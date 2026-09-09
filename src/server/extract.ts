import { ROOT } from "./constants.ts";
import type { TGraphBaseAny } from "./graph.ts";
import type {
  TRootStructure,
  TStructure,
  TTopLevelStructure,
} from "./structure.types.ts";
import type { TLocalTypes } from "./types.ts";

/**
 * Extract the raw parsed structure from a graph returned by {@link parse}.
 *
 * This gives full access to the internal parse tree (`TRootStructure`),
 * including all top-level interfaces and type aliases, their properties,
 * and registered builtins. Use this when you need low-level access that
 * {@link extractApi} does not provide.
 *
 * @param graph The graph object returned by `parse`.
 * @returns The root structure containing all parsed types and builtins.
 */
export function getStructure(graph: TGraphBaseAny): TRootStructure {
  return graph[ROOT];
}

/**
 * A serializable representation of a TypeScript type in the schema.
 *
 * This discriminated union covers every type construct ts-api supports:
 * primitives, literals, arrays, nullable, unions, objects, references,
 * builtins, and functions.
 */
export type ApiType =
  | { kind: "primitive"; type: "string" | "number" | "boolean" }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "array"; items: ApiType }
  | { kind: "nullable"; type: ApiType }
  | { kind: "union"; types: ApiType[] }
  | { kind: "object"; properties: ApiObjectProperty[] }
  | { kind: "ref"; name: string; params: ApiType[] }
  | { kind: "builtin"; name: string }
  | {
    kind: "function";
    arguments: ApiArgument[];
    returns: ApiType;
  };

/**
 * A property of an inline object type (e.g. `{ name: string }`).
 */
export interface ApiObjectProperty {
  name: string;
  type: ApiType;
  optional: boolean;
}

/**
 * A function argument in an endpoint.
 */
export interface ApiArgument {
  name: string;
  type: ApiType;
  optional: boolean;
}

/**
 * A node in the API tree — either a {@link ApiNamespace} or an {@link ApiEndpoint}.
 */
export type ApiNode = ApiNamespace | ApiEndpoint;

/**
 * A namespace node in the API tree. Namespaces contain nested endpoints
 * and/or sub-namespaces.
 */
export interface ApiNamespace {
  kind: "namespace";
  name: string;
  path: string[];
  children: ApiNode[];
}

/**
 * An endpoint (function) node in the API tree. Each endpoint corresponds
 * to one RPC function in the schema.
 */
export interface ApiEndpoint {
  kind: "endpoint";
  name: string;
  path: string[];
  arguments: ApiArgument[];
  returns: ApiType;
}

/**
 * A top-level type declaration (interface or type alias) from the schema file.
 */
export interface ApiTypeDeclaration {
  name: string;
  kind: "interface" | "alias";
  parameters: string[];
  properties?: ApiObjectProperty[];
  type?: ApiType;
}

/**
 * The full API tree extracted from a schema by {@link extractApi}.
 */
export interface ApiTree {
  /** The name of the root interface (the `entry` passed to `extractApi`). */
  entry: string;
  /** The root namespace containing all endpoints and sub-namespaces. */
  root: ApiNamespace;
  /** All top-level type declarations from the schema file. */
  types: ApiTypeDeclaration[];
}

/**
 * Extract a serializable API tree from a parsed graph.
 *
 * Walks the graph from the given entry interface and returns a clean tree
 * of namespaces and endpoints, plus a flat list of all type declarations.
 * The result is fully JSON-serializable (no symbols, no circular references)
 * and is suitable for documentation generation, introspection, or any
 * tooling that needs to understand the API structure.
 *
 * Refs are preserved as `{ kind: "ref", name, params }` so that types like
 * `Paginated<TodoItem>` can be cross-referenced via the `types` array.
 * Builtins (e.g. `Date`) are resolved to `{ kind: "builtin", name }`.
 * Circular interface references are handled by returning an empty namespace.
 *
 * @param graph The graph object returned by `parse`.
 * @param entry The name of the root interface to walk from (e.g. `"Graph"`).
 * @returns The extracted API tree.
 *
 * @example
 * ```ts
 * const graph = parse<AllTypes>(resolve("./api/graph.ts"));
 * const api = extractApi(graph, "Graph");
 *
 * // Walk all endpoints
 * function visit(node: ApiNode) {
 *   if (node.kind === "endpoint") {
 *     console.log(node.path.join("."), node.arguments, node.returns);
 *   } else {
 *     node.children.forEach(visit);
 *   }
 * }
 * visit(api.root);
 * ```
 */
export function extractApi(
  graph: TGraphBaseAny,
  entry: string,
): ApiTree {
  const rootStructure = graph[ROOT];
  const entryType = rootStructure.types.find((t) => t.name === entry);
  if (!entryType) {
    throw new Error(`Entry type "${entry}" not found`);
  }

  const root = walkNamespace(
    rootStructure,
    {},
    entryType.kind === "alias" ? entryType.type : entryType,
    [entry],
    new Set<string>(),
  );

  if (!root) {
    throw new Error(`Entry type "${entry}" is not a namespace`);
  }

  const types = rootStructure.types.map((t) =>
    convertTopLevel(rootStructure, t)
  );

  return { entry, root, types };
}

