import { assertEquals, assertThrows } from "@std/assert";
import { resolve } from "@std/path";
import { assertSnapshot } from "@std/testing/snapshot";
import { extractApi, getStructure, parse } from "../src/server/mod.ts";
import { loadSchema } from "./utils/loadSchema.ts";
import type {
  ApiEndpoint,
  ApiNamespace,
  ApiTypeDeclaration,
} from "../src/server/extract.ts";
import type { BasicTypes } from "./schemas/basic.types.ts";
import type { TodoListTypes } from "./schemas/todolist.types.ts";

const basicGraph = parse<BasicTypes>(
  loadSchema(resolve("./tests/schemas/basic.ts")),
);
const todolistGraph = parse<TodoListTypes>(
  loadSchema(resolve("./tests/schemas/todolist.ts")),
);

function findEndpoint(
  children: ApiNamespace["children"],
  name: string,
): ApiEndpoint {
  const node = children.find((c) => c.name === name);
  if (!node || node.kind !== "endpoint") {
    throw new Error(`Endpoint "${name}" not found`);
  }
  return node;
}

function findNamespace(
  children: ApiNamespace["children"],
  name: string,
): ApiNamespace {
  const node = children.find((c) => c.name === name);
  if (!node || node.kind !== "namespace") {
    throw new Error(`Namespace "${name}" not found`);
  }
  return node;
}

function findType(
  types: ApiTypeDeclaration[],
  name: string,
): ApiTypeDeclaration {
  const t = types.find((t) => t.name === name);
  if (!t) throw new Error(`Type "${name}" not found`);
  return t;
}

Deno.test("getStructure: returns root structure with types and builtins", () => {
  const structure = getStructure(basicGraph);

  assertEquals(structure.kind, "root");
  assertEquals(structure.mode, "graph");
  assertEquals(structure.types.map((t) => t.name), [
    "Role",
    "User",
    "Group",
    "Graph",
  ]);
  assertEquals(structure.builtins.map((b) => b.name), ["Date"]);
});

Deno.test("getStructure: todolist has all types", () => {
  const structure = getStructure(todolistGraph);

  assertEquals(structure.types.map((t) => t.name), [
    "PaginationParams",
    "User",
    "App",
    "Todo",
    "CoinHeads",
    "CoinTails",
    "Config",
    "Graph",
  ]);
});

Deno.test("getStructure: interfaces have properties and parameters", () => {
  const structure = getStructure(basicGraph);
  const user = structure.types.find((t) => t.name === "User")!;

  if (user.kind !== "interface") throw new Error("expected interface");
  assertEquals(user.parameters, []);
  assertEquals(user.properties.map((p) => p.name), [
    "name",
    "age",
    "group",
    "maybeGroup",
  ]);
});

Deno.test("getStructure: aliases have type and parameters", () => {
  const structure = getStructure(basicGraph);
  const role = structure.types.find((t) => t.name === "Role")!;

  if (role.kind !== "alias") throw new Error("expected alias");
  assertEquals(role.parameters, []);
  assertEquals(role.type.kind, "union");
});

Deno.test("extractApi: snapshot basic", async (test) => {
  const api = extractApi(basicGraph, "Graph");
  await assertSnapshot(test, api);
});

Deno.test("extractApi: snapshot todolist", async (test) => {
  const api = extractApi(todolistGraph, "Graph");
  await assertSnapshot(test, api);
});

Deno.test("extractApi: returns entry name", () => {
  const api = extractApi(basicGraph, "Graph");
  assertEquals(api.entry, "Graph");
});

Deno.test("extractApi: root namespace has correct name and path", () => {
  const api = extractApi(basicGraph, "Graph");
  assertEquals(api.root.kind, "namespace");
  assertEquals(api.root.name, "Graph");
  assertEquals(api.root.path, ["Graph"]);
});

Deno.test("extractApi: endpoints and namespaces are separated", () => {
  const api = extractApi(todolistGraph, "Graph");
  const children = api.root.children;

  assertEquals(children.map((c) => c.kind), [
    "endpoint",
    "namespace",
    "namespace",
    "endpoint",
    "endpoint",
  ]);
  assertEquals(children.map((c) => c.name), [
    "auth",
    "users",
    "apps",
    "flip",
    "config",
  ]);
});

Deno.test("extractApi: endpoint has arguments and returns", () => {
  const api = extractApi(todolistGraph, "Graph");
  const users = findNamespace(api.root.children, "users");
  const byId = findEndpoint(users.children, "byId");

  assertEquals(byId.path, ["Graph", "users", "byId"]);
  assertEquals(byId.arguments, [
    {
      name: "id",
      type: { kind: "primitive", type: "string" },
      optional: false,
    },
  ]);
  assertEquals(byId.returns, {
    kind: "ref",
    name: "User",
    params: [],
  });
});

Deno.test("extractApi: endpoint with no args", () => {
  const api = extractApi(basicGraph, "Graph");
  const group = findEndpoint(api.root.children, "group");

  assertEquals(group.arguments, []);
  assertEquals(group.returns, { kind: "ref", name: "Group", params: [] });
});

