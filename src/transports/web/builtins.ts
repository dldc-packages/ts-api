import type * as v from "@valibot/valibot";
import { builtin, type TBuiltinConfig } from "../../server/builtins.ts";
import type { MutationResult, QueryResult, StreamResult } from "./types.ts";

/**
 * A phantom-marker builtin's `getSchema` simply forwards the schema of its
 * single type argument (`QueryResult<T>` validates `T`). The marker types must
 * be used with exactly one type argument, so getSchema enforces it here — arity
 * validation is the builtin's own responsibility.
 */
function phantom(name: string): (
  params: v.BaseSchema<any, any, any>[],
) => v.BaseSchema<any, any, any> {
  return (params) => {
    if (params.length !== 1) {
      throw new Error(
        `Web builtin ${name} requires exactly one type argument, got ${params.length}`,
      );
    }
    return params[0];
  };
}

export type TWebBuiltins = {
  QueryResult: TBuiltinConfig<QueryResult<any>>;
  MutationResult: TBuiltinConfig<MutationResult<any>>;
  StreamResult: TBuiltinConfig<StreamResult<any>>;
};

export const webBuiltins: TWebBuiltins = {
  QueryResult: builtin<QueryResult<any>>({
    getSchema: phantom("QueryResult"),
  }),
  MutationResult: builtin<MutationResult<any>>({
    getSchema: phantom("MutationResult"),
  }),
  StreamResult: builtin<StreamResult<any>>({
    getSchema: phantom("StreamResult"),
  }),
};
