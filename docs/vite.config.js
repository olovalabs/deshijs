import { defineConfig } from "vite";
import deshi from "deshijs/vite";
import { execSync } from "node:child_process";

function tailwindAuto() {
  const compile = () => {
    try {
      execSync("bunx tailwindcss -i ./src/tailwind.css -o ./src/public/tailwind.css --minify", {
        stdio: "ignore",
      });
    } catch (e) {
      console.error("[tailwind] Build failed:", e);
    }
  };

  return {
    name: "tailwind-auto",
    buildStart() {
      compile();
    },
    configureServer(server) {
      // Compile on dev server startup
      compile();
      // Auto-recompile when .deshi or .css files change
      server.watcher.on("change", (file) => {
        if (file.endsWith(".deshi") || file.endsWith("tailwind.css")) {
          compile();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindAuto(),
    deshi({ router: true }),
  ],
  appType: "mpa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
