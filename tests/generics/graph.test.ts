import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { loadSchema } from "../utils/loadSchema.ts";
import { parse, REF } from "../../src/server/mod.ts";
import { GET, PATH } from "../../src/server/constants.ts";
import type { BaseFn, Graph, Paginated, TodoItem } from "./graph.ts";

export interface AllTypes {
  Graph: Graph;
  Paginated: Paginated<any>;
  TodoItem: TodoItem;
  BaseFn: BaseFn<any>;
}

const graph = parse<AllTypes>(
  loadSchema(resolve("./tests/generics/graph.ts")),
);

Deno.test("Simple Generic", () => {
  const p1 = graph.Graph.todos;
  assertEquals(p1[PATH].map((p) => `${p.key}(${p.kind})`), [
    "root.Graph.todos(function)",
  ]);
  const p2 = p1.return;
  assertEquals(p2[PATH].map((p) => `${p.key}(${p.kind})`), [
    "root.Graph.todos.returns(ref)",
  ]);
  const p3 = p2[GET](REF);
  assertEquals(p3[PATH].map((p) => `${p.key}(${p.kind})`), [
    "root.Graph.todos.returns(ref)",
    "root.Paginated(interface)",
  ]);
});

Deno.test("Nested generic", () => {
  const p1 = graph.Graph.nested;
  assertEquals(p1[PATH].map((p) => `${p.key}(${p.kind})`), [
    "root.Graph.nested(function)",
  ]);
  const p2 = p1.return;
  assertEquals(p2[PATH].map((p) => `${p.key}(${p.kind})`), [
    "root.Graph.nested.returns(ref)",
  ]);
  const p3 = p2[GET](REF);
  assertEquals(p3[PATH].map((p) => `${p.key}(${p.kind})`), [
    "root.Graph.nested.returns(ref)",
    "root.TodoItem(interface)",
  ]);
});
