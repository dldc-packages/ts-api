import SuperJSON, { type SuperJSONResult } from "superjson";
import type { TWebCodec } from "../../src/transports/web/types.ts";

/**
 * The web transport always sends JSON on the wire; the codec is the bridge
 * between a value and the JSON-compatible object it is serialized as.
 *
 * Superjson turns e.g. a `Date` into a `{ json, meta }` object that survives
 * JSON transport, so `caughtAt: Date` round-trips as a real `Date` on both
 * sides — and it is applied to args, results and streamed values alike.
 *
 * The **same** codec must be passed to `handleWeb` (server) and to
 * `execQuery` / `execMutation` / `execStream` (client).
 */
export const codec: TWebCodec = {
  encode: (value) => SuperJSON.serialize(value),
  decode: (value) => SuperJSON.deserialize(value as SuperJSONResult),
};
