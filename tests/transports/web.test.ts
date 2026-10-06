import { createKey } from "@dldc/stack";
import { webBuiltins } from "@dldc/ts-api/transports/web/builtins";
import {
  execMutation,
  execQuery,
  execStream,
} from "@dldc/ts-api/transports/web/client";
import {
  mutationResolver,
  queryResolver,
  streamResolver,
} from "@dldc/ts-api/transports/web/resolvers";
import { handleWeb } from "@dldc/ts-api/transports/web/server";
import type {
  StreamResult,
  TWebCodec,
} from "@dldc/ts-api/transports/web/types";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { resolve } from "@std/path";
import { query, type TQuery } from "../../src/client/mod.ts";
import {
  createBuiltins,
  createEngine,
  parse,
  resolver,
} from "../../src/server/mod.ts";
import { readSSE } from "../../src/transports/sse/client.ts";
import { stringifyJsonURL } from "../../src/transports/web/utils.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type { WebTypes } from "./web.types.ts";

const client = query<WebTypes>();

const graph = parse<WebTypes>(
  loadSchema(resolve("./tests/transports/web.ts")),
  { builtins: createBuiltins({ ...webBuiltins }) },
);

const engine = createEngine({
  graph,
  entries: ["Graph"],
  resolvers: [
    // The web transport's endpoints are wrapped in `QueryResult<T>` /
    // `MutationResult<T>` / `StreamResult<T>`, which are phantom markers: the
    // resolvers return the unwrapped values (`resolver` is used instead of
    // `fn` because those wrappers only exist at the type level).
    resolver(graph.Graph.aQuery, (ctx) => {
      const [foo, bar] = ctx.getInputOrFail(graph.Graph.aQuery);
      return { todoName: foo, done: bar > 0 };
    }),
    resolver(graph.Graph.longQuery, (ctx) => {
      const [a, b, c] = ctx.getInputOrFail(graph.Graph.longQuery);
      return `${a}|${b}|${c}`;
    }),
    resolver(graph.Graph.aMutation, (ctx) => {
      const [id] = ctx.getInputOrFail(graph.Graph.aMutation);
      return id === "keep";
    }),
    resolver(graph.Graph.aStream, (ctx) => {
      const [topic] = ctx.getInputOrFail(graph.Graph.aStream);
      return (async function* () {
        for (let i = 0; i < 3; i++) {
          yield i + topic.length;
        }
      })();
    }),
  ],
});

interface WebServer {
  base: string;
  shutdown: () => Promise<void>;
}

/**
 * Serve `handleWeb` over a real HTTP server, mounted at `/api` (so the client's
 * `baseUrl` is `http://127.0.0.1:<port>/api`).
 */
function startServer(
  handler: (request: Request) => Promise<Response> | Response = (request) =>
    handleWeb(engine, request, { basePath: "/api" }),
): WebServer {
  const server = Deno.serve({ port: 0 }, handler);
  return {
    base: `http://127.0.0.1:${server.addr.port}/api`,
    shutdown: () => server.shutdown(),
  };
}

function buildServerWith(
  eng: typeof engine,
): WebServer {
  const server = Deno.serve(
    { port: 0 },
    (request) => handleWeb(eng, request, { basePath: "/api" }),
  );
  return {
    base: `http://127.0.0.1:${server.addr.port}/api`,
    shutdown: () => server.shutdown(),
  };
}

async function collect<T>(
  base: string,
  query: TQuery<StreamResult<T>>,
  codec?: TWebCodec,
): Promise<T[]> {
  const values: T[] = [];
  for await (const value of execStream(query, base, undefined, codec)) {
    values.push(value);
  }
  return values;
}

// A custom codec in the spirit of superjson's `{ json, meta }` wrapper: every
// value travels inside a `{ wrapped }` object, so we can assert the client and
// server really are applying `encode` / `decode` (on the JSON-parsed object,
// before it is JSON-serialized).
const wrappedCodec: TWebCodec = {
  encode: (value) => ({ wrapped: value }),
  decode: (value) => (value as { wrapped?: unknown }).wrapped,
};

// ---------------------------------------------------------------------------
// client — queries & mutations
// ---------------------------------------------------------------------------

