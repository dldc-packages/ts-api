import { assertThrows } from "@std/assert";
import { createEngine, fn, parse } from "../../src/server/mod.ts";

Deno.test("recursion is rejected at parse time (fail fast)", () => {
  // Direct self-reference through an interface.
  assertThrows(
    () =>
      parse(`
      interface Node { next?: Node }
      interface Graph { n: () => Node }
    `),
    Error,
    'Recursive type detected at "root.Node"',
  );

  // Mutual recursion between two interfaces.
  assertThrows(
    () =>
      parse(`
      interface Group { users: User[] }
      interface User { group: Group }
      interface Graph { u: () => User; g: () => Group }
    `),
    Error,
    'Recursive type detected at "root.User"',
  );

  // Recursion through a generic type (non-terminating for any concrete type).
  assertThrows(
    () =>
      parse(`
      interface Tree<T> { children: Tree<T>[] }
      interface Graph { t: () => Tree<string> }
    `),
    Error,
    'Recursive type detected at "root.Tree"',
  );
});

Deno.test("finite nested generics are not flagged as recursion at parse", () => {
  // `Page<Page<Todo>>` is a finite instantiation, not a recursive type: it
  // re-enters `Page` with different arguments, so it must parse without a
  // recursion error. Building its schema is covered end-to-end by the
  // `tests/generics` suite (note: very deep nesting is still limited by the
  // graph navigation depth, a separate concern from recursion detection).
  parse(`
    interface Page<T> { items: T[]; total: number }
    interface Todo { name: string }
    interface Graph { nested: () => Page<Page<Todo>>; nested2: () => Page<Page<Page<Todo>>> }
  `);
});

Deno.test("types reused across independent branches are not recursion", () => {
  // A type referenced from several sibling properties/endpoints is fine, as is
  // a generic passthrough alias (`Admin<T> = T`) used at multiple sites.
  parse(`
    interface Shared { value: string }
    type Admin<T> = T;
    interface Graph {
      a: () => Shared;
      b: (x: Shared) => number;
      c: () => { left: Shared; right: Shared };
      users: { create: () => null; admin: Admin<{ delete: () => null }> };
      files: { admin: Admin<() => null>; rename: () => null };
    }
  `);
});

Deno.test("recursive data types are rejected even when only used by introspection", () => {
  // `getStructure`/`extractApi` don't build schemas, but the type itself can
  // never be schema-resolved, so parse fails fast on it.
  assertThrows(
    () =>
      parse(`
      interface Node { next?: Node }
    `),
    Error,
    "Recursive type detected",
  );
});

Deno.test("a non-recursive schema still parses and runs", async () => {
  interface Todo {
    name: string;
  }
  interface Graph {
    todos: () => Todo[];
  }
  const graph = parse<{ Graph: Graph }>(`
    interface Todo { name: string }
    interface Graph { todos: () => Todo[] }
  `);
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [fn(graph.Graph.todos, () => [{ name: "a" }])],
  });
  const res = await engine.run({ path: ["Graph", "todos"], args: [] });
  if (JSON.stringify(res) !== JSON.stringify([{ name: "a" }])) {
    throw new Error("unexpected result");
  }
});
