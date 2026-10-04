import type { SyntaxNode } from "@lezer/common";
import type { TRootStructure, TTopLevelStructure } from "../structure.types.ts";

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
export const TYPE_NODE_NAMES = new Set([
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

// `TypeName` is Lezer's catch-all name for both primitive keywords and plain
// type references. Keywords the compiler would represent differently are
// explicitly rejected, matching the previous ts-morph behaviour.
export const TS_KEYWORDS: Record<string, string | undefined> = {
  any: "AnyKeyword",
  unknown: "UnknownKeyword",
  never: "NeverKeyword",
  undefined: "UndefinedKeyword",
  object: "ObjectKeyword",
  symbol: "SymbolKeyword",
  bigint: "BigIntKeyword",
  this: "ThisType",
};

/** All children, including anonymous tokens, in source order. */
export function children(node: SyntaxNode): SyntaxNode[] {
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

/** The first direct child that is a type node, if any. */
export function typeChild(node: SyntaxNode): SyntaxNode | undefined {
  return children(node).find((c) => TYPE_NODE_NAMES.has(c.type.name));
}

export function childByName(
  node: SyntaxNode,
  name: string,
): SyntaxNode | undefined {
  return children(node).find((n) => n.type.name === name);
}

export function hasChild(node: SyntaxNode, name: string): boolean {
  return children(node).some((n) => n.type.name === name);
}

export function textOf(node: SyntaxNode, sourceText: string): string {
  return sourceText.slice(node.from, node.to);
}

/** 1-based line number of the start of a node. */
export function lineAt(node: SyntaxNode, sourceText: string): number {
  let line = 1;
  const end = Math.min(node.from, sourceText.length);
  for (let i = 0; i < end; i++) {
    if (sourceText.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

export function throwUnknown(
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
export function unquote(raw: string): string {
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

export function requiredType(node: SyntaxNode, label: string): SyntaxNode {
  const child = typeChild(node);
  if (!child) {
    throw new Error(`Expected a ${label} type for ${node.type.name}`);
  }
  return child;
}

export function findType(
  rootStructure: TRootStructure,
  name: string,
): TTopLevelStructure | undefined {
  return rootStructure.types.find((t) => t.name === name);
}

/**
 * Whether `pos` sits at the beginning of a line (only spaces/tabs before it on
 * that line). Used to tell leading doc comments (`/** ...`) from trailing
 * comments (`// ...` after code on the same line).
 */
export function startsLine(sourceText: string, pos: number): boolean {
  const lineStart = sourceText.lastIndexOf("\n", pos - 1) + 1;
  for (let i = lineStart; i < pos; i++) {
    const code = sourceText.charCodeAt(i);
    if (code !== 32 && code !== 9) {
      return false;
    }
  }
  return true;
}
