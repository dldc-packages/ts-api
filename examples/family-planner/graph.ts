import { resolve } from "@std/path";
import { parse } from "../../server.ts";
import type { Graph } from "./schema.ts";

const SCHEMA_PATH = resolve("./examples/family-planner/schema.ts");

export const graph = parse<{ Graph: Graph }>(SCHEMA_PATH);
