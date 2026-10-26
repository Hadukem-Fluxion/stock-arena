import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";

export function peakRss(text) {
  const match = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(text);
  if (!match) throw new Error("GNU time did not report peak RSS.");
  return Number(match[1]);
}
export function withinBudget(rssKiB, limitMB) {
  return limitMB === 0 || rssKiB * 1024 < limitMB * 1_000_000;
}
export function measure({
  root,
  label,
  output,
  heap = 512,
  production = false,
  limit = 400,
  allowFailure = false,
}) {
  if (process.platform !== "linux")
    throw new Error("Peak RSS comparison requires Linux and /usr/bin/time.");
  if (
    !/^[a-z-]+$/.test(label) ||
    !Number.isInteger(heap) ||
    heap < 128 ||
    heap > 4096 ||
    !Number.isFinite(limit) ||
    limit < 0
  )
    throw new Error("Invalid measurement options.");
  root = resolve(root);
  output = resolve(output);
  mkdirSync(output, { recursive: true });
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (revision.status !== 0) throw new Error("Cannot identify measured revision.");
  const entries = [];
  for (const name of ["api", "worker"]) {
    const file = join(output, `${label}-${name}`),
      config = production ? "tsconfig.production.json" : "tsconfig.json";
    const args = [
      `--max-old-space-size=${heap}`,
      ...(production ? ["--max-semi-space-size=1", "--optimize-for-size"] : []),
      join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      join(root, `apps/${name}/${config}`),
    ];
    const run = spawnSync(
      "/usr/bin/time",
      ["-v", "-o", `${file}.time`, process.execPath, ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "", LC_ALL: "C" },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    writeFileSync(`${file}.log`, (run.stdout ?? "") + (run.stderr ?? ""));
    if (run.error) throw new Error("Could not run compiler measurement.");
    const rssKiB = peakRss(readFileSync(`${file}.time`, "utf8"));
    entries.push({
      name,
      config,
      exitCode: run.status,
      peakRssKiB: rssKiB,
      peakRssMiB: Number((rssKiB / 1024).toFixed(2)),
      peakRssMB: Number(((rssKiB * 1024) / 1_000_000).toFixed(2)),
      passed: run.status === 0 && withinBudget(rssKiB, limit),
    });
  }
  const report = {
    label,
    revision: revision.stdout.trim(),
    node: process.version,
    platform: process.platform,
    heapMiB: heap,
    limitMB: limit,
    production,
    entries,
  };
  writeFileSync(join(output, `${label}.json`), JSON.stringify(report, null, 2) + "\n");
  const table = `\n### Typecheck RSS: ${label} (${report.revision})\n\n| Package | Config | Exit | Peak RSS MB | Peak RSS MiB |\n| --- | --- | --- | --- | --- |\n${entries.map((e) => `| ${e.name} | ${e.config} | ${e.exitCode} | ${e.peakRssMB} | ${e.peakRssMiB} |`).join("\n")}\n`;
  console.info(table);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
  if (!allowFailure && entries.some((e) => !e.passed))
    throw new Error("Compiler failed or exceeded the peak RSS budget.");
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2),
      value = (key, fallback) => {
        const i = args.indexOf(key);
        return i < 0 ? fallback : args[i + 1];
      };
    const root = value("--root", ".");
    const docker = readFileSync(resolve(root, "deploy/lightsail/Dockerfile"), "utf8");
    const defaultHeap = /ARG TYPECHECK_HEAP_MB=(\d+)/.exec(docker)?.[1] ?? "512";
    measure({
      root: value("--root", "."),
      label: value("--label", "after"),
      output: value("--output", ".corepack/typecheck-memory"),
      heap: Number(value("--heap", defaultHeap)),
      limit: Number(value("--limit-mb", "400")),
      production:
        args.includes("--production") ||
        (args.includes("--docker-profile") &&
          readFileSync(
            resolve(value("--root", "."), "deploy/lightsail/Dockerfile"),
            "utf8",
          ).includes("typecheck:production")),
      allowFailure: args.includes("--allow-failure"),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Memory measurement failed.");
    process.exitCode = 1;
  }
}
