import { defineConfig } from "vite";
import { deshi } from "./compiler/plugin";

export default defineConfig({
  plugins: [deshi({ router: true })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
