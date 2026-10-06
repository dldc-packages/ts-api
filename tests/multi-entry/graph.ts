/**
 * The public API tree. One of the schema's entries.
 */
export interface Public {
  /** The server version. */
  version: () => string;
  /** The current user's own profile. */
  me: () => User;
  /** Search the catalog. */
  search: (q: string) => Results;
}

/**
 * The admin API tree. A second entry, served alongside `Public`.
 */
export interface Admin {
  users: {
    /** List all users. */
    list: () => User[];
    /** Fetch a single user by id. */
    byId: (id: string) => User;
  };
  /** Aggregate statistics. */
  stats: () => Stats;
}

export interface User {
  id: string;
  name: string;
}

export interface Results {
  total: number;
  items: string[];
}

export interface Stats {
  count: number;
}
