import type { ARGS, PATH, RESULT } from "./constants.ts";

export type TQueryDef = string[];

export type TVariables = unknown[];

export interface TQuery<Result> {
  [PATH]: TQueryDef;
  [ARGS]: TVariables;
  [RESULT]: Result;
}

export interface TQueryRequest {
  path: TQueryDef;
  args: TVariables;
}

export type TQueryOf<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => TQuery<R>
  : T extends Record<string, any> ? { [K in keyof T]: TQueryOf<T[K]> }
  : never;
