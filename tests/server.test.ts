import { assertExists } from "@std/assert";
import { resolve } from "@std/path";
import { parse } from "../src/server/mod.ts";
import { loadSchema } from "./utils/loadSchema.ts";
import type { TodoListTypes } from "./schemas/todolist.types.ts";

Deno.test("parseSchema", () => {
  const schema = parse<TodoListTypes>(
    loadSchema(resolve("./tests/schemas/todolist.ts")),
  );

  assertExists(schema);
});
