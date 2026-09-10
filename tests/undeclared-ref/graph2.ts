import type { BothType, InputType, OutputType } from "./types.ts";

export interface Graph2 {
  inputOnly: (x: InputType) => string;
  outputOnly: () => OutputType;
  both: (x: BothType) => BothType;
}
