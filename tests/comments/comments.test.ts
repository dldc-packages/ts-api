import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import {
  extractApi,
  parse,
  ROOT,
  type TRootStructure,
} from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type { Graph } from "./schema.ts";

const graph = parse<{ Graph: Graph }>(
  loadSchema(resolve("./tests/comments/schema.ts")),
);

function inter(root: TRootStructure, name: string) {
  const t = root.types.find((s) => s.name === name);
  if (!t || t.kind !== "interface") {
    throw new Error(`No interface named "${name}"`);
  }
  return t;
}

function prop(
  i: ReturnType<typeof inter>,
  name: string,
) {
  const p = i.properties.find((x) => x.name === name);
  if (!p) {
    throw new Error(`No property "${name}"`);
  }
  return p;
}

Deno.test("Parse schema with comments", async (test) => {
  await test.assertSnapshot(graph[ROOT]);
});

Deno.test("comments: top-level declarations get their leading comment", () => {
  const root = graph[ROOT] as TRootStructure;

  const role = root.types.find((s) => s.name === "Role")!;
  assertEquals(role.comment, "A single-line JSDoc comment");

  assertEquals(inter(root, "User").comment, "User of the system");
  assertEquals(inter(root, "Group").comment, "Group of users");
  assertEquals(inter(root, "Graph").comment, "Main Graph entry");
});

Deno.test("comments: property comments across all comment styles", () => {
  const root = graph[ROOT] as TRootStructure;
  const user = inter(root, "User");

  // plain single-line block
  assertEquals(prop(user, "age").comment, "Single line comment");
  // plain multi-line block (alignment dedented)
  assertEquals(prop(user, "group").comment, "Inline multi-line\ncomment");
  // run of line comments
  assertEquals(
    prop(user, "maybeGroup").comment,
    "Multiple\nsingle line\ncomments",
  );
  // multi-line JSDoc with markdown bullets
  assertEquals(prop(user, "tags").comment, "list:\n- one\n- two");
  // single-line JSDoc
  assertEquals(prop(user, "label").comment, "Inline single-line JSDoc");
  // plain block without stars
  assertEquals(prop(user, "code").comment, "Block comment without JSDoc stars");
  // line comment
  assertEquals(
    prop(inter(root, "Group"), "users").comment,
    "line comment for the users property",
  );
});

Deno.test("comments: modifiers and nested objects keep their doc", () => {
  const root = graph[ROOT] as TRootStructure;
  const wm = inter(root, "WithModifiers");

  assertEquals(prop(wm, "id").comment, "readonly property");
  assertEquals(prop(wm, "label").comment, "optional property");
  assertEquals(prop(wm, "lookup").comment, "endpoint property");
  assertEquals(prop(wm, "config").comment, "nested inline object");

  const config = prop(wm, "config").structure;
  assertEquals(config.kind, "object");
  if (config.kind === "object") {
    assertEquals(
      config.properties.find((p) => p.name === "enabled")?.comment,
      "inner property of the inline object",
    );
  }
});

Deno.test("comments: trailing comments are not doc comments", () => {
  const root = graph[ROOT] as TRootStructure;
  const wt = inter(root, "WithTrailing");

  assertEquals(prop(wt, "first").comment, undefined);
  assertEquals(prop(wt, "second").comment, undefined);
  assertEquals(prop(wt, "third").comment, undefined);
});

Deno.test("comments: the closest comment block wins", () => {
  const root = graph[ROOT] as TRootStructure;
  const s = inter(root, "Separated");

  assertEquals(prop(s, "prop").comment, "second, closer comment");
});

Deno.test("comments: a dangling comment does not leak to the next declaration", () => {
  const root = graph[ROOT] as TRootStructure;

  assertEquals(
    inter(root, "Dangling").comment,
    "A dangling comment before the closing brace must not leak",
  );
  assertEquals(inter(root, "AfterDangling").comment, undefined);
});

Deno.test("comments: exposed via extractApi", () => {
  const api = extractApi(graph, ["Graph"]);

  // root namespace comment comes from the entry declaration
  assertEquals(api.entries[0].kind, "namespace");
  assertEquals(api.entries[0].name, "Graph");
  assertEquals(api.entries[0].comment, "Main Graph entry");

  const endpoint = (name: string) => {
    const node = api.entries[0].children.find((c) => c.name === name);
    if (!node || node.kind !== "endpoint") {
      throw new Error(`no endpoint ${name}`);
    }
    return node;
  };
  const namespace = (name: string) => {
    const node = api.entries[0].children.find((c) => c.name === name);
    if (!node || node.kind !== "namespace") {
      throw new Error(`no namespace ${name}`);
    }
    return node;
  };

  // endpoint comments
  assertEquals(endpoint("group").comment, "Retrieves the main group");
  assertEquals(endpoint("login").comment, "Logs a user in");

  // argument comments
  assertEquals(endpoint("login").arguments[1].comment, "the password");
  assertEquals(endpoint("login").arguments[0].comment, undefined);

  // namespace comments (the property comment where it is referenced)
  const admin = namespace("admin");
  assertEquals(admin.comment, "Administration endpoints");
  const wipe = admin.children.find((c) => c.name === "wipe");
  if (!wipe || wipe.kind !== "endpoint") throw new Error("no endpoint wipe");
  assertEquals(wipe.comment, "Deletes everything");

  // type declaration comments
  const type = (name: string) => api.types.find((t) => t.name === name)!;
  assertEquals(type("Graph").comment, "Main Graph entry");
  assertEquals(type("Role").comment, "A single-line JSDoc comment");
  assertEquals(type("User").comment, "User of the system");

  // property comments on type declarations
  const usersProp = type("Group").properties!.find((p) => p.name === "users")!;
  assertEquals(usersProp.comment, "line comment for the users property");

  // code fences survive in endpoint comments
  assertEquals(
    endpoint("version").comment,
    "```ts\nconst v = Graph.version();\n```",
  );

  // nodes without comments always carry the field, with an undefined value
  const withTrailingFirst = type("WithTrailing").properties![0];
  assertEquals(withTrailingFirst.comment, undefined);
  assertEquals("comment" in withTrailingFirst, true);
  const username = endpoint("login").arguments[0];
  assertEquals(username.comment, undefined);
  assertEquals("comment" in username, true);
});