Deno.test("extractApi: nested namespace paths", () => {
  const api = extractApi(todolistGraph, "Graph");
  const apps = findNamespace(api.root.children, "apps");

  assertEquals(apps.path, ["Graph", "apps"]);
  assertEquals(apps.children.map((c) => c.name), ["all", "byId"]);

  const all = findEndpoint(apps.children, "all");
  assertEquals(all.path, ["Graph", "apps", "all"]);
  assertEquals(all.arguments, [
    {
      name: "pagination",
      type: { kind: "ref", name: "PaginationParams", params: [] },
      optional: true,
    },
  ]);
  assertEquals(all.returns, {
    kind: "array",
    items: { kind: "ref", name: "App", params: [] },
  });
});

Deno.test("extractApi: union return type", () => {
  const api = extractApi(basicGraph, "Graph");
  const randomItem = findEndpoint(api.root.children, "randomItem");

  assertEquals(randomItem.returns, {
    kind: "union",
    types: [
      { kind: "ref", name: "User", params: [] },
      { kind: "ref", name: "Group", params: [] },
    ],
  });
});

Deno.test("extractApi: nullable return type", () => {
  const api = extractApi(todolistGraph, "Graph");
  const auth = findEndpoint(api.root.children, "auth");

  assertEquals(auth.returns, {
    kind: "nullable",
    type: {
      kind: "object",
      properties: [
        {
          name: "user",
          type: { kind: "ref", name: "User", params: [] },
          optional: false,
        },
      ],
    },
  });
});

Deno.test("extractApi: inline object return type", () => {
  const api = extractApi(todolistGraph, "Graph");
  const config = findEndpoint(api.root.children, "config");

  assertEquals(config.returns, { kind: "ref", name: "Config", params: [] });

  const configType = findType(api.types, "Config");
  assertEquals(configType.kind, "interface");
  assertEquals(configType.properties![0].name, "env");
  assertEquals(configType.properties![0].type, {
    kind: "object",
    properties: [
      {
        name: "version",
        type: { kind: "primitive", type: "string" },
        optional: false,
      },
      {
        name: "num",
        type: { kind: "primitive", type: "number" },
        optional: false,
      },
      {
        name: "str",
        type: { kind: "primitive", type: "string" },
        optional: false,
      },
      {
        name: "bool",
        type: { kind: "primitive", type: "boolean" },
        optional: false,
      },
    ],
  });
});

Deno.test("extractApi: types array contains all declarations", () => {
  const api = extractApi(basicGraph, "Graph");

  assertEquals(api.types.map((t) => t.name), [
    "Role",
    "User",
    "Group",
    "Graph",
  ]);
  assertEquals(api.types.map((t) => t.kind), [
    "alias",
    "interface",
    "interface",
    "interface",
  ]);
});

Deno.test("extractApi: interface type declaration has properties", () => {
  const api = extractApi(basicGraph, "Graph");
  const user = findType(api.types, "User");

  assertEquals(user.kind, "interface");
  assertEquals(user.parameters, []);
  assertEquals(user.properties!.map((p) => p.name), [
    "name",
    "age",
    "group",
    "maybeGroup",
  ]);
  assertEquals(user.properties![0], {
    name: "name",
    type: { kind: "primitive", type: "string" },
    optional: false,
  });
  assertEquals(user.properties![1], {
    name: "age",
    type: { kind: "nullable", type: { kind: "primitive", type: "number" } },
    optional: false,
  });
  assertEquals(user.properties![2], {
    name: "group",
    type: { kind: "ref", name: "Group", params: [] },
    optional: false,
  });
  assertEquals(user.properties![3], {
    name: "maybeGroup",
    type: {
      kind: "nullable",
      type: { kind: "ref", name: "Group", params: [] },
    },
    optional: false,
  });
});

Deno.test("extractApi: alias type declaration has type", () => {
  const api = extractApi(basicGraph, "Graph");
  const role = findType(api.types, "Role");

  assertEquals(role.kind, "alias");
  assertEquals(role.parameters, []);
  assertEquals(role.type, {
    kind: "union",
    types: [
      { kind: "literal", value: "admin" },
      { kind: "literal", value: "user" },
    ],
  });
});

Deno.test("extractApi: Graph interface has function properties", () => {
  const api = extractApi(basicGraph, "Graph");
  const graphType = findType(api.types, "Graph");

  assertEquals(graphType.kind, "interface");
  assertEquals(graphType.properties!.map((p) => p.name), [
    "group",
    "user",
    "randomItem",
  ]);
  const groupProp = graphType.properties![0];
  if (groupProp.type.kind !== "function") throw new Error("expected function");
  assertEquals(groupProp.type.arguments, []);
  assertEquals(groupProp.type.returns, {
    kind: "ref",
    name: "Group",
    params: [],
  });
});

Deno.test("extractApi: throws on unknown entry", () => {
  assertThrows(
    () => extractApi(basicGraph, "NonExistent"),
    Error,
    'Entry type "NonExistent" not found',
  );
});

Deno.test("extractApi: builtin types appear as builtin", () => {
  const dateGraph = parse(loadSchema(resolve("./tests/date/graph.ts")));
  const api = extractApi(dateGraph, "Graph");

  const sub = findNamespace(api.root.children, "sub");

  const now = findEndpoint(sub.children, "now");
  assertEquals(now.returns, { kind: "builtin", name: "Date" });

  const doStuff = findEndpoint(sub.children, "doStuff");
  assertEquals(doStuff.arguments, [
    {
      name: "date",
      type: { kind: "builtin", name: "Date" },
      optional: false,
    },
  ]);
  assertEquals(doStuff.returns, { kind: "primitive", type: "string" });
});
