import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo } from "node:net";

/**
 * A minimal Node.js stand-in for `Deno.serve({ port: 0 }, handler)`.
 *
 * The transport tests used the Web-standard `Deno.serve` API (a
 * `(Request) => Response` handler bound to an ephemeral port). This helper
 * adapts the Node `http` server to the same Web-standard handler shape so the
 * tests keep exercising the transports over a real socket, with the same
 * `{ port, shutdown }` surface.
 */
export interface TTestServer {
  port: number;
  baseUrl: string;
  shutdown: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function serve(
  handler: (request: Request) => Promise<Response> | Response,
): Promise<TTestServer> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readBody(req);
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

  return await new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolveServer({
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        shutdown: () =>
          new Promise<void>((resolveShutdown) => {
            server.closeAllConnections();
            server.close(() => resolveShutdown());
          }),
      });
    });
  });
}
