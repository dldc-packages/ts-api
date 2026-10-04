import type { Tree } from "@lezer/common";
import { normalizeComment, type TCommentSource } from "../../utils/comment.ts";
import { startsLine, textOf } from "./utils.ts";

// Map node "from" position to comment
export type CommentsMap = Map<number, string | undefined>;

const SKIPPED_NODE_TYPES = new Set(["ExportDeclaration", "export", ";"]);

/**
 * Builds a map of node -> comment from the given syntax tree.
 */
export function buildCommentsMap(
  sourceText: string,
  tree: Tree,
): CommentsMap {
  const commentsMap: CommentsMap = new Map();
  const cursor = tree.cursor();
  // traverse all node sequentially to build the comments map
  let comment: TCommentSource | null = null;
  do {
    const node = cursor.node;
    if (node.type.name === "BlockComment" || node.type.name === "LineComment") {
      if (!startsLine(sourceText, node.from)) {
        // A comment that shares its line with preceding code (e.g.
        // `name: string; // stays here`) is a trailing comment: it documents
        // the previous line, not the next declaration, so it is dropped.
        comment = null;
      } else if (node.type.name === "BlockComment") {
        comment = { type: "BlockComment", content: textOf(node, sourceText) };
      } else if (comment && comment.type === "LineComment") {
        comment.content.push(textOf(node, sourceText));
      } else {
        comment = { type: "LineComment", content: [textOf(node, sourceText)] };
      }
      continue;
    }
    if (!comment) {
      continue;
    }
    commentsMap.set(node.from, normalizeComment(comment));
    if (SKIPPED_NODE_TYPES.has(node.type.name)) {
      // Don't reset the comment to also assign the comment to the next relevant node
      continue;
    }
    comment = null;
  } while (cursor.next());

  return commentsMap;
}
