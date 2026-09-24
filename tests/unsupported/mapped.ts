/**
 * Unsupported syntax: mapped type (`K in keyof`).
 */
export interface Item {
  name: string;
}

export type MaybePartial = { [K in keyof Item]?: Item[K] };

export interface Graph {
  get: () => MaybePartial;
}
