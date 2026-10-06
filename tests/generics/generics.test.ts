import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../src/client/mod.ts";
import { createEngine, fn, parse } from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type { Graph, ListParams, Paginated, TodoItem } from "./graph.ts";

export interface AllTypes {
  Graph: Graph;
  Paginated: Paginated<any>;
  ListParams: ListParams<any>;
  TodoItem: TodoItem;
}

const client = query<AllTypes>();

const graph = parse<AllTypes>(
  loadSchema(resolve("./tests/generics/graph.ts")),
);

Deno.test("Fails if no resolver", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [],
  });

  const q = client.Graph.todos();
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(() =>
    engine.run({ path: queryDef, args: variables })
  );
  assertEquals(
    (err as Error).message,
    "Invalid resolved value for root.Graph.todos (expected: valid value, received: undefined)",
  );
});

Deno.test("get generic results", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.todos,
        () => ({
          total: 1,
          data: [{ name: "todo1", done: true }],
        }),
      ),
    ],
  });

  const q = client.Graph.todos();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, {
    total: 1,
    data: [{ name: "todo1", done: true }],
  });
});

Deno.test("Resolver in generic", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.todos,
        () => ({
          total: 0,
          data: [],
        }),
      ),
    ],
  });

  const q = client.Graph.todos();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, {
    total: 0,
    data: [],
  });
});

Deno.test("Fails if a property is missing", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.todos,
        () => ({
          data: [],
        } as any),
      ),
    ],
  });

  const q = client.Graph.todos();
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(() =>
    engine.run({ path: queryDef, args: variables })
  );
  assertEquals(
    (err as Error).message,
    'Invalid resolved value for root.Graph.todos (expected: valid value, received: {"data":[]})',
  );
});

Deno.test("nested function with generic", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.nested,
        (_ctx, [num]) => {
          assertEquals(num, 42);
          return { name: "todo1", done: true };
        },
      ),
    ],
  });

  const q = client.Graph.nested(42);
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, { name: "todo1", done: true });
});

Deno.test("generic as input: createMany receives Paginated<TodoItem>", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.createMany,
        (_ctx, [items]) => {
          return items.data;
        },
      ),
    ],
  });

  const q = client.Graph.createMany({
    total: 2,
    data: [
      { name: "todo1", done: true },
      { name: "todo2", done: false },
    ],
  });
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, [
    { name: "todo1", done: true },
    { name: "todo2", done: false },
  ]);
});

Deno.test("generic as input: search receives ListParams<string>", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.search,
        (_ctx, [params]) => {
          return [{ name: params.filter ?? "all", done: false }];
        },
      ),
    ],
  });

  const q = client.Graph.search({ filter: "buy", page: 1 });
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, [{ name: "buy", done: false }]);
});

Deno.test("generic as input: search with optional filter omitted", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.search,
        (_ctx, [params]) => {
          return [{ name: params.filter ?? "all", done: false }];
        },
      ),
    ],
  });

  const q = client.Graph.search({ page: 2 });
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, [{ name: "all", done: false }]);
});

Deno.test("generic input validation: createMany rejects invalid data", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.createMany,
        (_ctx, [items]) => {
          return items.data;
        },
      ),
    ],
  });

  const q = client.Graph.createMany({
    total: 1,
    data: [{ name: "todo1", done: "not-a-boolean" as any }],
  });
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(
    async () => {
      await engine.run({ path: queryDef, args: variables });
    },
  );
  assertEquals(
    (err as Error).message,
    "Invalid arguments passed to root.Graph.createMany",
  );
});

Deno.test("nested declared generic: Paginated<Paginated<TodoItem>> resolves", async () => {
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.nestedPaginated,
        () => ({
          total: 1,
          data: [{ total: 1, data: [{ name: "todo1", done: true }] }],
        }),
      ),
    ],
  });

  const q = client.Graph.nestedPaginated();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, {
    total: 1,
    data: [{ total: 1, data: [{ name: "todo1", done: true }] }],
  });
});

Deno.test("nested declared generic output is validated deeply", async () => {
  // The inner `Paginated<TodoItem>` is validated too: `done` is a boolean, so
  // the resolver returning a string must be rejected.
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      fn(
        graph.Graph.nestedPaginated,
        () =>
          ({
            total: 1,
            data: [{ total: 1, data: [{ name: "todo1", done: "yes" }] }],
          }) as any,
      ),
    ],
  });

  const q = client.Graph.nestedPaginated();
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(() =>
    engine.run({ path: queryDef, args: variables })
  );
  assertEquals(
    (err as Error).message.startsWith(
      "Invalid resolved value for root.Graph.nestedPaginated",
    ),
    true,
  );
});
