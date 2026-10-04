import type { TStructure } from "../../server/structure.types.ts";

const KIND = Symbol("kind");

/**
 * Optional custom encode / decode hooks.
 *
 * The transport always sends JSON over the wire; the codec transforms between
 * a value and a JSON-compatible object in between:
 *
 * - `encode(value)` is applied to a value (an args array, a result, a single
 *   streamed value) before it is JSON-serialized.
 * - `decode(parsedJson)` is applied to a JSON-parsed value to recover the real
 *   value.
 *
 * Each defaults to the identity (plain JSON). Pass the same codec to both the
 * web client functions and {@link handleWeb} to support non-JSON values — for
 * example superjson, whose `serialize` / `deserialize` deliberately return / go
 * back from a `{ json, meta }` object that is then JSON-serialized onto the
 * wire:
 *
 * ```ts
 * const codec = {
 *   encode: (value) => SuperJSON.serialize(value),
 *   decode: (value) => SuperJSON.deserialize(value),
 * };
 * ```
 *
 * Note: the codec does not change the transport. `execQuery` still sends a
 * GET with the JsonURL-encoded encoded args when the URL stays short (it
 * falls back to POST only when the URL would be too long).
 */
export interface TWebCodec {
  encode(value: unknown): unknown;
  decode(value: unknown): unknown;
}

export interface QueryResult<T> {
  [KIND]: "query";
  data: T;
}

export interface MutationResult<T> {
  [KIND]: "mutation";
  data: T;
}

export interface StreamResult<T> {
  [KIND]: "stream";
  data: T;
}

/**
 * The three transport kinds the web transport enforces on the wire. An
 * endpoint maps to one of these through the `ref` that wraps its response
 * structure: `QueryResult` → `"query"`, `MutationResult` → `"mutation"`,
 * `StreamResult` → `"stream"`.
 */
export type TWebEndpointKind = "query" | "mutation" | "stream";

/**
 * Map an endpoint's response structure to its web transport kind, or
 * `undefined` when it is not wrapped in one of the three web marker types
 * (`QueryResult` / `MutationResult` / `StreamResult`) — whether that is a
 * non-function node or a plain endpoint that is not governed by the transport
 * contract.
 */
export function webKindFromStructure(
  structure: TStructure | undefined,
): TWebEndpointKind | undefined {
  if (structure?.kind !== "ref") {
    return undefined;
  }
  switch (structure.ref) {
    case "QueryResult":
      return "query";
    case "MutationResult":
      return "mutation";
    case "StreamResult":
      return "stream";
    default:
      return undefined;
  }
}
