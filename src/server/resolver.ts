import type { ApiContext } from "./context.ts";
import type { TGraphBaseAny } from "./graph.ts";
import type { TYPES } from "./constants.ts";
import type { TMiddleware } from "./types.ts";

export interface TResolver {
  kind: "resolver";
  path: TGraphBaseAny;
  middlewares: TMiddleware[];
}

export function resolver(
  path: TGraphBaseAny,
  ...middlewares: TMiddleware[]
): TResolver {
  return { kind: "resolver", path, middlewares };
}

export function fn<G extends TGraphBaseAny>(
  path: G,
  resolver: (
    ctx: ApiContext,
    args: G[typeof TYPES]["input"],
  ) => unknown | Promise<unknown>,
): TResolver {
  return {
    kind: "resolver",
    path,
    middlewares: [
      (ctx) => {
        const args = ctx.getInputOrFail(path);
        return resolver(ctx, args);
      },
    ],
  };
}