Deno.test("web: execQuery GETs short queries with args in the URL", async () => {
  let method: string | null = null;
  let url: string | null = null;
  const { base, shutdown } = startServer(async (request) => {
    method = request.method;
    url = request.url;
    return await handleWeb(engine, request, { basePath: "/api" });
  });
  try {
    const q = client.Graph.aQuery("foo", 123);
    const result = await execQuery(q, base);
    assertEquals(result, { todoName: "foo", done: true });
    assertEquals(method, "GET");
    assertEquals(url, base + "/Graph.aQuery?" + stringifyJsonURL(["foo", 123]));
  } finally {
    await shutdown();
  }
});

Deno.test("web: execQuery round-trips special characters in GET args", async () => {
  const { base, shutdown } = startServer();
  try {
    const q = client.Graph.aQuery('has "quotes" + spaces', 0);
    const result = await execQuery(q, base);
    assertEquals(result, { todoName: 'has "quotes" + spaces', done: false });
  } finally {
    await shutdown();
  }
});

Deno.test("web: execQuery POSTs when the URL would be too long", async () => {
  let method: string | null = null;
  let body: unknown;
  const { base, shutdown } = startServer(async (request) => {
    method = request.method;
    body = await request.clone().json();
    return await handleWeb(engine, request, { basePath: "/api" });
  });
  try {
    const big = "a".repeat(3000);
    const q = client.Graph.longQuery(big, "b", "c");
    const result = await execQuery(q, base);
    assertEquals(result, `${big}|b|c`);
    assertEquals(method, "POST");
    // Path stays in the URL, args are the raw JSON body.
    assertEquals(body, [big, "b", "c"]);
  } finally {
    await shutdown();
  }
});

Deno.test("web: execMutation POSTs with args as the JSON body", async () => {
  let method: string | null = null;
  let body: unknown;
  let contentType: string | null = null;
  const { base, shutdown } = startServer(async (request) => {
    method = request.method;
    contentType = request.headers.get("content-type");
    body = await request.clone().json();
    return await handleWeb(engine, request, { basePath: "/api" });
  });
  try {
    const q = client.Graph.aMutation("keep");
    const result = await execMutation(q, base);
    assertEquals(result, true);
    assertEquals(method, "POST");
    assertEquals(body, ["keep"]);
    assertEquals(contentType, "application/json");
  } finally {
    await shutdown();
  }
});

Deno.test("web: execQuery forwards custom headers", async () => {
  let seenAuth: string | null = null;
  const { base, shutdown } = startServer(async (request) => {
    seenAuth = request.headers.get("authorization");
    return await handleWeb(engine, request, { basePath: "/api" });
  });
  try {
    const q = client.Graph.aQuery("foo", 1);
    await execQuery(q, base, { headers: { Authorization: "Bearer secret" } });
    assertEquals(seenAuth, "Bearer secret");
  } finally {
    await shutdown();
  }
});

Deno.test("web: execQuery throws on a non-ok status", async () => {
  const server = Deno.serve(
    { port: 0 },
    () => new Response("not found", { status: 404 }),
  );
  const base = `http://127.0.0.1:${server.addr.port}`;
  try {
    const q = client.Graph.aQuery("foo", 1);
    const err = await assertRejects(() => execQuery(q, base));
    assertEquals((err as Error).message, "HTTP error! status: 404");
  } finally {
    await server.shutdown();
  }
});

Deno.test("web: execMutation propagates an abort signal", async () => {
  const server = Deno.serve({ port: 0 }, async () => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    return Response.json(true);
  });
  const base = `http://127.0.0.1:${server.addr.port}`;
  try {
    const controller = new AbortController();
    const q = client.Graph.aMutation("keep");
    setTimeout(() => controller.abort(), 20);
    const err = await assertRejects(() =>
      execMutation(q, base, { signal: controller.signal })
    );
    assertEquals((err as Error).name, "AbortError");
  } finally {
    await server.shutdown();
  }
});

// ---------------------------------------------------------------------------
// client — streams
// ---------------------------------------------------------------------------

Deno.test("web: execStream streams every yielded value over SSE", async () => {
  const { base, shutdown } = startServer();
  try {
    const q = client.Graph.aStream("ab");
    const values = await collect(base, q);
    assertEquals(values, [2, 3, 4]);
  } finally {
    await shutdown();
  }
});

