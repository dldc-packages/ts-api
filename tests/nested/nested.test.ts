import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../src/client/mod.ts";
import { createEngine, fn, parse } from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type { Family, Graph, Member } from "./graph.ts";

interface AllTypes {
  Graph: Graph;
  Family: Family;
  Member: Member;
}

const graph = parse<AllTypes>(
  loadSchema(resolve("./tests/nested/graph.ts")),
);

const client = query<AllTypes>();

interface TMemberDbItem {
  id: string;
  name: string;
  familyId: string;
}

interface TFamilyDbItem {
  id: string;
  name: string;
}

const db = {
  families: {
    "f1": { id: "f1", name: "Smith" },
    "f2": { id: "f2", name: "Doe" },
  } as Record<string, TFamilyDbItem>,
  members: {
    "m1": { id: "m1", name: "John", familyId: "f1" },
    "m2": { id: "m2", name: "Jane", familyId: "f2" },
    "m3": { id: "m3", name: "Alice", familyId: "f1" },
  } as Record<string, TMemberDbItem>,
};

Deno.test("Resolve basic list", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(
        graph.Graph.members,
        () => {
          const members = Object.values(db.members);
          return members.map((member) => ({
            id: member.id,
            name: member.name,
            nameUpper: member.name.toUpperCase(),
            family: db.families[member.familyId],
            emails: [],
          }));
        },
      ),
    ],
  });

  const q = client.Graph.members();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, [
    {
      id: "m1",
      name: "John",
      nameUpper: "JOHN",
      family: { id: "f1", name: "Smith" },
      emails: [],
    },
    {
      id: "m2",
      name: "Jane",
      nameUpper: "JANE",
      family: { id: "f2", name: "Doe" },
      emails: [],
    },
    {
      id: "m3",
      name: "Alice",
      nameUpper: "ALICE",
      family: { id: "f1", name: "Smith" },
      emails: [],
    },
  ]);
});

Deno.test("Resolve single member", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(
        graph.Graph.member,
        () => {
          const member = db.members["m1"];
          return {
            id: member.id,
            name: member.name,
            nameUpper: member.name.toUpperCase(),
            family: db.families[member.familyId],
            emails: ["john@example.com"],
          };
        },
      ),
    ],
  });

  const q = client.Graph.member();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, {
    id: "m1",
    name: "John",
    nameUpper: "JOHN",
    family: { id: "f1", name: "Smith" },
    emails: ["john@example.com"],
  });
});

Deno.test("Resolve family", async () => {
  const engine = createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(
        graph.Graph.family,
        () => db.families["f1"],
      ),
    ],
  });

  const q = client.Graph.family();
  const { path: queryDef, args: variables } = queryToObject(q);
  const result = await engine.run({ path: queryDef, args: variables });
  assertEquals(result, { id: "f1", name: "Smith" });
});
