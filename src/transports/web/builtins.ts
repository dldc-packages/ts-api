import { builtin, type TBuiltinConfig } from "../../server/builtins.ts";
import type { MutationResult, QueryResult, StreamResult } from "./types.ts";

export type TWebBuiltins = {
  QueryResult: TBuiltinConfig<QueryResult<any>>;
  MutationResult: TBuiltinConfig<MutationResult<any>>;
  StreamResult: TBuiltinConfig<StreamResult<any>>;
};

export const webBuiltins: TWebBuiltins = {
  QueryResult: builtin<QueryResult<any>>({
    parameters: ["T"],
    getSchema: (params) => params[0],
  }),
  MutationResult: builtin<MutationResult<any>>({
    parameters: ["T"],
    getSchema: (params) => params[0],
  }),
  StreamResult: builtin<StreamResult<any>>({
    parameters: ["T"],
    getSchema: (params) => params[0],
  }),
};
