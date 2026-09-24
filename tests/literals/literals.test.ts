import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../src/client/mod.ts";
import { createEngine, fn, parse } from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import { ROOT } from "../../src/server/constants.ts";
import type { LiteralTypes } from "./literals.types.ts";

const graph = parse<LiteralTypes>(
  loadSchema(resolve("./tests/literals/graph.ts")),
);

const client = query<LiteralTypes>();

Deno.test("String literals with escape sequences are parsed via getLiteralValue", () => {
  const struct = graph[ROOT].types.find((s) => s.name === "StringWithEscapes");
  assertEquals(struct, {
    "kind": "alias",
    "key": "root.StringWithEscapes",
    "name": "StringWithEscapes",
    "type": {
      "kind": "union",
      "key": "root.StringWithEscapes.type",
      "types": [
        {
          "kind": "literal",
          "key": "root.StringWithEscapes.type.0",
          "type": "hello\nworld",
        },
        {
          "kind": "literal",
          "key": "root.StringWithEscapes.type.1",
          "type": "emoji\uD83D\uDE00",
        },
        {
          "kind": "literal",
          "key": "root.StringWithEscapes.type.2",
          "type": "tab\there",
        },
      ],
    },
    "parameters": [],
  });
});

Deno.test("Numeric literals are supported", () => {
  const struct = graph[ROOT].types.find((s) => s.name === "NumericLiterals");
  assertEquals(struct, {
    "kind": "alias",
    "key": "root.NumericLiterals",
    "name": "NumericLiterals",
    "type": {
      "kind": "union",
      "key": "root.NumericLiterals.type",
      "types": [
        { "kind": "literal", "key": "root.NumericLiterals.type.0", "type": 42 },
        { "kind": "literal", "key": "root.NumericLiterals.type.1", "type": 0 },
        { "kind": "literal", "key": "root.NumericLiterals.type.2", "type": -7 },
      ],
    },
    "parameters": [],
  });
});

Deno.test("Mixed literals (string, number, boolean, null) are supported", () => {
  const struct = graph[ROOT].types.find((s) => s.name === "MixedLiterals");
  assertEquals(struct, {
    "kind": "alias",
    "key": "root.MixedLiterals",
    "name": "MixedLiterals",
    "type": {
      "kind": "nullable",
      "key": "root.MixedLiterals.type",
      "type": {
        "kind": "union",
        "key": "root.MixedLiterals.type",
        "types": [
          {
            "kind": "literal",
            "key": "root.MixedLiterals.type.0",
            "type": "admin",
          },
          {
            "kind": "literal",
            "key": "root.MixedLiterals.type.1",
            "type": 200,
          },
          {
            "kind": "literal",
            "key": "root.MixedLiterals.type.2",
            "type": true,
          },
          {
            "kind": "literal",
            "key": "root.MixedLiterals.type.3",
            "type": false,
          },
        ],
      },
    },
    "parameters": [],
  });
});

Deno.test("Resolve numeric literal", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.numericLiterals, () => 42 as const),
    ],
  });

  const q = client.Graph.numericLiterals();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, 42);
});

Deno.test("Fail with invalid numeric literal", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.numericLiterals, () => 99 as any),
    ],
  });

  const q = client.Graph.numericLiterals();
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(() =>
    engine.run({ path: queryDef, args: variables })
  );
  assertEquals(
    (err as Error).message,
    "Invalid resolved value for root.Graph.numericLiterals (expected: valid value, received: 99)",
  );
});

Deno.test("Resolve string with escape sequences", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.stringWithEscapes, () => "hello\nworld" as const),
    ],
  });

  const q = client.Graph.stringWithEscapes();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, "hello\nworld");
});

Deno.test("Resolve mixed literal (null)", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.mixedLiterals, () => null),
    ],
  });

  const q = client.Graph.mixedLiterals();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, null);
});

Deno.test("Resolve mixed literal (number)", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.mixedLiterals, () => 200 as const),
    ],
  });

  const q = client.Graph.mixedLiterals();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, 200);
});
