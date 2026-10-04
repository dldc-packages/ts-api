/**
 * The pokedex schema.
 *
 * This example uses the **web transport**, so every endpoint must be wrapped in
 * one of the three marker types it exposes:
 *
 * - `QueryResult<T>` — served as GET (or POST when the URL would be too long).
 * - `MutationResult<T>` — served as POST.
 * - `StreamResult<T>` — served as Server-Sent Events (POST + SSE).
 *
 * It also uses the `Date` builtin; `caughtAt` survives the wire because both
 * the server and the client use the same superjson `codec` (see `codec.ts`).
 */

import type {
  MutationResult,
  QueryResult,
  StreamResult,
} from "../../src/transports/web/types.ts";

export type PokemonType = "electric" | "fire" | "grass" | "water" | "normal";

export interface Pokemon {
  id: string;
  name: string;
  types: PokemonType[];
  /** When the pokemon was caught — a real `Date` on both sides, thanks to superjson. */
  caughtAt: Date;
  shiny: boolean;
}

export interface ListPokemonParams {
  search?: string;
  types?: PokemonType[];
  /** Only pokemon caught after this `Date` (also transported with superjson). */
  since?: Date;
}

export interface PokedexNamespace {
  list: (params?: ListPokemonParams) => QueryResult<Pokemon[]>;
  byId: (id: string) => QueryResult<Pokemon | null>;
  catch: (name: string, shiny?: boolean) => MutationResult<Pokemon>;
  release: (id: string) => MutationResult<Pokemon | null>;
  /** Emits every matching pokemon one by one, as a live stream. */
  search: (name: string) => StreamResult<Pokemon>;
}

export interface Graph {
  pokedex: PokedexNamespace;
}
