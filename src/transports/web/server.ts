import type { TQueryRequest } from "../../client/query.types.ts";
import type { TEngine, TExtendsContext } from "../../server/engine.ts";
import { GraphClientErreur } from "../../server/erreur.ts";
import {
  getEndpointResponseStructure,
  type TGraphBaseAny,
} from "../../server/mod.ts";
import { encodeSSEEvent } from "../sse/server.ts";
import {
  type TWebCodec,
  type TWebEndpointKind,
  webKindFromStructure,
} from "./types.ts";
import { decodePath, parseJsonURL } from "./utils.ts";

const defaultCodec: TWebCodec = {
  encode: (value) => value,
  decode: (value) => value,
};

/** Options for {@link handleWeb}. */
export interface TWebHandleOptions {
  /**
   * The URL path prefix to strip from the request pathname before decoding the
   * endpoint path.
   *
   * The web client appends the encoded endpoint path (e.g. `Graph.aQuery`) to
   * the `baseUrl` it was given, so when the transport is mounted under a prefix
   * (e.g. `hono.get("/api/:path", ...)`), that prefix must be provided here for
   * it to be separated from the endpoint path. Defaults to `""` (no prefix).
   */
  basePath?: string;
  /**
   * An optional function that can extend the engine's context before resolvers
   * run, exactly like the `extendsCtx` argument of {@link TEngine.run} and
   * {@link TEngine.runIterable}. Useful to inject request-scoped data (e.g. the
   * authenticated user).
   */
  extendsCtx?: TExtendsContext;
  /**
   * An optional custom encode / decode that transforms values into
   * JSON-compatible objects before they are JSON-serialized. Must match the
   * codec used by the client (see {@link TWebCodec}).
   */
  codec?: TWebCodec;
}

/**
 * Handle a request coming from the web transport's client.
 *
 * The endpoint path is decoded from the URL (after stripping `basePath`) and
 * the args come from the JsonURL query string (GET requests) or the JSON
 * request body (POST requests) — in both cases `codec.decode`d (default
 * identity).
 *
 * The request must match the transport kind the endpoint is declared with in
 * the schema: `QueryResult` endpoints run as GET or POST (the client POSTs
 * long queries) and return JSON; `MutationResult` endpoints only accept POST
 * and return JSON; `StreamResult` endpoints only accept POST and must
 * advertise `Accept: text/event-stream`, in which case every yielded value is
 * streamed back as a Server-Sent Events `message` event (with `engine.run` /
 * `engine.runIterable` respectively). Violations are rejected with a `405`
 * (bad method) or `406` (bad `Accept`) JSON `Response` instead of silently
 * executing — so e.g. a GET on a mutation (a CSRF vector) can never run. If
 * running the query throws, an `error` event carrying `{ "message": ... }` is
 * sent instead — in streaming and JSON mode alike the error is surfaced to the
 * client.
 *
 * Both `engine.run` and `engine.runIterable` receive `options.extendsCtx`, and
 * every value written to the response goes through `options.codec` (default
 * JSON).
 *
 * @param engine The engine instance used to run the query.
 * @param request The request to handle.
 * @param options See {@link TWebHandleOptions}.
 * @returns A `Response` (JSON or `text/event-stream`).
 */
export async function handleWeb(
  engine: TEngine,
  request: Request,
  options: TWebHandleOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = decodeRequestPath(url.pathname, options.basePath);
  const streaming = acceptsEventStream(request);
  const codec = options.codec ?? defaultCodec;

  // Enforce the transport kind declared by the endpoint's schema wrapper
  // (QueryResult / MutationResult / StreamResult) instead of trusting the
  // request: e.g. a GET on a mutation would otherwise be silently executed —
  // a CSRF vector — and a user can't accidentally stream a non-stream
  // endpoint. Queries may run as GET or POST (the client POSTs long queries);
  // mutations and streams are POST-only, and streams additionally require
  // `Accept: text/event-stream`.
  const kind = resolveEndpointKind(engine.graph, path);
  const violation = checkTransport(kind, request.method, streaming);
  if (violation) {
    return jsonErrorResponse(
      new Error(violation.message),
      violation.status,
      codec.encode,
    );
  }

  let args: unknown[];
  try {
    args = await readArgs(request, url, codec.decode);
  } catch (error) {
    if (streaming) {
      return sseErrorResponse(errorMessage(error), codec.encode);
    }
    return jsonErrorResponse(error, 400, codec.encode);
  }

  const query = { path, args };
  if (streaming) {
    return streamResponse(engine, query, options, codec.encode);
  }
  return jsonResponse(engine, query, options, codec.encode);
}

/**
 * Decode the endpoint path from the request pathname, stripping an optional
 * `basePath` prefix.
 */
function decodeRequestPath(pathname: string, basePath?: string): string[] {
  let rest = pathname;
  const prefix = normalizeBasePath(basePath);
  if (prefix) {
    if (rest === prefix) {
      rest = "";
    } else if (rest.startsWith(prefix + "/")) {
      rest = rest.slice(prefix.length);
    }
  }
  rest = rest.replace(/^\/+/, "");
  if (rest === "") {
    return [];
  }
  return decodePath(rest);
}

