import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import type { IsExact } from "@std/testing/types";
import { query, queryToObject, type TQuery } from "../../client.ts";
import { createEngine, fn, parse } from "../../server.ts";
import { assertType } from "../utils/assertType.ts";
import type { Graph, Namespace } from "./graph.ts";

interface AllTypes {
  Graph: Graph;
  Namespace: Namespace;
}

const graph = parse<AllTypes>(
  resolve("./tests/date/graph.ts"),
);

const client = query<AllTypes>();

Deno.test("Properly parse Date", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.sub.now, () => new Date("2021-01-01T00:00:00.000Z")),
    ],
  });

  const q = client.Graph.sub.now();
  const { path: queryDef, args: variables } = queryToObject(q);
  const res = await engine.run({ path: queryDef, args: variables });
  assertEquals(res instanceof Date, true);
  assertEquals((res as Date).toISOString(), "2021-01-01T00:00:00.000Z");
});

Deno.test("Fail if output is not a date", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.sub.now, () => 42 as any),
    ],
  });

  const q = client.Graph.sub.now();
  assertType<IsExact<typeof q, TQuery<Date>>>(true);
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(() =>
    engine.run({ path: queryDef, args: variables })
  );
  assertEquals(
    (err as Error).message,
    "Invalid resolved value for root.Namespace.now (expected: valid value, received: 42)",
  );
});

Deno.test("Date input", async (t) => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.sub.doStuff, (_ctx, [date]) => {
        return date.toISOString();
      }),
    ],
  });

  await t.step("Parse Date input", async () => {
    const q = client.Graph.sub.doStuff(
      new Date("2021-01-01T00:00:00.000Z"),
    );
    const { path: queryDef, args: variables } = queryToObject(q);
    const res = await engine.run({ path: queryDef, args: variables });
    assertEquals(res, "2021-01-01T00:00:00.000Z");
  });

  await t.step("Fail if input is not a date", async () => {
    const q = client.Graph.sub.doStuff(42 as any);
    const { path: queryDef, args: variables } = queryToObject(q);
    const err = await assertRejects(() =>
      engine.run({ path: queryDef, args: variables })
    );
    assertEquals(
      (err as Error).message,
      "Invalid arguments passed to root.Namespace.doStuff",
    );
  });
});