Deno.test("web: execStream uses POST with args as the JSON body", async () => {
  let method: string | null = null;
  let body: unknown;
  let accept: string | null = null;
  const { base, shutdown } = startServer(async (request) => {
    method = request.method;
    accept = request.headers.get("accept");
    body = await request.clone().json();
    return await handleWeb(engine, request, { basePath: "/api" });
  });
  try {
    const q = client.Graph.aStream("ab");
    const values = await collect(base, q);
    assertEquals(values, [2, 3, 4]);
    assertEquals(method, "POST");
    assertEquals(body, ["ab"]);
    assertEquals(accept, "text/event-stream");
  } finally {
    await shutdown();
  }
});

Deno.test("web: execStream throws when invalid args are delivered as an error event", async () => {
  const { base, shutdown } = startServer();
  try {
    const q = client.Graph.aStream(42 as any);
    const err = await assertRejects(() => collect(base, q));
    assertEquals(
      (err as Error).message,
      "Invalid arguments passed to root.Graph.aStream",
    );
  } finally {
    await shutdown();
  }
});

Deno.test("web: execStream throws when a failing resolver is delivered as an error event", async () => {
  const failingEngine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      resolver(graph.Graph.aStream, () => {
        throw new Error("boom-stream");
      }),
    ],
  });
  const server = buildServerWith(failingEngine);
  try {
    const q = client.Graph.aStream("t");
    const err = await assertRejects(() => collect(server.base, q));
    assertEquals((err as Error).message, "boom-stream");
  } finally {
    await server.shutdown();
  }
});

// ---------------------------------------------------------------------------
// server — handleWeb
// ---------------------------------------------------------------------------

Deno.test("web: handleWeb runs a GET query from JsonURL args in the URL", async () => {
  const request = new Request(
    `http://localhost/api/Graph.aQuery?${stringifyJsonURL(["foo", 3])}`,
  );
  const response = await handleWeb(engine, request, { basePath: "/api" });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { todoName: "foo", done: true });
});

Deno.test("web: handleWeb runs a POST query from a JSON args body", async () => {
  const request = new Request("http://localhost/api/Graph.aMutation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(["keep"]),
  });
  const response = await handleWeb(engine, request, { basePath: "/api" });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), true);
});

Deno.test("web: handleWeb rejects non-array GET args with a 400", async () => {
  const request = new Request("http://localhost/api/Graph.aQuery?notanarray");
  const response = await handleWeb(engine, request, { basePath: "/api" });
  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    message: "Query args in the URL must be an array",
  });
});

Deno.test("web: handleWeb rejects a malformed JSON body with a 400", async () => {
  const request = new Request("http://localhost/api/Graph.aMutation", {
    method: "POST",
    body: "not json",
  });
  const response = await handleWeb(engine, request, { basePath: "/api" });
  assertEquals(response.status, 400);
});

Deno.test("web: handleWeb returns 400 for invalid arguments (client error)", async () => {
  const request = new Request(
    `http://localhost/api/Graph.aQuery?${stringifyJsonURL(["only-one"])}`,
  );
  const response = await handleWeb(engine, request, { basePath: "/api" });
  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    message: "Invalid arguments passed to root.Graph.aQuery",
  });
});

Deno.test("web: handleWeb returns 500 for a failing resolver (server error)", async () => {
  const failingEngine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      resolver(graph.Graph.aMutation, () => {
        throw new Error("boom-json");
      }),
    ],
  });
  const request = new Request("http://localhost/api/Graph.aMutation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(["x"]),
  });
  const response = await handleWeb(failingEngine, request, {
    basePath: "/api",
  });
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { message: "boom-json" });
});

Deno.test("web: handleWeb decodes the endpoint path from the full pathname", async () => {
  // Without a basePath, the whole pathname is decoded as the endpoint path.
  const request = new Request(
    `http://localhost/Graph.aQuery?${stringifyJsonURL(["root", 1])}`,
  );
  const response = await handleWeb(engine, request);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { todoName: "root", done: true });
});

Deno.test("web: handleWeb streams SSE responses to text/event-stream requests", async () => {
  const request = new Request("http://localhost/api/Graph.aStream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(["ab"]),
  });
  const response = await handleWeb(engine, request, { basePath: "/api" });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "text/event-stream");

  const text = await response.text();
  assertStringIncludes(text, "event: message");
  // The three streamed values must be present as data lines.
  assertStringIncludes(text, "data: 2");
  assertStringIncludes(text, "data: 3");
  assertStringIncludes(text, "data: 4");
});

