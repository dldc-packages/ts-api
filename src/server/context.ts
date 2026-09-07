import type { TKey, TStackCoreValue } from "@dldc/stack";
import { createKey, Stack } from "@dldc/stack";
import type { TYPES } from "./constants.ts";
import type { TGraphBaseAny } from "./graph.ts";

const GraphKey: TKey<TGraphBaseAny, false> = createKey("graph");
const ArgsKey: TKey<unknown[], false> = createKey("args");

export class ApiContext extends Stack {
  static readonly GraphKey = GraphKey;
  static readonly ArgsKey = ArgsKey;

  static create(graph: TGraphBaseAny, args: unknown[]): ApiContext {
    return new ApiContext().with(
      GraphKey.Provider(graph),
      ArgsKey.Provider(args),
    );
  }

  static empty(): ApiContext {
    return new ApiContext();
  }

  protected override instantiate(stackCore: TStackCoreValue): this {
    return new ApiContext(stackCore) as any;
  }

  get graph(): TGraphBaseAny {
    return this.getOrFail(GraphKey.Consumer);
  }

  getInputOrFail<G extends TGraphBaseAny>(
    _graph: G,
  ): G[typeof TYPES]["input"] {
    return this.getOrFail(ArgsKey.Consumer) as any;
  }

  withGraph(graph: TGraphBaseAny): this {
    return this.with(GraphKey.Provider(graph));
  }
}
