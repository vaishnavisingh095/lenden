import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Keep it simple: run test files serially. This suite deliberately
    // exercises real concurrent DB writes *inside* individual tests
    // (see customers.duplicateSubmission/identity tests) — running whole
    // test files in parallel on top of that would make failures harder
    // to attribute to the behavior under test versus cross-file races.
    fileParallelism: false,
  },
});
