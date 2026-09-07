import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../client.ts";
import { createEngine, fn, parse } from "../../server.ts";
import type {
  Graph,
  Namespace,
  PageConfig,
  PaginatedResult,
  Stuff,
} from "./graph.ts";

interface AllTypes {
  Graph: Graph;
  Namespace: Namespace;
  Stuff: Stuff;
  PageConfig: PageConfig;
  PaginatedResult: PaginatedResult<unknown>;
}

const graph = parse<AllTypes>(
  resolve("./tests/paginated/graph.ts"),
);

const client = query<AllTypes>();

Deno.test("Resolve paginated", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.sub.listStuff, (_ctx, [search, pageConfig]) => {
        assertEquals(search, "hello");
        assertEquals(pageConfig, { page: 2 });
        return {
          data: [{ data: "hello", num: 42 }],
          total: 1,
        };
      }),
    ],
  });

  const q = client.Graph.sub.listStuff("hello", { page: 2 });
  const { path: queryDef, args: variables } = queryToObject(q);
  const res = await engine.run({ path: queryDef, args: variables });
  assertEquals(res, { data: [{ data: "hello", num: 42 }], total: 1 });
});

Deno.test("Resolve paginated with no args", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.sub.listStuff, () => ({
        data: [],
        total: 0,
      })),
    ],
  });

  const q = client.Graph.sub.listStuff();
  const { path: queryDef, args: variables } = queryToObject(q);
  const res = await engine.run({ path: queryDef, args: variables });
  assertEquals(res, { data: [], total: 0 });
});
