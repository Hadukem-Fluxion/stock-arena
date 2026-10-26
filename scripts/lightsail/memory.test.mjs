import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { expect, it } from "vitest";
import { peakRss, withinBudget } from "./measure-typecheck.mjs";
it("parses compiler peak RSS and refuses missing measurements", () => {
  expect(peakRss("Maximum resident set size (kbytes): 312480\n")).toBe(312480);
  expect(() => peakRss("Exit status: 0\n")).toThrow();
  expect(withinBudget(390624, 400)).toBe(true);
  expect(withinBudget(390625, 400)).toBe(false);
});
it("keeps full CI typechecking and sequential strict production checks with an adjustable heap", () => {
  const file = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const docker = file("../../deploy/lightsail/Dockerfile"),
    ci = file("../../.github/workflows/ci.yml"),
    limited = file("../../.github/workflows/lightsail.yml");
  expect(ci).toContain("pnpm typecheck");
  expect(docker).toContain("ARG TYPECHECK_HEAP_MB=512");
  expect(docker).toMatch(
    /api typecheck:production\s*\\\s*&& NODE_OPTIONS=.*worker typecheck:production/,
  );
  for (const name of ["api", "worker"]) {
    const cfg = JSON.parse(file(`../../apps/${name}/tsconfig.production.json`));
    expect(cfg.extends).toBe("./tsconfig.json");
    expect(cfg.exclude).toEqual(["src/**/*.test.ts"]);
    expect(cfg.compilerOptions).toBeUndefined();
  }
  expect(limited).toContain("memory=1g");
  expect(limited).toContain("memory-swap=3g");
  expect(limited).toContain("--no-cache");
  expect(limited).toContain("--production");
});
