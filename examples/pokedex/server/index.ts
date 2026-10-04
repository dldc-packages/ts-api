/**
 * The pokedex server.
 *
 * It builds the engine (see `graph.ts`, `resolvers.ts`, `database.ts`) and
 * serves the web transport over HTTP: a single `handleWeb` route for `/api/*`
 * handles GET queries, POST mutations and SSE streams. Every value is
 * encoded/decoded with the superjson `codec` (see `../codec.ts`).
 */
import { createEngine } from "../../../src/server/mod.ts";
import { handleWeb } from "../../../src/transports/web/server.ts";
import { codec } from "../codec.ts";
import { graph } from "./graph.ts";
import { resolvers } from "./resolvers.ts";

const engine = createEngine({
  graph,
  entry: "Graph",
  resolvers,
});

/**
 * Handle any request targeting `/api/*`. `handleWeb` picks the right behaviour
 * from the request: the endpoint path travels in the URL, the args come from
 * the JsonURL query string (GET) or the JSON body (POST), and streams are
 * selected by `Accept: text/event-stream` — all `codec.decode`'d first.
 */
export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }
  return await handleWeb(engine, request, {
    basePath: "/api",
    codec,
  });
}

export function startServer(port = 8000): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve(
    {
      port,
      onListen: ({ hostname, port }) => {
        console.log(`Pokedex API ready at http://${hostname}:${port}/api`);
      },
    },
    handler,
  );
}

// Run the server on its own: `deno task example:pokedex:server`
if (import.meta.main) {
  startServer();
}
