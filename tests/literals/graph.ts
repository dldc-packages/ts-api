export type StringWithEscapes =
  | "hello\nworld"
  | "emoji\uD83D\uDE00"
  | "tab\there";
export type NumericLiterals = 42 | 0 | -7;
export type MixedLiterals = "admin" | 200 | true | false | null;

export interface Graph {
  stringWithEscapes: () => StringWithEscapes;
  numericLiterals: () => NumericLiterals;
  mixedLiterals: () => MixedLiterals;
}
