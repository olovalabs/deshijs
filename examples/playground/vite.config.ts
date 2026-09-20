import { defineConfig } from "vite";
import deshi from "deshi/vite";

export default defineConfig({
  plugins: [deshi({ router: true })],
  appType: "mpa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
