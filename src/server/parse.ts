import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/javascript";
import * as v from "@valibot/valibot";
import type { TTypesBase } from "../utils/types.ts";
import { DEFAULT_BUILTINS_GRAPH } from "./builtins.ts";
import { ROOT } from "./constants.ts";
import { graph, type TGraphBaseAny } from "./graph.ts";
import type {
  TBuiltinStructure,
  TFunctionArgumentStructure,
  TRootStructure,
  TStructure,
  TStructureAlias,
  TStructureArgumentItem,
  TStructureArguments,
  TStructureInterface,
  TStructureObjectProperty,
  TStructureUnion,
  TTopLevelStructure,
} from "./structure.types.ts";
import type { TGraphOf } from "./types.ts";

/**
 * The TypeScript grammar of `@lezer/javascript` compiled as a plain syntactic
 * parser. No type checking, no compiler: we only walk the syntax tree.
 *
 * Note: importing `@lezer/lr` reads `process.env.LOG` in Deno, so the runtime
 * needs `--allow-env=LOG` (scoped to that single variable). This is the price
 * for a ~0.8MB dependency instead of the ~26MB TypeScript compiler.
 */
const tsParser = parser.configure({ dialect: "ts" });

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
 * Parse the TypeScript source of a schema and turn it into a graph object.
 *
 * The source is passed as a string, so this function is pure: it does no
 * file-system access and can run anywhere (browser, edge, Deno, Node). Use
 * {@link parseFromFile} (from `@dldc/ts-api/server/filesystem`) when you want
 * `parse` to read the schema file from disk for you.
 *
 * Fails fast by default: it throws if the schema references a type that is
 * neither declared in the file nor registered as a builtin (see
 * {@link TMissingBuiltinAction}).
 */
