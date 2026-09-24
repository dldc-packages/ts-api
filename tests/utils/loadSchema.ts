import { readSchemaFile } from "../../src/server/filesystem.ts";

/**
 * Read a schema file for parsing.
 *
 * Tests intentionally load schema files through the package's own filesystem
 * subpath (`readSchemaFile`) so the server-side file-loading path stays
 * covered, while `parse` itself is exercised with a plain source string.
 */
export function loadSchema(path: string): string {
  return readSchemaFile(path);
}
