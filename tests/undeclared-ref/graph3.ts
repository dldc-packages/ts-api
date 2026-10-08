import type { ImportedGeneric } from "./types.ts";

export interface Foo {
  name: string;
}

export interface Graph3 {
  list: () => ImportedGeneric<Foo>;
  count: (items: ImportedGeneric<Foo>) => number;
}
