import { describe, expect, test } from "vite-plus/test";
import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import * as v from "valibot";
import { query, queryToObject } from "../../src/client/mod.ts";
import {
  builtin,
  createBuiltins,
  createEngine,
  DEFAULT_BUILTINS,
  fn,
  parse,
  ROOT,
} from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type { MyBuiltin } from "./builtins.ts";
import type { Graph } from "./graph.ts";

interface AllTypes {
  Graph: Graph;
}

const builtins = createBuiltins({
  ...DEFAULT_BUILTINS,
  MyBuiltin: builtin<MyBuiltin>({
    getSchema: () => v.string(),
  }),
});

const graph = parse<AllTypes>(loadSchema(resolve("./tests/builtins/graph.ts")), { builtins });

test("Snapshot structure", async () => {
  expect(graph[ROOT]).toMatchSnapshot();
});

const client = query<AllTypes>();

test("Properly parse MyBuiltin", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [fn(graph.Graph.now, () => "Hello")],
  });

  const q = client.Graph.now();
  const { path: queryDef, args: variables } = queryToObject(q);
  const res = await engine.run({ path: queryDef, args: variables });
  assertEquals(res, "Hello");
});

test("Fail if output is not a string", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [fn(graph.Graph.now, () => 42 as any)],
  });

  const q = client.Graph.now();
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(() => engine.run({ path: queryDef, args: variables }));
  assertEquals(
    (err as Error).message,
    "Invalid resolved value for root.Graph.now (expected: valid value, received: 42)",
  );
});

test("validateOutput: false skips return value validation", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    validateOutput: false,
    resolvers: [fn(graph.Graph.now, () => 42 as any)],
  });

  const q = client.Graph.now();
  const { path, args } = queryToObject(q);
  const result = await engine.run({ path, args });
  // The invalid (non-string) value is returned as-is, no validation error.
  assertEquals(result, 42);
});

describe("MyBuiltin input", () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(graph.Graph.doStuff, (_ctx, [builtin]) => {
        return builtin;
      }),
    ],
  });

  test("Parse MyBuiltin input", async () => {
    const q = client.Graph.doStuff("Hello");
    const { path: queryDef, args: variables } = queryToObject(q);
    const res = await engine.run({ path: queryDef, args: variables });
    assertEquals(res, "Hello");
  });

  test("Fail if input is not a string", async () => {
    const q = client.Graph.doStuff(42 as any);
    const { path: queryDef, args: variables } = queryToObject(q);
    const err = await assertRejects(() => engine.run({ path: queryDef, args: variables }));
    assertEquals((err as Error).message, "Invalid arguments passed to root.Graph.doStuff");
  });
});
