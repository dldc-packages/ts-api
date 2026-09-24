import type { TQueryRequest } from "../../src/client/mod.ts";
import { createEngine } from "../../src/server/mod.ts";
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
