import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject, type TQuery } from "../../src/client/mod.ts";
import {
  type ApiEndpoint,
  type ApiNamespace,
  createEngine,
  extractApi,
  fn,
  GraphClientErreur,
  parse,
} from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type { Admin, Public, Results, Stats, User } from "./graph.ts";

export interface AllTypes {
  Public: Public;
  Admin: Admin;
  User: User;
  Results: Results;
  Stats: Stats;
}

const client = query<AllTypes>();

const graph = parse<AllTypes>(
  loadSchema(resolve("./tests/multi-entry/graph.ts")),
);

// ---------------------------------------------------------------------------
// Engine: multiple entries
// ---------------------------------------------------------------------------

function run(engine: ReturnType<typeof createEngine>, q: TQuery<unknown>) {
  const { path, args } = queryToObject(q);
  return engine.run({ path, args });
}

const multiEntryEngine = createEngine({
  graph,
  entries: ["Public", "Admin"],
  resolvers: [
    fn(graph.Public.version, () => "1.0.0"),
    fn(graph.Public.me, () => ({ id: "me", name: "Alice" })),
    fn(graph.Public.search, (_ctx, [q]) => ({ total: q.length, items: [q] })),
    fn(graph.Admin.users.list, () => [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ]),
    fn(graph.Admin.users.byId, (_ctx, [id]) => ({ id, name: "Alice" })),
    fn(graph.Admin.stats, () => ({ count: 2 })),
  ],
});

Deno.test("engine: runs queries starting from the first entry", async () => {
  assertEquals(await run(multiEntryEngine, client.Public.version()), "1.0.0");
  assertEquals(await run(multiEntryEngine, client.Public.me()), {
    id: "me",
    name: "Alice",
  });
  assertEquals(await run(multiEntryEngine, client.Public.search("api")), {
    total: 3,
    items: ["api"],
  });
});

Deno.test("engine: runs queries starting from the second entry", async () => {
  assertEquals(await run(multiEntryEngine, client.Admin.stats()), {
    count: 2,
  });
  assertEquals(
    await run(multiEntryEngine, client.Admin.users.byId("1")),
    { id: "1", name: "Alice" },
  );
  assertEquals(
    await run(multiEntryEngine, client.Admin.users.list()),
    [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ],
  );
});

Deno.test("engine: rejects a query starting from a non-entry top-level type", async () => {
  // `User` is a declared top-level type but is not listed in `entries`.
  const err = await assertRejects(
    () => multiEntryEngine.run({ path: ["User"], args: [] }),
  );
  assertEquals(
    (err as Error).message,
    `Invalid entry, all queries should start from one of ["Public","Admin"] (requested: "User")`,
  );
});

Deno.test("engine: rejects a query starting from an unknown top-level type", async () => {
  const err = await assertRejects(
    () => multiEntryEngine.run({ path: ["Nope"], args: [] }),
  );
  assertEquals(
    (err as Error).message,
    `Invalid entry, all queries should start from one of ["Public","Admin"] (requested: "Nope")`,
  );
});

Deno.test("engine: InvalidEntry error data lists all entries", async () => {
  let err: unknown;
  try {
    await multiEntryEngine.run({ path: ["Results"], args: [] });
    assertEquals(true, false, "expected run to reject");
  } catch (e) {
    err = e;
  }
  const data = GraphClientErreur.get(err);
  assertEquals(data?.kind, "InvalidEntry");
  if (data?.kind !== "InvalidEntry") throw new Error("expected InvalidEntry");
  assertEquals(data.entries, ["Public", "Admin"]);
  assertEquals(data.requested, "Results");
});

Deno.test("engine: args validation works within the second entry", async () => {
  const err = await assertRejects(
    () =>
      multiEntryEngine.run({
        path: ["Admin", "users", "byId"],
        args: [123],
      }),
  );
  assertEquals(
    (err as Error).message,
    "Invalid arguments passed to root.Admin.users.byId",
  );
});

