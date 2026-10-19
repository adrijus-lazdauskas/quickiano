import { defineConfig } from "vitest/config";

// GitHub Pages serves the app under /quickiano/, the dev server under /.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/quickiano/" : "/",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
}));
