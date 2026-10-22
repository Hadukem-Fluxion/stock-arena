import { randomBytes } from "node:crypto";
import process from "node:process";
import console from "node:console";
import {
  chmodSync,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Explicit operator rotation. Never print file contents, values or raw filesystem errors. */
export function rotateSecrets(path) {
  const file = resolve(path);
  const previous = lstatSync(file, { throwIfNoEntry: false });
  if (previous && (!previous.isFile() || previous.isSymbolicLink()))
    throw new Error("Unsafe environment file.");
  const source = previous ? readFileSync(file, "utf8") : "";
  const values = new Map(
    ["SESSION_SECRET", "TELEGRAM_WEBHOOK_SECRET"].map((key) => [
      key,
      randomBytes(36).toString("base64url"),
    ]),
  );
  const lines = source
    .split(/\r?\n/)
    .filter(
      (line) => !/^\s*(?:export\s+)?(?:SESSION_SECRET|TELEGRAM_WEBHOOK_SECRET)\s*=/.test(line),
    );
  while (lines.at(-1) === "") lines.pop();
  for (const [key, value] of values) lines.push(`${key}=${value}`);
  const temporary = join(dirname(file), `.${basename(file)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${lines.join("\n")}\n`, "utf8");
    } finally {
      closeSync(descriptor);
    }
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--file")
      throw new Error("Invalid arguments.");
    rotateSecrets(process.argv[3]);
    console.info("Session and Telegram webhook secrets rotated; no values displayed.");
  } catch {
    console.error(
      "Secret rotation failed. Check the target file and permissions; no values displayed.",
    );
    process.exitCode = 1;
  }
}
