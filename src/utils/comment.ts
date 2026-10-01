/**
 * A raw comment as gathered from the source, before any normalization.
 *
 * - `BlockComment`: the raw text of a block comment — from the opening `/*` or
 *   `/**` through the closing `\*\/` — delimiters included.
 * - `LineComment`: the raw texts of one or more consecutive `//` line
 *   comments, delimiters included.
 *
 * @internal
 */
export type TCommentSource =
  | { type: "BlockComment"; content: string }
  | { type: "LineComment"; content: string[] };

/**
 * Turn a raw comment into plain documentation text.
 *
 * Block comments (opening `/*` or `/**` through closing `\*\/`):
 *
 * - Line endings are normalized to `\n`.
 * - The opening `/*` / `/**` and the closing `\*\/` are removed.
 * - Leading and trailing empty lines are dropped (the closing `\*\/` often
 *   sits on its own line, leaving an empty line behind).
 * - **Star layout** (every line starts with a decorator `*`, the classic JSDoc
 *   style): the star — plus a single space after it — is removed, preserving
 *   any deeper indentation (so ` *   foo` keeps its extra spaces, e.g. code
 *   blocks in `@example` tags). This also keeps Markdown bullets (`- item`,
 *   `* item`) intact, as only the very first `*` of each line is a decorator.
 * - **Plain layout** (no decorator stars): continuation lines are indented to
 *   align under the first line's text (they have no `*` anchor), so their
 *   common leading whitespace is pure formatting. It is dropped, and any extra
 *   (relative) indentation is kept: `/* a\n··b\n····c \*\/` → `a\nb\n··c`.
 *
 * Line comments (`// ...`):
 *
 * - `//` (plus one optional space) is removed from each line.
 * - A run of consecutive lines is merged with `\n`.
 * - Trailing whitespace shared by every line is removed (aligned comments stay
 *   aligned).
 *
 * @internal
 */
export function normalizeComment(comment: TCommentSource): string {
  if (comment.type === "BlockComment") {
    return normalizeBlockComment(comment.content);
  }
  return normalizeLineComment(comment.content);
}

function normalizeLineComment(contents: string[]): string {
  // Remove `//` (and one optional space) from each line.
  const lines = contents.map((line) => line.replace(/^\/\/\s?/, ""));
  // Remove the trailing whitespace shared by every line, so that aligned
  // comments (`// foo   ` / `// bar   `) stay aligned after extraction.
  const minTrailingWhitespace = Math.min(
    ...lines.map((line) => line.match(/\s*$/)?.[0].length ?? 0),
  );
  return lines
    .map((line) => line.slice(0, line.length - minTrailingWhitespace))
    .join("\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

function normalizeBlockComment(raw: string): string {
  // Normalize line endings, then strip the opening `/*` / `/**` and the
  // closing `\*\/`.
  const body = raw
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*\/\*+/, "")
    .replace(/\*\/\s*$/, "");
  // The closing `\*\/` often sits on its own line, which leaves a trailing
  // empty line behind: drop empty lines at both ends.
  const lines = dropOuterEmpty(body.split("\n"));
  if (lines.length === 0) {
    return "";
  }
  // Classic JSDoc layout: every line starts with a decorator `*`. Remove the
  // star and the single space after it, but preserve any deeper indentation
  // (` *   code` keeps its extra spaces).
  if (lines.every((line) => line.trim().startsWith("*"))) {
    return dropOuterEmpty(
      lines.map((line) => line.replace(/^\s*\*\s?/, "")),
    ).join("\n").trim();
  }
  // Plain layout: continuation lines are indented to align under the first
  // line's text (they have no `*` anchor), so their common leading whitespace
  // is pure formatting. Drop it, keeping any extra relative indentation.
  const [first, ...rest] = lines;
  const indents = rest
    .filter((line) => line.trim() !== "")
    .map((line) => leadingWhitespaceLength(line));
  const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return [first, ...rest.map((line) => line.slice(commonIndent))].join("\n")
    .trim();
}

/** Length of the leading whitespace of a line. */
function leadingWhitespaceLength(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

/** Copy of the lines array with leading/trailing empty lines removed. */
function dropOuterEmpty(lines: string[]): string[] {
  const out = lines.slice();
  while (out.length > 0 && out[0].trim() === "") out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return out;
}
