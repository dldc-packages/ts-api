import type { Page } from "./builtins.ts";

export interface Todo {
  title: string;
  done: boolean;
}

/**
 * A declared generic type, used to exercise mixed nesting: a generic builtin
 * (`Page`) as a type argument of a declared generic, and vice versa.
 */
export interface Box<T> {
  value: T;
  label: string;
}

export interface Graph {
  /**
   * Generic builtin as an output, parameter is a declared interface.
   */
  todos: () => Page<Todo>;
  /**
   * Generic builtin as an input.
   */
  pageOfStrings: (page: Page<string>) => number;
  /**
   * Nested generic builtin.
   */
  nested: () => Page<Page<number>>;
  /**
   * Generic builtin parameter that is another generic declared type.
   */
  pageOfMaybeTodo: () => Page<Todo | null>;
  /**
   * Nested declared generic.
   */
  nestedBox: () => Box<Box<Todo>>;
  /**
   * Mixed: generic builtin nested inside a declared generic.
   */
  boxOfPage: () => Box<Page<Todo>>;
  /**
   * Mixed: declared generic nested inside a generic builtin.
   */
  pageOfBoxedTodo: () => Page<Box<Todo>>;
}
