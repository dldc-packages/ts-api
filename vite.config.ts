import { resolve } from "node:path";
import { defineConfig } from "vite-plus";

const root = import.meta.dirname;

export default defineConfig({
  // Tests import the package through its own public subpaths
  // (`@dldc/ts-api/transports/web/client`, ...), exactly like the JSR manifests
  // used to. The alias points those self-references at the sources so tests run
  // against the same code the packages will be built from.
  resolve: {
    alias: {
      "@dldc/ts-api": resolve(root, "src"),
    },
  },

  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.types.ts"],
    },
  },

  fmt: {
    // Generated snapshots are owned by Vitest's snapshot writer; prose docs
    // and CI files are kept untouched by the formatter to avoid unrelated
    // churn.
    ignorePatterns: [
      "**/__snapshots__/**",
      "**/*.md",
      ".github/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
    ],
  },

  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // `any` was the only excluded rule in the previous Deno lint config.
      "no-explicit-any": "off",
      // Intentional recursion patterns (proxy forwarding, graph walk).
      "only-used-in-recursion": "off",
      // Existing header-merging code predates this rule; keep it untouched.
      "no-useless-fallback-in-spread": "off",
    },
    overrides: [
      {
        // Parse fixtures define valid types that the library parses from source
        // strings; not all of them are referenced from test code.
        files: ["tests/**/schema.ts", "tests/**/graph.ts", "tests/**/types.ts"],
        rules: {
          "no-unused-vars": "off",
        },
      },
    ],
  },

  // Library build (tsdown). The entry map mirrors the export map in
  // package.json so every public subpath has its own emitted module and types.
  pack: {
    entry: {
      client: "src/client/mod.ts",
      server: "src/server/mod.ts",
      "server/filesystem": "src/server/filesystem.ts",
      "transports/http/client": "src/transports/http/client.ts",
      "transports/http/server": "src/transports/http/server.ts",
      "transports/sse/client": "src/transports/sse/client.ts",
      "transports/sse/server": "src/transports/sse/server.ts",
      "transports/web/builtins": "src/transports/web/builtins.ts",
      "transports/web/client": "src/transports/web/client.ts",
      "transports/web/resolvers": "src/transports/web/resolvers.ts",
      "transports/web/server": "src/transports/web/server.ts",
      "transports/web/types": "src/transports/web/types.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
  },
});
