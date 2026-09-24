import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { assertSnapshot } from "@std/testing/snapshot";
import * as v from "@valibot/valibot";
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

const graph = parse<AllTypes>(
  loadSchema(resolve("./tests/builtins/graph.ts")),
  { builtins },
);

Deno.test("Snapshot structure", async (test) => {
  await assertSnapshot(test, graph[ROOT]);
});

const client = query<AllTypes>();

Deno.test("Properly parse MyBuiltin", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.now, () => "Hello"),
    ],
  });

  const q = client.Graph.now();
  const { path: queryDef, args: variables } = queryToObject(q);
  const res = await engine.run({ path: queryDef, args: variables });
  assertEquals(res, "Hello");
});

Deno.test("Fail if output is not a string", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.now, () => 42 as any),
    ],
  });

  const q = client.Graph.now();
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(() =>
    engine.run({ path: queryDef, args: variables })
  );
  assertEquals(
    (err as Error).message,
    "Invalid resolved value for root.Graph.now (expected: valid value, received: 42)",
  );
});

Deno.test("validateOutput: false skips return value validation", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    validateOutput: false,
    resolvers: [
      fn(graph.Graph.now, () => 42 as any),
    ],
  });

  const q = client.Graph.now();
  const { path, args } = queryToObject(q);
  const result = await engine.run({ path, args });
  // The invalid (non-string) value is returned as-is, no validation error.
  assertEquals(result, 42);
});

Deno.test("MyBuiltin input", async (t) => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.doStuff, (_ctx, [builtin]) => {
        return builtin;
      }),
    ],
  });

  await t.step("Parse MyBuiltin input", async () => {
    const q = client.Graph.doStuff("Hello");
    const { path: queryDef, args: variables } = queryToObject(q);
    const res = await engine.run({ path: queryDef, args: variables });
    assertEquals(res, "Hello");
  });

  await t.step("Fail if input is not a string", async () => {
    const q = client.Graph.doStuff(42 as any);
    const { path: queryDef, args: variables } = queryToObject(q);
    const err = await assertRejects(() =>
      engine.run({ path: queryDef, args: variables })
    );
    assertEquals(
      (err as Error).message,
      "Invalid arguments passed to root.Graph.doStuff",
    );
  });
});
