import { readFileSync } from "node:fs";
import * as v from "@valibot/valibot";
import type {
  FunctionTypeNode,
  InterfaceDeclaration,
  LiteralTypeNode,
  TypeAliasDeclaration,
  TypeLiteralNode,
  TypeReferenceNode,
  UnionTypeNode,
} from "@ts-morph/ts-morph";
import {
  Node,
  NullLiteral,
  NumericLiteral,
  Project,
  StringLiteral,
  SyntaxKind,
} from "@ts-morph/ts-morph";
import type { TTypesBase } from "../utils/types.ts";
import { DEFAULT_BUILTINS_GRAPH } from "./builtins.ts";
import { ROOT } from "./constants.ts";
import { graph, type TGraphBaseAny } from "./graph.ts";
import type {
  TFunctionArgumentStructure,
  TRootStructure,
  TStructure,
  TStructureAlias,
  TStructureArguments,
  TStructureInterface,
  TStructureObjectProperty,
  TStructureUnion,
  TTopLevelStructure,
} from "./structure.types.ts";
import type { TBuiltinStructure } from "./structure.types.ts";
import type { TGraphOf } from "./types.ts";

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

/** Options for {@link parse}. */
export interface TParseOptions {
  /**
   * The builtins graph from `createBuiltins`. Defaults to
   * `DEFAULT_BUILTINS_GRAPH` (includes `Date`).
   */
  builtins?: TGraphBaseAny;
  /**
   * What to do when the schema references a type that is neither declared in
   * the schema file nor registered as a builtin.
   *
   * - `"throw"` (default): fail at parse time.
   * - `"warn"`: auto-register the type as a builtin and log a warning.
   * - `"ignore"`: auto-register the type as a builtin without logging.
   *
   * May also be `{ input, output }` to use different actions for types used as
   * function arguments (`input`) vs function return values (`output`). A type
   * used on both sides uses the stricter of the two.
   */
  missingBuiltinAction?: TMissingBuiltinActionConfig;
}

/**
 * Pass the path to the schema file as well as the the types to be used in the schema.
 *
 * Fails fast by default: it throws if the schema references a type that is
 * neither declared in the file nor registered as a builtin (see
 * {@link TMissingBuiltinAction}).
 */
export function parse<Types extends TTypesBase>(
  schemaPath: string,
  options: TParseOptions = {},
): TGraphOf<Types> {
  const project = new Project({
    useInMemoryFileSystem: true,
  });

  const file = project.createSourceFile(
    schemaPath,
    readFileSync(schemaPath, "utf-8"),
  );
  const key = "root";

  const builtins = options.builtins ?? DEFAULT_BUILTINS_GRAPH;
  const builtinsRootStructure = builtins[ROOT];
  if (builtinsRootStructure.mode !== "builtins") {
    throw new Error("Builtins must be in builtins mode");
  }

  const rootStructure: TRootStructure = {
    kind: "root",
    key,
    types: [],
    // Copy the array so auto-registering missing builtins never mutates the
    // shared builtins graph passed in (e.g. DEFAULT_BUILTINS_GRAPH).
    builtins: [...builtinsRootStructure.builtins],
    mode: "graph",
  };

  // find all statements in the file
  const statements = file.getStatements();

  for (const statement of statements) {
    if (Node.isImportDeclaration(statement)) {
      continue;
    }
    const struct = parseNode(statement, key);
    if (struct.kind !== "interface" && struct.kind !== "alias") {
      throw new Error(
        `Only interfaces and type aliases are supported at the root level, found: ${struct.kind}`,
      );
    }
    const alreadyExists = rootStructure.types.find(
      (s) => s.name === struct.name,
    );
    if (alreadyExists) {
      throw new Error(`Duplicate type name: ${struct.name}`);
    }
    rootStructure.types.push(struct);
  }

  validateNoFunctionsInReturns(rootStructure);
  handleMissingBuiltins(
    rootStructure,
    options.missingBuiltinAction ?? "throw",
  );

  return graph(rootStructure) as TGraphOf<Types>;
}

