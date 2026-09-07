import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../client.ts";
import { createEngine, createKey, fn, parse, resolver } from "../server.ts";
import type { TodoListTypes } from "./schemas/todolist.types.ts";

const client = query<TodoListTypes>();

const graph = parse<TodoListTypes>(
  resolve("./tests/schemas/todolist.ts"),
);

interface AuthUser {
  id: string;
  name: string;
}

const AuthKey = createKey<AuthUser | null>("auth");

const engine = createEngine({
  graph,
  entry: "Graph",
  resolvers: [
    fn(graph.Graph.auth, (ctx) => {
      const user = ctx.getOrFail(AuthKey.Consumer);
      return user
        ? { user: { userName: user.name, app: { appName: "app1", todos: [] } } }
        : null;
    }),
    resolver(
      graph.Graph.users,
      (ctx, next) => {
        const user = ctx.getOrFail(AuthKey.Consumer);
        if (!user) {
          throw new Error("Unauthorized");
        }
        return next(ctx);
      },
    ),
    fn(graph.Graph.users.byId, (_ctx, [id]) => {
      return { userName: id, app: { appName: "app1", todos: [] } };
    }),
  ],
});

Deno.test("context: authenticated user can call auth()", async () => {
  const q = client.Graph.auth();
  const { path: queryDef, args } = queryToObject(q);

  const result = await engine.run({ path: queryDef, args }, (ctx) => {
    return ctx.with(AuthKey.Provider({ id: "u1", name: "Alice" }));
  });

  assertEquals(result, {
    user: { userName: "Alice", app: { appName: "app1", todos: [] } },
  });
});

Deno.test("context: null user returns null from auth()", async () => {
  const q = client.Graph.auth();
  const { path: queryDef, args } = queryToObject(q);

  const result = await engine.run({ path: queryDef, args }, (ctx) => {
    return ctx.with(AuthKey.Provider(null));
  });

  assertEquals(result, null);
});

Deno.test("context: unauthenticated user is rejected by namespace middleware", async () => {
  const q = client.Graph.users.byId("1");
  const { path: queryDef, args } = queryToObject(q);

  await assertRejects(
    () =>
      engine.run({ path: queryDef, args }, (ctx) => {
        return ctx.with(AuthKey.Provider(null));
      }),
    Error,
    "Unauthorized",
  );
});
