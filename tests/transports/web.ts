import type {
  MutationResult,
  QueryResult,
  StreamResult,
} from "../../src/transports/web/types.ts";

export interface Todo {
  todoName: string;
  done: boolean;
}

export interface Graph {
  aQuery: (foo: string, bar: number) => QueryResult<Todo>;
  longQuery: (a: string, b: string, c: string) => QueryResult<string>;
  aMutation: (id: string) => MutationResult<boolean>;
  aStream: (topic: string) => StreamResult<number>;
}
