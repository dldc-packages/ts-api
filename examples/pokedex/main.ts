/**
 * Run the whole pokedex example end-to-end: boot the server on port 8000,
 * run the web-transport + superjson client against it over HTTP, then stop.
 *
 *   deno task example:pokedex
 */
import { main } from "./client/index.ts";
import { startServer } from "./server/index.ts";

const PORT = 8000;

const server = startServer(PORT);
try {
  await main(`http://127.0.0.1:${PORT}/api`);
} finally {
  await server.shutdown();
}

console.log("Server closed.");
