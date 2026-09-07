import { assertEquals } from "@std/assert";
import { query, queryToObject } from "../../client.ts";
import type {
  App,
  CoinHeads,
  CoinTails,
  Config,
  Graph,
  User,
} from "./graph.ts";

export interface TodoListTypes {
  Graph: Graph;
  App: App;
  Config: Config;
  User: User;
  CoinHeads: CoinHeads;
  CoinTails: CoinTails;
}

const client = query<TodoListTypes>();

Deno.test("simple query", () => {
  const q = client.Graph.config();
  assertEquals(queryToObject(q), { path: ["Graph", "config"], args: [] });
});

Deno.test("call with args", () => {
  const q = client.Graph.apps.all({ page: 1, limit: 10 });
  assertEquals(queryToObject(q), {
    path: ["Graph", "apps", "all"],
    args: [{ limit: 10, page: 1 }],
  });
});

Deno.test("call with no args", () => {
  const q = client.Graph.apps.all();
  assertEquals(queryToObject(q), {
    path: ["Graph", "apps", "all"],
    args: [],
  });
});

Deno.test("call with string arg", () => {
  const q = client.Graph.apps.byId("some-id");
  assertEquals(queryToObject(q), {
    path: ["Graph", "apps", "byId"],
    args: ["some-id"],
  });
});

Deno.test("call returns typed result", () => {
  const q = client.Graph.config();
  void q;
});

Deno.test("call with multiple args", () => {
  const q = client.Graph.users.byId("user-123");
  assertEquals(queryToObject(q), {
    path: ["Graph", "users", "byId"],
    args: ["user-123"],
  });
});

Deno.test("call with no-arg function", () => {
  const q = client.Graph.flip();
  assertEquals(queryToObject(q), {
    path: ["Graph", "flip"],
    args: [],
  });
});

Deno.test("call with optional arg omitted", () => {
  const q = client.Graph.apps.all();
  assertEquals(queryToObject(q), {
    path: ["Graph", "apps", "all"],
    args: [],
  });
});
