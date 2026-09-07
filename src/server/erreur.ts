import { createErreurStore, type TReadonlyErreurStore } from "@dldc/erreur";
import type * as v from "@valibot/valibot";
import { STRUCTURE } from "./constants.ts";
import type { TGraphBaseAny } from "./graph.ts";

/**
 * Those error are likely caused by the query and can be send back to the client.
 */
export type TGraphClientErreurData = {
  kind: "ArgsValidationFailed";
  graph: TGraphBaseAny;
  issues: v.BaseIssue<any>[];
} | {
  kind: "InvalidEntry";
  graph: TGraphBaseAny;
  entries: string[];
  requested: string;
};

const GraphClientErreurPrivate = createErreurStore<TGraphClientErreurData>();
export const GraphClientErreur: TReadonlyErreurStore<TGraphClientErreurData> =
  GraphClientErreurPrivate.asReadonly;

export function createArgsValidationFailed(
  graph: TGraphBaseAny,
  issues: v.BaseIssue<any>[],
): Error {
  return GraphClientErreurPrivate.setAndReturn(
    new Error(`Invalid arguments passed to ${graph[STRUCTURE].key}`),
    { graph, kind: "ArgsValidationFailed", issues },
  );
}

export function createInvalidEntry(
  graph: TGraphBaseAny,
  entries: string[],
  requested: string,
): Error {
  const entryMessage = entries.length === 1
    ? printValue(entries[0])
    : `one of ${printValue(entries)}`;

  return GraphClientErreurPrivate.setAndReturn(
    new Error(
      `Invalid entry, all queries should start from ${entryMessage} (requested: ${
        printValue(requested)
      })`,
    ),
    { graph, kind: "InvalidEntry", entries, requested },
  );
}

/**
 * Those error are likely caused by the server implementation.
 * The should not be send back to the client but should be logged.
 */
export type TGraphServerErreurData = {
  kind: "InvalidResolvedValue";
  graph: TGraphBaseAny;
  resolved: any;
  expected: string;
};

const GraphServerErreurPrivate = createErreurStore<TGraphServerErreurData>();
export const GraphServerErreur: TReadonlyErreurStore<TGraphServerErreurData> =
  GraphServerErreurPrivate.asReadonly;

export function createInvalidResolvedValue(
  graph: TGraphBaseAny,
  resolved: any,
  expected: string,
): Error {
  return GraphServerErreurPrivate.setAndReturn(
    new Error(
      `Invalid resolved value for ${
        graph[STRUCTURE].key
      } (expected: ${expected}, received: ${printValue(resolved)})`,
    ),
    { graph, kind: "InvalidResolvedValue", resolved, expected },
  );
}

function printValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable object]";
    }
  }
  return String(value);
}