// ---------------------------------------------------------------------------
// extendsCtx
// ---------------------------------------------------------------------------

Deno.test("web: handleWeb passes extendsCtx to engine.run", async () => {
  const FlagKey = createKey<string>("web-flag");
  const extEngine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      resolver(
        graph.Graph.aMutation,
        (ctx) => ctx.getOrFail(FlagKey.Consumer) === "on",
      ),
    ],
  });
  const server = Deno.serve(
    { port: 0 },
    (request) =>
      handleWeb(extEngine, request, {
        basePath: "/api",
        extendsCtx: (ctx) => ctx.with(FlagKey.Provider("on")),
      }),
  );
  const base = `http://127.0.0.1:${server.addr.port}/api`;
  try {
    const q = client.Graph.aMutation("x");
    const result = await execMutation(q, base);
    assertEquals(result, true);
  } finally {
    await server.shutdown();
  }
});

Deno.test("web: handleWeb passes extendsCtx to engine.runIterable", async () => {
  const FlagKey = createKey<string>("web-flag-stream");
  const extEngine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      resolver(graph.Graph.aStream, (ctx) => {
        const ok = ctx.getOrFail(FlagKey.Consumer) === "stream-on";
        return (async function* () {
          yield ok ? 7 : 0;
        })();
      }),
    ],
  });
  const server = Deno.serve(
    { port: 0 },
    (request) =>
      handleWeb(extEngine, request, {
        basePath: "/api",
        extendsCtx: (ctx) => ctx.with(FlagKey.Provider("stream-on")),
      }),
  );
  const base = `http://127.0.0.1:${server.addr.port}/api`;
  try {
    const q = client.Graph.aStream("t");
    const values = await collect(base, q);
    assertEquals(values, [7]);
  } finally {
    await server.shutdown();
  }
});

// ---------------------------------------------------------------------------
// codec
// ---------------------------------------------------------------------------

Deno.test("web: execMutation round-trips args and result through the codec", async () => {
  let capturedBody: unknown;
  const server = Deno.serve({ port: 0 }, async (request) => {
    capturedBody = await request.clone().text();
    return await handleWeb(engine, request, {
      basePath: "/api",
      codec: wrappedCodec,
    });
  });
  const base = `http://127.0.0.1:${server.addr.port}/api`;
  try {
    const q = client.Graph.aMutation("keep");
    const result = await execMutation(q, base, undefined, wrappedCodec);
    assertEquals(result, true);
    // The wire body is the codec-encoded args, not the raw array.
    assertEquals(capturedBody, JSON.stringify({ wrapped: ["keep"] }));
  } finally {
    await server.shutdown();
  }
});

Deno.test("web: execQuery GETs short queries with a codec, JsonURL-encoding the wrapped args", async () => {
  let method: string | null = null;
  let url: string | null = null;
  const server = Deno.serve({ port: 0 }, async (request) => {
    method = request.method;
    url = request.url;
    return await handleWeb(engine, request, {
      basePath: "/api",
      codec: wrappedCodec,
    });
  });
  const base = `http://127.0.0.1:${server.addr.port}/api`;
  try {
    const q = client.Graph.aQuery("foo", 123);
    const result = await execQuery(q, base, undefined, wrappedCodec);
    assertEquals(result, { todoName: "foo", done: true });
    // The codec does not change the transport: short queries still GET, with
    // the codec-encoded args JsonURL-encoded into the URL.
    assertEquals(method, "GET");
    assertEquals(
      url,
      base + "/Graph.aQuery?" + stringifyJsonURL({ wrapped: ["foo", 123] }),
    );
  } finally {
    await server.shutdown();
  }
});

Deno.test("web: execQuery with a codec POSTs when the URL would be too long", async () => {
  let method: string | null = null;
  let capturedBody: unknown;
  const server = Deno.serve({ port: 0 }, async (request) => {
    method = request.method;
    capturedBody = await request.clone().text();
    return await handleWeb(engine, request, {
      basePath: "/api",
      codec: wrappedCodec,
    });
  });
  const base = `http://127.0.0.1:${server.addr.port}/api`;
  try {
    const big = "a".repeat(3000);
    const q = client.Graph.longQuery(big, "b", "c");
    const result = await execQuery(q, base, undefined, wrappedCodec);
    assertEquals(result, `${big}|b|c`);
    assertEquals(method, "POST");
    // The body is the codec-encoded args, not the raw array.
    assertEquals(capturedBody, JSON.stringify({ wrapped: [big, "b", "c"] }));
  } finally {
    await server.shutdown();
  }
});

