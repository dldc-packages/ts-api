# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.1] - 2026-10-08

### Changed

- **Builtins no longer declare `parameters`.** `TBuiltinConfig.parameters` is
  removed. A builtin's `getSchema` now always receives the valibot schemas of
  the type arguments it was used with, in order (an empty array if none) — and
  is itself responsible for validating the count when one is required. This
  allows builtins with optional/omittable type parameters, and removes the
  "Invalid type arguments: expected N parameter(s)" error raised at schema
  resolution time.
- The web transport builtins (`QueryResult` / `MutationResult` / `StreamResult`)
  now enforce their single type argument from `getSchema` instead of the removed
  `parameters` declaration — the error message wording changes.

### Added

- **`Array<T>` is a native array type.** Previously `Array<Foo>` parsed to a ref
  to the global `Array` and failed with "Missing builtin type: Array". It now
  behaves exactly like `Foo[]` in the graph (request and response).

## [4.0.0] - 2026-10-07

### Breaking

- **`createEngine` now takes `entries`, not `entry`.** The `entry` option (a
  single string) was replaced by `entries` — an array of the root interface
  names queries may start from (e.g. `["Graph"]`). A query whose `path[0]`
  matches none of them is rejected with an `InvalidEntry` error that lists the
  accepted entries (e.g. `one of ["Public","Admin"]`).
- **`extractApi` now takes `entries`, not `entry`.** It accepts an array of
  entry interface names and returns an `ApiTree` with an `entries` field — an
  array of `ApiNamespace`, one per entry in the given order — replacing the
  previous `entry` field and single `root` namespace.

### Added

- **Multiple entry points.** A schema can declare any number of root interfaces,
  each exposed as an independent API tree from the same engine and the same
  client type map, while sharing data types across them. A public and an admin
  API can now live in one schema with their own endpoints and resolvers:
  `createEngine({ graph, entries: ["Public", "Admin"], ... })`.
- Multi-entry test coverage (`tests/multi-entry/`): dispatching from any entry,
  `InvalidEntry` errors (message and erreur data), and one `extractApi` tree per
  entry.

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
