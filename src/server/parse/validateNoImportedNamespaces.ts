import type { TRootStructure, TStructure } from "../structure.types.ts";

/**
 * Throw if a type imported into the schema file is used to build the graph
 * tree (a namespace property).
 *
 * Imported types can only be used as data: function arguments, return values,
 * or fields of non-namespace interfaces — where a registered builtin provides
 * the runtime schema. Using one as a namespace is broken because a builtin is
 * an opaque leaf that cannot be navigated, so it is rejected at parse time.
 */
export function validateNoImportedNamespaces(
  rootStructure: TRootStructure,
  importedNames: Set<string>,
): void {
  if (importedNames.size === 0) {
    return;
  }
  for (const type of rootStructure.types) {
    const locals = new Set(type.parameters);
    const structure = type.kind === "alias" ? type.type : type;
    walkNamespace(structure, locals);
  }

  // An interface/object containing endpoints is a namespace. Its non-endpoint
  // properties are graph-tree nodes, so an imported type there is invalid.
  // Pure data interfaces are never navigated, so imported data fields are fine.
  function walkNamespace(structure: TStructure, locals: Set<string>): void {
    if (structure.kind !== "interface" && structure.kind !== "object") {
      return;
    }
    const hasEndpoint = structure.properties.some(
      (prop) => prop.structure.kind === "function",
    );
    if (!hasEndpoint) {
      return;
    }
    for (const prop of structure.properties) {
      if (prop.structure.kind === "function") {
        // Endpoint: arguments and return value are data, imported types are fine.
        continue;
      }
      walkNodeValue(prop.structure, locals);
    }
  }

  function walkNodeValue(structure: TStructure, locals: Set<string>): void {
    switch (structure.kind) {
      case "ref":
        if (
          importedNames.has(structure.ref) &&
          !locals.has(structure.ref) &&
          !rootStructure.types.some((t) => t.name === structure.ref)
        ) {
          throw new Error(
            `Imported type "${structure.ref}" is used as a namespace, which is not supported. ` +
              "Imported types can only be used as function input/output (registered as builtins) " +
              "or as data fields of non-namespace interfaces. " +
              `Declare "${structure.ref}" directly in the schema file instead.`,
          );
        }
        // Generic arguments can also be namespaces (e.g. `Wrapper<Imported>`).
        for (const param of structure.params) {
          walkNodeValue(param, locals);
        }
        break;
      case "nullable":
        walkNodeValue(structure.type, locals);
        break;
      case "alias":
        walkNodeValue(structure.type, locals);
        break;
      case "interface":
      case "object": {
        // Inline sub-namespace (contains endpoints) → recurse; otherwise data.
        if (
          structure.properties.some(
            (prop) => prop.structure.kind === "function",
          )
        ) {
          walkNamespace(structure, locals);
        }
        return;
      }
      default:
        break;
    }
  }
}
