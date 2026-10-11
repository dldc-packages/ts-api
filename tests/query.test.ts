import { test } from "vite-plus/test";
import { assertType, type IsExact } from "@std/testing/types";
import { query, type TQuery } from "../src/client/mod.ts";

test("primitive return", () => {
  const client = query<{ foo: () => string }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<string>>>(true);
});

test("nullable return", () => {
  const client = query<{ foo: () => string | null }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<string | null>>>(true);
});

test("object return", () => {
  const client = query<{ foo: () => { bar: string } }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<{ bar: string }>>>(true);
});

test("array return", () => {
  const client = query<{ foo: () => string[] }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<string[]>>>(true);
});

test("nested namespace", () => {
  const client = query<{ foo: { bar: () => number } }>();
  const q = client.foo.bar();
  assertType<IsExact<typeof q, TQuery<number>>>(true);
});

test("function with args", () => {
  const client = query<{ foo: (x: string, y: number) => boolean }>();
  const q = client.foo("hello", 42);
  assertType<IsExact<typeof q, TQuery<boolean>>>(true);
});

test("void return (null)", () => {
  const client = query<{ foo: () => null }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<null>>>(true);
});
