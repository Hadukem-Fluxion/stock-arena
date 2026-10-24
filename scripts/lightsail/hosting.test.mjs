import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import process from "node:process";
import { URL } from "node:url";
import { rotateSecrets } from "./rotate-secrets.mjs";
import { validateEnvironment, validateOhioEnvironment } from "./validate-env.mjs";

const directories = [];
function temporary() {
  const path = mkdtempSync(join(tmpdir(), "mstocks-hosting-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("bootstrap firewall", () => {
  it.skipIf(process.platform === "win32")(
    "keeps SSH/HTTP/HTTPS open without pinning a client IP or provisioning the host",
    () => {
      const folder = temporary(),
        log = join(folder, "ufw-calls");
      writeFileSync(
        join(folder, "ufw"),
        '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$FIREWALL_TEST_LOG"\n',
        { mode: 0o755 },
      );
      const script = fileURLToPath(new URL("../../deploy/lightsail/bootstrap.sh", import.meta.url));
      const result = spawnSync(
        "bash",
        ["-c", 'source "$1"; configure_firewall', "synthetic-bootstrap", script],
        {
          encoding: "utf8",
          env: { ...process.env, PATH: folder + ":" + process.env.PATH, FIREWALL_TEST_LOG: log },
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
        "default deny incoming",
        "default allow outgoing",
        "allow 22/tcp",
        "allow 80/tcp",
        "allow 443/tcp",
        "--force enable",
      ]);
      expect(result.stdout).toBe("");
    },
  );
});

describe.skipIf(process.platform === "win32")("live HTTPS startup checks", () => {
  function liveCheck(mode) {
    const folder = temporary(),
      log = join(folder, "curl-calls"),
      count = join(folder, "https-attempts");
    writeFileSync(join(folder, "docker"), "#!/usr/bin/env bash\nexit 99\n", { mode: 0o755 });
    writeFileSync(
      join(folder, "curl"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SMOKE_TEST_LOG"
url="\${!#}"
if [[ $url == http://127.0.0.1:* ]]; then
  [[ $SMOKE_TEST_MODE != local-failure ]] || exit 7
  printf '{"ok":true}'
  exit 0
fi
n=0
[[ ! -f $SMOKE_TEST_COUNT ]] || read -r n < "$SMOKE_TEST_COUNT"
n=$((n + 1))
printf '%s\\n' "$n" > "$SMOKE_TEST_COUNT"
if [[ $SMOKE_TEST_MODE == permanent || $n -le 2 ]]; then
  case $SMOKE_TEST_MODE in
    empty) exit 0 ;;
    malformed) printf 'synthetic-private-response'; exit 0 ;;
    unhealthy) printf '{"ok":false}'; exit 0 ;;
    *) printf 'synthetic-private-curl-error' >&2; exit 60 ;;
  esac
fi
printf '{"ok":true}'
`,
      { mode: 0o755 },
    );
    const script = fileURLToPath(new URL("../../deploy/lightsail/smoke-test.sh", import.meta.url));
    const result = spawnSync(
      "bash",
      [
        "-c",
        // Advance the shell deadline without real sleeps, network or Compose operations.
        'sleep() { SECONDS=$((SECONDS + $1)); }; export -f sleep; exec bash "$1" --live',
        "synthetic-smoke",
        script,
      ],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: folder + ":" + process.env.PATH,
          SMOKE_TEST_LOG: log,
          SMOKE_TEST_COUNT: count,
          SMOKE_TEST_MODE: mode,
        },
      },
    );
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.every((call) => call.includes("--fail --silent --show-error --max-time"))).toBe(
      true,
    );
    expect(calls.some((call) => /--insecure|(?:^|\s)-k(?:\s|$)/.test(call))).toBe(false);
    expect(result.stdout + result.stderr).not.toMatch(
      /synthetic-private|Traceback|JSONDecodeError/,
    );
    return { result, calls };
  }
  it.each(["tls", "empty", "malformed", "unhealthy"])(
    "retries %s failures before parsing a healthy HTTPS response",
    (mode) => {
      const { result, calls } = liveCheck(mode);
      expect(result.status).toBe(0);
      expect(calls).toHaveLength(4);
      expect(result.stdout).toBe("Live health checks passed; no services or data changed.\n");
      expect(result.stderr).toBe("");
    },
  );
  it("stops at the 60-second deadline with a concise error and no response body", () => {
    const { result, calls } = liveCheck("permanent");
    expect(result.status).toBe(1);
    expect(calls.length).toBeGreaterThan(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "HTTPS health check failed after 60 seconds; check DNS, firewall and Caddy logs.\n",
    );
  });
  it("fails a broken local API before attempting HTTPS", () => {
    const { result, calls } = liveCheck("local-failure");
    expect(result.status).toBe(1);
    expect(calls).toHaveLength(1);
    expect(result.stderr).toBe("Local API health check failed; check service status.\n");
  });
});

describe("hosting secret rotation", () => {
  it("generates independent URL-safe 48-character secrets, deduplicating only those keys", () => {
    const file = join(temporary(), ".env");
    writeFileSync(
      file,
      "# Keep this comment\r\nDATABASE_URL=synthetic-value\r\nexport SESSION_SECRET=old\r\nSESSION_SECRET=duplicate\r\nTELEGRAM_WEBHOOK_SECRET=old\r\nOTHER=value\r\n",
    );
    rotateSecrets(file);
    const content = readFileSync(file, "utf8");
    const session = content.match(/^SESSION_SECRET=([A-Za-z0-9_-]{48})$/m)?.[1];
    const webhook = content.match(/^TELEGRAM_WEBHOOK_SECRET=([A-Za-z0-9_-]{48})$/m)?.[1];
    expect(session).toHaveLength(48);
    expect(webhook).toHaveLength(48);
    expect(session).not.toBe(webhook);
    expect(content.match(/SESSION_SECRET=/g)).toHaveLength(1);
    expect(content).toContain("DATABASE_URL=synthetic-value\n");
    expect(content).toContain("OTHER=value\n");
    rotateSecrets(file);
    expect(readFileSync(file, "utf8")).not.toContain(session);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it("creates a new file without printing values, including on invalid CLI input", () => {
    const file = join(temporary(), ".env");
    const script = fileURLToPath(new URL("./rotate-secrets.mjs", import.meta.url));
    const stdout = execFileSync(process.execPath, [script, "--file", file], { encoding: "utf8" });
    expect(stdout).toBe("Session and Telegram webhook secrets rotated; no values displayed.\n");
    const invalid = spawnSync(process.execPath, [script, "--file", join(file, "unavailable")], {
      encoding: "utf8",
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).not.toContain(file);
  });
  it.skipIf(process.platform === "win32")(
    "rejects regular and dangling symlinks without modifying their target",
    () => {
      const folder = temporary();
      const target = join(folder, "target");
      const link = join(folder, "link");
      writeFileSync(target, "untouched");
      symlinkSync(target, link);
      expect(() => rotateSecrets(link)).toThrow("Unsafe environment file.");
      expect(readFileSync(target, "utf8")).toBe("untouched");
      const dangling = join(folder, "dangling");
      symlinkSync(join(folder, "missing"), dangling);
      expect(() => rotateSecrets(dangling)).toThrow("Unsafe environment file.");
    },
  );
});
describe("production environment guard", () => {
  it("validates the Ohio file without printing secrets and rejects templates/old database", () => {
    const env = {
      DATABASE_URL:
        "postgresql://postgres.fhslaelrgoiibblgfinu:synthetic@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require",
      SESSION_SECRET: "s".repeat(48),
      TELEGRAM_WEBHOOK_SECRET: "w".repeat(48),
      DISCORD_CLIENT_ID: "1560368721216938175",
      DISCORD_CLIENT_SECRET: "synthetic-private-marker",
      DISCORD_PUBLIC_KEY: "a".repeat(64),
      TELEGRAM_BOT_TOKEN: "123:synthetic",
      TELEGRAM_BOT_USERNAME: "mStocksArenaBot",
      TELEGRAM_WEBHOOK_URL: "https://77-114-44-78.sslip.io/api/telegram/webhook",
      OWNER_DISCORD_ID: "1225988280596824094",
      ADMIN_WEB_ORIGIN: "https://mstocks-arena.vercel.app",
    };
    expect(() => validateOhioEnvironment(env)).not.toThrow();
    for (const invalid of [
      { ...env, DISCORD_CLIENT_SECRET: "CHANGE_ME" },
      {
        ...env,
        DATABASE_URL: env.DATABASE_URL.replace("fhslaelrgoiibblgfinu", "djlyrllwnvvljxexusbw"),
      },
      { ...env, TELEGRAM_WEBHOOK_URL: "http://example.invalid" },
    ])
      expect(() => validateOhioEnvironment(invalid)).toThrow("Invalid Ohio configuration.");
    const file = join(temporary(), ".env");
    writeFileSync(
      file,
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    const script = fileURLToPath(new URL("./validate-env.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, "api", "--file", file], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Hosting environment valid; no values displayed.\n");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(env.SESSION_SECRET, "private-failure-marker"),
    );
    const failed = spawnSync(process.execPath, [script, "api", "--file", file], {
      encoding: "utf8",
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).not.toContain("private-failure-marker");
    expect(failed.stdout).toBe("");
  });
  const env = {
    DATABASE_URL: "postgresql://synthetic@db.invalid/postgres",
    SESSION_SECRET: "s".repeat(48),
  };
  it("requires Postgres so API and worker cannot accidentally use separate PGlite files", () => {
    for (const role of ["api", "worker", "migrate"]) {
      expect(() => validateEnvironment(role, { ...env, DATABASE_URL: "" })).toThrow();
      expect(() =>
        validateEnvironment(role, { ...env, DATABASE_URL: "https://db.invalid" }),
      ).toThrow();
      expect(() => validateEnvironment(role, env)).not.toThrow();
    }
  });
  it("requires rotated API/webhook secrets, permits an unconfigured Telegram provider and rejects unknown services", () => {
    expect(() => validateEnvironment("api", { ...env, SESSION_SECRET: "old-secret" })).toThrow();
    expect(() =>
      validateEnvironment("api", { ...env, TELEGRAM_BOT_TOKEN: "fake-token" }),
    ).toThrow();
    expect(() =>
      validateEnvironment("api", {
        ...env,
        TELEGRAM_BOT_TOKEN: "fake-token",
        TELEGRAM_WEBHOOK_SECRET: "w".repeat(48),
      }),
    ).not.toThrow();
    expect(() => validateEnvironment("worker", { DATABASE_URL: env.DATABASE_URL })).not.toThrow();
    expect(() => validateEnvironment("unexpected", env)).toThrow();
  });
  it("suppresses raw credential-bearing errors at the CLI boundary", () => {
    const script = fileURLToPath(new URL("./validate-env.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, "migrate"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "synthetic-sensitive-value" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("synthetic-sensitive-value");
    expect(result.stderr).not.toContain("Error:");
  });
});
