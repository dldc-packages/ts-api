import * as v from "@valibot/valibot";
import type { TEngine } from "../../server/engine.ts";

const apiBodySchema = v.object({
  path: v.array(v.string()),
  args: v.array(v.unknown()),
});

export function parseBody(
  body: unknown,
): { path: string[]; args: unknown[] } {
  return v.parse(apiBodySchema, body);
}

/**
 * @param engine The engine instance used to run the query.
 * @param request The HTTP request containing the query.
 * @returns The result of executing the query.
 */
export async function handleQuery(
  engine: TEngine,
  request: Request,
): Promise<unknown> {
  const body = await request.json();
  const parsed = parseBody(body);
  const result = await engine.run(parsed);
  return result;
}
