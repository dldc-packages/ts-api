import type { TEngine } from "../../server/engine.ts";
import { parseBody } from "../http/server.ts";

const encoder = new TextEncoder();

/**
 * Build the bytes of a single Server-Sent Events block.
 *
 * A payload containing real newlines (e.g. pretty-printed JSON) is split into
 * several `data:` lines, which the SSE spec joins back with a `\n` on the
 * receiving side — so any JSON payload survives the round-trip unchanged.
 */
export function encodeSSEEvent(event: string, data: string): Uint8Array {
  const dataLines = data.split(/\r?\n/);
  let block = `event: ${event}\n`;
  for (const line of dataLines) {
    block += `data: ${line}\n`;
  }
  block += "\n";
  return encoder.encode(block);
}

function serialized(value: unknown): string {
  // `JSON.stringify(undefined)` returns `undefined`, not a string; fall back to
  // `null` so the SSE encoding always receives something it can split.
  return JSON.stringify(value) ?? "null";
}

/**
 * Run the query carried by an HTTP request against the engine and stream every
 * produced value back as a Server-Sent Events (SSE) response.
 *
 * The request body is expected to be the same `{ path, args }` JSON produced by
 * the client's `queryToObject` (see `parseBody` from the http transport).
 * Each value yielded by `engine.runIterable` is sent as a `message` event whose
 * `data` is the JSON-encoded value. If running the query throws — an invalid
 * payload, invalid arguments, a failing resolver, ... — a single `error` event
 * carrying `{ "message": ... }` is sent before the stream closes, so clients
 * can surface the failure without having to inspect the HTTP status.
 *
 * @param engine The engine instance used to run the query.
 * @param request The HTTP request containing the query.
 * @returns A `text/event-stream` Response.
 */
export async function handleQuery(
  engine: TEngine,
  request: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return sseErrorResponse("Invalid JSON body");
  }

  let parsed;
  try {
    parsed = parseBody(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid body";
    return sseErrorResponse(message);
  }

  const iterable = engine.runIterable(parsed);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const value of iterable) {
          controller.enqueue(encodeSSEEvent("message", serialized(value)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encodeSSEEvent("error", serialized({ message })),
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

function sseErrorResponse(message: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encodeSSEEvent("error", serialized({ message })),
      );
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
