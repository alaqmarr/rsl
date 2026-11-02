import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./apps/web/src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["apps/**/__tests__/**/*.test.ts", "packages/**/__tests__/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
