/**
 * Thin wrappers around the web transport's `execQuery` / `execMutation` /
 * `execStream`, with the base URL and the superjson `codec` already bound — so
 * callers only pass the query (plus optional fetch options).
 *
 * Use {@link createClient} to bind the three functions to a server. The codec
 * comes from `../codec.ts` and is always the same on both sides.
 */
import type { TQuery } from "../../../src/client/mod.ts";
import {
  execMutation as webExecMutation,
  execQuery as webExecQuery,
  execStream as webExecStream,
} from "../../../src/transports/web/client.ts";
import type {
  MutationResult,
  QueryResult,
  StreamResult,
} from "../../../src/transports/web/types.ts";
import { codec } from "../codec.ts";

/** The three exec functions bound to one server (see {@link createClient}). */
export interface TPokedexClient {
  /** Execute a `QueryResult` endpoint (GET, or POST when the URL is too long). */
  execQuery<T>(query: TQuery<QueryResult<T>>, init?: RequestInit): Promise<T>;
  /** Execute a `MutationResult` endpoint (POST). */
  execMutation<T>(
    query: TQuery<MutationResult<T>>,
    init?: RequestInit,
  ): Promise<T>;
  /** Consume a `StreamResult` endpoint over Server-Sent Events. */
  execStream<T>(
    query: TQuery<StreamResult<T>>,
    init?: RequestInit,
  ): AsyncIterable<T>;
}

/**
 * Build a client for the given `baseUrl`, injecting it (and the shared codec)
 * into the three `exec` functions.
 */
export function createClient(baseUrl: string): TPokedexClient {
  const execQuery = <T>(
    query: TQuery<QueryResult<T>>,
    init?: RequestInit,
  ): Promise<T> => webExecQuery(query, baseUrl, init, codec);

  const execMutation = <T>(
    query: TQuery<MutationResult<T>>,
    init?: RequestInit,
  ): Promise<T> => webExecMutation(query, baseUrl, init, codec);

  const execStream = <T>(
    query: TQuery<StreamResult<T>>,
    init?: RequestInit,
  ): AsyncIterable<T> => webExecStream(query, baseUrl, init, codec);

  return { execQuery, execMutation, execStream };
}
