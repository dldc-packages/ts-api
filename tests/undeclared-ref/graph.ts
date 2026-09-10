import type { ImportedType } from "./types.ts";

export interface Graph {
  value: ImportedType;
  items: ImportedType[];
  get: () => ImportedType;
  echo: (value: ImportedType) => string;
}
