import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const core = (path: string) => fileURLToPath(new URL(`../../packages/core/src/${path}`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the build works from any host, sub-path or a local file server.
  base: "./",
  resolve: {
    alias: [
      { find: /^@collate\/core\/ui$/, replacement: core("ui/index.ts") },
      { find: /^@collate\/core$/, replacement: core("index.ts") },
    ],
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: { manualChunks: { react: ["react", "react-dom"], arkiv: ["@arkiv-network/sdk", "viem"] } },
    },
  },
})