function walkNamespace(
  rootStructure: TRootStructure,
  localTypes: TLocalTypes,
  structure: TStructure,
  path: string[],
  visited: Set<string>,
): ApiNamespace | null {
  const concrete = resolveToConcrete(rootStructure, localTypes, structure);

  if (concrete.kind !== "interface" && concrete.kind !== "object") {
    return null;
  }

  const name = path[path.length - 1];

  if (concrete.kind === "interface" && visited.has(concrete.name)) {
    return { kind: "namespace", name, path, children: [] };
  }

  const newVisited = concrete.kind === "interface"
    ? new Set(visited).add(concrete.name)
    : visited;

  const children: ApiNode[] = [];
  for (const prop of concrete.properties) {
    const propPath = [...path, prop.name];
    const propConcrete = resolveToConcrete(
      rootStructure,
      localTypes,
      prop.structure,
    );

    if (propConcrete.kind === "function") {
      children.push({
        kind: "endpoint",
        name: prop.name,
        path: propPath,
        arguments: propConcrete.arguments.arguments.map((a) => ({
          name: a.name,
          type: convertType(rootStructure, localTypes, a.structure),
          optional: a.optional,
        })),
        returns: convertType(
          rootStructure,
          localTypes,
          propConcrete.returns,
        ),
      });
    } else {
      const ns = walkNamespace(
        rootStructure,
        localTypes,
        prop.structure,
        propPath,
        newVisited,
      );
      if (ns) {
        children.push(ns);
      }
    }
  }

  return { kind: "namespace", name, path, children };
}

function resolveToConcrete(
  rootStructure: TRootStructure,
  localTypes: TLocalTypes,
  structure: TStructure,
): TStructure {
  switch (structure.kind) {
    case "ref": {
      const local = localTypes[structure.ref];
      if (local) {
        return resolveToConcrete(rootStructure, localTypes, local);
      }
      const topLevel = rootStructure.types.find((t) =>
        t.name === structure.ref
      );
      if (topLevel) {
        const nextLocalTypes: TLocalTypes = { ...localTypes };
        topLevel.parameters.forEach((name, index) => {
          const param = structure.params[index];
          if (param) {
            nextLocalTypes[name] = param;
          }
        });
        const inner = topLevel.kind === "alias" ? topLevel.type : topLevel;
        return resolveToConcrete(rootStructure, nextLocalTypes, inner);
      }
      const builtin = rootStructure.builtins.find((b) =>
        b.name === structure.ref
      );
      if (builtin) {
        return builtin;
      }
      return structure;
    }
    case "alias": {
      return resolveToConcrete(rootStructure, localTypes, structure.type);
    }
    default:
      return structure;
  }
}

function convertType(
  rootStructure: TRootStructure,
  localTypes: TLocalTypes,
  structure: TStructure,
): ApiType {
  switch (structure.kind) {
    case "primitive":
      return { kind: "primitive", type: structure.type };
    case "literal":
      return { kind: "literal", value: structure.type };
    case "array":
      return {
        kind: "array",
        items: convertType(rootStructure, localTypes, structure.items),
      };
    case "nullable":
      return {
        kind: "nullable",
        type: convertType(rootStructure, localTypes, structure.type),
      };
    case "union":
      return {
        kind: "union",
        types: structure.types.map((t) =>
          convertType(rootStructure, localTypes, t)
        ),
      };
    case "object":
      return {
        kind: "object",
        properties: structure.properties.map((p) => ({
          name: p.name,
          type: convertType(rootStructure, localTypes, p.structure),
          optional: p.optional,
        })),
      };
    case "ref": {
      const builtin = rootStructure.builtins.find((b) =>
        b.name === structure.ref
      );
      if (builtin) {
        return { kind: "builtin", name: builtin.name };
      }
      return {
        kind: "ref",
        name: structure.ref,
        params: structure.params.map((p) =>
          convertType(rootStructure, localTypes, p)
        ),
      };
    }
    case "builtin":
      return { kind: "builtin", name: structure.name };
    case "interface":
      return {
        kind: "object",
        properties: structure.properties.map((p) => ({
          name: p.name,
          type: convertType(rootStructure, localTypes, p.structure),
          optional: p.optional,
        })),
      };
    case "alias":
      return convertType(rootStructure, localTypes, structure.type);
    case "function":
      return {
        kind: "function",
        arguments: structure.arguments.arguments.map((a) => ({
          name: a.name,
          type: convertType(rootStructure, localTypes, a.structure),
          optional: a.optional,
        })),
        returns: convertType(rootStructure, localTypes, structure.returns),
      };
  }
}

function convertTopLevel(
  rootStructure: TRootStructure,
  struct: TTopLevelStructure,
): ApiTypeDeclaration {
  if (struct.kind === "interface") {
    return {
      name: struct.name,
      kind: "interface",
      parameters: struct.parameters,
      properties: struct.properties.map((p) => ({
        name: p.name,
        type: convertType(rootStructure, {}, p.structure),
        optional: p.optional,
      })),
    };
  }
  return {
    name: struct.name,
    kind: "alias",
    parameters: struct.parameters,
    type: convertType(rootStructure, {}, struct.type),
  };
}