Deno.test("web: execStream decodes each SSE event through the codec", async () => {
  const server = Deno.serve(
    { port: 0 },
    (request) =>
      handleWeb(engine, request, { basePath: "/api", codec: wrappedCodec }),
  );
  const base = `http://127.0.0.1:${server.addr.port}/api`;
  try {
    const q = client.Graph.aStream("ab");
    const values = await collect(base, q, wrappedCodec);
    assertEquals(values, [2, 3, 4]);
  } finally {
    await server.shutdown();
  }
});

Deno.test("web: handleWeb decodes the wrapped body and encodes the wrapped result", async () => {
  const request = new Request("http://localhost/api/Graph.aMutation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wrapped: ["keep"] }),
  });
  const response = await handleWeb(engine, request, {
    basePath: "/api",
    codec: wrappedCodec,
  });
  assertEquals(response.status, 200);
  // The wire result is `{ wrapped: true }`, which the client unwraps.
  assertEquals(await response.json(), { wrapped: true });
});

Deno.test("web: handleWeb without a codec still uses plain JSON", async () => {
  // Regression guard: no codec on either side keeps the plain JSON wire.
  const { base, shutdown } = startServer();
  try {
    const q = client.Graph.aMutation("keep");
    const result = await execMutation(q, base);
    assertEquals(result, true);
  } finally {
    await shutdown();
  }
});

// ---------------------------------------------------------------------------
// transport enforcement
// ---------------------------------------------------------------------------

Deno.test("web: handleWeb rejects GET on a mutation", async () => {
  const request = new Request(
    `http://localhost/api/Graph.aMutation?${stringifyJsonURL(["x"])}`,
  );
  const response = await handleWeb(engine, request, { basePath: "/api" });
  assertEquals(response.status, 405);
  assertEquals(await response.json(), {
    message: "MutationResult endpoints only accept POST requests",
  });
});

Deno.test("web: handleWeb rejects GET on a stream", async () => {
  const request = new Request("http://localhost/api/Graph.aStream");
  const response = await handleWeb(engine, request, { basePath: "/api" });
  assertEquals(response.status, 405);
  assertEquals(await response.json(), {
    message: "StreamResult endpoints only accept POST requests",
  });
});

Deno.test("web: handleWeb rejects streaming a non-stream endpoint", async () => {
  const cases: Array<{ path: string; body: unknown }> = [
    { path: "Graph.aQuery", body: ["foo", 1] },
    { path: "Graph.aMutation", body: ["x"] },
  ];
  for (const { path, body } of cases) {
    const request = new Request(`http://localhost/api/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    const response = await handleWeb(engine, request, { basePath: "/api" });
    assertEquals(response.status, 406, `expected 406 for ${path}`);
    assertEquals(await response.json(), {
      message: "Only StreamResult endpoints can be streamed",
    });
  }
});

Deno.test("web: handleWeb requires Accept: text/event-stream on a stream", async () => {
  const request = new Request("http://localhost/api/Graph.aStream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(["ab"]),
  });
  const response = await handleWeb(engine, request, { basePath: "/api" });
  assertEquals(response.status, 406);
  assertEquals(await response.json(), {
    message:
      "StreamResult endpoints must be called with Accept: text/event-stream",
  });
});

Deno.test("web: handleWeb accepts the valid combinations", async () => {
  // GET query
  const getQuery = await handleWeb(
    engine,
    new Request(
      `http://localhost/api/Graph.aQuery?${stringifyJsonURL(["foo", 1])}`,
    ),
    { basePath: "/api" },
  );
  assertEquals(getQuery.status, 200);

  // POST query (the client POSTs long queries)
  const postQuery = await handleWeb(
    engine,
    new Request("http://localhost/api/Graph.aQuery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["foo", 1]),
    }),
    { basePath: "/api" },
  );
  assertEquals(postQuery.status, 200);

  // POST mutation
  const postMutation = await handleWeb(
    engine,
    new Request("http://localhost/api/Graph.aMutation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["keep"]),
    }),
    { basePath: "/api" },
  );
  assertEquals(postMutation.status, 200);

  // POST stream with SSE
  const postStream = await handleWeb(
    engine,
    new Request("http://localhost/api/Graph.aStream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(["ab"]),
    }),
    { basePath: "/api" },
  );
  assertEquals(postStream.status, 200);
  assertEquals(postStream.headers.get("content-type"), "text/event-stream");
});

