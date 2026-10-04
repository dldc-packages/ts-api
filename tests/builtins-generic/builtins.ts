/**
 * A generic opaque type. ts-api can't introspect it (it's imported, never
 * followed), so it must be registered as a builtin whose `getSchema` receives
 * the schemas of the generic type arguments.
 */
export type Page<T> = {
  items: T[];
  cursor: string;
};
