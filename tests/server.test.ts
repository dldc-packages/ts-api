import { assertExists } from "@std/assert";
import { resolve } from "@std/path";
import { parse } from "../server.ts";
import type { TodoListTypes } from "./schemas/todolist.types.ts";

Deno.test("parseSchema", () => {
  const schema = parse<TodoListTypes>(
    resolve("./tests/schemas/todolist.ts"),
  );

  assertExists(schema);
});
