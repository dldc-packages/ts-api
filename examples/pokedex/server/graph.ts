import { resolve } from "@std/path";
import { createBuiltins } from "../../../src/server/mod.ts";
import { parseFromFile } from "../../../src/server/filesystem.ts";
import { webBuiltins } from "../../../src/transports/web/builtins.ts";
import type { Graph } from "../schema.ts";

const SCHEMA_PATH = resolve("./examples/pokedex/schema.ts");

/**
 * Parsing is unchanged except for one thing: the web transport needs its
 * `webBuiltins` (`QueryResult`, `MutationResult`, `StreamResult`) registered.
 * `createBuiltins` merges them with the default builtins, so the `Date`
 * builtin is still available.
 */
export const graph = parseFromFile<{ Graph: Graph }>(SCHEMA_PATH, {
  builtins: createBuiltins({ ...webBuiltins }),
});
