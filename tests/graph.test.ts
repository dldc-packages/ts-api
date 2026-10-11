import { describe, expect, test } from "vite-plus/test";
import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { PATH, REF, ROOT } from "../src/server/constants.ts";
import { getEndpointResponseStructure, parse, type TGraphBase } from "../src/server/mod.ts";
import type { BasicTypes } from "./schemas/basic.types.ts";
import type { TodoListTypes } from "./schemas/todolist.types.ts";
import { loadSchema } from "./utils/loadSchema.ts";

test("todolist snapshot structure", async () => {
  const graph = parse<TodoListTypes>(loadSchema(resolve("./tests/schemas/todolist.ts")));
  expect(graph[ROOT]).toMatchSnapshot();
});

const graph = parse<BasicTypes>(loadSchema(resolve("./tests/schemas/basic.ts")));

test("snapshot structure", async () => {
  expect(graph[ROOT]).toMatchSnapshot();
});

test("g.User.age", () => {
  const p1 = graph.User.age;
  const path = p1[PATH];
  assertEquals(
    path.map((p) => p.key),
    ["root.User.age"],
  );
});

test("g.User.group", () => {
  const p2 = graph.User.group;
  const path = p2[PATH];
  assertEquals(
    path.map((p) => p.key),
    ["root.User.group"],
  );
});

test("g.User.group.name", () => {
  const p3 = graph.User.group.name;
  const path = p3[PATH];
  assertEquals(
    path.map((p) => p.key),
    ["root.User.group", "root.Group.name"],
  );
});

test("g.Graph.user (function)", () => {
  const p4 = graph.Graph.user;
  const path = p4[PATH];
  assertEquals(
    path.map((p) => p.key),
    ["root.Graph.user"],
  );
});

test("g.Graph.user.return", () => {
  const p4 = graph.Graph.user.return;
  const path = p4[PATH];
  assertEquals(
    path.map((p) => p.key),
    ["root.Graph.user.returns"],
  );
});

test("g.Graph.user.return[REF]", () => {
  const p4 = graph.Graph.user.return[REF];
  const path = p4[PATH];
  assertEquals(
    path.map((p) => p.key),
    ["root.Graph.user.returns", "root.User"],
  );
});

test("g.Graph.user.return.group", () => {
  const p4 = graph.Graph.user.return.group;
  const path = p4[PATH];
  assertEquals(
    path.map((p) => p.key),
    ["root.Graph.user.returns", "root.User.group"],
  );
});

test("g.User.maybeGroup", () => {
  const p = graph.User.maybeGroup;
  const path = p[PATH];
  assertEquals(
    path.map((p) => p.key),
    ["root.User.maybeGroup"],
  );
});

test("g.User.maybeGroup.name", () => {
  const p = graph.User.maybeGroup.name;
  const path = p[PATH];
  assertEquals(
    path.map((p) => p.key),
    ["root.User.maybeGroup.type", "root.Group.name"],
  );
});

describe("matrix", () => {
  const CASES: { graph: TGraphBase<any>; result: string[] }[] = [
    { graph: graph.User.age, result: ["root.User.age"] },
    { graph: graph.User.group, result: ["root.User.group"] },
    {
      graph: graph.User.group.name,
      result: ["root.User.group", "root.Group.name"],
    },
    {
      graph: graph.Graph.user.return[REF],
      result: ["root.Graph.user.returns", "root.User"],
    },
    {
      graph: graph.Graph.user.return.group,
      result: ["root.Graph.user.returns", "root.User.group"],
    },
    { graph: graph.User.maybeGroup, result: ["root.User.maybeGroup"] },
    {
      graph: graph.User.maybeGroup.name,
      result: ["root.User.maybeGroup.type", "root.Group.name"],
    },
  ];

  for (const { graph, result } of CASES) {
    const name = result.join(" > ");
    test(name, () => {
      assertEquals(
        graph[PATH].map((p) => p.key),
        result,
      );
    });
  }
});

test("getEndpointResponseStructure resolves an endpoint's return", () => {
  assertEquals(getEndpointResponseStructure(graph, ["Graph", "user"]), {
    kind: "ref",
    key: "root.Graph.user.returns",
    ref: "User",
    params: [],
  });
  assertEquals(getEndpointResponseStructure(graph, ["Graph", "randomItem"])?.kind, "union");
});

test("getEndpointResponseStructure returns undefined for non-endpoints", () => {
  // An interface is not a function endpoint.
  assertEquals(getEndpointResponseStructure(graph, ["User"]), undefined);
  // Empty path.
  assertEquals(getEndpointResponseStructure(graph, []), undefined);
  // Unknown root type.
  assertEquals(getEndpointResponseStructure(graph, ["Nope"]), undefined);
  // Unknown property.
  assertEquals(getEndpointResponseStructure(graph, ["Graph", "nope"]), undefined);
});
