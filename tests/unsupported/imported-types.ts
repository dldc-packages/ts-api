/**
 * Types imported by the unsupported-pattern fixtures.
 *
 * These are opaque to ts-api: it never follows imports, so each must be
 * registered as a builtin when used as data.
 */
export interface UsersNamespace {
  list: () => string;
}

export interface Settings {
  theme: string;
}

export type Token = string;
