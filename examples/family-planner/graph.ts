import { resolve } from "@std/path";
import { parseFromFile } from "../../src/server/filesystem.ts";
import type { Graph } from "./schema.ts";

const SCHEMA_PATH = resolve("./examples/family-planner/schema.ts");

export const graph = parseFromFile<{ Graph: Graph }>(SCHEMA_PATH);
