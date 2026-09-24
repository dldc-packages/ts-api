import { assertEquals, assertNotEquals, assertThrows } from "@std/assert";
import { resolve } from "@std/path";
import { query, queryToObject } from "../../src/client/mod.ts";
import {
  createEngine,
  extractApi,
  fn,
  getStructure,
  parse,
  type TMissingBuiltinAction,
  type TMissingBuiltinActionConfig,
} from "../../src/server/mod.ts";
import { loadSchema } from "../utils/loadSchema.ts";
import type { Graph } from "./graph.ts";
import type { Graph2 } from "./graph2.ts";

interface AllTypes {
  Graph: Graph;
}

interface AllTypes2 {
  Graph2: Graph2;
}

const client = query<AllTypes>();

// The type is imported and used in the graph, but never declared as a builtin.
function parseWith(
  action: TMissingBuiltinAction | TMissingBuiltinActionConfig = "throw",
) {
  return parse<AllTypes>(
    loadSchema(resolve("./tests/undeclared-ref/graph.ts")),
    { missingBuiltinAction: action },
  );
}

function parseGraph2(config: TMissingBuiltinActionConfig) {
  return parse<AllTypes2>(
    loadSchema(resolve("./tests/undeclared-ref/graph2.ts")),
    { missingBuiltinAction: config },
  );
}

function makeEngine(graph: ReturnType<typeof parseWith>) {
  return createEngine({
    graph,
    entry: "Graph",
    resolvers: [
      fn(graph.Graph.get, () => "hello"),
      fn(graph.Graph.echo, (_ctx, [value]) => value),
    ],
  });
}

Deno.test("parse throws by default on a missing builtin", () => {
  assertThrows(
    () => parseWith("throw"),
    Error,
    "Missing builtin type: ImportedType",
  );
});

Deno.test("imports are skipped, missing types are not registered by default", () => {
  assertThrows(() => parseWith("throw"));
});

Deno.test("parse with 'ignore' auto-registers missing types as builtins", () => {
  const graph = parseWith("ignore");
  const root = getStructure(graph);

  // Only the locally declared Graph interface is a top-level type.
  assertEquals(root.types.map((t) => t.name), ["Graph"]);
  // The imported type is auto-registered as a builtin.
  assertEquals(
    root.builtins.map((b) => b.name),
    ["Date", "ImportedType"],
  );
});

Deno.test("extractApi resolves auto-registered builtins as builtin", () => {
  const api = extractApi(parseWith("ignore"), "Graph");
  // The `get` endpoint returns the imported type, auto-registered as a builtin.
  const get = api.root.children.find(
    (c) => c.kind === "endpoint" && c.name === "get",
  );
  assertNotEquals(get, undefined);
  if (get?.kind !== "endpoint") {
    throw new Error("Expected `get` to be an endpoint");
  }
  assertEquals(get.returns, { kind: "builtin", name: "ImportedType" });
});

Deno.test("engine runs with an auto-registered builtin", async () => {
  const graph = parseWith("ignore");
  const engine = makeEngine(graph);

  const q = client.Graph.get();
  const { path, args } = queryToObject(q);
  const result = await engine.run({ path, args });
  assertEquals(result, "hello");
});

Deno.test("parse with 'warn' auto-registers and logs a warning", () => {
  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const graph = parseWith("warn");
    assertNotEquals(
      getStructure(graph).builtins.find((b) => b.name === "ImportedType"),
      undefined,
    );
    assertEquals(warnings.length, 1);
    assertEquals(String(warnings[0]).includes("ImportedType"), true);
  } finally {
    console.warn = originalWarn;
  }
});

Deno.test("object config: input 'ignore', output 'throw' throws on output/both types", () => {
  const err = captureError(() =>
    parseGraph2({ input: "ignore", output: "throw" })
  );
  assertNotEquals(err, undefined);
  assertEquals(err!.message.includes("OutputType"), true);
  assertEquals(err!.message.includes("BothType"), true);
  assertEquals(err!.message.includes("InputType"), false);
});

Deno.test("object config: input 'throw', output 'ignore' throws on input/both types", () => {
  const err = captureError(() =>
    parseGraph2({ input: "throw", output: "ignore" })
  );
  assertNotEquals(err, undefined);
  assertEquals(err!.message.includes("InputType"), true);
  assertEquals(err!.message.includes("BothType"), true);
  assertEquals(err!.message.includes("OutputType"), false);
});

function captureError(fn: () => unknown): Error | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err as Error;
  }
}

Deno.test("object config: stricter action wins when a type is used on both sides", () => {
  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    // input: ignore, output: warn.
    // InputType -> ignore (silent), OutputType -> warn, BothType -> both -> warn.
    const graph = parseGraph2({ input: "ignore", output: "warn" });
    const builtins = getStructure(graph).builtins.map((b) => b.name);
    assertEquals(builtins.includes("InputType"), true);
    assertEquals(builtins.includes("OutputType"), true);
    assertEquals(builtins.includes("BothType"), true);
    // Two warnings: OutputType and BothType (BothType took the stricter warn).
    assertEquals(warnings.length, 2);
    assertEquals(String(warnings).includes("OutputType"), true);
    assertEquals(String(warnings).includes("BothType"), true);
  } finally {
    console.warn = originalWarn;
  }
});
