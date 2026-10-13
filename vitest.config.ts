import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "path";

const requestedWorkers = Number(process.env.VITEST_MAX_WORKERS);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Nested worktrees have their own suites and source revisions.
    exclude: [...configDefaults.exclude, "**/.worktrees/**"],
    // CLI tests spawn Bun processes. Unbounded workers create resource contention
    // and false timeouts on busy desktops; keep the existing assertion deadlines.
    maxWorkers: Number.isInteger(requestedWorkers) && requestedWorkers > 0 ? requestedWorkers : 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
