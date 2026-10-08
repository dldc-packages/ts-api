import * as v from "@valibot/valibot";
import type {
  TBuiltinStructure,
  TRootStructure,
  TStructure,
} from "../structure.types.ts";

/**
 * What to do when the schema references a type that is neither declared in the
 * schema file nor registered as a builtin.
 *
 * - `"throw"` (default): fail at parse time.
 * - `"warn"`: auto-register the type as a builtin (with an `unknown` schema)
 *   and log a warning.
 * - `"ignore"`: auto-register the type as a builtin (with an `unknown` schema)
 *   without logging.
 */
export type TMissingBuiltinAction = "ignore" | "throw" | "warn";

/**
 * Configuration for how to handle types referenced in the schema that are
 * neither declared in the file nor registered as a builtin.
 *
 * Either a single action applied to every missing type, or an object allowing a
 * different action for types used as function inputs (`input`) vs types used as
 * function outputs / return values (`output`). When a type is used on both
 * sides, the stricter of the two actions wins (`throw` > `warn` > `ignore`).
 */
export type TMissingBuiltinActionConfig =
  | TMissingBuiltinAction
  | { input: TMissingBuiltinAction; output: TMissingBuiltinAction };

type TMissingRefUsage = { input: boolean; output: boolean };
type TMissingRefContext = "input" | "output" | "neutral";

const MISSING_BUILTIN_SEVERITY: Record<TMissingBuiltinAction, number> = {
  ignore: 0,
  warn: 1,
  throw: 2,
};

export function handleMissingBuiltins(
  rootStructure: TRootStructure,
  config: TMissingBuiltinActionConfig,
): void {
  const missing = collectMissingRefs(rootStructure);
  if (missing.size === 0) {
    return;
  }

  const toThrow: string[] = [];
  for (const [name, usage] of missing) {
    const action = resolveAction(config, usage);
    if (action === "throw") {
      toThrow.push(name);
      continue;
    }
    if (action === "warn") {
      console.warn(
        `[ts-api] Type "${name}" is not declared in the schema nor registered as a builtin. ` +
          "Automatically registering it as a builtin with an unknown schema.",
      );
    }
    rootStructure.builtins.push(createAutoBuiltin(name));
  }

  if (toThrow.length > 0) {
    throw new Error(
      `Missing builtin type${toThrow.length > 1 ? "s" : ""}: ${
        toThrow.join(", ")
      }. ` +
        "Register them with createBuiltins() or set missingBuiltinAction to 'warn' or 'ignore'.",
    );
  }
}

function createAutoBuiltin(name: string): TBuiltinStructure {
  return {
    kind: "builtin",
    key: `builtin.${name}`,
    name,
    // Auto-registered builtins are opaque `unknown` leaves: their type
    // arguments (if any) are ignored, so any number of them is accepted.
    getSchema: () => v.unknown(),
  };
}

function collectMissingRefs(
  rootStructure: TRootStructure,
): Map<string, TMissingRefUsage> {
  const missing = new Map<string, TMissingRefUsage>();
  for (const type of rootStructure.types) {
    walkForMissingRefs(
      rootStructure,
      type,
      new Set(type.parameters),
      "neutral",
      missing,
    );
  }
  return missing;
}

function walkForMissingRefs(
  rootStructure: TRootStructure,
  structure: TStructure,
  locals: Set<string>,
  context: TMissingRefContext,
  missing: Map<string, TMissingRefUsage>,
): void {
  switch (structure.kind) {
    case "ref":
      if (
        !locals.has(structure.ref) &&
        !rootStructure.types.some((t) => t.name === structure.ref) &&
        !rootStructure.builtins.some((b) => b.name === structure.ref)
      ) {
        const usage = missing.get(structure.ref) ??
          { input: false, output: false };
        if (context === "input") {
          usage.input = true;
        }
        if (context === "output") {
          usage.output = true;
        }
        missing.set(structure.ref, usage);
      }
      structure.params.forEach((p) =>
        walkForMissingRefs(rootStructure, p, locals, context, missing)
      );
      break;
    case "interface":
    case "object":
      structure.properties.forEach((p) =>
        walkForMissingRefs(rootStructure, p.structure, locals, context, missing)
      );
      break;
    case "alias":
      walkForMissingRefs(
        rootStructure,
        structure.type,
        locals,
        context,
        missing,
      );
      break;
    case "array":
      walkForMissingRefs(
        rootStructure,
        structure.items,
        locals,
        context,
        missing,
      );
      break;
    case "nullable":
      walkForMissingRefs(
        rootStructure,
        structure.type,
        locals,
        context,
        missing,
      );
      break;
    case "union":
      structure.types.forEach((t) =>
        walkForMissingRefs(rootStructure, t, locals, context, missing)
      );
      break;
    case "function":
      structure.arguments.arguments.forEach((a) =>
        walkForMissingRefs(rootStructure, a.structure, locals, "input", missing)
      );
      walkForMissingRefs(
        rootStructure,
        structure.returns,
        locals,
        "output",
        missing,
      );
      break;
    case "primitive":
    case "literal":
    case "builtin":
      break;
  }
}

function resolveAction(
  config: TMissingBuiltinActionConfig,
  usage: TMissingRefUsage,
): TMissingBuiltinAction {
  if (typeof config === "string") {
    return config;
  }
  if (usage.input && usage.output) {
    // Used on both sides: take the stricter of the two.
    return MISSING_BUILTIN_SEVERITY[config.input] >=
        MISSING_BUILTIN_SEVERITY[config.output]
      ? config.input
      : config.output;
  }
  if (usage.input) {
    return config.input;
  }
  // Used only as output, or in a neutral position (e.g. a non-endpoint data
  // field): fall back to the output action.
  return config.output;
}
