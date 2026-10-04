import type { TYPES } from "../../server/constants.ts";
import type { ApiContext } from "../../server/context.ts";
import type { TGraphBaseAny, TGraphBaseOutput } from "../../server/graph.ts";
import { fn, type TResolver } from "../../server/resolver.ts";
import type { MutationResult, QueryResult, StreamResult } from "./types.ts";

/**
 * Unwrap the value hidden behind a web transport wrapper (phantom) type.
 *
 * `QueryResult<T>` / `MutationResult<T>` / `StreamResult<T>` only exist at the
 * type level — the runtime value (and what resolvers return) is `T`.
 */
type TWebUnwrap<T> = T extends QueryResult<infer U> ? U
  : T extends MutationResult<infer U> ? U
  : T extends StreamResult<infer U> ? U
  : never;

/** The args tuple of a graph node (the shape `fn` already passes). */
type TWebArgs<G extends TGraphBaseAny> = G[typeof TYPES]["input"];

/**
 * A graph node whose response is wrapped in `QueryResult`.
 *
 * Each resolver helper constrains `path` to one of these at the type level, so
 * pointing the wrong helper at an endpoint (or at a namespace) is a compile
 * error — the check costs nothing at runtime.
 */
type TWebQueryEndpoint = TGraphBaseOutput<QueryResult<any>>;

/** A graph node whose response is wrapped in `MutationResult`. */
type TWebMutationEndpoint = TGraphBaseOutput<MutationResult<any>>;

/** A graph node whose response is wrapped in `StreamResult`. */
type TWebStreamEndpoint = TGraphBaseOutput<StreamResult<any>>;

/** The resolver type plain `fn` expects (the phantom wrapped return type). */
type TFnResolver<G extends TGraphBaseAny> = (
  ctx: ApiContext,
  args: TWebArgs<G>,
) => G[typeof TYPES]["output"] | Promise<G[typeof TYPES]["output"]>;

/**
 * Like `fn`, but for `QueryResult<T>` endpoints: the resolver receives the
 * typed `args` and returns the unwrapped `T` value — no phantom marker to
 * write or cast away.
 *
 * `path` is checked at the type level: it must be a `QueryResult` endpoint, so
 * passing a `MutationResult` / `StreamResult` endpoint (or a namespace) is a
 * compile error.
 */
export function queryResolver<G extends TWebQueryEndpoint>(
  path: G,
  resolver: (
    ctx: ApiContext,
    args: TWebArgs<G>,
  ) =>
    | TWebUnwrap<G[typeof TYPES]["output"]>
    | Promise<TWebUnwrap<G[typeof TYPES]["output"]>>,
): TResolver {
  return fn(path, resolver as unknown as TFnResolver<G>);
}

/**
 * Like `fn`, but for `MutationResult<T>` endpoints: same as
 * {@link queryResolver}, for mutations.
 *
 * `path` must be a `MutationResult` endpoint (checked at the type level).
 */
export function mutationResolver<G extends TWebMutationEndpoint>(
  path: G,
  resolver: (
    ctx: ApiContext,
    args: TWebArgs<G>,
  ) =>
    | TWebUnwrap<G[typeof TYPES]["output"]>
    | Promise<TWebUnwrap<G[typeof TYPES]["output"]>>,
): TResolver {
  return fn(path, resolver as unknown as TFnResolver<G>);
}

/**
 * Like `fn`, but for `StreamResult<T>` endpoints: the resolver returns an
 * async iterable of `T` (e.g. an async generator), which `engine.runIterable`
 * streams to the client one yielded value at a time.
 *
 * `path` must be a `StreamResult` endpoint (checked at the type level).
 */
export function streamResolver<G extends TWebStreamEndpoint>(
  path: G,
  resolver: (
    ctx: ApiContext,
    args: TWebArgs<G>,
  ) => AsyncIterable<TWebUnwrap<G[typeof TYPES]["output"]>>,
): TResolver {
  return fn(path, resolver as unknown as TFnResolver<G>);
}
