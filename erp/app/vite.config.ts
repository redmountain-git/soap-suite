import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  resolve: {
    alias: {
      "@rmsc/domain-core": fileURLToPath(new URL("../packages/domain-core/src/index.ts", import.meta.url)),
      "@rmsc/local-store": fileURLToPath(new URL("../packages/local-store/src/index.ts", import.meta.url)),
      "@rmsc/worker-protocol": fileURLToPath(new URL("../packages/worker-protocol/src/index.ts", import.meta.url)),
      "@rmsc/vector-widgets/vector-math": fileURLToPath(new URL("../packages/vector-widgets/src/vector-math.ts", import.meta.url)),
      "@rmsc/soap-formulation": fileURLToPath(new URL("../packages/soap-formulation/src/index.ts", import.meta.url)),
      "@rmsc/vector-widgets": fileURLToPath(new URL("../packages/vector-widgets/src/index.ts", import.meta.url))
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  worker: {
    format: "es"
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"]
  },
  plugins: [
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{html,js,css,svg,png,webmanifest}"]
      }
    })
  ]
});
