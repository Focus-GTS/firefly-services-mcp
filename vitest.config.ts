import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "**/*.d.ts"],
    },
    pool: "threads",
    // Most unit tests finish in <50ms. The integration tests under
    // test/integration/ exercise the Adobe SDK's async-job poller, which
    // sleeps 2s between status fetches — a single LR/PS happy-path test
    // therefore takes ~2.1s. We raise testTimeout to comfortably cover
    // that while still failing fast for genuinely stuck tests.
    testTimeout: 15_000,
    // MSW server lifecycle is wired in per-file by the integration tests
    // themselves (see test/integration/setup.ts). Unit tests never import
    // the setup module, so they remain hermetic and fast.
  },
});