function normalizeBasePath(basePath?: string): string {
  if (!basePath || basePath === "/") {
    return "";
  }
  const withSlash = basePath.startsWith("/") ? basePath : "/" + basePath;
  return withSlash.replace(/\/+$/, "");
}

/**
 * Resolve the transport kind an endpoint is declared with by reading the ref
 * wrapping its response structure (from the server's public
 * {@link getEndpointResponseStructure}).
 *
 * Returns `undefined` for endpoints that are not wrapped in one of the three
 * web transport types (nothing to enforce then) or whose response structure
 * cannot be resolved.
 */
function resolveEndpointKind(
  graph: TGraphBaseAny,
  path: string[],
): TWebEndpointKind | undefined {
  return webKindFromStructure(getEndpointResponseStructure(graph, path));
}

interface TTransportViolation {
  status: number;
  message: string;
}

/**
 * Check that the request matches the endpoint's declared transport kind.
 *
 * - `query`: GET or POST (the client POSTs long queries), plain JSON only.
 * - `mutation`: POST only, plain JSON only.
 * - `stream`: POST only, and requires `Accept: text/event-stream`.
 *
 * Ends with no violation for endpoints whose kind is unknown (they are not
 * governed by the transport contract).
 */
function checkTransport(
  kind: TWebEndpointKind | undefined,
  method: string,
  streaming: boolean,
): TTransportViolation | undefined {
  if (kind === undefined) {
    return undefined;
  }
  const isGet = method === "GET";
  switch (kind) {
    case "query":
      if (streaming) {
        return {
          status: 406,
          message: "Only StreamResult endpoints can be streamed",
        };
      }
      return undefined;
    case "mutation":
      if (isGet) {
        return {
          status: 405,
          message: "MutationResult endpoints only accept POST requests",
        };
      }
      if (streaming) {
        return {
          status: 406,
          message: "Only StreamResult endpoints can be streamed",
        };
      }
      return undefined;
    case "stream":
      if (isGet) {
        return {
          status: 405,
          message: "StreamResult endpoints only accept POST requests",
        };
      }
      if (!streaming) {
        return {
          status: 406,
          message:
            "StreamResult endpoints must be called with Accept: text/event-stream",
        };
      }
      return undefined;
  }
}

/**
 * Read the query args from the request: the JsonURL query string for GET
 * requests, a JSON body for POST requests — both `codec.decode`'d (default
 * identity).
 *
 * The JsonURL query string is passed through as-is (percent-encoded, with `+`
 * for spaces as produced by the AQF syntax), so its parser can reverse the
 * encoding exactly.
 */
async function readArgs(
  request: Request,
  url: URL,
  decode: (value: unknown) => unknown,
): Promise<unknown[]> {
  if (request.method === "GET") {
    const search = url.search.replace(/^[?]/, "");
    if (search === "") {
      return [];
    }
    const decoded = decode(parseJsonURL(search));
    if (!Array.isArray(decoded)) {
      throw new Error("Query args in the URL must be an array");
    }
    return decoded;
  }
  const text = await request.text();
  const decoded = decode(JSON.parse(text));
  if (!Array.isArray(decoded)) {
    throw new Error("Request body must be a JSON array of args");
  }
  return decoded;
}

/** Whether the client asked for an SSE stream (via the `Accept` header). */
function acceptsEventStream(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/event-stream");
}

async function jsonResponse(
  engine: TEngine,
  query: TQueryRequest,
  options: TWebHandleOptions,
  encode: (value: unknown) => unknown,
): Promise<Response> {
  try {
    const result = await engine.run(query, options.extendsCtx);
    return Response.json(encode(result));
  } catch (error) {
    // Client-caused validation failures (e.g. invalid arguments) are "safe" to
    // send back; anything else is a server-side error.
    return jsonErrorResponse(
      error,
      GraphClientErreur.has(error) ? 400 : 500,
      encode,
    );
  }
}

function streamResponse(
  engine: TEngine,
  query: TQueryRequest,
  options: TWebHandleOptions,
  encode: (value: unknown) => unknown,
): Response {
  const iterable = engine.runIterable(query, options.extendsCtx);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const value of iterable) {
          controller.enqueue(encodeSSEEvent("message", json(encode(value))));
        }
      } catch (error) {
        controller.enqueue(
          encodeSSEEvent(
            "error",
            json(encode({ message: errorMessage(error) })),
          ),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonErrorResponse(
  error: unknown,
  status: number,
  encode: (value: unknown) => unknown,
): Response {
  return Response.json(encode({ message: errorMessage(error) }), { status });
}

function sseErrorResponse(
  message: string,
  encode: (value: unknown) => unknown,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeSSEEvent("error", json(encode({ message }))));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function json(value: unknown): string {
  // `JSON.stringify(undefined)` returns `undefined`, not a string; fall back to
  // `null` so the SSE encoding always receives something it can split.
  return JSON.stringify(value) ?? "null";
}