Deno.test("web: queryResolver / mutationResolver / streamResolver", async () => {
  // The typed resolvers delegate to `fn`, so they behave identically — with
  // the phantom wrappers unwrapped and the args passed as the second argument.
  const engine = createEngine({
    graph,
    entries: ["Graph"],
    resolvers: [
      queryResolver(graph.Graph.aQuery, (_ctx, [foo, bar]) => ({
        todoName: foo,
        done: bar > 0,
      })),
      mutationResolver(graph.Graph.aMutation, (_ctx, [id]) => {
        return id === "keep";
      }),
      streamResolver(graph.Graph.aStream, (_ctx, [topic]) => {
        return (async function* () {
          for (let i = 0; i < 3; i++) {
            yield i + topic.length;
          }
        })();
      }),
    ],
  });

  // GET query
  const queryResponse = await handleWeb(
    engine,
    new Request(
      `http://localhost/api/Graph.aQuery?${stringifyJsonURL(["foo", 1])}`,
    ),
    { basePath: "/api" },
  );
  assertEquals(queryResponse.status, 200);
  assertEquals(await queryResponse.json(), { todoName: "foo", done: true });

  // POST mutation
  const mutationResponse = await handleWeb(
    engine,
    new Request("http://localhost/api/Graph.aMutation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["keep"]),
    }),
    { basePath: "/api" },
  );
  assertEquals(mutationResponse.status, 200);
  assertEquals(await mutationResponse.json(), true);

  // SSE stream
  const streamResponse = await handleWeb(
    engine,
    new Request("http://localhost/api/Graph.aStream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(["ab"]),
    }),
    { basePath: "/api" },
  );
  assertEquals(streamResponse.status, 200);
  const values: unknown[] = [];
  for await (const value of readSSE(streamResponse)) {
    values.push(value);
  }
  assertEquals(values, [2, 3, 4]);
});

Deno.test("web: resolver helpers are typed to their endpoint kind", () => {
  // Correct helpers accept the matching endpoints and unwrap their return type.
  const query = queryResolver(graph.Graph.aQuery, (_ctx, [foo, bar]) => ({
    todoName: foo,
    done: bar > 0,
  }));
  const mutation = mutationResolver(graph.Graph.aMutation, (_ctx, [id]) => {
    return id === "keep";
  });
  const stream = streamResolver(graph.Graph.aStream, (_ctx, [topic]) => {
    return (async function* () {
      for (let i = 0; i < 3; i++) {
        yield i + topic.length;
      }
    })();
  });

  // The `@ts-expect-error` directives below are the type-level assertions:
  // each line must be rejected at compile time (deno test type-checks the
  // file, so an unused or un-errored directive fails the suite).

  // MutationResult passed to queryResolver
  // @ts-expect-error aMutation is a MutationResult, not a QueryResult
  queryResolver(graph.Graph.aMutation, (_ctx, [id]) => id === "keep");

  // QueryResult passed to mutationResolver
  // @ts-expect-error aQuery is a QueryResult, not a MutationResult
  mutationResolver(graph.Graph.aQuery, (_ctx, [foo, bar]) => ({
    todoName: foo,
    done: bar > 0,
  }));

  // QueryResult passed to streamResolver
  // @ts-expect-error aQuery is a QueryResult, not a StreamResult
  streamResolver(graph.Graph.aQuery, (_ctx, [foo]) => {
    return (async function* () {
      yield { todoName: foo, done: true };
    })();
  });

  // A namespace passed to queryResolver
  // @ts-expect-error a namespace is not an endpoint
  queryResolver(graph.Graph, () => undefined as never);

  assertEquals(query.kind, "resolver");
  assertEquals(mutation.kind, "resolver");
  assertEquals(stream.kind, "resolver");
});
