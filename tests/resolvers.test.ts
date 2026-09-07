import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../client.ts";
import { createEngine, fn, parse, resolver } from "../server.ts";
import type { TodoListTypes } from "./schemas/todolist.types.ts";

const client = query<TodoListTypes>();

const graph = parse<TodoListTypes>(
  resolve("./tests/schemas/todolist.ts"),
);

Deno.test("Resolver order on same node", async () => {
  const order: number[] = [];

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      resolver(
        graph.Graph.config,
        (ctx, next) => {
          order.push(1);
          return next(ctx);
        },
        (ctx, next) => {
          order.push(2);
          return next(ctx);
        },
        () => {
          return { env: { version: "1.0.0", num: 0, str: "", bool: false } };
        },
      ),
    ],
  });

  const q = client.Graph.config();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, {
    env: { version: "1.0.0", num: 0, str: "", bool: false },
  });
  assertEquals(order, [1, 2]);
});

Deno.test("Namespace resolver wraps function resolver", async () => {
  const order: string[] = [];

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      resolver(
        graph.Graph,
        (ctx, next) => {
          order.push("namespace");
          return next(ctx);
        },
      ),
      fn(
        graph.Graph.config,
        () => {
          order.push("function");
          return { env: { version: "1.0.0", num: 0, str: "", bool: false } };
        },
      ),
    ],
  });

  const q = client.Graph.config();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, {
    env: { version: "1.0.0", num: 0, str: "", bool: false },
  });
  assertEquals(order, ["namespace", "function"]);
});
