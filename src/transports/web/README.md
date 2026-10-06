# Web Transport

Web transport is an extension on basic TS-Api setup that let you mix HTTP and
Stream transport.

## Schema

When defining your schema, you **must** wrap every endpoint with one of the 3
generic types exposed by the web transport.

- **QueryResult**: Will make a GET request, or POST if the query parameters are
  too large.
- **MutationResult**: Will make a POST request.
- **StreamResult**: Will make a SSE request (POST).

```ts
// schema.ts
import type {
  MutationResult,
  QueryResult,
  StreamResult,
} from "@dldc/ts-api/transports/web/types";

export interface Graph {
  aQuery: (foo: string, bar: number) => QueryResult<string>;
  aMutation: (id: string) => MutationResult<boolean>;
  aStream: (topic: string) => StreamResult<number>;
}
```

## Parse and Engine

The only change on the parse and engine setup is that you now need to include
the `webBuiltins` in parse

```ts
import { parseFromFile } from "@dldc/ts-api/server/filesystem";
import { builtin, createBuiltins } from "@dldc/ts-api/server";
import { webBuiltins } from "@dldc/ts-api/transports/web/builtins";
import type { Graph } from "./schema.ts";

const graph = parseFromFile<{ Graph: Graph }>(resolve("./schema.ts"), {
  builtins: createBuiltins({
    ...webBuiltins,
    OtherBuiltins: builtin(/*...*/),
  }),
});
```

## Resolvers

The `QueryResult<T>` / `MutationResult<T>` / `StreamResult<T>` wrappers are
_phantom_ types — they only exist at the type level, and resolvers return the
plain `T` value. Plain `fn` types a resolver as returning the wrapped type, so
the web transport ships three typed helpers (from
`@dldc/ts-api/transports/web/resolvers`) that are `fn` underneath with the
wrapper unwrapped and the typed args passed as the second argument:

```ts
import {
  mutationResolver,
  queryResolver,
  streamResolver,
} from "@dldc/ts-api/transports/web/resolvers";

const engine = createEngine({
  graph,
  entries: ["Graph"],
  resolvers: [
    queryResolver(graph.Graph.aQuery, (_ctx, [foo, bar]) => {
      // `foo` is string, `bar` is number; returns the plain value.
      return `${foo}${bar}`;
    }),
    mutationResolver(graph.Graph.aMutation, (_ctx, [id]) => {
      return id === "keep";
    }),
    streamResolver(graph.Graph.aStream, (_ctx, [topic]) => {
      // Return an async generator (or any async iterable): each yielded
      // value is streamed to the client as an SSE message.
      return (async function* () {
        for (let i = 0; i < 3; i++) {
          yield i + topic.length;
        }
      })();
    }),
  ],
});
```

Each helper restricts `path` to a single endpoint kind at the **type level**:
`queryResolver` only accepts a `QueryResult` endpoint, `mutationResolver` a
`MutationResult`, `streamResolver` a `StreamResult`. Passing a wrong kind (or a
namespace, or a plain non-web endpoint) is a compile error — there is no runtime
check to pay for.

## Server

On your server add an endpoint to handle the requests, it should handle both GET
and POST. The endpoint path (e.g. `Graph.aQuery`) is decoded from the URL, and
the args come from the JsonURL query string (GET) or the JSON body (POST), so
`handleWeb` needs to know which URL prefix belongs to routing: pass it with
`basePath` (omit it when the transport is mounted at the root of your server).

```ts
import { handleWeb } from "@dldc/ts-api/transports/web/server";

const hono = new Hono();

hono.get("/api/:path", (c) => {
  return handleWeb(engine, c.request, { basePath: "/api" });
});

hono.post("/api/:path", (c) => {
  return handleWeb(engine, c.request, { basePath: "/api" });
});
```

By default `handleWeb` returns a JSON response. When the client requests
`Accept: text/event-stream` (which `execStream` does), the response is a
Server-Sent Events stream instead, so `StreamResult` endpoints work over the
same endpoint.

`handleWeb` enforces the transport kind each endpoint is declared with in the
schema instead of trusting the request:

- `QueryResult` endpoints run as GET **or** POST (the client POSTs long queries)
  and return JSON.
- `MutationResult` endpoints only accept POST and return JSON.
- `StreamResult` endpoints only accept POST and must advertise
  `Accept: text/event-stream`.

A violation is rejected with a `405` (bad method) or `406` (bad `Accept`) JSON
`Response` instead of silently executing — so for example a GET sent to a
mutation (a CSRF vector: browsers trigger GETs cross-origin without CORS
preflights) can never run. Endpoints not wrapped in one of the three types are
left untouched.

Two extra options are available on `handleWeb`:

- `extendsCtx` is forwarded to `engine.run` / `engine.runIterable`, so you can
  inject request-scoped data (e.g. the authenticated user) into resolvers.
- `codec` transforms values into JSON-compatible objects (e.g. superjson's
  `{ json, meta }`) and must match the codec passed to the client.

```ts
import SuperJSON from "superjson";

// e.g. reading the Authorization header somewhere (Hono `c`).
hono.post("/api/:path", (c) => {
  return handleWeb(engine, c.request, {
    basePath: "/api",
    extendsCtx: (ctx) => ctx, // inject request-scoped data into ctx
    codec: {
      encode: (value) => SuperJSON.serialize(value),
      decode: (value) => SuperJSON.deserialize(value),
    },
  });
});
```

## Client

On the client side, you can use the different methods to call your API
endpoints, note that only compatible endpoints will work with corresponding
function.

```ts
import {
  execMutation,
  execQuery,
  execStream,
} from "@dldc/ts-api/transports/web/client";

const client = query<{ Graph: Graph }>();
const baseUrl = "https://example.com/api";

const queryResult = await execQuery(client.Graph.aQuery("foo", 123), baseUrl);
const mutationResult = await execMutation(
  client.Graph.aMutation("id"),
  baseUrl,
);

const stream = execStream(client.Graph.aStream("topic"), baseUrl);
for await (const value of stream) {
  console.log(value);
}
```

`execQuery` and `execMutation` resolve to the returned value. `execStream`
returns an async iterable of the values the server streams back.

The optional `codec` argument (the 4th parameter of `execQuery` / `execMutation`
/ `execStream`) transforms values into JSON-compatible objects before they are
JSON-serialized onto the wire, and back after parsing — e.g. superjson, whose
`serialize` / `deserialize` produce / consume a `{ json, meta }` object that is
sent as JSON. It must be paired with the same codec on `handleWeb`:

```ts
import SuperJSON from "superjson";

const codec = {
  encode: (value) => SuperJSON.serialize(value),
  decode: (value) => SuperJSON.deserialize(value),
};
const mutationResult = await execMutation(
  client.Graph.aMutation("id"),
  baseUrl,
  undefined,
  codec,
);
```

The `codec` does not change the transport: `execQuery` still GETs short queries,
with the encoded args JsonURL-encoded into the URL (falling back to POST when
the URL would be too long).
