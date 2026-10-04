import { queryToObject } from "../../client/query.ts";
import type { TQuery } from "../../client/query.types.ts";

/** A single Server-Sent Events block as parsed by {@link parseSSEBlock}. */
interface TSseEvent {
  /** The `event` field; defaults to `"message"`. */
  event: string;
  /** The `data` field(s), joined back with `\n`. */
  data: string;
  /** The `id` field, when present. */
  id?: string;
}

const EVENT_NAME = "message";
const ERROR_EVENT_NAME = "error";

/**
 * Execute a query over Server-Sent Events (SSE) and return an async iterable of
 * the values the server streams back.
 *
 * Like the http transport's `execQuery`, it sends a POST request whose body is
 * the `{ path, args }` JSON produced by `queryToObject`. Unlike it, the
 * response is a `text/event-stream` that the server writes to incrementally:
 *
 * - Every `message` event is JSON-decoded and yielded.
 * - If the server sends an `error` event (e.g. invalid arguments, a failing
 *   resolver), the error's message is thrown. The underlying HTTP connection is
 *   released in both the success and the error cases.
 *
 * @param query The query to execute.
 * @param input The URL (or `Request`) to send the query to.
 * @param init Optional fetch options (only `signal` and `headers` are commonly
 *   needed; `method` and `body` are set automatically).
 * @returns An async iterable of the streamed return values.
 */
export async function* execQuery<T>(
  query: TQuery<T>,
  input: string | URL | Request,
  init?: RequestInit,
): AsyncIterable<T> {
  const { args, path } = queryToObject(query);
  const response = await fetch(input, {
    signal: init?.signal,
    method: "POST",
    body: JSON.stringify({ path, args }),
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  yield* readSSE<T>(response);
}

/**
 * Consume the body of an SSE response as an async iterable of decoded values.
 *
 * Shared by the sse (and web) client transports: the caller is responsible for
 * the request itself and for checking `response.ok`.
 *
 * - Every `message` event is JSON-parsed and decoded (via the identity, or
 *   `decode` when given) and yielded.
 * - If the server sends an `error` event (e.g. invalid arguments, a failing
 *   resolver), the error's message is thrown. The underlying HTTP connection is
 *   released in both the success and the error cases.
 *
 * @param response A `text/event-stream` response.
 * @param decode Optional decoder applied to JSON-parsed event data (e.g. the
 *   web transport's custom codec), defaulting to the identity.
 * @returns An async iterable of the streamed values.
 */
export async function* readSSE<T>(
  response: Response,
  decode: (value: unknown) => unknown = (value) => value,
): AsyncIterable<T> {
  if (!response.body) {
    throw new Error("SSE response has no body");
  }

  const reader = response.body.getReader();
  try {
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const split = splitSSEBuffer(buffer);
      buffer = split.rest;
      for (const event of split.events) {
        yield* applySSEEvent<T>(event, decode);
      }
    }
    // Flush what the decoder may still be holding (e.g. a multi-byte UTF-8
    // sequence split across chunks) plus any trailing, unterminated block.
    buffer += decoder.decode();
    const split = splitSSEBuffer(buffer);
    for (const event of split.events) {
      yield* applySSEEvent<T>(event, decode);
    }
  } catch (error) {
    // Make sure the underlying HTTP connection is closed when the consumer
    // stops early or an `error` event was received.
    reader.cancel().catch(() => {});
    throw error;
  }
}

/**
 * Turn a single SSE event into the client-side outcome: yield the decoded value
 * of a `message` event, throw on an `error` event, and leave any other event
 * (unknown type, keep-alive, empty data) unanswered.
 */
function* applySSEEvent<T>(
  event: TSseEvent,
  decode: (value: unknown) => unknown,
): Generator<T> {
  const type = event.event || EVENT_NAME;
  if (type === ERROR_EVENT_NAME) {
    throw new Error(readSSEError(event.data, decode));
  }
  if (event.data !== "") {
    yield decode(JSON.parse(event.data)) as T;
  }
}

/**
 * Split a raw SSE text buffer into complete event blocks and the remainder.
 *
 * Does not treat the buffer as a whole document: a block that is not yet
 * terminated by a blank line is returned in `rest` and re-processed once more
 * data arrives. CRLF line endings are normalized so both `\n\n` and `\r\n\r\n`
 * terminate a block.
 */
function splitSSEBuffer(buffer: string): {
  events: TSseEvent[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const events: TSseEvent[] = [];
  let rest = normalized;
  for (;;) {
    const separator = rest.indexOf("\n\n");
    if (separator === -1) {
      break;
    }
    const block = rest.slice(0, separator);
    rest = rest.slice(separator + 2);
    const event = parseSSEBlock(block);
    if (event) {
      events.push(event);
    }
  }
  return { events, rest };
}

/**
 * Parse a single SSE block (already trimmed of its terminating blank line) into
 * an event. Returns `null` for blocks that only carry keep-alive comments or
 * unknown fields, which produce no event.
 */
function parseSSEBlock(block: string): TSseEvent | null {
  if (block.trim() === "") {
    return null;
  }
  let event = EVENT_NAME;
  let id: string | undefined;
  const dataParts: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      // Empty line separator or a comment (keep-alive) — skip.
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      // The SSE spec strips exactly one leading space from the field value.
      value = value.slice(1);
    }
    switch (field) {
      case "event":
        event = value;
        break;
      case "data":
        dataParts.push(value);
        break;
      case "id":
        id = value;
        break;
      case "retry":
        break;
      default:
        // Unknown fields are ignored, per the SSE spec.
        break;
    }
  }
  return { event, data: dataParts.join("\n"), id };
}

/**
 * Extract the error message carried by an `error` event. The server sends the
 * message as JSON (`{ "message": ... }`); fall back to the raw data if it is
 * not decodable.
 */
function readSSEError(
  data: string,
  decode: (value: unknown) => unknown = (value) => value,
): string {
  if (data === "") {
    return "Stream error";
  }
  try {
    const parsed = decode(JSON.parse(data)) as { message?: unknown } | null;
    return typeof parsed?.message === "string"
      ? parsed.message
      : String(parsed);
  } catch {
    return data;
  }
}
