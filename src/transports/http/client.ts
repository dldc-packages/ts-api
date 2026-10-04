import { queryToObject } from "../../client/query.ts";
import type { TQuery } from "../../client/query.types.ts";

export async function execQuery<T>(
  query: TQuery<T>,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<T> {
  const { args, path } = queryToObject(query);
  const response = await fetch(input, {
    signal: init?.signal,
    method: "POST",
    body: JSON.stringify({ path, args }),
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}
