import { defineConfig } from "vitest/config";
import path from "node:path";

// Kept separate from vite.config.ts so tests do not load the Figma Make dev-server plugins.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
