/**
 * Supported pattern: imported types used purely as data.
 * - `Settings` / `Token` as fields of a non-namespace interface (`User`)
 * - `Token` as function input and output
 */
import type { Settings, Token } from "./imported-types.ts";

export interface User {
  settings: Settings;
  token: Token | null;
}

export interface Graph {
  get: () => User;
  echo: (value: Token) => string;
}
