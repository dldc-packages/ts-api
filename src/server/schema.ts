import * as v from "@valibot/valibot";
import { GET, REF, STRUCTURE } from "./constants.ts";
import type { TGraphBaseAny } from "./graph.ts";
import type { TRootStructure, TStructureKind } from "./structure.types.ts";

export interface TSchemaContext {
  rootStructure: TRootStructure;
  /**
   * Cache of already resolved schemas for each graph node to avoid redundant computations.
   */
  cache: WeakMap<TGraphBaseAny, v.BaseSchema<any, any, any>>;
}

export function createSchemaContext(
  rootStructure: TRootStructure,
): TSchemaContext {
  return {
    rootStructure,
    cache: new WeakMap(),
  };
}

export type TStructureGetSchema = (
  context: TSchemaContext,
  graph: TGraphBaseAny,
) => v.BaseSchema<any, any, any>;

type TByStructureKind = {
  [K in TStructureKind]: TStructureGetSchema;
};

function objectLikeSchema(
  context: TSchemaContext,
  graph: TGraphBaseAny,
) {
  const structure = graph[STRUCTURE];
  if (structure.kind !== "interface" && structure.kind !== "object") {
    throw new Error("Invalid structure kind");
  }
  const properties = structure.properties.map(
    ({ name, optional }) => {
      const subGraph = graph[GET](name);
      const propSchema = getStructureSchema(context, subGraph);
      return [
        name,
        optional ? v.optional(propSchema) : propSchema,
      ] as const;
    },
  );
  return v.strictObject(Object.fromEntries(properties));
}

const SCHEMA_BY_STRUCTURE: TByStructureKind = {
  root: () => {
    throw new Error("Root schema should not be called");
  },
  alias: (context, graph) => {
    return getStructureSchema(context, graph[GET](REF));
  },
  ref: (context, graph) => {
    return getStructureSchema(context, graph[GET](REF));
  },
  interface: objectLikeSchema,
  object: objectLikeSchema,
  array: (context, graph) => {
    const itemSchema = getStructureSchema(context, graph[GET]("items"));
    return v.array(itemSchema);
  },
  primitive: (_context, graph) => {
    const structure = graph[STRUCTURE];
    if (structure.kind !== "primitive") {
      throw new Error("Invalid structure kind");
    }
    switch (structure.type) {
      case "string":
        return v.string();
      case "number":
        return v.number();
      case "boolean":
        return v.boolean();
    }
  },
  literal: (_context, graph) => {
    const structure = graph[STRUCTURE];
    if (structure.kind !== "literal") {
      throw new Error("Invalid structure kind");
    }
    if (structure.type === null) {
      return v.null_();
    }
    return v.literal(structure.type);
  },
  nullable: (context, graph) => {
    const subSchema = getStructureSchema(context, graph[GET](REF));
    return v.nullable(subSchema);
  },
  union: (context, graph) => {
    const structure = graph[STRUCTURE];
    if (structure.kind !== "union") {
      throw new Error("Invalid structure kind");
    }
    const unionSchema = structure.types.map((unionItem) => {
      const unionGraph = graph[GET](unionItem);
      return getStructureSchema(context, unionGraph);
    });
    return v.union(unionSchema);
  },
  function: () => {
    throw new Error("Cannot get schema of function");
  },
  arguments: (context, graph) => {
    const structure = graph[STRUCTURE];
    if (structure.kind !== "arguments") {
      throw new Error("Invalid structure kind");
    }
    const argsSchema = structure.arguments.map((arg) => {
      const argGraph = graph[GET](arg.name);
      const argSchema = getStructureSchema(context, argGraph);
      return arg.optional ? v.optional(argSchema) : argSchema;
    });
    return v.tuple(argsSchema);
  },
  builtin: (context, graph) => {
    const structure = graph[STRUCTURE];
    if (structure.kind !== "builtin") {
      throw new Error("Invalid structure kind");
    }
    // Resolve each supplied type argument through the same graph navigation a
    // body uses to read its fields — `resolveRef` bound them positionally into
    // `localTypes`. A builtin used with no type arguments receives an empty
    // array; enforcing an exact arity (or allowing omitted ones) is up to the
    // builtin's getSchema.
    const paramSchemas: v.BaseSchema<any, any, any>[] = [];
    for (let index = 0;; index += 1) {
      let paramGraph: TGraphBaseAny;
      try {
        paramGraph = graph[GET](String(index));
      } catch {
        break; // no type argument at this index
      }
      paramSchemas.push(getStructureSchema(context, paramGraph));
    }
    return structure.getSchema(paramSchemas);
  },
};

export function getStructureSchema(
  context: TSchemaContext,
  graph: TGraphBaseAny,
): v.BaseSchema<any, any, any> {
  const cached = context.cache.get(graph);
  if (cached !== undefined) {
    return cached;
  }
  // Recursive types are rejected at parse time (see `validateNoRecursiveTypes`
  // in `parse.ts`), so schema resolution is guaranteed to terminate here.
  const schema = SCHEMA_BY_STRUCTURE[graph[STRUCTURE].kind](context, graph);
  context.cache.set(graph, schema);
  return schema;
}
