import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../client.ts";
import { createEngine, fn, parse } from "../../server.ts";
import { ROOT } from "../../src/server/constants.ts";
import type { Graph, UserRole } from "./graph.ts";

interface AllTypes {
  Graph: Graph;
  UserRole: UserRole;
}

const graph = parse<AllTypes>(
  resolve("./tests/enums/graph.ts"),
);

const client = query<AllTypes>();

Deno.test("Properly parse schema", () => {
  const roleStruct = graph[ROOT].types.find((s) => s.name === "UserRole");

  assertEquals(roleStruct, {
    "kind": "alias",
    "key": "root.UserRole",
    "name": "UserRole",
    "type": {
      "kind": "union",
      "key": "root.UserRole.type",
      "types": [
        { "kind": "literal", "key": "root.UserRole.type.0", "type": "admin" },
        { "kind": "literal", "key": "root.UserRole.type.1", "type": "user" },
        { "kind": "literal", "key": "root.UserRole.type.2", "type": "guest" },
      ],
    },
    "parameters": [],
  });
});

Deno.test("Resolve enum", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.role, () => "admin"),
    ],
  });

  const q = client.Graph.role();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, "admin");
});

Deno.test("Fail with invalid value", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.role, () => "yolo"),
    ],
  });

  const q = client.Graph.role();
  const { path: queryDef, args: variables } = queryToObject(q);
  const err = await assertRejects(() =>
    engine.run({ path: queryDef, args: variables })
  );
  assertEquals(
    (err as Error).message,
    'Invalid resolved value for root.Graph.role (expected: valid value, received: "yolo")',
  );
});
