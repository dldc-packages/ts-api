export type Role = "admin" | "user";

export interface User {
  name: string;
  age: number | null;
  group: Group;
  maybeGroup: Group | null;
}

export interface Group {
  name: string;
  users: string[];
}

export interface Graph {
  group: () => Group;
  user: () => User;
  randomItem: () => User | Group;
}
