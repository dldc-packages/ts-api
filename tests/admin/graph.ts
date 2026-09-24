/**
 * A generic "marker" type. Attaching a resolver to `graph.Admin` applies
 * to *every* property typed `Admin<...>` in the graph.
 *
 * NOTE: return types must not use `void` (parse rejects it), so endpoints
 * return `null` instead.
 */
export type Admin<T> = T;

export interface Graph {
  status: () => string;

  users: {
    create: () => null;
    admin: Admin<{ delete: () => null }>;
  };

  posts: {
    create: () => null;
    publish: (title: string) => string;
    admin: Admin<{
      delete: () => null;
      pin: (id: number) => null;
    }>;
  };

  files: {
    admin: Admin<() => null>;
    rename: Admin<(id: number, name: string) => null>;
  };
}
