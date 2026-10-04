import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { resolve } from "@std/path";
import { query } from "../../src/client/mod.ts";
import { createEngine, fn, parse } from "../../src/server/mod.ts";
import { execQuery } from "@dldc/ts-api/transports/http/client";
import { handleQuery, parseBody } from "@dldc/ts-api/transports/http/server";
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
    fn(graph.Graph.config, () => ({
      env: { version: "1.0.0", num: 42, str: "hello", bool: true },
    })),
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

interface HttpServer {
  base: string;
  shutdown: () => Promise<void>;
}

/** Serve the http transport's `handleQuery` over a real HTTP server. */
function startServer(
  handler: (request: Request) => Promise<Response> | Response = async (
    request,
  ) => Response.json(await handleQuery(engine, request)),
): HttpServer {
  const server = Deno.serve({ port: 0 }, handler);
  return {
    base: `http://127.0.0.1:${server.addr.port}`,
    shutdown: () => server.shutdown(),
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// client
// ---------------------------------------------------------------------------

Deno.test("http: execQuery returns the result of a query", async () => {
  const { base, shutdown } = startServer();
  try {
    const q = client.Graph.config();
    const result = await execQuery(q, base);
    assertEquals(result, {
      env: { version: "1.0.0", num: 42, str: "hello", bool: true },
    });
  } finally {
    await shutdown();
  }
});

Deno.test("http: execQuery posts { path, args } as JSON", async () => {
  let captured: unknown;
  let contentType: string | null = null;
  const { base, shutdown } = startServer(async (request) => {
    contentType = request.headers.get("content-type");
    const text = await request.text();
    captured = JSON.parse(text);
    return Response.json(
      await handleQuery(
        engine,
        new Request(request.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: text,
        }),
      ),
    );
  });
  try {
    const q = client.Graph.apps.byId("app1");
    const result = await execQuery(q, base);
    assertEquals(result, { appName: "app1", todos: [] });
    assertEquals(captured, { path: ["Graph", "apps", "byId"], args: ["app1"] });
    assertEquals(contentType, "application/json");
  } finally {
    await shutdown();
  }
});

Deno.test("http: execQuery forwards custom headers", async () => {
  let seenAuth: string | null = null;
  const { base, shutdown } = startServer(async (request) => {
    seenAuth = request.headers.get("authorization");
    return Response.json(await handleQuery(engine, request));
  });
  try {
    const q = client.Graph.config();
    await execQuery(q, base, { headers: { Authorization: "Bearer secret" } });
    assertEquals(seenAuth, "Bearer secret");
  } finally {
    await shutdown();
  }
});

Deno.test("http: execQuery throws on a non-ok status", async () => {
  const { base, shutdown } = startServer(() =>
    new Response("not found", { status: 404 })
  );
  try {
    const q = client.Graph.config();
    const err = await assertRejects(() => execQuery(q, base));
    assertEquals((err as Error).message, "HTTP error! status: 404");
  } finally {
    await shutdown();
  }
});

Deno.test("http: execQuery propagates an abort signal", async () => {
  const { base, shutdown } = startServer(async () => {
    // Keep the request pending so the client-side abort wins the race.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    return Response.json({ ok: true });
  });
  try {
    const controller = new AbortController();
    const q = client.Graph.config();
    setTimeout(() => controller.abort(), 20);
    const err = await assertRejects(() =>
      execQuery(q, base, { signal: controller.signal })
    );
    assertEquals((err as Error).name, "AbortError");
  } finally {
    await shutdown();
  }
});

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

Deno.test("http: handleQuery runs a query from a JSON body", async () => {
  const result = await handleQuery(
    engine,
    jsonRequest({ path: ["Graph", "config"], args: [] }),
  );
  assertEquals(result, {
    env: { version: "1.0.0", num: 42, str: "hello", bool: true },
  });
});

Deno.test("http: handleQuery rejects on invalid arguments", async () => {
  const err = await assertRejects(() =>
    handleQuery(
      engine,
      jsonRequest({ path: ["Graph", "apps", "byId"], args: [42] }),
    )
  );
  assertEquals(
    (err as Error).message,
    "Invalid arguments passed to root.Graph.apps.byId",
  );
});

Deno.test("http: handleQuery rejects when the body is not valid JSON", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    body: "{not json",
  });
  await assertRejects(() => handleQuery(engine, request));
});

Deno.test("http: handleQuery rejects when a resolver throws", async () => {
  const failingEngine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.config, () => {
        throw new Error("boom");
      }),
    ],
  });
  const err = await assertRejects(() =>
    handleQuery(
      failingEngine,
      jsonRequest({ path: ["Graph", "config"], args: [] }),
    )
  );
  assertEquals((err as Error).message, "boom");
});

// ---------------------------------------------------------------------------
// parseBody
// ---------------------------------------------------------------------------

Deno.test("http: parseBody accepts a valid body", () => {
  const body = { path: ["Graph", "config"], args: [1, "two", null] };
  assertEquals(parseBody(body), body);
});

Deno.test("http: parseBody rejects a non-object body", () => {
  assertThrows(() => parseBody("nope"));
  assertThrows(() => parseBody(null));
  assertThrows(() => parseBody(42));
});

Deno.test("http: parseBody rejects a missing or malformed path", () => {
  assertThrows(() => parseBody({ args: [] }));
  assertThrows(() => parseBody({ path: "Graph", args: [] }));
  assertThrows(() => parseBody({ path: [123], args: [] }));
});

Deno.test("http: parseBody rejects malformed args", () => {
  assertThrows(() => parseBody({ path: ["Graph"], args: "one" }));
});
