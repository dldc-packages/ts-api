# Pokedex — web transport + superjson

A complete ts-api example using the **web transport** (queries + mutations +
Server-Sent Events streams behind a single HTTP endpoint) combined with the
**superjson** codec, so `Date` values survive the wire in both directions. The
server and the client are split into separate folders.

## Run it

Boot the server on `http://localhost:8000/api`, run the client against it, then
stop:

```sh
deno task example:pokedex
```

Or start just the server (keep it running):

```sh
deno task example:pokedex:server
```

## Folder layout

```
pokedex/
  README.md     this file
  schema.ts     shared: the Graph type — the API contract both sides type-check against
  codec.ts      shared: the superjson codec, passed to the server AND the client
  main.ts       entry point: boots the server, runs the client, shuts down
  server/       server-side code
    index.ts    engine + a single `handleWeb` route for /api/*
    graph.ts    parses the schema with the web builtins registered
    resolvers.ts  the endpoint implementations
    database.ts   a tiny in-memory pokédex
  client/       client-side code
    api.ts      `createClient(baseUrl)` returning `execQuery` / `execMutation` / `execStream` bound to a server (codec injected)
    index.ts    the demo, calling those wrappers
```

## What it demonstrates

### 1. The schema wraps every endpoint in a transport kind

The web transport is **opinionated**: your schema declares how each endpoint is
served by wrapping it in one of three marker types:

- `QueryResult<T>` — served as **GET** (a POST is used when the args make the
  URL too long).
- `MutationResult<T>` — served as **POST**.
- `StreamResult<T>` — served as **Server-Sent Events** (POST +
  `Accept:
  text/event-stream`).

```ts
export interface PokedexNamespace {
  list: (params?: ListPokemonParams) => QueryResult<Pokemon[]>;
  byId: (id: string) => QueryResult<Pokemon | null>;
  catch: (name: string, shiny?: boolean) => MutationResult<Pokemon>;
  release: (id: string) => MutationResult<Pokemon | null>;
  search: (name: string) => StreamResult<Pokemon>;
}
```

### 2. Parsing registers the web builtins

`schema.ts` also uses the `Date` builtin. Registering the web builtins keeps
them, because `createBuiltins` merges with the default ones:

```ts
export const graph = parseFromFile<{ Graph: Graph }>(SCHEMA_PATH, {
  builtins: createBuiltins({ ...webBuiltins }),
});
```

### 3. The same superjson codec goes on both sides

The transport always sends JSON on the wire; the codec bridges a value and the
JSON-compatible object it is serialized as. Superjson turns a `Date` into a
`{ json, meta }` object, so `caughtAt: Date` comes back as a real `Date`.
Because it is applied to args, results _and_ streamed values, the **same** codec
must be passed to `handleWeb` (server) and to `execQuery` / `execMutation` /
`execStream` (client):

```ts
export const codec: TWebCodec = {
  encode: (value) => SuperJSON.serialize(value),
  decode: (value) => SuperJSON.deserialize(value),
};
```

### 4. One route serves everything

`server/index.ts` routes `/api/*` to `handleWeb`; it picks the behaviour from
the request (JsonURL query string for GET, JSON body for POST,
`Accept:
text/event-stream` for streams) and `codec.decode`s the args either
way:

```ts
export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }
  return await handleWeb(engine, request, { basePath: "/api", codec });
}
```

The server also **enforces** the declared kind instead of trusting the request:
for example a GET sent to a `MutationResult` endpoint is rejected with `405`,
and a stream requested without the SSE `Accept` header with `406`.

### 5. The client picks one function per kind

`client/api.ts` exposes `createClient(baseUrl)`, which returns the three `exec`
functions **bound to that server** (with the superjson codec injected), so
callers only pass the query — plus optional fetch options. `client/index.ts`
builds `const api = createClient(baseUrl)` and then calls `api.execQuery` for
queries, `api.execMutation` for mutations and `for await`s over `api.execStream`
for streams — no repeated `baseUrl` / `codec` arguments, and always the same
codec as the server.

### 6. A note on resolvers

The web transport's `QueryResult` / `MutationResult` / `StreamResult` are
_phantom_ types — they only exist at the type level. Resolvers therefore use the
typed helpers `queryResolver` / `mutationResolver` / `streamResolver` (from
`@dldc/ts-api/transports/web/resolvers`) instead of `fn`: they're `fn`
underneath, with the phantom wrapper unwrapped and the typed args passed as the
second argument:

```ts
const catchResolver = mutationResolver(
  graph.Graph.pokedex.catch,
  (_ctx, [name, shiny = false]) => {
    return toPokemon(db.catchPokemon(name, shiny));
  },
);
```

`StreamResult` endpoints return an async generator, and each yielded value is
streamed to the client as an SSE message. Each helper is also typed to a single
endpoint kind, so handing a `MutationResult` to `queryResolver` is a compile
error rather than a silent mis-wiring.
