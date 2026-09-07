import type {
  Graph,
  MixedLiterals,
  NumericLiterals,
  StringWithEscapes,
} from "./graph.ts";

export interface LiteralTypes {
  Graph: Graph;
  StringWithEscapes: StringWithEscapes;
  NumericLiterals: NumericLiterals;
  MixedLiterals: MixedLiterals;
}
