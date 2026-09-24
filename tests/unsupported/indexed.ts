/**
 * Unsupported syntax: indexed access type (`T["k"]`).
 */
export interface Item {
  name: string;
}

export interface Graph {
  get: () => Item["name"];
}
