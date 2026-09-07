import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { assertSnapshot } from "@std/testing/snapshot";
import { parse, type TGraphBase } from "../server.ts";
import { PATH, REF, ROOT } from "../src/server/constants.ts";
import type { BasicTypes } from "./schemas/basic.types.ts";
import type { TodoListTypes } from "./schemas/todolist.types.ts";

Deno.test("todolist snapshot structure", async (test) => {
  const graph = parse<TodoListTypes>(
    resolve("./tests/schemas/todolist.ts"),
  );
  await assertSnapshot(test, graph[ROOT]);
});

const graph = parse<BasicTypes>(resolve("./tests/schemas/basic.ts"));

Deno.test("snapshot structure", async (test) => {
  await assertSnapshot(test, graph[ROOT]);
});

Deno.test("g.User.age", () => {
  const p1 = graph.User.age;
  const path = p1[PATH];
  assertEquals(path.map((p) => p.key), ["root.User.age"]);
});

Deno.test("g.User.group", () => {
  const p2 = graph.User.group;
  const path = p2[PATH];
  assertEquals(path.map((p) => p.key), ["root.User.group"]);
});

Deno.test("g.User.group.name", () => {
  const p3 = graph.User.group.name;
  const path = p3[PATH];
  assertEquals(path.map((p) => p.key), ["root.User.group", "root.Group.name"]);
});

Deno.test("g.Graph.user (function)", () => {
  const p4 = graph.Graph.user;
  const path = p4[PATH];
  assertEquals(path.map((p) => p.key), ["root.Graph.user"]);
});

Deno.test("g.Graph.user.return", () => {
  const p4 = graph.Graph.user.return;
  const path = p4[PATH];
  assertEquals(path.map((p) => p.key), ["root.Graph.user.returns"]);
});

Deno.test("g.Graph.user.return[REF]", () => {
  const p4 = graph.Graph.user.return[REF];
  const path = p4[PATH];
  assertEquals(path.map((p) => p.key), [
    "root.Graph.user.returns",
    "root.User",
  ]);
});

Deno.test("g.Graph.user.return.group", () => {
  const p4 = graph.Graph.user.return.group;
  const path = p4[PATH];
  assertEquals(path.map((p) => p.key), [
    "root.Graph.user.returns",
    "root.User.group",
  ]);
});

Deno.test("g.User.maybeGroup", () => {
  const p = graph.User.maybeGroup;
  const path = p[PATH];
  assertEquals(path.map((p) => p.key), ["root.User.maybeGroup"]);
});

Deno.test("g.User.maybeGroup.name", () => {
  const p = graph.User.maybeGroup.name;
  const path = p[PATH];
  assertEquals(path.map((p) => p.key), [
    "root.User.maybeGroup.type",
    "root.Group.name",
  ]);
});

Deno.test("matrix", async (t) => {
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
    await t.step(name, () => {
      assertEquals(graph[PATH].map((p) => p.key), result);
    });
  }
});
