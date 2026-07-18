import { defineConfig } from "vite";
import { access, cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function copyArchitectureAssets() {
  return {
    name: "copy-architecture-assets",
    apply: "build",
    async closeBundle() {
      const clientOutput = resolve("dist/client");
      const assetOutput = resolve(clientOutput, "assets");
      const serverOutput = resolve("dist/server");
      const metadataOutput = resolve("dist/.openai");
      await Promise.all([
        mkdir(assetOutput, { recursive: true }),
        mkdir(serverOutput, { recursive: true }),
        mkdir(metadataOutput, { recursive: true }),
      ]);
      await Promise.all(
        ["ai-icons", "aws-icons"].map((directory) =>
          cp(resolve("assets", directory), resolve(assetOutput, directory), { recursive: true })
        )
      );
      await cp(resolve("worker/index.js"), resolve(serverOutput, "index.js"));
      if (await exists(resolve(".openai/hosting.json"))) {
        await cp(resolve(".openai/hosting.json"), resolve(metadataOutput, "hosting.json"));
      }
    },
  };
}

// The runtime icon catalog stores stable asset paths because nodes can be added
// dynamically. Copy the complete official icon set after Vite bundles the app
// so production builds retain the same catalog behavior as the dev server and
// GitHub Pages' source deployment.
export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  plugins: [copyArchitectureAssets()],
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
