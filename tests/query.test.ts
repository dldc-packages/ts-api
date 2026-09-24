import { assertType, type IsExact } from "@std/testing/types";
import { query, type TQuery } from "../src/client/mod.ts";

Deno.test("primitive return", () => {
  const client = query<{ foo: () => string }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<string>>>(true);
});

Deno.test("nullable return", () => {
  const client = query<{ foo: () => string | null }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<string | null>>>(true);
});

Deno.test("object return", () => {
  const client = query<{ foo: () => { bar: string } }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<{ bar: string }>>>(true);
});

Deno.test("array return", () => {
  const client = query<{ foo: () => string[] }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<string[]>>>(true);
});

Deno.test("nested namespace", () => {
  const client = query<{ foo: { bar: () => number } }>();
  const q = client.foo.bar();
  assertType<IsExact<typeof q, TQuery<number>>>(true);
});

Deno.test("function with args", () => {
  const client = query<{ foo: (x: string, y: number) => boolean }>();
  const q = client.foo("hello", 42);
  assertType<IsExact<typeof q, TQuery<boolean>>>(true);
});

Deno.test("void return (null)", () => {
  const client = query<{ foo: () => null }>();
  const q = client.foo();
  assertType<IsExact<typeof q, TQuery<null>>>(true);
});
