export interface Paginated<T> {
  data: T[];
  total: number;
}

export interface TodoItem {
  name: string;
  done: boolean;
}

export interface ListParams<T> {
  filter?: T;
  page?: number;
}

export type BaseFn<Result> = (num: number) => Result;

export interface Graph {
  todos: () => Paginated<TodoItem>;
  nested: (num: number) => TodoItem;
  createMany: (items: Paginated<TodoItem>) => TodoItem[];
  search: (params: ListParams<string>) => TodoItem[];
}
