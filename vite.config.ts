import { defineConfig } from "vite";
import { deshi } from "./compiler/plugin";

export default defineConfig({
  plugins: [deshi({ router: false })],
  appType: "mpa",
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