export function parse<Types extends TTypesBase>(
  sourceText: string,
  options: TParseOptions = {},
): TGraphOf<Types> {
  const tree = tsParser.parse(sourceText);
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
  const statements = children(tree.topNode);
  const importedNames = collectImportedNames(tree.topNode, sourceText);

  for (const statement of statements) {
    if (statement.type.name === "ImportDeclaration") {
      continue;
    }
    if (statement.type.name === ";" || statement.type.name === "export") {
      // Stray tokens at the top level (should not happen on valid input).
      continue;
    }
    let structNode = statement;
    if (statement.type.name === "ExportDeclaration") {
      structNode = children(statement).find(
        (c) =>
          c.type.name === "InterfaceDeclaration" ||
          c.type.name === "TypeAliasDeclaration",
      ) ?? statement;
    }
    const struct = parseNode(structNode, key, sourceText);
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
  validateNoImportedNamespaces(rootStructure, importedNames);
  handleMissingBuiltins(
    rootStructure,
    options.missingBuiltinAction ?? "throw",
  );

  return graph(rootStructure) as TGraphOf<Types>;
}

/**
 * Collect the local names bound by import declarations in the schema file.
 *
 * ts-api never follows imports — an imported type is opaque. Knowing which
 * names are imported lets us reject using them as part of the graph structure
 * (see {@link validateNoImportedNamespaces}).
 */
function collectImportedNames(
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

/**
 * Throw if a type imported into the schema file is used to build the graph
 * tree (a namespace property).
 *
 * Imported types can only be used as data: function arguments, return values,
 * or fields of non-namespace interfaces — where a registered builtin provides
 * the runtime schema. Using one as a namespace is broken because a builtin is
 * an opaque leaf that cannot be navigated, so it is rejected at parse time.
 */
function validateNoImportedNamespaces(
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

// ---------------------------------------------------------------------------
// Lezer AST helpers
// ---------------------------------------------------------------------------

/** All children, including anonymous tokens, in source order. */
function children(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const cur = node.cursor();
  if (cur.firstChild()) {
    do {
      const name = cur.node.type.name;
      // Comments carry no AST meaning for ts-api and can appear anywhere
      // between tokens, so they are dropped from traversal everywhere.
      if (
        name === "LineComment" || name === "BlockComment" || name === "Hashbang"
      ) {
        continue;
      }
      out.push(cur.node);
    } while (cur.nextSibling());
  }
  return out;
}

/**
 * The structural type node names emitted by the TS-dialect grammar. Named
 * (non-token) nodes in type positions always have one of these names.
 *
 * NOTE: in this build of @lezer/common the anonymous-token flag is not set on
 * token node types, so tokens and named nodes are indistinguishable via node
 * flags. We therefore classify by name: `children()` (a cursor walk) yields
 * everything — including punctuation/keyword tokens — and these sets pick out
 * the structural nodes.
 */
const TYPE_NODE_NAMES = new Set([
  "TypeName",
  "ParameterizedType",
  "IndexedType",
  "ArrayType",
  "UnionType",
  "IntersectionType",
  "LiteralType",
  "NullType",
  "ObjectType",
  "FunctionSignature",
  "VoidType",
  "ReadonlyType",
  "ParenthesizedType",
  "TupleType",
  "ConditionalType",
  "KeyofType",
  "TypeofType",
  "InferredType",
  "UniqueType",
  "ImportType",
  "TemplateType",
  "ThisType",
]);

/** The first direct child that is a type node, if any. */
function typeChild(node: SyntaxNode): SyntaxNode | undefined {
  return children(node).find((c) => TYPE_NODE_NAMES.has(c.type.name));
}

function childByName(node: SyntaxNode, name: string): SyntaxNode | undefined {
  return children(node).find((n) => n.type.name === name);
}

function hasChild(node: SyntaxNode, name: string): boolean {
  return children(node).some((n) => n.type.name === name);
}

function textOf(node: SyntaxNode, sourceText: string): string {
  return sourceText.slice(node.from, node.to);
}

/** 1-based line number of the start of a node. */
function lineAt(node: SyntaxNode, sourceText: string): number {
  let line = 1;
  const end = Math.min(node.from, sourceText.length);
  for (let i = 0; i < end; i++) {
    if (sourceText.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

function throwUnknown(
  node: SyntaxNode,
  sourceText: string,
  kindName?: string,
): never {
  const kind = kindName ?? node.type.name;
  console.info(textOf(node, sourceText), `at line ${lineAt(node, sourceText)}`);
  throw new Error(
    `Unknown node: ${textOf(node, sourceText)} (${kind}) at line ${
      lineAt(node, sourceText)
    }`,
  );
}

/** Unescape a string literal (both `"` and `'` quoted forms). */
function unquote(raw: string): string {
  const q = raw.charCodeAt(0);
  const last = raw.charCodeAt(raw.length - 1);
  if (q === 34 && last === 34) { // double quotes
    return JSON.parse(raw);
  }
  if (q === 39 && last === 39) { // single quotes
    const inner = raw.slice(1, -1);
    try {
      return JSON.parse(
        '"' + inner.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"',
      );
    } catch {
      // Best effort: keep the raw content when escaping is ambiguous.
      return inner;
    }
  }
  throw new Error(`Unsupported literal type: ${raw}`);
}

function requiredType(node: SyntaxNode, label: string): SyntaxNode {
  const child = typeChild(node);
  if (!child) {
    throw new Error(`Expected a ${label} type for ${node.type.name}`);
  }
  return child;
}

// `TypeName` is Lezer's catch-all name for both primitive keywords and plain
// type references. Keywords the compiler would represent differently are
// explicitly rejected, matching the previous ts-morph behaviour.
const TS_KEYWORDS: Record<string, string | undefined> = {
  any: "AnyKeyword",
  unknown: "UnknownKeyword",
  never: "NeverKeyword",
  undefined: "UndefinedKeyword",
  object: "ObjectKeyword",
  symbol: "SymbolKeyword",
  bigint: "BigIntKeyword",
  this: "ThisType",
};

// ---------------------------------------------------------------------------
// Node → TStructure
// ---------------------------------------------------------------------------

function parseNode(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  switch (node.type.name) {
    case "TypeAnnotation":
      return parseNode(requiredType(node, "type"), parentKey, sourceText);
    case "ReadonlyType":
    case "ParenthesizedType":
      // Transparent wrappers: `readonly X` and `(X)` carry no semantic weight.
      return parseNode(requiredType(node, "type"), parentKey, sourceText);
    case "TypeName":
      return parseTypeName(node, parentKey, sourceText);
    case "ParameterizedType":
      return parseParameterizedType(node, parentKey, sourceText);
    case "IndexedType":
      return parseIndexedType(node, parentKey, sourceText);
    case "ArrayType":
      return parseArrayType(node, parentKey, sourceText);
    case "UnionType":
      return parseUnionType(node, parentKey, sourceText);
    case "LiteralType":
      return parseLiteralType(node, parentKey, sourceText);
    case "NullType":
      return { kind: "literal", key: parentKey, type: null };
    case "ObjectType":
      return parseObjectType(node, parentKey, sourceText);
    case "FunctionSignature":
      return parseFunctionSignature(node, parentKey, sourceText);
    case "InterfaceDeclaration":
      return parseInterfaceDeclaration(node, parentKey, sourceText);
    case "TypeAliasDeclaration":
      return parseTypeAliasDeclaration(node, parentKey, sourceText);
    case "VoidType":
      throw new Error("Void expressions are not supported, use null instead");
    default:
      return throwUnknown(node, sourceText);
  }
}

function parseTypeName(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  const name = textOf(node, sourceText);
  if (name === "string") {
    return { kind: "primitive", key: parentKey, type: "string" };
  }
  if (name === "number") {
    return { kind: "primitive", key: parentKey, type: "number" };
  }
  if (name === "boolean") {
    return { kind: "primitive", key: parentKey, type: "boolean" };
  }
  const keywordKind = TS_KEYWORDS[name];
  if (keywordKind) {
    return throwUnknown(node, sourceText, keywordKind);
  }
  return { kind: "ref", key: parentKey, ref: name, params: [] };
}

function parseParameterizedType(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  const base = typeChild(node);
  if (!base) {
    throw new Error("Generic type must have a base type");
  }
  const refName =
    base.type.name === "TypeName" || base.type.name === "IndexedType"
      ? textOf(base, sourceText)
      : null;
  if (refName === null) {
    throw new Error(
      `Only identifiers and qualified names are supported for now, received: ${base.type.name}`,
    );
  }
  const argsList = childByName(node, "TypeArgList");
  const params = argsList
    ? children(argsList)
      .filter((c) =>
        c.type.name !== "<" && c.type.name !== ">" && c.type.name !== ","
      )
      .map((param, index) =>
        parseNode(param, `${parentKey}.params.${index}`, sourceText)
      )
    : [];
  return { kind: "ref", key: parentKey, ref: refName, params };
}

function parseIndexedType(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  if (hasChild(node, "[")) {
    // `T["k"]` — indexed access types are not supported.
    return throwUnknown(node, sourceText, "IndexedAccessType");
  }
  // Qualified name such as `Temporal.PlainDate`.
  return {
    kind: "ref",
    key: parentKey,
    ref: textOf(node, sourceText),
    params: [],
  };
}

function parseArrayType(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  return {
    kind: "array",
    key: parentKey,
    items: parseNode(
      requiredType(node, "element"),
      `${parentKey}.items`,
      sourceText,
    ),
  };
}

function parseUnionType(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  // Check if it's a nullable
  const all = children(node).filter((n) => n.type.name !== "LogicOp");
  const hasNull = all.some((n) => n.type.name === "NullType");
  const subTypes = hasNull
    ? all.filter((n) => n.type.name !== "NullType")
    : all;
  if (hasNull && subTypes.length === 1) {
    return {
      kind: "nullable",
      key: parentKey,
      type: parseNode(subTypes[0], `${parentKey}.type`, sourceText),
    };
  }
  const types: TStructure[] = subTypes.map((typeNode, i) =>
    parseNode(typeNode, `${parentKey}.${i}`, sourceText)
  );
  const union: TStructureUnion = { kind: "union", key: parentKey, types };
  return hasNull ? { kind: "nullable", key: parentKey, type: union } : union;
}

function parseLiteralType(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  const raw = textOf(node, sourceText).trim();
  if (raw === "true") {
    return { kind: "literal", key: parentKey, type: true };
  }
  if (raw === "false") {
    return { kind: "literal", key: parentKey, type: false };
  }
  const q = raw[0];
  if (q === '"' || q === "'") {
    return { kind: "literal", key: parentKey, type: unquote(raw) };
  }
  if (/^[+-]?\d/.test(raw)) {
    // Handle numeric separators such as `1_000`.
    return {
      kind: "literal",
      key: parentKey,
      type: Number(raw.replaceAll("_", "")),
    };
  }
  throw new Error(`Unsupported literal type: ${raw}`);
}

function parseObjectType(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  return {
    kind: "object",
    key: parentKey,
    properties: parseMembers(node, parentKey, sourceText, false),
  };
}

/**
 * Parse the members of an object/interface body.
 *
 * - `PropertyType` → a property.
 * - `MethodType` → rejected in interfaces; in inline object types it is
 *   silently ignored (like ts-morph's `getProperties()` used to).
 * - `IndexSignature` → a mapped type (`{ [K in keyof T]: X }`) is rejected;
 *   a plain index signature is ignored (like ts-morph used to).
 * - Everything else that isn't a known separator token is rejected, so
 *   unsupported constructs fail loudly instead of being misread.
 */
function parseMembers(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
  interfaceContext: boolean,
): TStructureObjectProperty[] {
  const properties: TStructureObjectProperty[] = [];
  for (const member of children(node)) {
    const name = member.type.name;
    if (name === "PropertyType") {
      properties.push(parsePropertyType(member, parentKey, sourceText));
    } else if (name === "MethodType") {
      if (interfaceContext) {
        throw new Error(
          "Methods are not supported yet, please use `property: () => void;` instead.",
        );
      }
      // Inline object method signatures are ignored, like ts-morph's
      // `getProperties()` used to.
    } else if (name === "IndexSignature") {
      if (hasChild(member, "in")) {
        // `{ [K in keyof T]: X }` — mapped types are not supported.
        return throwUnknown(member, sourceText, "MappedType");
      }
      // Plain index signatures are ignored, like ts-morph used to.
    } else if (name !== "{" && name !== "}" && name !== ";" && name !== ",") {
      return throwUnknown(member, sourceText);
    }
  }
  return properties;
}

function parsePropertyType(
  member: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructureObjectProperty {
  const annotation = childByName(member, "TypeAnnotation");
  if (!annotation) {
    throw new Error(`Property must have a type annotation`);
  }
  const valueNode = requiredType(annotation, "property");
  const keyNode = children(member).find(
    (n) =>
      n.type.name !== "TypeAnnotation" &&
      n.type.name !== "Optional" &&
      n.type.name !== "readonly",
  );
  if (!keyNode || keyNode.type.isError) {
    // A Lezer error node (`⚠`) inside the property means a syntax construct we
    // can't interpret — fail loudly instead of misreading the member.
    throwUnknown(keyNode ?? member, sourceText);
  }
  const propName = keyNode.type.name === "String"
    ? unquote(textOf(keyNode, sourceText))
    : textOf(keyNode, sourceText);
  const propKey = `${parentKey}.${propName}`;
  return {
    name: propName,
    structure: parseNode(valueNode, propKey, sourceText),
    optional: hasChild(member, "Optional"),
  };
}

function parseFunctionSignature(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  const argsKey = `${parentKey}.arguments`;
  const argumentsStruct: TStructureArguments = {
    kind: "arguments",
    key: argsKey,
    arguments: [],
  };
  const paramList = childByName(node, "ParamList");
  if (paramList) {
    let param:
      | { name: string; optional: boolean; type: SyntaxNode | null }
      | null = null;
    for (const part of children(paramList)) {
      const name = part.type.name;
      if (name === "VariableDefinition") {
        if (param) {
          argumentsStruct.arguments.push(
            flushParam(param, argsKey, sourceText),
          );
        }
        param = {
          name: textOf(part, sourceText),
          optional: false,
          type: null,
        };
      } else if (name === "Optional") {
        if (param) param.optional = true;
      } else if (name === "TypeAnnotation") {
        if (param) param.type = requiredType(part, "parameter");
      } else if (
        name !== "," && name !== "(" && name !== ")" && name !== "..."
      ) {
        throw new Error(
          `Unsupported function parameter: ${textOf(part, sourceText)}`,
        );
      }
    }
    if (param) {
      argumentsStruct.arguments.push(flushParam(param, argsKey, sourceText));
    }
  }
  const returnsNode = children(node).find(
    (n) => n.type.name !== "ParamList" && n.type.name !== "Arrow",
  );
  if (!returnsNode) {
    throw new Error("Function type must have a return type");
  }
  return {
    kind: "function",
    key: parentKey,
    arguments: argumentsStruct,
    returns: parseNode(returnsNode, `${parentKey}.returns`, sourceText),
  };
}

function flushParam(
  param: { name: string; optional: boolean; type: SyntaxNode | null },
  argsKey: string,
  sourceText: string,
): TStructureArgumentItem {
  const type = param.type;
  if (!type) {
    throw new Error(`Parameter "${param.name}" must have a type annotation`);
  }
  const argKey = `${argsKey}.${param.name}`;
  return {
    name: param.name,
    structure: parseNode(
      type,
      argKey,
      sourceText,
    ) as TFunctionArgumentStructure,
    optional: param.optional,
  };
}

function parseTypeParameters(node: SyntaxNode, sourceText: string): string[] {
  const paramList = childByName(node, "TypeParamList");
  if (!paramList) {
    return [];
  }
  if (hasChild(paramList, "Equals")) {
    throw new Error(
      "Type parameters with default values are not supported yet.",
    );
  }
  return children(paramList)
    .filter((param) => param.type.name === "TypeDefinition")
    .map((param) => textOf(param, sourceText));
}

function parseTypeAliasDeclaration(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructureAlias {
  const nameNode = childByName(node, "TypeDefinition");
  if (!nameNode) {
    throw new Error("Type alias must have a name");
  }
  const name = textOf(nameNode, sourceText);
  const key = `${parentKey}.${name}`;
  const valueNode = typeChild(node);
  if (!valueNode) {
    throw new Error("Type alias must have a type");
  }
  return {
    kind: "alias",
    key,
    name,
    type: parseNode(valueNode, `${key}.type`, sourceText),
    parameters: parseTypeParameters(node, sourceText),
  };
}

function parseInterfaceDeclaration(
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructureInterface {
  const nameNode = childByName(node, "TypeDefinition");
  if (!nameNode) {
    throw new Error("Interface must have a name");
  }
  const name = textOf(nameNode, sourceText);
  const key = `${parentKey}.${name}`;
  const properties: TStructureObjectProperty[] = [];
  const body = childByName(node, "ObjectType");
  if (body) {
    properties.push(...parseMembers(body, key, sourceText, true));
  }
  return {
    kind: "interface",
    key,
    name,
    properties,
    parameters: parseTypeParameters(node, sourceText),
  };
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
