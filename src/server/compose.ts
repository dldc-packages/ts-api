import type { ApiContext } from "./context.ts";
import type { TMiddleware } from "./types.ts";

export function compose(...middlewares: (TMiddleware | null)[]): TMiddleware {
  const fns = middlewares.filter((m): m is TMiddleware => m !== null);
  return (ctx, next) => {
    let index = -1;
    function dispatch(i: number, ctx: ApiContext): Promise<unknown> {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      if (i >= fns.length) return next(ctx);
      return Promise.resolve(fns[i](ctx, (c) => dispatch(i + 1, c)));
    }
    return dispatch(0, ctx);
  };
}

export function withContext(
  mid: TMiddleware,
  update: (ctx: ApiContext) => ApiContext,
): TMiddleware {
  return (ctx, next) => mid(update(ctx), next);
}
