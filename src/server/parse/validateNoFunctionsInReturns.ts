import type { TRootStructure, TStructure } from "../structure.types.ts";
import { findType } from "./utils.ts";

export function validateNoFunctionsInReturns(
  rootStructure: TRootStructure,
): void {
  const visited = new Set<string>();
  for (const type of rootStructure.types) {
    walkForFunctions(rootStructure, type, visited);
  }
}

function walkForFunctions(
  rootStructure: TRootStructure,
  structure: TStructure,
  visited: Set<string>,
): void {
  switch (structure.kind) {
    case "function":
      checkNoFunctionsInStructure(
        rootStructure,
        structure.returns,
        new Set<string>(),
        `${structure.key}.returns`,
      );
      break;
    case "interface":
    case "object":
      for (const prop of structure.properties) {
        walkForFunctions(rootStructure, prop.structure, visited);
      }
      break;
    case "alias":
      walkForFunctions(rootStructure, structure.type, visited);
      break;
    case "array":
      walkForFunctions(rootStructure, structure.items, visited);
      break;
    case "nullable":
      walkForFunctions(rootStructure, structure.type, visited);
      break;
    case "union":
      structure.types.forEach((t) =>
        walkForFunctions(rootStructure, t, visited)
      );
      break;
    case "ref": {
      const resolved = findType(rootStructure, structure.ref);
      if (resolved) {
        if (visited.has(resolved.key)) {
          return;
        }
        visited.add(resolved.key);
        walkForFunctions(
          rootStructure,
          resolved.kind === "alias" ? resolved.type : resolved,
          visited,
        );
      }
      break;
    }
    case "primitive":
    case "literal":
    case "builtin":
      break;
  }
}

function checkNoFunctionsInStructure(
  rootStructure: TRootStructure,
  structure: TStructure,
  visited: Set<string>,
  context: string,
): void {
  switch (structure.kind) {
    case "function":
      throw new Error(
        `Function found in return type at ${context}. Return types must not contain functions. Use a separate namespace property instead.`,
      );
    case "object":
    case "interface":
      for (const prop of structure.properties) {
        checkNoFunctionsInStructure(
          rootStructure,
          prop.structure,
          visited,
          `${context}.${prop.name}`,
        );
      }
      break;
    case "array":
      checkNoFunctionsInStructure(
        rootStructure,
        structure.items,
        visited,
        `${context}.items`,
      );
      break;
    case "nullable":
      checkNoFunctionsInStructure(
        rootStructure,
        structure.type,
        visited,
        `${context}.type`,
      );
      break;
    case "union":
      structure.types.forEach((t, i) =>
        checkNoFunctionsInStructure(
          rootStructure,
          t,
          visited,
          `${context}.${i}`,
        )
      );
      break;
    case "ref": {
      const resolved = findType(rootStructure, structure.ref);
      if (resolved) {
        if (visited.has(resolved.key)) {
          return;
        }
        visited.add(resolved.key);
        checkNoFunctionsInStructure(
          rootStructure,
          resolved.kind === "alias" ? resolved.type : resolved,
          visited,
          context,
        );
      }
      break;
    }
    case "alias":
      checkNoFunctionsInStructure(
        rootStructure,
        structure.type,
        visited,
        context,
      );
      break;
    case "primitive":
    case "literal":
    case "builtin":
      break;
  }
}
