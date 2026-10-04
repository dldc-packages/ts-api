import { queryToObject } from "../../client/query.ts";
import type { TQuery } from "../../client/query.types.ts";
import { readSSE } from "../sse/client.ts";
import type {
  MutationResult,
  QueryResult,
  StreamResult,
  TWebCodec,
} from "./types.ts";
import { encodePath, stringifyJsonURL } from "./utils.ts";

const MAX_URL_LENGTH = 2000;

const defaultCodec: TWebCodec = {
  encode: (value) => value,
  decode: (value) => value,
};

/**
 * Execute a query endpoint and resolve to its returned value.
 *
 * The args are always JsonURL-encoded into the query string and sent as a GET
 * when the URL stays short enough, falling back to a POST whose body is the
 * args array (the path travels in the URL either way). An optional `codec`
 * transforms the args (and the result) into JSON-compatible objects before
 * they are JsonURL- / JSON-serialized — it does not change the transport.
 *
 * @param query The query to execute.
 * @param baseUrl The base URL the endpoint path is appended to.
 * @param init Optional fetch options (only `signal` and `headers` are commonly
 *   needed; `method` and `body` are set automatically).
 * @param codec Optional custom encode / decode turning values into
 *   JSON-compatible objects (see {@link TWebCodec}).
 * @returns The returned value of the endpoint.
 */
export async function execQuery<T>(
  query: TQuery<QueryResult<T>>,
  baseUrl: string,
  init?: RequestInit,
  codec?: TWebCodec,
): Promise<T> {
  const { args, path } = queryToObject(query);
  const resolvedCodec = codec ?? defaultCodec;
  // The codec transforms the values (e.g. to a superjson `{ json, meta }`
  // object), it does not change the transport: the encoded args are still
  // JsonURL-encoded into the URL, and only POSTed when the URL would be too
  // long.
  const encodedArgs = resolvedCodec.encode(args);

  const url = buildUrl(baseUrl, path);
  const getUrl = new URL(url.toString());
  const queryString = stringifyJsonURL(encodedArgs);
  if (queryString) {
    getUrl.search = "?" + queryString;
  }
  if (getUrl.toString().length <= MAX_URL_LENGTH) {
    // Run with get
    const response = await fetch(getUrl, {
      ...init,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    return handleResponse<T>(response, resolvedCodec.decode);
  }
  // Run with POST if the URL is too long.
  return execPost<T>(url, args, init, resolvedCodec);
}

/**
 * Execute a mutation endpoint with a POST request whose body is the raw `args`
 * array (the path travels in the URL), and resolve to the encoded result.
 *
 * @param query The mutation query to execute.
 * @param baseUrl The base URL the endpoint path is appended to.
 * @param init Optional fetch options (only `signal` and `headers` are commonly
 *   needed; `method` and `body` are set automatically).
 * @param codec Optional custom encode / decode turning values into
 *   JSON-compatible objects (see {@link TWebCodec}).
 * @returns The returned value of the endpoint.
 */
export function execMutation<T>(
  query: TQuery<MutationResult<T>>,
  baseUrl: string,
  init?: RequestInit,
  codec?: TWebCodec,
): Promise<T> {
  const { args, path } = queryToObject(query);
  const url = buildUrl(baseUrl, path);
  return execPost<T>(url, args, init, codec ?? defaultCodec);
}

/**
 * Execute a streaming endpoint over Server-Sent Events and return an async
 * iterable of the values the server streams back.
 *
 * Unlike `execQuery` / `execMutation`, the response is a `text/event-stream`
 * the server writes to incrementally (`StreamResult` endpoints). The request is
 * always a POST whose body is the raw `args` array (the path travels in the
 * URL), with an `Accept: text/event-stream` header so `handleWeb` knows to
 * stream. Each `message` event is decoded and yielded; a server `error` event
 * is thrown as an `Error`.
 *
 * @param query The stream query to execute.
 * @param baseUrl The base URL the endpoint path is appended to.
 * @param init Optional fetch options (only `signal` and `headers` are commonly
 *   needed; `method` and `body` are set automatically).
 * @param codec Optional custom encode / decode turning values into
 *   JSON-compatible objects (see {@link TWebCodec}).
 * @returns An async iterable of the streamed values.
 */
export async function* execStream<T>(
  query: TQuery<StreamResult<T>>,
  baseUrl: string,
  init?: RequestInit,
  codec?: TWebCodec,
): AsyncIterable<T> {
  const { args, path } = queryToObject(query);
  const resolvedCodec = codec ?? defaultCodec;
  const url = buildUrl(baseUrl, path);
  const response = await fetch(url, {
    ...init,
    method: "POST",
    body: JSON.stringify(resolvedCodec.encode(args)),
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  yield* readSSE<T>(response, resolvedCodec.decode);
}

async function handleResponse<T>(
  response: Response,
  decode: (value: unknown) => unknown,
): Promise<T> {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const text = await response.text();
  return decode(JSON.parse(text)) as T;
}

async function execPost<T>(
  url: URL,
  jsonBody: unknown,
  init?: RequestInit,
  codec: TWebCodec = defaultCodec,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    method: "POST",
    body: JSON.stringify(codec.encode(jsonBody)),
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  return handleResponse<T>(response, codec.decode);
}

function buildUrl(baseUrl: string, path: string[]): URL {
  const url = new URL(baseUrl);
  const encodedPath = encodePath(path);
  url.pathname = url.pathname.replace(/\/$/, "") + "/" + encodedPath;
  return url;
}
