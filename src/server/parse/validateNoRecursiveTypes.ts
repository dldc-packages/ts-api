import type { TRootStructure, TStructure } from "../structure.types.ts";
import { findType } from "./utils.ts";

/**
 * Throw if the schema contains a structurally recursive type.
 *
 * A type is recursive when expanding it (following references, substituting
 * generic parameters) re-enters a top-level declaration while that declaration
 * is still being expanded. Such a type can never be turned into a finite
 * valibot schema, so it is rejected at parse time (fail fast) instead of
 * failing (or hanging) later, the first time a query needs its schema.
 *
 * The walk tracks the current expansion path as a stack of top-level
 * declaration keys: a declaration is only an error if it is re-entered while on
 * the path, so a type reused across independent branches is fine. Generic type
 * parameters are opaque leaves (their arguments are walked separately through
 * the ref's `params`), so finite instantiations of nested generics — e.g.
 * `Page<Page<Todo>>` — are allowed.
 */
export function validateNoRecursiveTypes(rootStructure: TRootStructure): void {
  const path = new Set<string>();
  for (const type of rootStructure.types) {
    walkNoRecursiveTypes(
      rootStructure,
      type,
      path,
      new Set(type.parameters),
    );
  }
}

function walkNoRecursiveTypes(
  rootStructure: TRootStructure,
  structure: TStructure,
  path: Set<string>,
  locals: Set<string>,
): void {
  switch (structure.kind) {
    case "ref": {
      if (locals.has(structure.ref)) {
        // A generic type parameter (e.g. `T`) is bound at each use site; it is
        // not a top-level declaration to recurse into.
        break;
      }
      const resolved = findType(rootStructure, structure.ref);
      if (resolved) {
        if (path.has(resolved.key)) {
          throw new Error(
            `Recursive type detected at "${resolved.key}". Recursive types are not supported by ts-api.`,
          );
        }
        path.add(resolved.key);
        walkNoRecursiveTypes(
          rootStructure,
          resolved.kind === "alias" ? resolved.type : resolved,
          path,
          new Set(resolved.parameters),
        );
        path.delete(resolved.key);
      }
      // The ref's type arguments may reference recursive types.
      structure.params.forEach((param) =>
        walkNoRecursiveTypes(rootStructure, param, path, locals)
      );
      break;
    }
    case "interface":
    case "object":
      structure.properties.forEach((prop) =>
        walkNoRecursiveTypes(rootStructure, prop.structure, path, locals)
      );
      break;
    case "alias":
      walkNoRecursiveTypes(rootStructure, structure.type, path, locals);
      break;
    case "array":
      walkNoRecursiveTypes(rootStructure, structure.items, path, locals);
      break;
    case "nullable":
      walkNoRecursiveTypes(rootStructure, structure.type, path, locals);
      break;
    case "union":
      structure.types.forEach((t) =>
        walkNoRecursiveTypes(rootStructure, t, path, locals)
      );
      break;
    case "function":
      structure.arguments.arguments.forEach((a) =>
        walkNoRecursiveTypes(rootStructure, a.structure, path, locals)
      );
      walkNoRecursiveTypes(rootStructure, structure.returns, path, locals);
      break;
    case "primitive":
    case "literal":
    case "builtin":
      break;
  }
}
