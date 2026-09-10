import * as v from "@valibot/valibot";
import { GET, REF, ROOT, STRUCTURE } from "./constants.ts";
import { ApiContext } from "./context.ts";
import { compose } from "./compose.ts";
import {
  createArgsValidationFailed,
  createInvalidEntry,
  createInvalidResolvedValue,
} from "./erreur.ts";
import type { TGraphBaseAny } from "./graph.ts";
import type { TResolver } from "./resolver.ts";
import { createSchemaContext, getStructureSchema } from "./schema.ts";
import type { TMiddleware } from "./types.ts";
import type { TQueryRequest } from "../client/query.types.ts";

export type TExtendsContext = (
  ctx: ApiContext,
) => ApiContext | Promise<ApiContext>;

/**
 * An engine used to run queries against a parsed graph.
 *
 * Created by {@link createEngine}. Calling `run` validates the query's entry
 * point, arguments and return value, and dispatches to the attached resolvers.
 */
export interface TEngine {
  /** The graph the engine was created from. */
  graph: TGraphBaseAny;
  /**
   * Executes a query against the engine.
   *
   * @param query A `{ path, args }` object (as produced by the client's
   *   `queryToObject`).
   * @param extendsCtx An optional function that can extend the context before
   *   resolvers run (e.g. to inject request-scoped data).
   * @returns The validated return value of the targeted endpoint.
   */
  run: (query: TQueryRequest, extendsCtx?: TExtendsContext) => Promise<unknown>;
}

/** Options for {@link createEngine}. */
export interface TEngineOptions {
  /** The graph returned by `parse`. */
  graph: TGraphBaseAny;
  /** The resolvers to attach to graph nodes. */
  resolvers: TResolver[];
  /** The name of the root interface in the graph (e.g. `"Graph"`). */
  entry: string;
  /**
   * Whether to validate the returned value of endpoints against their schema.
   *
   * Defaults to `true`. Set to `false` to skip the schema validation of
   * resolver return values (the value is returned as-is). This can improve
   * performance when the return type is already trusted.
   */
  validateOutput?: boolean;
}

/**
 * Create an engine used to run queries against a parsed graph.
 *
 * @param options See {@link TEngineOptions}.
 * @returns A {@link TEngine} exposing `run` (to execute queries) and the
 *   `graph` it was created from.
 */
export function createEngine(
  { graph, resolvers, entry, validateOutput = true }: TEngineOptions,
): TEngine {
  const rootStructure = graph[ROOT];
  const schemaContext = createSchemaContext(rootStructure);
  const resolverMap = buildResolverMap(resolvers);

  return {
    graph,
    run,
  };

  async function run(
    query: TQueryRequest,
    extendsCtx?: TExtendsContext,
  ): Promise<unknown> {
    if (typeof query !== "object" || query === null) {
      throw new Error("Query must be an object with path and args");
    }
    const { path, args } = query;

    if (!Array.isArray(path) || path.length === 0) {
      throw new Error("Query path must be a non-empty array");
    }
    if (typeof path[0] !== "string") {
      throw new Error("Query path must start with a string");
    }
    if (path[0] !== entry) {
      throw createInvalidEntry(graph, [entry], path[0]);
    }
    if (!Array.isArray(args)) {
      throw new Error("Query args must be an array");
    }

    const collected: TMiddleware[] = [];
    let current = graph[GET](entry);
    {
      const resolvers = resolverMap.get(current[STRUCTURE].key);
      if (resolvers) {
        collected.push(...resolvers);
      }
    }

    for (let i = 1; i < path.length; i++) {
      const struct = current[STRUCTURE];
      if (struct.kind === "ref" || struct.kind === "alias") {
        const resolved = current[GET](REF);
        const resolvedStruct = resolved[STRUCTURE];
        const resolvers = resolverMap.get(resolvedStruct.key);
        if (resolvers) {
          collected.push(...resolvers);
        }
        current = resolved;
      }

      const prop = path[i];
      if (typeof prop !== "string") {
        throw new Error(`Query path element at index ${i} must be a string`);
      }
      current = current[GET](prop);
      const resolvers = resolverMap.get(current[STRUCTURE].key);
      if (resolvers) {
        collected.push(...resolvers);
      }
    }

    const fnStructure = current[STRUCTURE];
    if (fnStructure.kind !== "function") {
      throw new Error(
        `Query must target a function, got: ${fnStructure.kind} at ${fnStructure.key}`,
      );
    }

    const argsGraph = current[GET]("arguments");
    const argsSchema = getStructureSchema(schemaContext, argsGraph);
    const argsParse = v.safeParse(argsSchema, args);
    if (argsParse.success === false) {
      throw createArgsValidationFailed(current, argsParse.issues);
    }
    const validatedArgs = argsParse.output;

    const mid = compose(...collected);
    const ctx = ApiContext.create(graph, validatedArgs);
    const extendedCtx = extendsCtx ? await extendsCtx(ctx) : ctx;
    const result = await mid(extendedCtx, () => Promise.resolve(undefined));

    if (validateOutput === false) {
      return result;
    }

    const returnGraph = current[GET]("return");
    const returnSchema = getStructureSchema(schemaContext, returnGraph);
    const returnParse = v.safeParse(returnSchema, result);
    if (returnParse.success === false) {
      throw createInvalidResolvedValue(current, result, "valid value");
    }

    return returnParse.output;
  }
}

function buildResolverMap(
  resolvers: TResolver[],
): Map<string, TMiddleware[]> {
  const map = new Map<string, TMiddleware[]>();
  for (const { path: graph, middlewares } of resolvers) {
    const key = graph[STRUCTURE].key;
    const existing = map.get(key);
    if (existing) {
      existing.push(...middlewares);
    } else {
      map.set(key, [...middlewares]);
    }
  }
  return map;
}
