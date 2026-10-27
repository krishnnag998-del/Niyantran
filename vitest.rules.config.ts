import { defineConfig } from "vitest/config";
import path from "node:path";

// Security-rules tests need the Firestore emulator, so they run separately: pnpm test:rules
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: { environment: "node", include: ["tests/rules/**/*.test.ts"], testTimeout: 20000, hookTimeout: 30000, fileParallelism: false },
});
