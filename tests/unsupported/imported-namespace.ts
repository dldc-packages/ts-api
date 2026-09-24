/**
 * Unsupported pattern: an imported type used to build the graph tree
 * (`users` is a namespace property whose value is imported).
 */
import type { UsersNamespace } from "./imported-types.ts";

export interface Graph {
  users: UsersNamespace;
  version: () => string;
}
