import { assertEquals, assertRejects } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject, type TQuery } from "../../src/client/mod.ts";
import { createEngine, fn, parse, resolver } from "../../src/server/mod.ts";
import { execQuery } from "@dldc/ts-api/transports/sse/client";
import { handleQuery } from "@dldc/ts-api/transports/sse/server";
import { loadSchema } from "../utils/loadSchema.ts";
import type { TodoListTypes } from "../schemas/todolist.types.ts";

const client = query<TodoListTypes>();

const graph = parse<TodoListTypes>(
  loadSchema(resolve("./tests/schemas/todolist.ts")),
);

const engine = createEngine({
  graph,
  entry: "Graph",
  resolvers: [
    // Streams two `Config` values through an async generator; each item is
    // validated against the `Config` return schema by `runIterable`.
    resolver(graph.Graph.config, () => {
      return (async function* () {
        yield { env: { version: "1.0.0", num: 1, str: "one", bool: true } };
        yield { env: { version: "1.0.0", num: 2, str: "two", bool: true } };
      })();
    }),
    fn(graph.Graph.apps.all, () => [
      { appName: "app1", todos: [] },
      { appName: "app2", todos: [] },
    ]),
    fn(graph.Graph.apps.byId, (_ctx, [id]) => ({
      appName: id,
      todos: [],
    })),
  ],
});

interface SseServer {
  base: string;
  shutdown: () => Promise<void>;
}

function startSseServer(): SseServer {
  const server = Deno.serve(
    { port: 0 },
    (request) => handleQuery(engine, request),
  );
  return {
    base: `http://127.0.0.1:${server.addr.port}`,
    shutdown: () => server.shutdown(),
  };
}

async function collect<T>(input: string, query: TQuery<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of execQuery(query, input)) {
    values.push(value);
  }
  return values;
}

Deno.test("sse: streams every yielded value", async () => {
  const { base, shutdown } = await startSseServer();
  try {
    const q = client.Graph.config();
    const values = await collect(base, q);
    assertEquals(values, [
      { env: { version: "1.0.0", num: 1, str: "one", bool: true } },
      { env: { version: "1.0.0", num: 2, str: "two", bool: true } },
    ]);
  } finally {
    await shutdown();
  }
});

Deno.test("sse: a non-iterable result is yielded once", async () => {
  const { base, shutdown } = await startSseServer();
  try {
    const q = client.Graph.apps.all({ limit: 10, page: 1 });
    const values = await collect(base, q);
    assertEquals(values.length, 1);
    assertEquals(values[0], [
      { appName: "app1", todos: [] },
      { appName: "app2", todos: [] },
    ]);
  } finally {
    await shutdown();
  }
});

Deno.test("sse: invalid arguments are delivered as an error event", async () => {
  const { base, shutdown } = await startSseServer();
  try {
    const q = client.Graph.apps.byId(42 as any);
    const err = await assertRejects(() => collect(base, q));
    assertEquals(
      (err as Error).message,
      "Invalid arguments passed to root.Graph.apps.byId",
    );
  } finally {
    await shutdown();
  }
});

Deno.test("sse: a failing resolver is delivered as an error event", async () => {
  const failingEngine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.config, () => {
        throw new Error("boom");
      }),
    ],
  });
  const server = Deno.serve({ port: 0 }, (request) => {
    return handleQuery(failingEngine, request);
  });
  try {
    const base = `http://127.0.0.1:${server.addr.port}`;
    const q = client.Graph.config();
    const err = await assertRejects(() => collect(base, q));
    assertEquals((err as Error).message, "boom");
  } finally {
    await server.shutdown();
  }
});

Deno.test("sse: the client query is the same { path, args } payload as http", () => {
  const q = client.Graph.apps.byId("app1");
  const { path, args } = queryToObject(q);
  assertEquals(path, ["Graph", "apps", "byId"]);
  assertEquals(args, ["app1"]);
});
