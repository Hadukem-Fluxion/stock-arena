import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const expected = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8")
  .trim()
  .replace(/^v/, "");
if (process.versions.node !== expected) {
  throw new Error("Node version must match .nvmrc. Use the pinned deployment runtime.");
}
