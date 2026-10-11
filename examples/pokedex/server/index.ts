/**
 * The pokedex server.
 *
 * It builds the engine (see `graph.ts`, `resolvers.ts`, `database.ts`) and
 * serves the web transport over HTTP: a single `handleWeb` route for `/api/*`
 * handles GET queries, POST mutations and SSE streams. Every value is
 * encoded/decoded with the superjson `codec` (see `../codec.ts`).
 */
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { createEngine } from "../../../src/server/mod.ts";
import { handleWeb } from "../../../src/transports/web/server.ts";
import { codec } from "../codec.ts";
import { graph } from "./graph.ts";
import { resolvers } from "./resolvers.ts";

const engine = createEngine({
  graph,
  entries: ["Graph"],
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

export interface TPokedexServer {
  server: Server;
  port: number;
  shutdown: () => Promise<void>;
}

/**
 * Serve the pokedex API on a real HTTP server (`node:http`), adapting
 * IncomingMessage/ServerResponse to the Web-standard handler shape.
 */
export function startServer(port = 8000): TPokedexServer {
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const v of value) {
            headers.append(key, v);
          }
        } else {
          headers.set(key, value);
        }
      }
      const request = new Request(url, {
        method: req.method,
        headers,
        body: body.length > 0 ? (body as unknown as BodyInit) : undefined,
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });

  server.listen(port, () => {
    const address = server.address() as AddressInfo | null;
    const hostname = address ? address.address : "localhost";
    console.log(`Pokedex API ready at http://${hostname}:${port}/api`);
  });

  return {
    server,
    port,
    shutdown: () =>
      new Promise<void>((resolveShutdown) => {
        server.closeAllConnections();
        server.close(() => resolveShutdown());
      }),
  };
}

// Run the server on its own: `pnpm example:pokedex:server`
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startServer();
}
