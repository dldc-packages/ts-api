/** A single-line JSDoc comment */
export type Role = "admin" | "user";

/**
 * User of the system
 */
interface User {
  name: string;
  /* Single line comment */
  age: number | null;
  /* Inline multi-line
     comment */
  group: Group;
  // Multiple
  // single line
  // comments
  maybeGroup: Group | null;
  /**
   * list:
   * - one
   * - two
   */
  tags: string[];
  /** Inline single-line JSDoc */
  label: string;
  /* Block comment without JSDoc stars */
  code: string;
}

/**
 * Group of users
 */
export interface Group {
  name: string;
  // line comment for the users property
  users: User[];
}

/**
 * Main Graph entry
 */
export interface Graph {
  /**
   * Retrieves the main group
   */
  group: () => Group;
  /**
   * Retrieves the main user
   */
  user: () => User;
  /**
   * Retrieves a random item, which can be either a user or a group
   */
  readonly randomItem: () => User | Group;
  /**
   * ```ts
   * const v = Graph.version();
   * ```
   */
  version: () => string;
  /**
   * Administration endpoints
   */
  admin: {
    /** Deletes everything */
    wipe: () => null;
  };
  /**
   * Logs a user in
   */
  login: (
    username: string,
    /** the password */
    password: string,
  ) => boolean;
}

/** Modifiers on properties keep their own doc comments */
interface WithModifiers {
  /** readonly property */
  readonly id: string;
  /** optional property */
  label?: string;
  /** endpoint property */
  lookup: (id: string) => string;
  /** nested inline object */
  config: {
    /** inner property of the inline object */
    enabled: boolean;
  };
}

/**
 * A trailing comment after code on the same line is not a doc comment.
 */
interface WithTrailing {
  first: string; // trailing on first — must not reach `second`
  second?: string;
  third: string;
}

/** When several comment blocks pile up, the closest one applies */
interface Separated {
  // first comment
  /** second, closer comment */
  prop: string;
}

/** A dangling comment before the closing brace must not leak */
interface Dangling {
  a: string;
  // dangling
}

interface AfterDangling {
  b: string;
}
