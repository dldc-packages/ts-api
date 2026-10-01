import { assertEquals } from "@std/assert";
import {
  normalizeComment,
  type TCommentSource,
} from "../../src/utils/comment.ts";

function block(content: string): TCommentSource {
  return { type: "BlockComment", content };
}

function line(...contents: string[]): TCommentSource {
  return { type: "LineComment", content: contents };
}

// ---------------------------------------------------------------------------
// Block comments: delimiters, decorator stars, line endings, whitespace
// ---------------------------------------------------------------------------

Deno.test("comment: block single-line JSDoc", () => {
  assertEquals(normalizeComment(block("/** hello */")), "hello");
});

Deno.test("comment: block single-line plain", () => {
  assertEquals(normalizeComment(block("/* hello */")), "hello");
});

Deno.test("comment: block single-line with extra leading star", () => {
  assertEquals(normalizeComment(block("/*** hello */")), "hello");
});

Deno.test("comment: block classic multi-line JSDoc", () => {
  assertEquals(
    normalizeComment(block("/**\n * hello\n */")),
    "hello",
  );
});

Deno.test("comment: block multi-line JSDoc without space after star", () => {
  assertEquals(
    normalizeComment(block("/**\n *hello\n */")),
    "hello",
  );
});

Deno.test("comment: block preserves indentation on inner lines", () => {
  assertEquals(
    normalizeComment(block("/**\n * a\n *   indented\n */")),
    "a\n  indented",
  );
});

Deno.test("comment: block tab after the decorator star is stripped", () => {
  assertEquals(
    normalizeComment(block("/**\n *\thello\n */")),
    "hello",
  );
});

Deno.test("comment: block multi-line without decorator stars", () => {
  assertEquals(
    normalizeComment(block("/*\nhello\nworld\n*/")),
    "hello\nworld",
  );
});

Deno.test("comment: block blank line in the middle is preserved", () => {
  assertEquals(
    normalizeComment(block("/**\n * a\n *\n * b\n */")),
    "a\n\nb",
  );
});

Deno.test("comment: block leading blank doc line is dropped", () => {
  assertEquals(
    normalizeComment(block("/**\n *\n * b\n */")),
    "b",
  );
});

Deno.test("comment: block trailing blank doc line is dropped", () => {
  assertEquals(
    normalizeComment(block("/**\n * a\n *\n */")),
    "a",
  );
});

Deno.test("comment: block keeps Markdown bullets", () => {
  assertEquals(
    normalizeComment(block("/**\n * list:\n * - one\n * - two\n */")),
    "list:\n- one\n- two",
  );
});

Deno.test("comment: block keeps star Markdown bullets", () => {
  assertEquals(
    normalizeComment(block("/**\n * * one\n * * two\n */")),
    "* one\n* two",
  );
});

Deno.test("comment: block keeps code fences", () => {
  assertEquals(
    normalizeComment(block("/**\n * ```ts\n * const x = 1\n * ```\n */")),
    "```ts\nconst x = 1\n```",
  );
});

Deno.test("comment: block CRLF line endings are normalized", () => {
  assertEquals(
    normalizeComment(block("/**\r\n * a\r\n */")),
    "a",
  );
});

Deno.test("comment: block interior trailing whitespace is preserved", () => {
  assertEquals(
    normalizeComment(block("/**\n * a   \n * b\n */")),
    "a   \nb",
  );
});

Deno.test("comment: block with summary on the opening line", () => {
  // Non-uniform layout: neither the star layout nor the plain layout applies
  // cleanly. The decorator line is not a star-layout line, and alignment is
  // dedented; content is kept otherwise.
  assertEquals(
    normalizeComment(block("/** summary\n * more\n */")),
    "summary\n* more",
  );
});

// Plain layout (no decorator stars): continuation indentation is alignment

Deno.test("comment: plain block continuation indentation is collapsed", () => {
  assertEquals(
    normalizeComment(block("/* Inline multi-line\n     comment */")),
    "Inline multi-line\ncomment",
  );
});

Deno.test("comment: plain block aligned continuation lines", () => {
  assertEquals(
    normalizeComment(block("/* first\n  second\n  third */")),
    "first\nsecond\nthird",
  );
});

Deno.test("comment: plain block keeps relative indentation", () => {
  assertEquals(
    normalizeComment(block("/* first\n  a\n    b */")),
    "first\na\n  b",
  );
});

Deno.test("comment: plain block continuation with deeper nested line", () => {
  assertEquals(
    normalizeComment(
      block("/* outter\n     indented\n       deeper\n   same */"),
    ),
    "outter\n  indented\n    deeper\nsame",
  );
});

Deno.test("comment: plain block single line keeps content", () => {
  assertEquals(normalizeComment(block("/* not jsdoc */")), "not jsdoc");
});

Deno.test("comment: block empty", () => {
  assertEquals(normalizeComment(block("/* */")), "");
});

Deno.test("comment: block fully empty content", () => {
  assertEquals(normalizeComment(block("")), "");
});

// ---------------------------------------------------------------------------
// Line comments: delimiter, runs, indentation, trailing whitespace
// ---------------------------------------------------------------------------

Deno.test("comment: line single", () => {
  assertEquals(normalizeComment(line("// hello")), "hello");
});

Deno.test("comment: line without space after slashes", () => {
  assertEquals(normalizeComment(line("//hello")), "hello");
});

Deno.test("comment: line run is merged", () => {
  assertEquals(normalizeComment(line("// a", "// b")), "a\nb");
});

Deno.test("comment: line indentation on inner lines is preserved", () => {
  assertEquals(normalizeComment(line("// a", "//   b")), "a\n  b");
});

Deno.test("comment: line tab after slashes is stripped", () => {
  assertEquals(normalizeComment(line("//\ta")), "a");
});

Deno.test("comment: line shared trailing whitespace is removed", () => {
  assertEquals(
    normalizeComment(line("// a   ", "// b   ")),
    "a\nb",
  );
});

Deno.test("comment: line non-shared trailing whitespace is preserved", () => {
  assertEquals(
    normalizeComment(line("// a   ", "// b")),
    "a   \nb",
  );
});

Deno.test("comment: line empty comment lines are dropped", () => {
  assertEquals(normalizeComment(line("//", "// x")), "x");
});

Deno.test("comment: line blank line in the middle is preserved", () => {
  assertEquals(normalizeComment(line("// a", "//", "// c")), "a\n\nc");
});

Deno.test("comment: line CRLF line endings are normalized", () => {
  assertEquals(normalizeComment(line("// a\r", "// b\r")), "a\nb");
});
