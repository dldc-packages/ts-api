import { readFileSync } from "node:fs";
import { parse, type TParseOptions } from "./parse.ts";
import type { TTypesBase } from "../utils/types.ts";
import type { TGraphOf } from "./types.ts";

/**
 * Read a schema file from disk as a string (UTF-8).
 *
 * This module is **not** browser-safe: it imports `node:fs`. It exists so that
 * Deno/Node applications can keep the `parse(schemaPath)` one-liner, while the
 * main `@dldc/ts-api/server` entry stays free of filesystem access and can be
 * imported in a browser. Import it from `@dldc/ts-api/server/filesystem`.
 */
export function readSchemaFile(path: string): string {
  return readFileSync(path, "utf-8");
}

/**
 * Parse a schema file from disk into a graph object.
 *
 * Equivalent to `parse(readSchemaFile(path), options)`. See
 * {@link parse} for the source-based (pure, browser-safe) variant and
 * {@link TParseOptions}.
 */
export function parseFromFile<Types extends TTypesBase>(
  schemaPath: string,
  options: TParseOptions = {},
): TGraphOf<Types> {
  return parse<Types>(readSchemaFile(schemaPath), options);
}
