import * as v from "@valibot/valibot";
import { TYPES } from "./constants.ts";
import { graphInternal } from "./graph.ts";
import type { TBuiltinStructure, TRootStructure } from "./structure.types.ts";
import type { TBuiltinsFromConfig, TGraphBuiltins } from "./types.ts";

/**
 * Builds the valibot schema validating a builtin's values.
 *
 * When the builtin declares generic type parameters (e.g. `parameters: ["T"]`
 * for `Page<T>`) and is used with type arguments (e.g. `Page<string>`),
 * `params` holds the valibot schemas of those arguments (here: the schema of
 * `string`), so the returned schema can depend on the generic instantiation. A
 * non-generic builtin (no `parameters`) receives an empty array.
 */
export type TBuiltinGetSchema = (
  params: v.BaseSchema<any, any, any>[],
) => v.BaseSchema<any, any, any>;

export interface TBuiltinConfig<T> {
  [TYPES]: T;
  getSchema: TBuiltinGetSchema;
  /**
   * Names of the generic type parameters this builtin can be used with
   * (e.g. `["T"]` for a `Page<T>` builtin). Omit for a non-generic builtin.
   */
  parameters?: string[];
}

export type TBuiltinTypesConfig = Record<
  string,
  TBuiltinConfig<any> | null
>;

export type TBuiltinTypes = Record<string, TBuiltinStructure>;

export function createBuiltins<Conf extends TBuiltinTypesConfig>(
  config: Conf,
): TGraphBuiltins<TBuiltinsFromConfig<Conf>> {
  const configResolved = {
    ...DEFAULT_BUILTINS,
    ...config,
  };
  const builtins: TBuiltinStructure[] = [];
  for (const [name, config] of Object.entries(configResolved)) {
    if (config) {
      const { getSchema, parameters = [] } = config;
      builtins.push({
        kind: "builtin",
        key: `builtin.${name}`,
        name,
        parameters,
        getSchema,
      });
    }
  }

  const rootStructure: TRootStructure = {
    kind: "root",
    key: "root",
    mode: "builtins",
    builtins,
    types: [],
  };

  return graphInternal({
    rootStructure,
    localTypes: {},
    path: [],
  }) as any;
}

export function builtin<T>(
  config: Omit<TBuiltinConfig<T>, typeof TYPES>,
): TBuiltinConfig<T> {
  return {
    [TYPES]: null as any,
    ...config,
  };
}

export type TDefaultBuiltins = {
  Date: TBuiltinConfig<Date>;
};

export const DEFAULT_BUILTINS: TDefaultBuiltins = {
  Date: builtin<Date>({
    getSchema: () => v.date(),
  }),
};

export const DEFAULT_BUILTINS_GRAPH: TGraphBuiltins<
  TBuiltinsFromConfig<TDefaultBuiltins>
> = createBuiltins<TDefaultBuiltins>(
  DEFAULT_BUILTINS,
);
