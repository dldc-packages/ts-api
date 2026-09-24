import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject, type TQuery } from "../../src/client/mod.ts";
import {
  createEngine,
  fn,
  parse,
  resolver,
  STRUCTURE,
  type TGraphBaseAny,
} from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import { GET, REF } from "../../src/server/constants.ts";
import type { Admin, Graph } from "./graph.ts";

export interface AllTypes {
  Graph: Graph;
  Admin: Admin<any>;
}

const client = query<AllTypes>();

const graph = parse<AllTypes>(
  loadSchema(resolve("./tests/admin/graph.ts")),
);

/**
 * Helper to run a query against an engine and return the raw result.
 */
function run(engine: ReturnType<typeof createEngine>, q: TQuery<unknown>) {
  const { path, args } = queryToObject(q);
  return engine.run({ path, args });
}

Deno.test("graph.Admin is the generic alias root.Admin", () => {
  const admin = graph.Admin as TGraphBaseAny;
  assertEquals(admin[STRUCTURE].kind, "alias");
  assertEquals(admin[STRUCTURE].key, "root.Admin");

  // A property typed `Admin<...>` is a ref to the `Admin` alias; resolving it
  // lands on the very same `root.Admin` structure, which is why a resolver
  // registered on `graph.Admin` matches every `Admin<...>` property.
  const resolved = graph.Graph.users.admin[GET](REF);
  assertEquals(resolved[STRUCTURE].key, "root.Admin");
});

Deno.test("admin guard runs before every Admin endpoint", async () => {
  const order: string[] = [];

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      resolver(
        graph.Admin,
        (_ctx, next) => {
          order.push("admin-guard");
          return next(_ctx);
        },
      ),
      fn(graph.Graph.users.admin.delete, () => {
        order.push("users.delete");
        return null;
      }),
      fn(graph.Graph.posts.admin.delete, () => {
        order.push("posts.delete");
        return null;
      }),
      fn(graph.Graph.posts.admin.pin, (_ctx, [id]) => {
        order.push(`posts.pin(${id})`);
        return null;
      }),
    ],
  });

  await run(engine, client.Graph.users.admin.delete());
  assertEquals(order, ["admin-guard", "users.delete"]);

  order.length = 0;
  await run(engine, client.Graph.posts.admin.delete());
  assertEquals(order, ["admin-guard", "posts.delete"]);

  order.length = 0;
  await run(engine, client.Graph.posts.admin.pin(42));
  assertEquals(order, ["admin-guard", "posts.pin(42)"]);
});

Deno.test("admin guard can block the endpoint", async () => {
  let deleted = false;

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      resolver(
        graph.Admin,
        (_ctx) => {
          throw new Error("Forbidden: admin only");
        },
      ),
      fn(graph.Graph.users.admin.delete, () => {
        deleted = true;
        return null;
      }),
    ],
  });

  const { path, args } = queryToObject(client.Graph.users.admin.delete());
  const err = await assertRejects(
    () => engine.run({ path, args }),
  );
  assertEquals((err as Error).message, "Forbidden: admin only");
  assertEquals(deleted, false);
});

Deno.test("non-admin endpoints are NOT guarded", async () => {
  const order: string[] = [];

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      resolver(
        graph.Admin,
        (_ctx, next) => {
          order.push("admin-guard");
          return next(_ctx);
        },
      ),
      fn(graph.Graph.status, () => "ok"),
      fn(graph.Graph.users.create, () => null),
      fn(graph.Graph.posts.create, () => null),
      fn(graph.Graph.posts.publish, (_ctx, [title]) => title),
    ],
  });

  const { path: path1, args: args1 } = queryToObject(client.Graph.status());
  assertEquals(await engine.run({ path: path1, args: args1 }), "ok");

  const { path: path2, args: args2 } = queryToObject(
    client.Graph.users.create(),
  );
  assertEquals(await engine.run({ path: path2, args: args2 }), null);

  const { path: path3, args: args3 } = queryToObject(
    client.Graph.posts.publish("hello"),
  );
  assertEquals(await engine.run({ path: path3, args: args3 }), "hello");

  assertEquals(order, []);
});

Deno.test("admin guard composes with a namespace resolver", async () => {
  const order: string[] = [];

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      resolver(
        graph.Graph.users,
        (_ctx, next) => {
          order.push("users-namespace");
          return next(_ctx);
        },
      ),
      resolver(
        graph.Admin,
        (_ctx, next) => {
          order.push("admin-guard");
          return next(_ctx);
        },
      ),
      fn(graph.Graph.users.admin.delete, () => {
        order.push("users.delete");
        return null;
      }),
    ],
  });

  await run(engine, client.Graph.users.admin.delete());
  // Outer namespace wraps the admin guard, which wraps the endpoint.
  assertEquals(order, ["users-namespace", "admin-guard", "users.delete"]);
});

Deno.test("Admin<() => null>: function as the generic endpoint", async () => {
  const order: string[] = [];

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      resolver(
        graph.Admin,
        (_ctx, next) => {
          order.push("admin-guard");
          return next(_ctx);
        },
      ),
      fn(graph.Graph.files.admin, () => {
        order.push("files.admin");
        return null;
      }),
    ],
  });

  await run(engine, client.Graph.files.admin());
  assertEquals(order, ["admin-guard", "files.admin"]);
});

Deno.test("Admin<(id, name) => null>: args flow through the generic", async () => {
  const order: string[] = [];

  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      resolver(
        graph.Admin,
        (_ctx, next) => {
          order.push("admin-guard");
          return next(_ctx);
        },
      ),
      fn(graph.Graph.files.rename, (_ctx, [id, name]) => {
        order.push(`files.rename(${id}, ${name})`);
        return null;
      }),
    ],
  });

  await run(engine, client.Graph.files.rename(7, "report.pdf"));
  assertEquals(order, ["admin-guard", "files.rename(7, report.pdf)"]);
});

Deno.test("Admin<() => null>: guard blocks and args validation uses the user-facing path", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      resolver(
        graph.Admin,
        () => {
          throw new Error("Forbidden: admin only");
        },
      ),
      fn(graph.Graph.files.rename, () => null),
    ],
  });

  // Guard blocks
  const { path, args } = queryToObject(client.Graph.files.rename(1, "a"));
  const err = await assertRejects(
    () => engine.run({ path, args }),
  );
  assertEquals((err as Error).message, "Forbidden: admin only");

  // Args validation error references the queried path, not an internal key
  const engine2 = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.files.rename, () => null),
    ],
  });
  const bad = client.Graph.files.rename("nope" as any, "a");
  const badReq = queryToObject(bad);
  const err2 = await assertRejects(
    () => engine2.run(badReq),
  );
  assertEquals(
    (err2 as Error).message,
    "Invalid arguments passed to root.Graph.files.rename",
  );
});
