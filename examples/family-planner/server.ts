import type { TQueryRequest } from "../../client.ts";
import { createEngine } from "../../server.ts";
import { graph } from "./graph.ts";
import { resolvers } from "./resolvers.ts";

export const graphEngine = createEngine({
  graph,
  entry: "Graph",
  resolvers,
});

export async function server(req: TQueryRequest): Promise<any> {
  return await graphEngine.run(req);
}
