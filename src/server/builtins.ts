import * as v from "@valibot/valibot";
import { TYPES } from "./constants.ts";
import { graphInternal } from "./graph.ts";
import type { TBuiltinStructure, TRootStructure } from "./structure.types.ts";
import type { TBuiltinsFromConfig, TGraphBuiltins } from "./types.ts";

/**
 * Builds the valibot schema validating a builtin's values.
 *
 * `params` holds the valibot schemas of the builtin's type arguments, in the
 * order they appear in the schema (e.g. for `Page<string>` the schema of
 * `string`). A builtin used with no type arguments receives an empty array.
 * Whether an exact arity is required — and whether type parameters may be
 * omitted (e.g. defaults) — is the builtin's own responsibility: `getSchema`
 * should validate `params.length` when it cares.
 */
export type TBuiltinGetSchema = (
  params: v.BaseSchema<any, any, any>[],
) => v.BaseSchema<any, any, any>;

export interface TBuiltinConfig<T> {
  [TYPES]: T;
  getSchema: TBuiltinGetSchema;
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
      const { getSchema } = config;
      builtins.push({
        kind: "builtin",
        key: `builtin.${name}`,
        name,
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
