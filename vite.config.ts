import { defineConfig } from "vitest/config";

/*
 * Hosting: Cloudflare Pages builds main and serves the app at the root of
 * https://quickiano.pages.dev/. Other hosts can set the path and the public
 * address at build time, e.g. BASE_PATH=/quickiano/ SITE_URL=https://example.github.io/quickiano/
 */
const BASE_PATH = process.env.BASE_PATH || "/";
const SITE_URL = process.env.SITE_URL || "https://quickiano.pages.dev/";

export default defineConfig(() => ({
  base: BASE_PATH,
  plugins: [
    {
      // Link previews need absolute URLs, so index.html says __SITE_URL__ and gets the real address here.
      name: "site-url",
      transformIndexHtml: (html: string) => html.replaceAll("__SITE_URL__", SITE_URL),
    },
  ],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
}));