function findType(
  rootStructure: TRootStructure,
  name: string,
): TTopLevelStructure | undefined {
  return rootStructure.types.find((t) => t.name === name);
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

function validateNoFunctionsInReturns(rootStructure: TRootStructure): void {
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

function parseNode(node: Node, parentKey: string): TStructure {
  if (Node.isStringKeyword(node)) {
    return { kind: "primitive", key: parentKey, type: "string" };
  }
  if (Node.isNumberKeyword(node)) {
    return { kind: "primitive", key: parentKey, type: "number" };
  }
  if (Node.isBooleanKeyword(node)) {
    return { kind: "primitive", key: parentKey, type: "boolean" };
  }
  if (Node.isInterfaceDeclaration(node)) {
    return parseInterfaceDeclaration(node, parentKey);
  }
  if (Node.isTypeAliasDeclaration(node)) {
    return parseTypeAliasDeclaration(node, parentKey);
  }
  if (Node.isTypeLiteral(node)) {
    return parseTypeLiteral(node, parentKey);
  }
  if (Node.isFunctionTypeNode(node)) {
    return parseFunctionTypeNode(node, parentKey);
  }
  if (Node.isUnionTypeNode(node)) {
    return parseUnionTypeNode(node, parentKey);
  }
  if (Node.isTypeReference(node)) {
    return parseTypeReferenceNode(node, parentKey);
  }
  if (Node.isArrayTypeNode(node)) {
    return parseArrayNode(node, parentKey);
  }
  if (Node.isLiteralTypeNode(node)) {
    return parseLiteralTypeNode(node, parentKey);
  }
  if (node.getKind() === SyntaxKind.VoidKeyword) {
    throw new Error("Void expressions are not supported, use null instead");
  }
  console.info(node.print(), `at line ${node.getStartLineNumber()}`);
  throw new Error(
    `Unknown node: ${node.print()} (${node.getKindName()}) at line ${node.getStartLineNumber()}`,
  );
}

function parseArrayNode(node: any, key: string): TStructure {
  const elementType = node.getElementTypeNode();
  if (!elementType) {
    throw new Error("Array node must have an element type");
  }
  return {
    kind: "array",
    key,
    items: parseNode(elementType, `${key}.items`),
  };
}

function parseLiteralTypeNode(
  node: LiteralTypeNode,
  key: string,
): TStructure {
  const literal = node.getLiteral();
  if (literal instanceof NullLiteral) {
    return { kind: "literal", key, type: null };
  }
  if (literal instanceof StringLiteral) {
    return { kind: "literal", key, type: literal.getLiteralValue() };
  }
  if (literal instanceof NumericLiteral) {
    return { kind: "literal", key, type: literal.getLiteralValue() };
  }
  if (Node.isPrefixUnaryExpression(literal)) {
    const operand = literal.getOperand();
    const operator = literal.getOperatorToken();
    if (
      Node.isNumericLiteral(operand) &&
      operator === SyntaxKind.MinusToken
    ) {
      return { kind: "literal", key, type: -operand.getLiteralValue() };
    }
  }
  if (literal.getKind() === SyntaxKind.TrueKeyword) {
    return { kind: "literal", key, type: true };
  }
  if (literal.getKind() === SyntaxKind.FalseKeyword) {
    return { kind: "literal", key, type: false };
  }
  throw new Error(`Unsupported literal type: ${literal.getText()}`);
}

function parseTypeLiteral(
  node: TypeLiteralNode,
  parentKey: string,
): TStructure {
  const properties: TStructureObjectProperty[] = [];
  for (const property of node.getProperties()) {
    // get the declaration of the property
    const colonNode = property.getFirstChildByKindOrThrow(
      SyntaxKind.ColonToken,
    );
    const valueNode = colonNode.getNextSiblingOrThrow();
    const propName = property.getName();
    const propKey = `${parentKey}.${propName}`;
    properties.push({
      name: propName,
      structure: parseNode(valueNode, propKey),
      optional: property.hasQuestionToken(),
    });
  }
  return { kind: "object", key: parentKey, properties };
}

function parseFunctionTypeNode(
  node: FunctionTypeNode,
  key: string,
): TStructure {
  const argsKey = `${key}.arguments`;
  const argumentsStruct: TStructureArguments = {
    kind: "arguments",
    key: argsKey,
    arguments: [],
  };
  const params = node.getParameters();
  for (const param of params) {
    const colonNode = param.getFirstChildByKindOrThrow(SyntaxKind.ColonToken);
    const valueNode = colonNode.getNextSiblingOrThrow();
    const optional = param.hasQuestionToken();
    const argName = param.getName();
    const argKey = `${argsKey}.${argName}`;
    argumentsStruct.arguments.push({
      name: argName,
      structure: parseNode(valueNode, argKey) as TFunctionArgumentStructure,
      optional,
    });
  }
  const res = node.getReturnTypeNodeOrThrow();
  return {
    kind: "function",
    key,
    arguments: argumentsStruct,
    returns: parseNode(res, `${key}.returns`),
  };
}

function parseUnionTypeNode(
  node: UnionTypeNode,
  key: string,
): TStructure {
  // Check if it's a nullable
  let subTypes = node.getTypeNodes();
  const hasNull = subTypes.some((typeNode) => {
    if (Node.isLiteralTypeNode(typeNode)) {
      return typeNode.getLiteral() instanceof NullLiteral;
    }
    return false;
  });
  if (hasNull) {
    subTypes = subTypes.filter((typeNode) => {
      if (Node.isLiteralTypeNode(typeNode)) {
        return !(typeNode.getLiteral() instanceof NullLiteral);
      }
      return true;
    });
    if (subTypes.length === 1) {
      return {
        kind: "nullable",
        key,
        type: parseNode(subTypes[0], `${key}.type`),
      };
    }
  }
  // union
  const types: TStructure[] = [];
  subTypes.forEach((typeNode, i) => {
    types.push(parseNode(typeNode, `${key}.${i}`));
  });
  const union: TStructureUnion = {
    kind: "union",
    key,
    types,
  };
  if (hasNull) {
    return { kind: "nullable", key, type: union };
  }
  return union;
}

function parseTypeReferenceNode(
  node: TypeReferenceNode,
  key: string,
): TStructure {
  const name = node.getTypeName();
  // Allow simple identifiers (e.g. "Date") and qualified names (e.g.
  // "Temporal.PlainDate"). Qualified names are only useful for builtins,
  // since ts-api can't resolve dotted names as interfaces or type aliases.
  const refName = Node.isIdentifier(name)
    ? name.getText()
    : Node.isQualifiedName(name)
    ? name.getText()
    : null;
  if (refName === null) {
    throw new Error(
      `Only identifiers and qualified names are supported for now, received: ${name.getKindName()}`,
    );
  }
  // get type params if generic
  const typeParams = node.getTypeArguments();
  const params = typeParams.map((param, index) =>
    parseNode(param, `${key}.params.${index}`)
  );
  return {
    kind: "ref",
    key,
    ref: refName,
    params,
  };
}

function parseTypeAliasDeclaration(
  node: TypeAliasDeclaration,
  parentKey: string,
): TStructureAlias {
  const name = node.getName();
  const key = `${parentKey}.${name}`;
  const valueNode = node.getTypeNode();
  if (!valueNode) {
    throw new Error("Type alias must have a type");
  }
  const parameters = node.getTypeParameters().map((param) => {
    const defType = param.getDefault();
    if (defType) {
      throw new Error(
        "Type parameters with default values are not supported yet.",
      );
    }
    return param.getName();
  });
  return {
    kind: "alias",
    key,
    name,
    type: parseNode(valueNode, `${key}.type`),
    parameters,
  };
}

function parseInterfaceDeclaration(
  node: InterfaceDeclaration,
  parentKey: string,
): TStructureInterface {
  const name = node.getName();
  const key = `${parentKey}.${name}`;
  const properties: TStructureObjectProperty[] = [];
  for (const property of node.getProperties()) {
    // get the declaration of the property
    const colonNode = property.getFirstChildByKindOrThrow(
      SyntaxKind.ColonToken,
    );
    const valueNode = colonNode.getNextSiblingOrThrow();
    const propName = property.getName();
    const propKey = `${key}.${propName}`;
    properties.push({
      name: propName,
      structure: parseNode(valueNode, propKey),
      optional: property.hasQuestionToken(),
    });
  }
  const methods = node.getMethods();
  if (methods.length > 0) {
    throw new Error(
      "Methods are not supported yet, please use `property: () => void;` instead.",
    );
  }
  const parameters = node.getTypeParameters().map((param) => {
    const defType = param.getDefault();
    if (defType) {
      throw new Error(
        "Type parameters with default values are not supported yet.",
      );
    }
    return param.getName();
  });
  return { kind: "interface", key, name, properties, parameters };
}

function handleMissingBuiltins(
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
    getSchema: () => v.unknown(),
  };
}

type TMissingRefUsage = { input: boolean; output: boolean };
type TMissingRefContext = "input" | "output" | "neutral";

const MISSING_BUILTIN_SEVERITY: Record<TMissingBuiltinAction, number> = {
  ignore: 0,
  warn: 1,
  throw: 2,
};

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
