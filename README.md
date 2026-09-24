# ts-api

> Use a TypeScript file as an RPC spec.

`@dldc/ts-api` lets you define your API as a regular TypeScript file. The same
file is used on the server (to validate inputs/outputs and dispatch to
resolvers) and on the client (to get a fully type-safe function caller). No code
generation, no build step.

## TL;DR

1. Write a TypeScript file that defines your API (a tree of namespaces whose
   leaves are functions).
2. On the server: `parse` the file, write resolvers, create an engine.
3. On the client: `query` the types and call functions — you get the return type
   back, typed and validated.

## Benefits

- **Type-safe client without any build step** — the client is a single Proxy
  that records the path and arguments. Types flow directly from your schema.
- **Very thin client library** — no runtime dependencies, just a Proxy.
- **Input and output validation** — arguments and return values are validated
  against [valibot](https://valibot.dev/) schemas generated from your types.
- **Single source of truth** — your TypeScript file is the spec. No separate
  schema language, no codegen.

## Installation

This package is published on the JSR registry. Install it with:

```sh
deno add jsr:@dldc/ts-api
```

> This package is built for Deno and the JSR registry. To run the examples or
> tests, use Deno. For Deno-specific setup, see [deno.com](https://deno.com).

## Quick start

### 1. Define your API

Create a TypeScript file that describes your API. This file is the single source
of truth — it is used by both the server and the client.

```ts
// api/schema.ts

export interface User {
  id: string;
  name: string;
}

export interface Graph {
  // Top-level namespace: organize functions with interfaces/objects
  users: {
    // Each leaf is a function — this is an RPC endpoint
    list: () => User[];
    byId: (id: string) => User;
    create: (name: string) => User;
  };
  version: () => string;
}
```

### 2. Set up the server

```ts
// server.ts
import { resolve } from "@std/path";
import { createEngine, fn, parse } from "@dldc/ts-api/server";
import type { Graph } from "./api/schema.ts";

const graph = parse<{ Graph: Graph }>(resolve("./api/schema.ts"));

export const engine = createEngine({
  graph,
  entry: "Graph", // the root interface name in your schema file
  resolvers: [
    fn(graph.Graph.users.list, () => {
      return [
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ];
    }),
    fn(graph.Graph.users.byId, (_ctx, [id]) => {
      // args are typed as [string] from the graph definition
      return { id, name: "Alice" };
    }),
    fn(graph.Graph.version, () => "1.0.0"),
  ],
});
```

### 3. Set up the client

```ts
// client.ts
import { query, queryToObject, type TQuery } from "@dldc/ts-api/client";
import type { Graph } from "./api/schema.ts";

const q = query<{ Graph: Graph }>();

// A helper to send queries to the server
async function executeQuery<R>(query: TQuery<R>): Promise<R> {
  const { path, args } = queryToObject(query);
  const res = await fetch("/api", {
    method: "POST",
    body: JSON.stringify({ path, args }),
  });
  return await res.json();
}

// Now you can call your API with full type safety:
const version = await executeQuery(q.Graph.version()); // string
const users = await executeQuery(q.Graph.users.list()); // User[]
const user = await executeQuery(q.Graph.users.byId("1")); // User
```

## How it works

### The schema file

A ts-api schema is a TypeScript file containing only `interface` and `type`
declarations. One interface (the "entry") serves as the root of your API tree.
The leaves of the tree are functions — each function is an RPC endpoint.

```
Graph (interface, the entry)
├── users (interface — a namespace)
│   ├── list: () => User[]        ← endpoint
│   ├── byId: (id) => User         ← endpoint
│   └── create: (name) => User     ← endpoint
└── version: () => string          ← endpoint
```

**Rules:**

1. **Top-level declarations must be `interface` or `type` aliases.**
2. **Function return types must not contain functions.** This means you cannot
   return a namespace or a callable. If a function returns an object, every
   property of that object must be data (string, number, array, nested object,
   etc.). To expose nested operations, use a namespace property instead:

   ```ts
   // ❌ Not allowed — return type contains a function
   interface Graph {
     user: (id: string) => { rename: (name: string) => User };
   }

   // ✅ Allowed — namespace with functions
   interface Graph {
     users: {
       rename: (id: string, name: string) => User;
     };
   }
   ```

3. **Namespace properties must be functions or sub-namespaces.** A bare data
   field like `version: string` is not reachable as an endpoint. Use a function
   instead:

   ```ts
   // ❌ Not reachable — bare data field on a namespace
   interface Graph {
     version: string;
   }

   // ✅ Reachable — a function returning data
   interface Graph {
     version: () => string;
   }
   ```

> **Note:** ts-api does not support all TypeScript syntax. Only a subset of
> types is supported (see [Supported types](#supported-types) for the full
> list). If you need a syntax that isn't supported, please
> [open an issue](https://github.com/dldc-packages/ts-api/issues).

### Generics

Generic interfaces and type aliases are supported. The type parameter is
inferred from usage. For example, a `Paginated<T>` wrapper can be used both as a
return type and as an argument type:

```ts
// api/schema.ts

export interface Paginated<T> {
  data: T[];
  total: number;
}

export interface TodoItem {
  name: string;
  done: boolean;
}

export interface ListParams<T> {
  filter?: T;
  page?: number;
}

export interface Graph {
  // Paginated<TodoItem> as a return type
  todos: () => Paginated<TodoItem>;
  // Paginated<TodoItem> as an input type
  createMany: (items: Paginated<TodoItem>) => TodoItem[];
  // Generic input with inferred type parameter
  search: (params: ListParams<string>) => TodoItem[];
}
```

On the server, resolvers receive and return the concrete instantiation:

```ts
import { fn } from "@dldc/ts-api/server";

fn(graph.Graph.todos, () => ({
  total: 1,
  data: [{ name: "Buy milk", done: false }],
}));

fn(graph.Graph.createMany, (_ctx, [items]) => {
  // items is typed as Paginated<TodoItem>
  return items.data; // TodoItem[]
});

fn(graph.Graph.search, (_ctx, [params]) => {
  // params is typed as ListParams<string>
  return [{ name: params.filter ?? "", done: false }];
});
```

### Generic wrapper middleware (e.g. admin-only endpoints)

A generic type alias is resolved through all its usages in the graph. You can
exploit this to attach a middleware to a **whole category** of endpoints at
once, instead of repeating it on every node. This is useful for e.g.
authorization ("admin-only" operations).

Define a generic "marker" type and wrap the endpoints you want to protect:

```ts
// api/schema.ts

export type Admin<T> = T;

export interface Graph {
  users: {
    create: () => null;
    // object form — a namespace of admin-only operations
    admin: Admin<{ delete: () => null }>;
  };
  posts: {
    create: () => null;
    admin: Admin<{ delete: () => null }>;
  };
  files: {
    // function form — a single admin-only endpoint
    admin: Admin<() => null>;
  };
}
```

> **Note:** endpoint return types cannot be `void` — use `null` instead (see
> [Supported types](#supported-types)).

Then attach a single resolver to the generic type itself. It runs **before every
endpoint wrapped in `Admin<...>`**, anywhere in the graph:

```ts
// server.ts
resolver(
  graph.Admin,
  (ctx, next) => {
    if (currentUser().role !== "admin") {
      throw new Error("Forbidden: admin only");
    }
    // `next` requires the context — call `next(ctx)`, not `next()`
    return next(ctx);
  },
);
```

The generic middleware wraps the endpoints' own resolvers, and namespace
middlewares wrap them in turn:

```
namespace  →  graph.Admin guard  →  endpoint fn
```

Because you reference `graph.Admin` directly (instead of navigating from the
`Graph` entry), `Admin` must be added to the type map — see
[Type maps (advanced)](#type-maps-advanced):

```ts
const graph = parse<{ Graph: Graph; Admin: Admin<any> }>(
  resolve("./api/schema.ts"),
);
```

### Type maps (advanced)

By default you pass the entry type to `parse` and `query` directly, as
`{ Graph: Graph }` above. Everything reachable from the entry is typed
structurally, so the resolvers and the client get full type safety from the
entry alone — you never have to list every type of your schema.

You only need a bigger type map when a resolver references a **top-level** type
directly, outside of the `Graph` namespace. For example
`resolver(graph.Admin, ...)` (see
[Generic wrapper middleware](#generic-wrapper-middleware-eg-admin-only-endpoints))
must list `Admin`:

```ts
// server.ts
import { resolve } from "@std/path";
import { parse } from "@dldc/ts-api/server";
import type { Admin, Graph } from "./api/schema.ts";

const graph = parse<{ Graph: Graph; Admin: Admin<any> }>(
  resolve("./api/schema.ts"),
);
```

### The query format

When you call a function on the client, it produces a `TQuery<R>` object
containing:

- `path`: an array of strings describing the navigation to the function (e.g.
  `["Graph", "users", "byId"]`)
- `args`: an array of arguments passed to the function (e.g. `["1"]`)
- `RESULT` (phantom type): the return type `R`, for type inference

The `queryToObject` helper extracts `{ path, args }` so you can serialize and
send them to the server.

### The engine

`createEngine` takes:

- `graph` — the result of `parse`
- `entry` — the name of the root interface (e.g. `"Graph"`)
- `resolvers` — an array of resolvers
- `validateOutput` (optional, default `true`) — whether to validate the returned
  value of endpoints against their schema. Set to `false` to skip this
  validation and return the resolver's value as-is.

It returns an engine exposing:

- `run({ path, args })` — executes the query and returns the validated result
- `graph` — the graph it was created from

When `engine.run({ path, args })` is called:

1. It validates that `path[0]` matches the entry.
2. It navigates the graph along `path`, collecting resolvers attached to each
   node.
3. It validates `args` against the function's argument types (via valibot).
4. It runs the composed middleware chain (resolvers).
5. It validates the return value against the function's return type (unless
   `validateOutput: false`).
6. It returns the value.

## Resolvers

Resolvers are functions attached to nodes in the graph. There are two kinds:

- **`fn`** — a simple resolver that receives typed args and returns a value.
- **`resolver`** — a middleware-style resolver with access to `next` for
  wrapping/composing.

Both use the `@dldc/stack` context system for dependency injection and shared
state.

### Writing a resolver

Use `fn` for simple resolvers. The second argument is the typed args tuple
(inferred from the graph node):

```ts
import { fn } from "@dldc/ts-api/server";

const listUsers = fn(
  graph.Graph.users.list, // attach to this node
  () => {
    return db.listUsers(); // just return the value
  },
);

const byId = fn(
  graph.Graph.users.byId,
  (_ctx, [id]) => {
    // args is typed as [string] from the graph definition
    return db.findUser(id);
  },
);
```

Use `resolver` when you need middleware capabilities (logging, auth, wrapping):

```ts
import { resolver } from "@dldc/ts-api/server";

const listUsers = resolver(
  graph.Graph.users.list,
  (ctx, next) => {
    console.log("before");
    const value = await next(ctx); // value from downstream
    console.log("after");
    return value;
  },
);
```

### Middleware chain

Resolvers attached to parent namespaces run before child resolvers. You can use
`next(ctx)` to delegate to the next resolver in the chain — it returns the value
from downstream:

```ts
resolver(graph.Graph, (ctx, next) => {
  console.log("before");
  const value = await next(ctx);
  console.log("after");
  return value;
});
```

Multiple middlewares can be attached to the same node — they run in order. The
last one should return a value:

```ts
resolver(
  graph.Graph.apps.all,
  (ctx, next) => {
    console.log("first");
    return next(ctx);
  },
  (ctx, next) => {
    console.log("second");
    return next(ctx);
  },
  () => {
    return []; // the final value
  },
);
```

### Sharing data between resolvers

Use `@dldc/stack` keys to share data between resolvers via the context. A common
pattern: a namespace resolver loads data once, and child function resolvers read
it from context instead of refetching:

```ts
import { createKey, fn, resolver } from "@dldc/ts-api/server";

const AppKey = createKey<{ name: string; version: string }>("App");

// Namespace resolver: load the app config once and share it with children
resolver(graph.Graph.apps, (ctx, next) => {
  const app = db.getApp(); // e.g. { name: "TodoApp", version: "2.0" }
  return next(ctx.with(AppKey.Provider(app)));
});

// Function resolver: read the app config from context instead of refetching
fn(graph.Graph.apps.byId, (ctx, [id]) => {
  const app = ctx.getOrFail(AppKey.Consumer);
  const todos = db.getTodos(id);
  return { appName: app.name, todos };
});
```

### Request-scoped context (e.g. authenticated user)

The `engine.run` function accepts an optional second argument — a function that
can extend the context before resolvers run. This is how you inject
request-scoped data like the authenticated user, request ID, etc.

```ts
import { createEngine, createKey, parse } from "@dldc/ts-api/server";

// 1. Define a key for the auth data
const AuthKey = createKey<{ id: string; name: string }>("auth");

const engine = createEngine({
  graph,
  entry: "Graph",
  resolvers: [
    // Guard: reject unauthenticated requests on the `users` namespace
    resolver(graph.Graph.users, (ctx, next) => {
      const user = ctx.getOrFail(AuthKey.Consumer);
      return next(ctx);
    }),
    // Use the auth data in a resolver
    fn(graph.Graph.auth, (ctx) => {
      const user = ctx.getOrFail(AuthKey.Consumer);
      return user;
    }),
  ],
});

// 2. When running a query, provide the context
const result = await engine.run(
  { path, args },
  (ctx) => ctx.with(AuthKey.Provider(currentUser)),
);
```

In a typical HTTP server:

```ts
async function handler(req: Request): Promise<Response> {
  const { path, args } = await req.json();
  const user = await getUserFromRequest(req); // your auth logic

  const result = await engine.run(
    { path, args },
    (ctx) => ctx.with(AuthKey.Provider(user)),
  );
  return Response.json(result);
}
```

## Builtins

ts-api parses your schema file (the entry `.ts` file) to build its schema. It
only reads **that one file** — it does not resolve imports or global types. This
means any type that isn't an `interface` or `type` declared directly in the
schema file needs a **builtin** to tell ts-api how to validate it at runtime.

There are two common scenarios:

1. **Global types** like `Date` — ts-api sees `Date` in the schema file but
   can't introspect its structure (it's a global, not an interface in the file).
2. **Imported types** — if you `import type { PlainDate } from "./builtins.ts"`,
   ts-api won't follow the import. It just sees the name `PlainDate` and needs a
   builtin to know how to validate it.

A builtin provides a valibot schema for runtime validation. The type itself is
opaque to ts-api — it's treated as a leaf value, not introspected.

> **Important:** ts-api **does not handle encoding or decoding** (transport). It
> validates values at runtime on both the client side (arguments) and the server
> side (arguments and return values), but it does not serialize or deserialize
> them. If your API only uses JSON-compatible types (`string`, `number`,
> `boolean`, `null`, arrays, plain objects), you don't need to worry about this.
> If you use non-JSON types like `Date` or `Temporal.PlainDate`, you are
> responsible for encoding/decoding them on the wire. See
> [Transport and encoding](#transport-and-encoding) below.

### Using the default `Date` builtin

`Date` is a common global type, so ts-api ships with a builtin for it included
by default — no extra setup needed:

```ts
// api/schema.ts
export interface Graph {
  now: () => Date;
  formatDate: (date: Date) => string;
}
```

### Creating custom builtins

For any other type ts-api can't introspect (imported types, globals, or opaque
type aliases), you create a custom builtin. The builtin provides a valibot
schema used to validate the value at runtime.

ts-api matches builtins by name. Both simple identifiers (`Date`, `PlainDate`)
and qualified names (`Temporal.PlainDate`) are supported. This means you can use
`Temporal.PlainDate` directly in your graph — no type alias needed:

```ts
// api/builtins.ts
import { builtin } from "@dldc/ts-api/server";
import * as v from "@valibot/valibot";

export const PlainDateBuiltin = builtin<Temporal.PlainDate>({
  // valibot schema used to validate the value at runtime
  getSchema: () => v.instance(Temporal.PlainDate),
});
```

Register the builtin on the server side — the key must match the name used in
the graph:

```ts
// server.ts
import { createBuiltins, DEFAULT_BUILTINS, parse } from "@dldc/ts-api/server";
import { PlainDateBuiltin } from "./api/builtins.ts";
import type { Graph } from "./api/schema.ts";

const builtins = createBuiltins({
  ...DEFAULT_BUILTINS,
  "Temporal.PlainDate": PlainDateBuiltin,
});

const graph = parse<{ Graph: Graph }>(resolve("./api/schema.ts"), { builtins });
```

Then use the type directly in your graph:

```ts
// api/schema.ts
export interface Graph {
  birthday: () => Temporal.PlainDate;
  eventsOn: (date: Temporal.PlainDate) => string[];
}
```

### Missing builtins

If a type referenced in the schema file is neither declared in the file nor
registered as a builtin, `parse` **fails fast** by default. This catches typos,
forgotten imports, or undeclared global types before any query runs:

```ts
// api/schema.ts
import type { PlainDate } from "./shared.ts"; // never registered as a builtin

export interface Graph {
  birthday: () => PlainDate; // → parse throws
}
```

```ts
parse<{ Graph: Graph }>(resolve("./api/schema.ts"));
// Error: Missing builtin type: PlainDate. Register them with createBuiltins()
// or set missingBuiltinAction to 'warn' or 'ignore'.
```

You can opt out with the `missingBuiltinAction` option, which accepts either a
single action or an object with separate actions for inputs and outputs:

- `"throw"` (default) — throw at `parse` time.
- `"warn"` — auto-register the missing type as a builtin (with an `unknown`
  schema) and log a warning to the console.
- `"ignore"` — auto-register the missing type as a builtin (with an `unknown`
  schema) without logging.

```ts
const graph = parse<{ Graph: Graph }>(
  resolve("./api/schema.ts"),
  { missingBuiltinAction: "warn" }, // auto-register + warn
);
```

To apply different rules for types used as function arguments vs return values,
pass an object `{ input, output }`:

```ts
const graph = parse<{ Graph: Graph }>(
  resolve("./api/schema.ts"),
  {
    missingBuiltinAction: {
      input: "throw", // fail on unknown types received from clients
      output: "warn", // but auto-register unknown return types
    },
  },
);
```

- A missing type used only as an **input** (function argument) uses the `input`
  action.
- A missing type used only as an **output** (function return value) uses the
  `output` action.
- A missing type used on **both** sides uses the stricter of the two (`throw` >
  `warn` > `ignore`).

Auto-registered builtins are treated as opaque leaf values validated against an
`unknown` schema (anything passes). They are added to the graph's root
structure, so you can inspect them via `getStructure`:

```ts
import { getStructure } from "@dldc/ts-api/server";

console.log(getStructure(graph).builtins.map((b) => b.name));
// ["Date", "PlainDate"]
```

> **Security warning:** Auto-registering a type used as an **input** (function
> argument) means its values will be validated against an `unknown` schema,
> which accepts **anything**. Incoming arguments of that type will not be
> checked at all, so arbitrary/unexpected data can reach your resolvers. Only
> opt into `missingBuiltinAction: "warn"` / `"ignore"` for inputs when you are
> certain it is safe, and prefer declaring a real builtin (with a proper valibot
> schema) or keeping `"throw"` for client-supplied inputs. This risk does not
> apply to outputs (return values), which are produced by your own resolvers.

## Supported types

| TypeScript construct                       | Supported | Notes                                  |
| ------------------------------------------ | --------- | -------------------------------------- |
| `string`, `number`, `boolean`              | ✅        | Primitives                             |
| `null`                                     | ✅        | Literal null                           |
| String literals (`"admin" \| "user"`)      | ✅        | Unions of string literals              |
| Number/boolean literals                    | ✅        |                                        |
| Arrays (`T[]`)                             | ✅        |                                        |
| Nullable (`T \| null`)                     | ✅        |                                        |
| Objects (`{ foo: string }`)                | ✅        | Inline type literals                   |
| Interfaces                                 | ✅        | Named, reusable                        |
| Type aliases                               | ✅        | Including unions                       |
| References to other interfaces             | ✅        | `ref: OtherInterface`                  |
| Generics                                   | ✅        | `interface Paginated<T> { data: T[] }` |
| Optional properties (`foo?: string`)       | ✅        |                                        |
| Functions `(arg: T) => R`                  | ✅        | RPC endpoints                          |
| Function return types containing functions | ❌        | Rejected at parse time                 |
| `undefined`                                | ❌        | Use `null` instead                     |
| `void`                                     | ❌        | Use `null` instead                     |
| Methods on interfaces                      | ❌        | Use `prop: () => T` instead            |

## API reference

### Client (`@dldc/ts-api/client`)

#### `query<Types>()`

Creates a type-safe proxy to build queries.

```ts
const q = query<{ Graph: Graph }>();
const userQuery = q.Graph.users.byId("1"); // TQuery<User>
```

#### `queryToObject<R>(query: TQuery<R>)`

Extracts `{ path, args }` from a query for serialization.

```ts
const { path, args } = queryToObject(q.Graph.users.byId("1"));
// path: ["Graph", "users", "byId"]
// args: ["1"]
```

#### Types

- `TQuery<R>` — a finalized query with return type `R`.
- `TQueryRequest` — `{ path: string[]; args: unknown[] }`, the extracted query
  data, ready for serialization.
- `TQueryOf<T>` — maps a type `T` to its query proxy type (for advanced use).

### Server (`@dldc/ts-api/server`)

#### `parse<Types>(schemaPath, options?)`

Parses a TypeScript file into a graph object. Fails fast by default if the
schema references a type that is neither declared nor registered as a builtin.

```ts
const graph = parse<{ Graph: Graph }>(resolve("./api/schema.ts"));
```

- `schemaPath`: path to your `.ts` schema file.
- `options` (optional): an object with:
  - `builtins` — a builtins graph from `createBuiltins`. Defaults to
    `DEFAULT_BUILTINS_GRAPH` (includes `Date`).
  - `missingBuiltinAction` — a single `"throw"` (default), `"warn"`, or
    `"ignore"`, or an object `{ input, output }` to use different actions for
    function arguments vs return values. Controls how types referenced in the
    schema but neither declared nor registered as builtins are handled. See
    [Missing builtins](#missing-builtins).

#### `createEngine(options)`

Creates an engine to run queries.

```ts
const engine = createEngine({
  graph,
  entry: "Graph",
  resolvers: [...],
});
```

Options:

- `graph` — the graph returned by `parse`.
- `entry` — the name of the root interface (e.g. `"Graph"`).
- `resolvers` — an array of resolvers.
- `validateOutput` (optional, default `true`) — when `false`, skips the schema
  validation of endpoint return values and returns them as-is.

Returns `{ graph, run }` where:

- `graph` — the graph the engine was created from.
- `run({ path, args })` — executes the query and returns the validated result.

#### `fn(path, resolver)`

Attaches a simple resolver. The resolver receives `(ctx, args)` where `args` is
typed from the graph node's function parameters.

```ts
fn(graph.Graph.users.byId, (_ctx, [id]) => {
  return db.findUser(id);
});
```

The resolver returns the value (or a promise of it). The return type is checked
against the graph node's expected output at compile time.

> **Note on literals:** because the expected output flows through a generic
> type, TypeScript widens string/number literals. When a function returns a
> union of literals (enums, literal types), annotate the returned literal with
> `as const` or the expected type to keep it valid:

```ts
fn(graph.Graph.role, () => "admin" as const);
```

#### `resolver(path, ...middlewares)`

Attaches middleware to a graph node. Use this when you need `next` for
wrapping/composing.

```ts
resolver(graph.Graph.users.list, (ctx, next) => {
  console.log("before");
  return next(ctx);
});
```

Middleware returns the value directly (not a context). `next(ctx)` returns the
value from downstream middleware.

#### `ApiContext`

The context object passed to resolvers. Extends `@dldc/stack`'s `Stack`.

Key methods:

- `ctx.getInputOrFail(graph)` — returns the validated arguments, typed to the
  function's parameter types.
- `ctx.get(key.Consumer)` / `ctx.getOrFail(key.Consumer)` — reads a value from
  the stack (for shared state between resolvers).
- `ctx.with(key.Provider(value))` — sets a value in the stack.

#### `createKey<T>(name)`

Creates a typed key for sharing data between resolvers via the stack.
Re-exported from `@dldc/stack`.

#### `createBuiltins(config)`

Creates a builtins graph from a config object.

```ts
const builtins = createBuiltins({
  ...DEFAULT_BUILTINS,
  MyType: builtin<MyType>({ getSchema: () => v.string() }),
});
```

#### `builtin<T>(config)`

Helper to define a builtin type.

```ts
builtin<Date>({ getSchema: () => v.date() });
```

#### `getStructure(graph)`

Extracts the raw parsed structure from a graph returned by `parse`. This gives
full access to the internal parse tree — all top-level interfaces, type aliases,
their properties, and registered builtins. Use this when you need low-level
access that `extractApi` does not provide.

```ts
import { getStructure, parse } from "@dldc/ts-api/server";

const graph = parse<{ Graph: Graph }>(resolve("./api/schema.ts"));
const structure = getStructure(graph);

// List all declared types
console.log(structure.types.map((t) => t.name));
// ["User", "Graph", ...]

// Inspect builtins
console.log(structure.builtins.map((b) => b.name));
// ["Date"]
```

Returns a `TRootStructure` with:

- `types` — array of `TTopLevelStructure` (interfaces and type aliases)
- `builtins` — array of `TBuiltinStructure`
- `mode` — `"graph"` for a parsed schema, `"builtins"` for a builtins graph

#### `extractApi(graph, entry)`

Extracts a serializable API tree from a parsed graph. Walks the graph from the
given entry interface and returns a clean tree of namespaces and endpoints, plus
a flat list of all type declarations. The result is fully JSON-serializable (no
symbols, no circular references) — suitable for documentation generation,
introspection, or any tooling that needs to understand the API structure.

```ts
import { extractApi, parse } from "@dldc/ts-api/server";
import type { ApiNode } from "@dldc/ts-api/server";

const graph = parse<{ Graph: Graph }>(resolve("./api/schema.ts"));
const api = extractApi(graph, "Graph");

// Walk all endpoints
function visit(node: ApiNode) {
  if (node.kind === "endpoint") {
    console.log(node.path.join("."), node.arguments, node.returns);
  } else {
    node.children.forEach(visit);
  }
}
visit(api.root);
// Graph.version [] { kind: "primitive", type: "string" }
// Graph.users.list [] { kind: "array", items: { kind: "ref", name: "User", ... } }
// Graph.users.byId [{ name: "id", ... }] { kind: "ref", name: "User", ... }
```

Returns an `ApiTree` with:

- `entry` — the name of the root interface (the `entry` argument)
- `root` — an `ApiNamespace` containing nested `ApiNamespace` and `ApiEndpoint`
  nodes
- `types` — array of `ApiTypeDeclaration` (all interfaces and type aliases from
  the schema)

Each `ApiEndpoint` has:

- `path` — e.g. `["Graph", "users", "byId"]`
- `arguments` — array of `{ name, type, optional }`
- `returns` — an `ApiType`

Each `ApiTypeDeclaration` has:

- `name`, `kind` (`"interface"` or `"alias"`), `parameters` (generic type
  params)
- `properties` (for interfaces) — array of `{ name, type, optional }`
- `type` (for aliases) — an `ApiType`

`ApiType` is a discriminated union covering all supported type constructs:
`primitive`, `literal`, `array`, `nullable`, `union`, `object`, `ref`,
`builtin`, and `function`. Refs are preserved as `{ kind: "ref", name, params }`
so that generic types like `Paginated<TodoItem>` stay cross-referenceable.
Builtins (e.g. `Date`) are resolved to `{ kind: "builtin", name }`.

#### Errors

ts-api uses `@dldc/erreur` for error handling. Errors are categorized:

- **Client errors** (`GraphClientErreur`) — caused by the query, safe to send
  back to the client:
  - `ArgsValidationFailed` — arguments didn't match the schema.
  - `InvalidEntry` — the query didn't start from the entry point.
- **Server errors** (`GraphServerErreur`) — caused by the server implementation,
  should be logged:
  - `InvalidResolvedValue` — a resolver returned a value that didn't match the
    return type.

To inspect an error's data:

```ts
import { GraphClientErreur } from "@dldc/ts-api/server";

try {
  await engine.run({ path, args });
} catch (err) {
  const data = GraphClientErreur.read(err);
  if (data?.kind === "ArgsValidationFailed") {
    // data.issues — valibot issues
  }
}
```

## Transport and encoding

ts-api is transport-agnostic and **does not handle encoding or decoding**. The
client produces a `TQuery<R>` which you turn into a `{ path, args }` object with
`queryToObject` and send however you like (fetch, WebSocket, etc.). The server's
`engine.run` accepts `{ path, args }` directly and returns a plain value.

> **Security:** ts-api validates the structure of incoming `args` against your
> schema, but it does **not** impose limits on payload size, request rate, or
> path length. You are responsible for enforcing body size limits, rate
> limiting, and authentication at the transport layer (e.g., in your HTTP server
> middleware) before calling `engine.run`.

### When your API is 100% JSON-compatible

If you only use `string`, `number`, `boolean`, `null`, arrays, and plain
objects, you can use `JSON.stringify` / `JSON.parse` directly:

```ts
// Client side
async function executeQuery<R>(query: TQuery<R>): Promise<R> {
  const { path, args } = queryToObject(query);
  const res = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args }),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

// Server side
async function handler(req: Request): Promise<Response> {
  const { path, args } = await req.json();
  const result = await engine.run({ path, args });
  return Response.json(result);
}
```

### When you use non-JSON types (Date, Temporal, etc.)

ts-api validates values at runtime (via valibot schemas), but it does not
serialize them. If you use types like `Date` or `Temporal.PlainDate`, you must
handle encoding/decoding yourself on both sides of the wire.

A common solution is to use
[superjson](https://github.com/flightcontrolhq/superjson), which extends JSON to
support `Date`, `Map`, `Set`, `BigInt`, `URL`, and more. It transparently
encodes/decodes these types so they survive transport:

```ts
import SuperJSON from "superjson";

// Client side
async function executeQuery<R>(query: TQuery<R>): Promise<R> {
  const { path, args } = queryToObject(query);
  const res = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: SuperJSON.stringify({ path, args }),
  });
  if (!res.ok) throw new Error(await res.text());
  return SuperJSON.parse<R>(await res.text());
}

// Server side
async function handler(req: Request): Promise<Response> {
  const { path, args } = SuperJSON.parse(await req.text());
  const result = await engine.run({ path, args });
  return new Response(SuperJSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}
```

With superjson, a `Date` value is transparently encoded as
`{ json: "2024-01-15T...", meta: { values: { ... } } }` on the wire, and decoded
back to a `Date` instance on the other side. The valibot schemas generated by
ts-api will then validate the decoded `Date` instance as expected.

## Examples

Look at the `examples/family-planner` directory for a complete example. You can
run it with:

```sh
deno task example:family-planner
```

You can also look at the `tests` directory to see all supported features.
