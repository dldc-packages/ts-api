import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../src/client/mod.ts";
import { createEngine, fn, parse } from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type {
  Graph,
  Namespace,
  ParamsWithNull,
  SimpleObj,
  SimpleParams,
} from "./graph.ts";

interface AllTypes {
  Graph: Graph;
  Namespace: Namespace;
  ParamsWithNull: ParamsWithNull;
  SimpleObj: SimpleObj;
  SimpleParams: SimpleParams;
}

const graph = parse<AllTypes>(
  loadSchema(resolve("./tests/nullable/graph.ts")),
);

const client = query<AllTypes>();

Deno.test("Nullable input", async (t) => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.sub.execWithParams, (_ctx, [params]) => {
        return JSON.stringify([
          params.nullable === null
            ? "null"
            : params.nullable === undefined
            ? "undefined"
            : typeof params.nullable,
          params.optionalNull === null
            ? "null"
            : params.optionalNull === undefined
            ? "undefined"
            : typeof params.optionalNull,
          params.optionalString === null
            ? "null"
            : params.optionalString === undefined
            ? "undefined"
            : typeof params.optionalString,
        ]);
      }),
    ],
  });

  await t.step("all provided", async () => {
    const q = client.Graph.sub.execWithParams({
      nullable: "nullable",
      optionalNull: "optionalNull",
      optionalString: "optionalString",
    });
    const { path: queryDef, args: variables } = queryToObject(q);
    const res = await engine.run({ path: queryDef, args: variables });
    assertEquals(res, `["string","string","string"]`);
  });

  await t.step("null provided", async () => {
    const q = client.Graph.sub.execWithParams({
      nullable: null,
      optionalNull: null,
    });
    const { path: queryDef, args: variables } = queryToObject(q);
    const res = await engine.run({ path: queryDef, args: variables });
    assertEquals(res, `["null","null","undefined"]`);
  });

  await t.step("omit optional nullable", async () => {
    const q = client.Graph.sub.execWithParams({
      nullable: "nullable",
    });
    const { path: queryDef, args: variables } = queryToObject(q);
    const res = await engine.run({ path: queryDef, args: variables });
    assertEquals(res, `["string","undefined","undefined"]`);
  });
});
