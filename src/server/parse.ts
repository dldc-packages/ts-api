import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/javascript";
import type { TTypesBase } from "../utils/types.ts";
import { DEFAULT_BUILTINS_GRAPH } from "./builtins.ts";
import { ROOT } from "./constants.ts";
import { graph, type TGraphBaseAny } from "./graph.ts";
import {
  buildCommentsMap,
  type CommentsMap,
} from "./parse/buildCommentsMap.ts";
import { collectImportedNames } from "./parse/collectImportedNames.ts";
import {
  handleMissingBuiltins,
  type TMissingBuiltinAction,
  type TMissingBuiltinActionConfig,
} from "./parse/handleMissingBuiltins.ts";
import {
  childByName,
  children,
  hasChild,
  requiredType,
  textOf,
  throwUnknown,
  TS_KEYWORDS,
  typeChild,
  unquote,
} from "./parse/utils.ts";
import { validateNoFunctionsInReturns } from "./parse/validateNoFunctionsInReturns.ts";
import { validateNoImportedNamespaces } from "./parse/validateNoImportedNamespaces.ts";
import { validateNoRecursiveTypes } from "./parse/validateNoRecursiveTypes.ts";
import type {
  TFunctionArgumentStructure,
  TRootStructure,
  TStructure,
  TStructureAlias,
  TStructureArgumentItem,
  TStructureArguments,
  TStructureInterface,
  TStructureObjectProperty,
  TStructureUnion,
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
const tsParser = parser.configure({ dialect: "ts", strict: true });

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

export type { TMissingBuiltinAction, TMissingBuiltinActionConfig };

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
  const commentsMap = buildCommentsMap(sourceText, tree);
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
  const topNodes = children(tree.topNode);
  const importedNames = collectImportedNames(tree.topNode, sourceText);

  for (const node of topNodes) {
    if (node.type.name === "ImportDeclaration") {
      continue;
    }
    if (node.type.name === ";" || node.type.name === "export") {
      // Stray tokens at the top level (should not happen on valid input).
      continue;
    }
    let structNode = node;
    if (node.type.name === "ExportDeclaration") {
      structNode = children(node).find(
        (c) =>
          c.type.name === "InterfaceDeclaration" ||
          c.type.name === "TypeAliasDeclaration",
      ) ?? node;
    }
    const struct = parseNode(commentsMap, structNode, key, sourceText);
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

  validateNoRecursiveTypes(rootStructure);
  validateNoFunctionsInReturns(rootStructure);
  validateNoImportedNamespaces(rootStructure, importedNames);
  handleMissingBuiltins(
    rootStructure,
    options.missingBuiltinAction ?? "throw",
  );

  return graph(rootStructure) as TGraphOf<Types>;
}

// ---------------------------------------------------------------------------
// Node → TStructure
// ---------------------------------------------------------------------------

function parseNode(
  commentsMap: CommentsMap,
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  switch (node.type.name) {
    case "TypeAnnotation":
      return parseNode(
        commentsMap,
        requiredType(node, "type"),
        parentKey,
        sourceText,
      );
    case "ReadonlyType":
    case "ParenthesizedType":
      // Transparent wrappers: `readonly X` and `(X)` carry no semantic weight.
      return parseNode(
        commentsMap,
        requiredType(node, "type"),
        parentKey,
        sourceText,
      );
    case "TypeName":
      return parseTypeName(node, parentKey, sourceText);
    case "ParameterizedType":
      return parseParameterizedType(commentsMap, node, parentKey, sourceText);
    case "IndexedType":
      return parseIndexedType(node, parentKey, sourceText);
    case "ArrayType":
      return parseArrayType(commentsMap, node, parentKey, sourceText);
    case "UnionType":
      return parseUnionType(commentsMap, node, parentKey, sourceText);
    case "LiteralType":
      return parseLiteralType(node, parentKey, sourceText);
    case "NullType":
      return { kind: "literal", key: parentKey, type: null };
    case "ObjectType":
      return parseObjectType(commentsMap, node, parentKey, sourceText);
    case "FunctionSignature":
      return parseFunctionSignature(commentsMap, node, parentKey, sourceText);
    case "InterfaceDeclaration":
      return parseInterfaceDeclaration(
        commentsMap,
        node,
        parentKey,
        sourceText,
      );
    case "TypeAliasDeclaration":
      return parseTypeAliasDeclaration(
        commentsMap,
        node,
        parentKey,
        sourceText,
      );
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
  commentsMap: CommentsMap,
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
        parseNode(
          commentsMap,
          param,
          `${parentKey}.params.${index}`,
          sourceText,
        )
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
  commentsMap: CommentsMap,
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  return {
    kind: "array",
    key: parentKey,
    items: parseNode(
      commentsMap,
      requiredType(node, "element"),
      `${parentKey}.items`,
      sourceText,
    ),
  };
}

function parseUnionType(
  commentsMap: CommentsMap,
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
      type: parseNode(
        commentsMap,
        subTypes[0],
        `${parentKey}.type`,
        sourceText,
      ),
    };
  }
  const types: TStructure[] = subTypes.map((typeNode, i) =>
    parseNode(commentsMap, typeNode, `${parentKey}.${i}`, sourceText)
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
  commentsMap: CommentsMap,
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
): TStructure {
  return {
    kind: "object",
    key: parentKey,
    properties: parseMembers(commentsMap, node, parentKey, sourceText, false),
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
  commentsMap: CommentsMap,
  node: SyntaxNode,
  parentKey: string,
  sourceText: string,
  interfaceContext: boolean,
): TStructureObjectProperty[] {
  const properties: TStructureObjectProperty[] = [];
  for (const member of children(node)) {
    const name = member.type.name;
    if (name === "PropertyType") {
      properties.push(
        parsePropertyType(commentsMap, member, parentKey, sourceText),
      );
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
  commentsMap: CommentsMap,
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
    structure: parseNode(commentsMap, valueNode, propKey, sourceText),
    optional: hasChild(member, "Optional"),
    comment: commentsMap.get(member.from),
  };
}

function parseFunctionSignature(
  commentsMap: CommentsMap,
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
      | {
        name: string;
        optional: boolean;
        type: SyntaxNode | null;
        node: SyntaxNode;
      }
      | null = null;
    for (const part of children(paramList)) {
      const name = part.type.name;
      if (name === "VariableDefinition") {
        if (param) {
          argumentsStruct.arguments.push(
            flushParam(commentsMap, param, argsKey, sourceText),
          );
        }
        param = {
          name: textOf(part, sourceText),
          optional: false,
          type: null,
          node: part,
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
      argumentsStruct.arguments.push(
        flushParam(commentsMap, param, argsKey, sourceText),
      );
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
    returns: parseNode(
      commentsMap,
      returnsNode,
      `${parentKey}.returns`,
      sourceText,
    ),
  };
}

function flushParam(
  commentsMap: CommentsMap,
  param: {
    name: string;
    optional: boolean;
    type: SyntaxNode | null;
    node: SyntaxNode;
  },
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
      commentsMap,
      type,
      argKey,
      sourceText,
    ) as TFunctionArgumentStructure,
    optional: param.optional,
    comment: commentsMap.get(param.node.from),
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
  commentsMap: CommentsMap,
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
    type: parseNode(commentsMap, valueNode, `${key}.type`, sourceText),
    parameters: parseTypeParameters(node, sourceText),
    comment: commentsMap.get(node.from),
  };
}

function parseInterfaceDeclaration(
  commentsMap: CommentsMap,
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
    properties.push(...parseMembers(commentsMap, body, key, sourceText, true));
  }
  return {
    kind: "interface",
    key,
    name,
    properties,
    parameters: parseTypeParameters(node, sourceText),
    comment: commentsMap.get(node.from),
  };
}
