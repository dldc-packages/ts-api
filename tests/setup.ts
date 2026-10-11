// Global test setup.
//
// The qualified builtin tests use the TC39 Temporal API (`Temporal.PlainDate`),
// which Deno exposes as a built-in global but Node.js does not. Load the
// official polyfill so `Temporal` is available on the global object, exactly
// like it was under Deno.
import "temporal-polyfill/global";
