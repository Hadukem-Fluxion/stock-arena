import { readFileSync } from "node:fs";
import { parseCatalog } from "./parse.js";
// Node-only subpath: JSON never enters TypeScript's inferred object graph or the browser.
const source: unknown = JSON.parse(
  readFileSync(new URL("./extended.generated.json", import.meta.url), "utf8"),
);
const catalog = parseCatalog(source);
export const EXTENDED_ASSETS = catalog.assets;
export const EXTENDED_CATALOG_VERSION = catalog.version;
export const EXTENDED_CATALOG_METADATA = catalog.metadata;