Deno.test("engine: a single-entry engine still rejects the other entry", async () => {
  const engine = createEngine({
    graph,
    entries: ["Public"],
    resolvers: [
      fn(graph.Public.version, () => "1.0.0"),
    ],
  });

  assertEquals(await run(engine, client.Public.version()), "1.0.0");

  const { path, args } = queryToObject(client.Admin.stats());
  const err = await assertRejects(() => engine.run({ path, args }));
  assertEquals(
    (err as Error).message,
    `Invalid entry, all queries should start from "Public" (requested: "Admin")`,
  );
});

// ---------------------------------------------------------------------------
// extractApi: multiple entries
// ---------------------------------------------------------------------------

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

Deno.test("extractApi: returns one namespace per entry, in order", () => {
  const api = extractApi(graph, ["Public", "Admin"]);

  assertEquals(api.entries.length, 2);
  assertEquals(api.entries[0].kind, "namespace");
  assertEquals(api.entries[0].name, "Public");
  assertEquals(api.entries[0].path, ["Public"]);
  assertEquals(api.entries[1].kind, "namespace");
  assertEquals(api.entries[1].name, "Admin");
  assertEquals(api.entries[1].path, ["Admin"]);
});

Deno.test("extractApi: trees follow the order of the entries argument", () => {
  const api = extractApi(graph, ["Admin", "Public"]);
  assertEquals(api.entries.map((n) => n.name), ["Admin", "Public"]);
});

Deno.test("extractApi: each entry tree only contains its own endpoints", () => {
  const api = extractApi(graph, ["Public", "Admin"]);

  const [publicNs, adminNs] = api.entries;
  assertEquals(
    publicNs.children.map((c) => c.name),
    ["version", "me", "search"],
  );
  assertEquals(findEndpoint(publicNs.children, "version").path, [
    "Public",
    "version",
  ]);

  // `Admin` has a nested namespace and an endpoint.
  assertEquals(
    adminNs.children.map((c) => c.name),
    ["users", "stats"],
  );
  const users = findNamespace(adminNs.children, "users");
  assertEquals(
    users.children.map((c) => c.name),
    ["list", "byId"],
  );
  assertEquals(findEndpoint(users.children, "byId").path, [
    "Admin",
    "users",
    "byId",
  ]);
  assertEquals(findEndpoint(users.children, "byId").returns, {
    kind: "ref",
    name: "User",
    params: [],
  });
  assertEquals(findEndpoint(adminNs.children, "stats").returns, {
    kind: "ref",
    name: "Stats",
    params: [],
  });
});

Deno.test("extractApi: a single entry returns a one-element array", () => {
  const api = extractApi(graph, ["Admin"]);
  assertEquals(api.entries.length, 1);
  assertEquals(api.entries[0].name, "Admin");
});

Deno.test("extractApi: throws when any entry is unknown", () => {
  assertThrows(
    () => extractApi(graph, ["Public", "NonExistent"]),
    Error,
    'Entry type "NonExistent" not found',
  );
});

Deno.test("extractApi: types contains all declarations, shared across entries", () => {
  const api = extractApi(graph, ["Public", "Admin"]);
  assertEquals(api.types.map((t) => t.name), [
    "Public",
    "Admin",
    "User",
    "Results",
    "Stats",
  ]);

  // The same `User` ref is reachable from both entries.
  const [publicNs, adminNs] = api.entries;
  const me = findEndpoint(publicNs.children, "me");
  const byId = findEndpoint(
    findNamespace(adminNs.children, "users").children,
    "byId",
  );
  assertEquals(me.returns, { kind: "ref", name: "User", params: [] });
  assertEquals(byId.returns, { kind: "ref", name: "User", params: [] });
});

Deno.test("extractApi: each root namespace carries its entry declaration comment", () => {
  const api = extractApi(graph, ["Public", "Admin"]);
  assertEquals(
    api.entries[0].comment,
    "The public API tree. One of the schema's entries.",
  );
  assertEquals(
    api.entries[1].comment,
    "The admin API tree. A second entry, served alongside `Public`.",
  );

  // Endpoint comments are preserved per tree as well.
  const users = findNamespace(api.entries[1].children, "users");
  assertEquals(
    findEndpoint(users.children, "list").comment,
    "List all users.",
  );
});

Deno.test("extractApi: snapshot multi-entry", async (test) => {
  const api = extractApi(graph, ["Public", "Admin"]);
  await test.assertSnapshot(api);
});
