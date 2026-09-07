import type { TTypesBase } from "../utils/types.ts";
import { ARGS, PATH } from "./constants.ts";
import type {
  TQuery,
  TQueryOf,
  TQueryRequest,
  TVariables,
} from "./query.types.ts";

export function query<Types extends TTypesBase>(): TQueryOf<Types> {
  return proxy([], []) as any;
}

function proxy(path: string[], args: TVariables): any {
  return new Proxy(
    () => {},
    {
      get(_, prop) {
        if (typeof prop !== "string") {
          throw new Error(`Invalid property access: ${String(prop)}`);
        }
        return proxy([...path, prop], args);
      },
      apply(_target, _thisArg, parameters) {
        return { [PATH]: path, [ARGS]: parameters };
      },
    },
  );
}

export function queryToObject<R>(q: TQuery<R>): TQueryRequest {
  return { path: q[PATH], args: q[ARGS] };
}
