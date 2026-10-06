import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import * as v from "@valibot/valibot";
import { query, queryToObject } from "../../src/client/mod.ts";
import {
  builtin,
  createBuiltins,
  createEngine,
  fn,
  parse,
  ROOT,
} from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type { Page } from "./builtins.ts";
import type { Graph } from "./graph.ts";

interface AllTypes {
  Graph: Graph;
}

// Records the valibot `type` tag of every generic-param schema each getSchema
// call receives, so we can assert the params are forwarded correctly.
const seenParamTypes: string[][] = [];
const paramCounts: number[] = [];

const builtins = createBuiltins({
  Page: builtin<Page<any>>({
    parameters: ["T"],
    getSchema: (params) => {
      paramCounts.push(params.length);
      seenParamTypes.push(
        params.map((p) => (p as { type?: string }).type ?? "?"),
      );
      const [itemSchema] = params;
      return v.object({
        items: itemSchema ? v.array(itemSchema) : v.unknown(),
        cursor: v.string(),
      });
    },
  }),
});

const graph = parse<AllTypes>(
  loadSchema(resolve("./tests/builtins-generic/graph.ts")),
  { builtins },
);

const client = query<AllTypes>();

function engine(resolvers: Parameters<typeof createEngine>[0]["resolvers"]) {
  return createEngine({
    graph,
    entries: ["Graph"],
    resolvers,
  });
}

Deno.test("Snapshot structure", async (test) => {
  await test.assertSnapshot(graph[ROOT]);
});

Deno.test("getSchema receives the schema of the generic param (output)", async () => {
  seenParamTypes.length = 0;
  paramCounts.length = 0;
  const e = engine([
    fn(graph.Graph.todos, () => ({
      cursor: "c1",
      items: [{ title: "Buy milk", done: false }],
    })),
  ]);

  const q = client.Graph.todos();
  const { path, args } = queryToObject(q);
  const res = await e.run({ path, args });
  assertEquals(res, {
    cursor: "c1",
    items: [{ title: "Buy milk", done: false }],
  });

  // One call, with a single param whose schema is the `Todo` interface
  // (validated with a strict object schema).
  assertEquals(paramCounts, [1]);
  assertEquals(seenParamTypes, [["strict_object"]]);
});

Deno.test("generic builtin output is validated against its param schema", async () => {
  // `Todo` requires `title: string` and `done: boolean` — missing `done`.
  const e = engine([
    fn(graph.Graph.todos, () =>
      ({
        cursor: "c1",
        items: [{ title: "Buy milk" }],
      }) as any),
  ]);

  const q = client.Graph.todos();
  const { path, args } = queryToObject(q);
  const err = await assertRejects(() => e.run({ path, args }));
  assertEquals(
    (err as Error).message.startsWith(
      "Invalid resolved value for root.Graph.todos",
    ),
    true,
  );
});

Deno.test("getSchema receives the schema of the generic param (input)", async () => {
  seenParamTypes.length = 0;
  paramCounts.length = 0;
  const e = engine([
    fn(graph.Graph.pageOfStrings, (_ctx, [page]) => page.items.length),
  ]);

  const q = client.Graph.pageOfStrings({
    cursor: "c2",
    items: ["a", "b", "c"],
  });
  const { path, args } = queryToObject(q);
  const res = await e.run({ path, args });
  assertEquals(res, 3);

  // The argument's `Page<string>` is validated against a string item schema.
  assertEquals(paramCounts, [1]);
  assertEquals(seenParamTypes, [["string"]]);
});

Deno.test("generic builtin input is validated against its param schema", async () => {
  const e = engine([
    fn(graph.Graph.pageOfStrings, (_ctx, [page]) => page.items.length),
  ]);

  // items must be strings — a number should be rejected.
  const q = client.Graph.pageOfStrings(
    { cursor: "c2", items: ["a", 42] } as any,
  );
  const { path, args } = queryToObject(q);
  const err = await assertRejects(() => e.run({ path, args }));
  assertEquals(
    (err as Error).message,
    "Invalid arguments passed to root.Graph.pageOfStrings",
  );
});

Deno.test("nested generic builtin", async () => {
  seenParamTypes.length = 0;
  paramCounts.length = 0;
  const e = engine([
    fn(graph.Graph.nested, () => ({
      cursor: "c3",
      items: [{ cursor: "inner", items: [1, 2, 3] }],
    })),
  ]);

  const q = client.Graph.nested();
  const { path, args } = queryToObject(q);
  const res = await e.run({ path, args });
  assertEquals(res, {
    cursor: "c3",
    items: [{ cursor: "inner", items: [1, 2, 3] }],
  });

  // Inner Page<number> is resolved first (it receives the number schema), then
  // the outer Page<...> receives the resulting inner object schema.
  assertEquals(paramCounts, [1, 1]);
  assertEquals(seenParamTypes, [["number"], ["object"]]);
});

