# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-10-05

### Added

- **HTTP transport** — `@dldc/ts-api/transports/http/client` and `/server`.
  `execQuery` POSTs a `{ path, args }` JSON body and returns the parsed
  response; on the server, `parseBody` validates that body and `handleQuery`
  runs it through an engine.
- **SSE transport** — `@dldc/ts-api/transports/sse/client` and `/server`. Same
  `{ path, args }` request, but the response is streamed over Server-Sent
  Events: `execQuery` returns an async iterable of the streamed values (`error`
  events are thrown), and `readSSE` / `encodeSSEEvent` expose the raw parsing
  and framing.
- **`runIterable` on `TEngine`** — a server-side streaming primitive. Like
  `run`, but returns a lazy async iterable: a resolver that returns an async
  iterable is yielded one item at a time (each validated against the return
  schema), any other value as a single item.
- **Web transport** — `@dldc/ts-api/transports/web/*`, an opinionated transport
  bundling HTTP + SSE with the transport contract enforced. Mark every endpoint
  with `QueryResult<T>` / `MutationResult<T>` / `StreamResult<T>`
  (`webBuiltins`), then:
  - `handleWeb(engine, request, { basePath, extendsCtx, codec })` on the server
    enforces the transport kind — queries accept GET (or POST when the JsonURL
    query is too long), mutations are POST-only, streams are POST with
    `Accept: text/event-stream` — answering `405` / `406` on violations.
  - One client function per kind: `execQuery`, `execMutation`, `execStream`.
  - Typed resolver helpers `queryResolver` / `mutationResolver` /
    `streamResolver` (`.../web/resolvers`) that call `fn` underneath with the
    phantom wrappers unwrapped, each typed to a single endpoint kind.
  - A `TWebCodec` (`encode` / `decode`) to carry non-JSON values such as `Date`s
    (e.g. superjson) without changing the transport.
- **`getEndpointResponseStructure(graph, path)`** — a public server API that
  resolves an endpoint's response structure (navigating generic wrappers such as
  `Admin<Graph>` transparently). `TGraphBase` also gained a defaulted `Output`
  type parameter, plus the `TGraphBaseOutput<Output>` helper.
- **`examples/pokedex/`** — a runnable full-stack example of the web transport
  - superjson, split into `server/` and `client/` folders.

## [3.0.0] - 2026-10-04

### Breaking

- **`parse()` fails fast on recursive types.** Schemas containing direct,
  mutual, or generically recursive type references now throw at parse time (e.g.
  "Recursive type detected at root.Node"). Previously such schemas parsed
  successfully and only errored when the offending type's schema was actually
  built at runtime, so they could be introspected with
  `getStructure`/`extractApi` and even serve endpoints that never touched the
  recursive type. There is no opt-out: recursive types must be restructured (or
  removed) for the schema to parse.
- **Generic builtins must declare their type parameters.** A builtin used with
  type arguments (e.g. `Foo<string>`) must declare them via `parameters` in its
  config (`builtin<Foo<any>>({ parameters: ["T"], getSchema })`). Using type
  arguments on a non-generic builtin now throws ("Invalid type arguments:
  expected 0 parameter(s) for builtin Foo, got 1") instead of silently dropping
  them.

### Added

- **Generic builtins.** `getSchema` now receives the valibot schemas of a
  builtin's generic type arguments, so a builtin can build a schema that depends
  on its generic instantiation (e.g. the schema of `Todo` in `Page<Todo>`). A
  non-generic builtin (no `parameters`) receives an empty array.
- `parameters` option on builtin configs (`TBuiltinConfig`) and `parameters`
  field on `TBuiltinStructure`.
- Fully resolved and validated nested generics: declared types, generic
  builtins, and mixed nesting (`Paginated<Paginated<Todo>>`,
  `Page<Page<number>>`, `Page<Box<Todo>>`, `Box<Page<Todo>>`).

### Fixed

- Nested declared generics previously mis-bound type arguments or failed schema
  building; type arguments are now bound as raw refs and re-resolved, so deep
  instantiation builds and validates correctly.

### Changed

- Generic resolution now uses a single path: builtin type arguments are bound
  into `localTypes` exactly like declared generics and reached through normal
  graph navigation (the internal `GENERIC_PARAMS` channel was removed).
- `parse.ts` was refactored into `src/server/parse/` (no public API change).
