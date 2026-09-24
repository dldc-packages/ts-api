import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../src/client/mod.ts";
import {
  builtin,
  createBuiltins,
  createEngine,
  fn,
  parse,
} from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import * as v from "@valibot/valibot";
import type { Graph as ImportedDataGraph } from "./imported-data.ts";
import type { Graph as ImportedNamespaceGraph } from "./imported-namespace.ts";
import type { Graph as IndexedGraph } from "./indexed.ts";
import type { Graph as MappedGraph } from "./mapped.ts";
import type { Settings, Token, UsersNamespace } from "./imported-types.ts";

const client = query<{ Graph: ImportedDataGraph }>();

// Opaque builtins for the imported types (they are data, validated via schema).
const opaque = <T>() => builtin<T>({ getSchema: () => v.unknown() });

const importedBuiltins = createBuiltins({
  Settings: opaque<Settings>(),
  Token: opaque<Token>(),
  UsersNamespace: opaque<UsersNamespace>(),
});

/**
 * Calls `fn` and returns the thrown error, or throws if nothing is thrown.
 */
function expectThrow(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("Expected to throw");
}

Deno.test("mapped type (K in keyof) is not supported", () => {
  const err = expectThrow(() =>
    parse<{ Graph: MappedGraph }>(
      loadSchema(resolve("./tests/unsupported/mapped.ts")),
    )
  );
  assertEquals(err.message.includes("MappedType"), true);
});

Deno.test("indexed access type (T['k']) is not supported", () => {
  const err = expectThrow(() =>
    parse<{ Graph: IndexedGraph }>(
      loadSchema(resolve("./tests/unsupported/indexed.ts")),
    )
  );
  assertEquals(err.message.includes("IndexedAccessType"), true);
});

Deno.test("imported type used as a namespace fails", () => {
  const err = expectThrow(() =>
    parse<{ Graph: ImportedNamespaceGraph }>(
      loadSchema(resolve("./tests/unsupported/imported-namespace.ts")),
      { builtins: importedBuiltins },
    )
  );
  assertEquals(
    err.message,
    `Imported type "UsersNamespace" is used as a namespace, which is not supported. ` +
      "Imported types can only be used as function input/output (registered as builtins) " +
      "or as data fields of non-namespace interfaces. " +
      'Declare "UsersNamespace" directly in the schema file instead.',
  );
});

Deno.test("imported type used as a namespace fails even without a builtin", () => {
  const err = expectThrow(() =>
    parse<{ Graph: ImportedNamespaceGraph }>(
      loadSchema(resolve("./tests/unsupported/imported-namespace.ts")),
    )
  );
  assertEquals(err.message.includes("used as a namespace"), true);
});

Deno.test("imported types used as data are allowed", async () => {
  const graph = parse<{ Graph: ImportedDataGraph }>(
    loadSchema(resolve("./tests/unsupported/imported-data.ts")),
    { builtins: importedBuiltins },
  );

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.get, () => ({
        settings: { theme: "dark" },
        token: "abc",
      })),
      fn(graph.Graph.echo, (_ctx, [value]) => value),
    ],
  });

  // Input: imported `Token` flows through the endpoint.
  const echoReq = queryToObject(client.Graph.echo("hello"));
  assertEquals(await engine.run(echoReq), "hello");

  // Output: `User` (containing imported data fields) is returned.
  const getReq = queryToObject(client.Graph.get());
  assertEquals(await engine.run(getReq), {
    settings: { theme: "dark" },
    token: "abc",
  });
});
