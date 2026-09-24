import type { ImportedType } from "./types.ts";

export interface Graph {
  get: () => ImportedType;
  echo: (value: ImportedType) => string;
}
