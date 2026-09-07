import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../client.ts";
import { createEngine, fn, parse } from "../server.ts";
import type { TodoListTypes } from "./schemas/todolist.types.ts";

const client = query<TodoListTypes>();

const graph = parse<TodoListTypes>(
  resolve("./tests/schemas/todolist.ts"),
);

const engine = createEngine({
  graph,
  entry: "Graph",
  resolvers: [
    fn(
      graph.Graph.config,
      () => ({ env: { version: "1.0.0", num: 42, str: "hello", bool: true } }),
    ),
    fn(
      graph.Graph.apps.all,
      (_ctx, [_pagination]) => {
        return [
          { appName: "app1", todos: [] },
          { appName: "app2", todos: [] },
        ];
      },
    ),
    fn(
      graph.Graph.apps.byId,
      (_ctx, [id]) => {
        return { appName: id, todos: [] };
      },
    ),
  ],
});

Deno.test("simple query", async () => {
  const q = client.Graph.config();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, {
    env: { version: "1.0.0", num: 42, str: "hello", bool: true },
  });
});

Deno.test("call query", async () => {
  const q = client.Graph.apps.all({ limit: 10, page: 1 });
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, [
    { appName: "app1", todos: [] },
    { appName: "app2", todos: [] },
  ]);
});

Deno.test("call query with invalid params should throw", async () => {
  const q = client.Graph.apps.all({ limit: 10, yolo: true } as any);
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(
    async () => {
      await engine.run({ path: queryDef, args: variables });
    },
  );
  assertEquals(
    (err as Error).message,
    "Invalid arguments passed to root.Graph.apps.all",
  );
});

Deno.test("should throw when query does not target entry", async () => {
  const q = client.Graph.config();
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(
    async () => {
      await engine.run({
        path: ["Config", ...queryDef.slice(1)],
        args: variables,
      });
    },
  );
  assertEquals(
    (err as Error).message,
    `Invalid entry, all queries should start from "Graph" (requested: "Config")`,
  );
});

Deno.test("should throw when targeting a non-function", async () => {
  const err = await assertRejects(
    async () => {
      await engine.run({ path: ["Graph", "apps"], args: [] });
    },
  );
  assertEquals(
    (err as Error).message,
    "Query must target a function, got: object at root.Graph.apps",
  );
});
