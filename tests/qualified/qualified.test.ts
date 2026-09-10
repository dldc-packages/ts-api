import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { assertSnapshot } from "@std/testing/snapshot";
import * as v from "@valibot/valibot";
import { query, queryToObject } from "../../client.ts";
import {
  builtin,
  createBuiltins,
  createEngine,
  DEFAULT_BUILTINS,
  fn,
  parse,
  ROOT,
} from "../../server.ts";
import type { Graph } from "./graph.ts";

interface AllTypes {
  Graph: Graph;
}

const builtins = createBuiltins({
  ...DEFAULT_BUILTINS,
  "Temporal.PlainDate": builtin<Temporal.PlainDate>({
    getSchema: () => v.instance(Temporal.PlainDate),
  }),
});

const graph = parse<AllTypes>(
  resolve("./tests/qualified/graph.ts"),
  { builtins },
);

Deno.test("Qualified builtin snapshot structure", async (test) => {
  await assertSnapshot(test, graph[ROOT]);
});

const client = query<AllTypes>();

Deno.test("Qualified builtin as output", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.birthday, () => {
        return Temporal.PlainDate.from("2024-01-15");
      }),
    ],
  });

  const q = client.Graph.birthday();
  const { path, args } = queryToObject(q);
  const result = await engine.run({ path, args });
  assertEquals(result, Temporal.PlainDate.from("2024-01-15"));
});

Deno.test("Qualified builtin as input", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.daysBetween, (_ctx, [from, to]) => {
        return from.until(to).total("days");
      }),
    ],
  });

  const from = Temporal.PlainDate.from("2024-01-01");
  const to = Temporal.PlainDate.from("2024-01-15");
  const q = client.Graph.daysBetween(from, to);
  const { path, args } = queryToObject(q);
  const result = await engine.run({ path, args });
  assertEquals(result, 14);
});

Deno.test("Qualified builtin rejects invalid output", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.birthday, () => {
        return "not-a-plain-date" as any;
      }),
    ],
  });

  const q = client.Graph.birthday();
  const { path, args } = queryToObject(q);
  await assertRejects(
    async () => {
      await engine.run({ path, args });
    },
  );
});

Deno.test("Qualified builtin rejects invalid input", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.daysBetween, (_ctx, [from, to]) => {
        return from.until(to).total("days");
      }),
    ],
  });

  const q = client.Graph.daysBetween(
    "not-a-plain-date" as any,
    Temporal.PlainDate.from("2024-01-15"),
  );
  const { path, args } = queryToObject(q);
  await assertRejects(
    async () => {
      await engine.run({ path, args });
    },
  );
});
