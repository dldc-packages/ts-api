export interface Foo {
  name: string;
  done: boolean;
}

export interface Graph {
  /**
   * `Array<Foo>` used as a response (return) type.
   */
  list: () => Array<Foo>;
  /**
   * `Array<Foo>` used as a request (argument) type.
   */
  count: (items: Array<Foo>) => number;
}
