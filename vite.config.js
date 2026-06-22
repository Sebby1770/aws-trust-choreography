import { defineConfig } from "vite";

// The app ships as native ES modules served as static files (see README and the
// Pages deploy workflow), so Vite is used purely as the dev server and Vitest's
// config host — there is no production bundling step to keep the icon SVGs and
// lazy catalog chunk served verbatim.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.js"],
      exclude: ["src/main.js", "src/flow-studio.js", "src/icon-catalog.js"],
    },
  },
});
