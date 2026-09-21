import { defineConfig } from "vite";

// This config is ESM (package.json sets "type": "module"), so __dirname does
// not exist. URL.pathname is percent-encoded, and this project's path contains
// spaces, so it has to be decoded before Rollup can open anything.
const sharedDir = decodeURIComponent(new URL("./shared/src", import.meta.url).pathname);

export default defineConfig({
  root: "client",
  resolve: {
    alias: { "@shared": sharedDir },
  },
  server: { port: 5173 },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
