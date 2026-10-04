/**
 * Endpoint implementations, using the web transport's typed resolver helpers.
 *
 * `queryResolver` / `mutationResolver` / `streamResolver` are `fn` with the
 * phantom `QueryResult` / `MutationResult` / `StreamResult` wrappers unwrapped:
 * the resolver receives the typed `args` as its second argument and returns
 * the plain value (no `getInputOrFail` dance needed).
 */
import {
  mutationResolver,
  queryResolver,
  streamResolver,
} from "../../../src/transports/web/resolvers.ts";
import type { Pokemon } from "../schema.ts";
import * as db from "./database.ts";
import { graph } from "./graph.ts";

const listResolver = queryResolver(
  graph.Graph.pokedex.list,
  (_ctx, [params]) => {
    return db.listPokemon(params).map(toPokemon);
  },
);

const byIdResolver = queryResolver(graph.Graph.pokedex.byId, (_ctx, [id]) => {
  const pokemon = db.getPokemon(id);
  return pokemon ? toPokemon(pokemon) : null;
});

const catchResolver = mutationResolver(
  graph.Graph.pokedex.catch,
  (_ctx, [name, shiny = false]) => {
    return toPokemon(db.catchPokemon(name, shiny));
  },
);

const releaseResolver = mutationResolver(
  graph.Graph.pokedex.release,
  (_ctx, [id]) => {
    const pokemon = db.releasePokemon(id);
    return pokemon ? toPokemon(pokemon) : null;
  },
);

/**
 * `streamResolver` (for `StreamResult` endpoints) resolves to an async
 * generator: every yielded value is streamed to the client as a Server-Sent
 * Events message.
 */
const searchResolver = streamResolver(
  graph.Graph.pokedex.search,
  (_ctx, [name]) => {
    return (async function* () {
      for (const pokemon of db.listPokemon({ search: name })) {
        // Emulate a slow radar sweep so the client sees several events arrive.
        await new Promise((resolve) => setTimeout(resolve, 200));
        yield toPokemon(pokemon);
      }
    })();
  },
);

function toPokemon(pokemon: db.DbPokemon): Pokemon {
  return {
    id: pokemon.id,
    name: pokemon.name,
    types: pokemon.types,
    caughtAt: pokemon.caughtAt,
    shiny: pokemon.shiny,
  };
}

export const resolvers = [
  listResolver,
  byIdResolver,
  catchResolver,
  releaseResolver,
  searchResolver,
];
