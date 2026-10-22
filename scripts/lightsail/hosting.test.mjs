import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import process from "node:process";
import { URL } from "node:url";
import { rotateSecrets } from "./rotate-secrets.mjs";
import { validateEnvironment } from "./validate-env.mjs";

const directories = [];
function temporary() {
  const path = mkdtempSync(join(tmpdir(), "mstocks-hosting-"));
  directories.push(path);
  return path;
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
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
