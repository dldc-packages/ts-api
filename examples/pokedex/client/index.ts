/**
 * The pokedex client.
 *
 * It uses {@link createClient} (`api.ts`) to build the three `exec` functions
 * bound to a server — the superjson `codec` is injected too, so each call is
 * just `api.execQuery(client.Graph.pokedex...)`. `Date` values survive the
 * wire in both directions thanks to the shared codec.
 */
import { query } from "../../../src/client/mod.ts";
import { createClient } from "./api.ts";
import type { Graph, Pokemon } from "../schema.ts";

const client = query<{ Graph: Graph }>();

export async function main(baseUrl: string): Promise<void> {
  // Bind execQuery / execMutation / execStream to this server (and the codec).
  const api = createClient(baseUrl);

  console.log("Pokedex — web transport + superjson\n");

  console.log("0. The dex starts empty");
  let dex = await api.execQuery(client.Graph.pokedex.list());
  console.log(`   list() -> ${dex.length} pokemon`);

  console.log("\n1. Catching a few pokemon (mutations)");
  const pikachu = await api.execMutation(client.Graph.pokedex.catch("Pikachu"));
  const shiny = await api.execMutation(
    client.Graph.pokedex.catch("Bulbasaur", true),
  );
  await api.execMutation(client.Graph.pokedex.catch("Squirtle"));
  const charmander = await api.execMutation(
    client.Graph.pokedex.catch("Charmander"),
  );
  for (const p of [pikachu, shiny, charmander]) {
    console.log(
      `   ${p.name} (${
        p.types.join(", ")
      }) caught at ${p.caughtAt.toISOString()}`,
    );
  }
  console.log(
    "   caughtAt is a real Date on the client:",
    pikachu.caughtAt instanceof Date,
  );

  console.log("\n2. Listing the whole dex");
  dex = await api.execQuery(client.Graph.pokedex.list());
  console.log("  ", dex.map(short).join(", "));

  console.log("\n3. Filtering by type");
  const grass = await api.execQuery(
    client.Graph.pokedex.list({ types: ["grass"] }),
  );
  console.log("   grass:", grass.map(short).join(", ") || "none");

  console.log("\n4. Filtering by a caught-after Date (superjson for args)");
  const since = new Date(Date.now() - 60_000);
  const recent = await api.execQuery(client.Graph.pokedex.list({ since }));
  console.log("   caught in the last minute:", recent.map(short).join(", "));

  console.log("\n5. byId");
  const found = await api.execQuery(client.Graph.pokedex.byId(pikachu.id));
  console.log("   ", found?.name);

  console.log("\n6. Releasing the shiny one");
  const released = await api.execMutation(
    client.Graph.pokedex.release(shiny.id),
  );
  console.log("   released:", released?.name ?? "<already gone>");

  console.log("\n7. Streaming a radar scan (SSE + superjson)");
  for await (const p of api.execStream(client.Graph.pokedex.search(""))) {
    console.log(
      `   * found ${p.name} caught ${p.caughtAt.toISOString()} (Date=${
        p.caughtAt instanceof Date
      })`,
    );
  }

  console.log("\nDone.");
}

function short(pokemon: Pokemon): string {
  return `${pokemon.name}${pokemon.shiny ? " ✨" : ""}`;
}
