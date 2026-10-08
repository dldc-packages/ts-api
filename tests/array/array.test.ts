import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../src/client/mod.ts";
import { PATH, ROOT } from "../../src/server/constants.ts";
import { createEngine, fn, parse } from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type { Foo, Graph } from "./graph.ts";

interface AllTypes {
  Graph: Graph;
  Foo: Foo;
}

const graph = parse<AllTypes>(
  loadSchema(resolve("./tests/array/graph.ts")),
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

Deno.test("Array<Foo> is parsed as a native array (like Foo[])", () => {
  // `list` returns `Array<Foo>` — the returns node must be an `array`
  // structure (not a `ref` to a missing `Array` builtin), whose items resolve
  // to the declared `Foo` interface, exactly like `Foo[]` would.
  const ret = graph.Graph.list.return;
  assertEquals(ret[PATH].map((p) => `${p.key}(${p.kind})`), [
    "root.Graph.list.returns(array)",
  ]);
  // Navigating into the array yields the `Foo` ref items structure.
  assertEquals(
    ret.items[PATH].map((p) => `${p.key}(${p.kind})`),
    ["root.Graph.list.returns.items(ref)"],
  );
});

const ALL = [
  { name: "Buy milk", done: false },
  { name: "Write code", done: true },
];

Deno.test("Array<Foo> as a response type", async () => {
  const e = engine([
    fn(graph.Graph.list, () => ALL),
  ]);

  const q = client.Graph.list();
  const { path, args } = queryToObject(q);
  const res = await e.run({ path, args });
  assertEquals(res, ALL);
});

Deno.test("Array<Foo> response is validated against Foo", async () => {
  // `done` must be a boolean — a resolver returning an invalid element must be
  // rejected.
  const e = engine([
    fn(graph.Graph.list, () => [{ name: "Buy milk", done: "yes" }] as any),
  ]);

  const q = client.Graph.list();
  const { path, args } = queryToObject(q);
  const err = await assertRejects(() => e.run({ path, args }));
  assertEquals(
    (err as Error).message.startsWith(
      "Invalid resolved value for root.Graph.list",
    ),
    true,
  );
});

Deno.test("Array<Foo> as a request type", async () => {
  const e = engine([
    fn(graph.Graph.count, (_ctx, [items]) => items.length),
  ]);

  const q = client.Graph.count([
    { name: "a", done: false },
    { name: "b", done: true },
    { name: "c", done: false },
  ]);
  const { path, args } = queryToObject(q);
  const res = await e.run({ path, args });
  assertEquals(res, 3);
});

Deno.test("Array<Foo> request is validated against Foo", async () => {
  const e = engine([
    fn(graph.Graph.count, (_ctx, [items]) => items.length),
  ]);

  // `done` must be a boolean — an invalid element must be rejected on input.
  const q = client.Graph.count([{ name: "a", done: "no" }] as any);
  const { path, args } = queryToObject(q);
  const err = await assertRejects(() => e.run({ path, args }));
  assertEquals(
    (err as Error).message,
    "Invalid arguments passed to root.Graph.count",
  );
});