Deno.test("generic builtin param can be another generic declared type", async () => {
  seenParamTypes.length = 0;
  paramCounts.length = 0;
  // `Page<Todo | null>` — the single param is the nullable Todo schema.
  const e = engine([
    fn(graph.Graph.pageOfMaybeTodo, () => ({
      cursor: "c4",
      items: [null, { title: "x", done: true }],
    })),
  ]);

  const q = client.Graph.pageOfMaybeTodo();
  const { path, args } = queryToObject(q);
  const res = await e.run({ path, args });
  assertEquals(res, {
    cursor: "c4",
    items: [null, { title: "x", done: true }],
  });

  assertEquals(paramCounts, [1]);
  assertEquals(seenParamTypes, [["nullable"]]);
});

Deno.test("generic builtin with wrong number of type arguments fails", async () => {
  // Using a generic builtin without its type argument is a resolution error
  // (surfaced when the schema is built, not by the TypeScript grammar).
  const g = parse(
    `
    interface Graph {
      bad: () => Page;
    }
  `,
    {
      builtins: createBuiltins({
        Page: builtin<Page<any>>({
          parameters: ["T"],
          getSchema: () => v.object({ items: v.unknown(), cursor: v.string() }),
        }),
      }),
    },
  );
  const engine = createEngine({
    graph: g as any,
    entries: ["Graph"],
    resolvers: [],
  });
  const err = await assertRejects(() =>
    engine.run({ path: ["Graph", "bad"], args: [] })
  );
  assertEquals(
    (err as Error).message,
    'Invalid type arguments: expected 1 parameter(s) for builtin "Page", got 0',
  );
});

Deno.test("nested declared generic (Box<Box<Todo>>)", async () => {
  seenParamTypes.length = 0;
  paramCounts.length = 0;
  const e = engine([
    fn(graph.Graph.nestedBox, () => ({
      label: "l1",
      value: { label: "l2", value: { title: "Buy milk", done: false } },
    })),
  ]);

  const q = client.Graph.nestedBox();
  const { path, args } = queryToObject(q);
  const res = await e.run({ path, args });
  assertEquals(res, {
    label: "l1",
    value: { label: "l2", value: { title: "Buy milk", done: false } },
  });

  // No builtin is involved, so getSchema is never called.
  assertEquals(paramCounts, []);
});

Deno.test("mixed: generic builtin nested in a declared generic", async () => {
  seenParamTypes.length = 0;
  paramCounts.length = 0;
  // `Box<Page<Todo>>` — building the `Box` schema requires the schema of
  // `Page<Todo>`, so the builtin's getSchema is called with the schema of
  // `Todo` as its only type argument.
  const e = engine([
    fn(graph.Graph.boxOfPage, () => ({
      label: "outer",
      value: { cursor: "c1", items: [{ title: "Buy milk", done: false }] },
    })),
  ]);

  const q = client.Graph.boxOfPage();
  const { path, args } = queryToObject(q);
  const res = await e.run({ path, args });
  assertEquals(res, {
    label: "outer",
    value: { cursor: "c1", items: [{ title: "Buy milk", done: false }] },
  });

  assertEquals(paramCounts, [1]);
  assertEquals(seenParamTypes, [["strict_object"]]);
});

Deno.test("mixed: declared generic nested in a generic builtin", async () => {
  seenParamTypes.length = 0;
  paramCounts.length = 0;
  // `Page<Box<Todo>>` — the builtin's only type argument is the declared
  // generic `Box<Todo>`, so getSchema receives its schema.
  const e = engine([
    fn(graph.Graph.pageOfBoxedTodo, () => ({
      cursor: "c2",
      items: [{ label: "a", value: { title: "Buy milk", done: true } }],
    })),
  ]);

  const q = client.Graph.pageOfBoxedTodo();
  const { path, args } = queryToObject(q);
  const res = await e.run({ path, args });
  assertEquals(res, {
    cursor: "c2",
    items: [{ label: "a", value: { title: "Buy milk", done: true } }],
  });

  assertEquals(paramCounts, [1]);
  assertEquals(seenParamTypes, [["strict_object"]]);
});

Deno.test("mixed output is validated deeply through the builtin schema", async () => {
  // `Box<Page<Todo>>` validates the nested `Page<Todo>`: `done` is a boolean,
  // so a resolver returning a string must be rejected.
  const e = engine([
    fn(graph.Graph.boxOfPage, () =>
      ({
        label: "outer",
        value: {
          cursor: "c3",
          items: [{ title: "Buy milk", done: "yes" }],
        },
      }) as any),
  ]);

  const q = client.Graph.boxOfPage();
  const { path, args } = queryToObject(q);
  const err = await assertRejects(() => e.run({ path, args }));
  assertEquals(
    (err as Error).message.startsWith(
      "Invalid resolved value for root.Graph.boxOfPage",
    ),
    true,
  );
});
