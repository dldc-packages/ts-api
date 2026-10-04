import type { ListPokemonParams, PokemonType } from "../schema.ts";

export interface DbPokemon {
  id: string;
  name: string;
  types: PokemonType[];
  caughtAt: Date;
  shiny: boolean;
}

/**
 * A handful of species that can be caught.
 */
const SPECIES: Record<string, PokemonType[]> = {
  Pikachu: ["electric"],
  Charmander: ["fire"],
  Bulbasaur: ["grass"],
  Squirtle: ["water"],
  Eevee: ["normal"],
};

const dex = new Map<string, DbPokemon>();

export function catchPokemon(name: string, shiny: boolean): DbPokemon {
  const pokemon: DbPokemon = {
    id: crypto.randomUUID(),
    name,
    types: SPECIES[name] ?? ["normal"],
    caughtAt: new Date(),
    shiny,
  };
  dex.set(pokemon.id, pokemon);
  return pokemon;
}

export function getPokemon(id: string): DbPokemon | undefined {
  return dex.get(id);
}

export function listPokemon(params: ListPokemonParams = {}): DbPokemon[] {
  const { search, types, since } = params;
  return Array.from(dex.values())
    .filter((pokemon) => {
      if (search !== undefined) {
        if (!pokemon.name.toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
      }
      if (types && !types.some((type) => pokemon.types.includes(type))) {
        return false;
      }
      if (since !== undefined && pokemon.caughtAt < since) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function releasePokemon(id: string): DbPokemon | undefined {
  const pokemon = dex.get(id);
  if (pokemon) {
    dex.delete(id);
  }
  return pokemon;
}
