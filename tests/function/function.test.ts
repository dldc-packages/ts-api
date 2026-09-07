import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../client.ts";
import { createEngine, fn, parse } from "../../server.ts";
import type { Graph, Namespace, StuffResult } from "./graph.ts";

interface AllTypes {
  Graph: Graph;
  Namespace: Namespace;
  StuffResult: StuffResult;
}

const graph = parse<AllTypes>(
  resolve("./tests/function/graph.ts"),
);

const client = query<AllTypes>();

Deno.test("Fails if no resolver", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [],
  });

  const q = client.Graph.sub.doStuff("hello", 1, { key: "value" });
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(() =>
    engine.run({ path: queryDef, args: variables })
  );
  assertEquals(
    (err as Error).message,
    "Invalid resolved value for root.Namespace.doStuff (expected: valid value, received: undefined)",
  );
});

Deno.test("get function results", async () => {
  let args: any[] = [];

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(
        graph.Graph.sub.doStuff,
        (_ctx, [str, num, obj]) => {
          args = [str, num, obj];
          return { data: "hello", num: 42 };
        },
      ),
    ],
  });

  const q = client.Graph.sub.doStuff("hello", 1, { key: "value" });
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, { data: "hello", num: 42 });
  assertEquals(args, ["hello", 1, { key: "value" }]);
});
