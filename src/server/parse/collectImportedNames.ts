import type { SyntaxNode } from "@lezer/common";
import { children, textOf } from "./utils.ts";

/**
 * Collect the local names bound by import declarations in the schema file.
 *
 * ts-api never follows imports — an imported type is opaque. Knowing which
 * names are imported lets us reject using them as part of the graph structure
 * (see {@link validateNoImportedNamespaces}).
 */
export function collectImportedNames(
  root: SyntaxNode,
  sourceText: string,
): Set<string> {
  const names = new Set<string>();
  for (const statement of children(root)) {
    if (statement.type.name !== "ImportDeclaration") {
      continue;
    }
    for (const child of children(statement)) {
      const name = child.type.name;
      if (name === "ImportGroup") {
        // Named imports: the local binding is always a `VariableDefinition`
        // (aliased imports are `VariableName as VariableDefinition`).
        for (const specifier of children(child)) {
          if (specifier.type.name === "VariableDefinition") {
            names.add(textOf(specifier, sourceText));
          }
        }
      } else if (name === "VariableDefinition") {
        // Default import, or `import * as NS` namespace import. Both bind a
        // local name; we don't care which it is for validation purposes.
        names.add(textOf(child, sourceText));
      }
    }
  }
  return names;
}
