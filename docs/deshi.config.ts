import { defineConfig } from "deshijs/config";

export default defineConfig({
  // Canonical origin — drives sitemap.xml / robots.txt generation.
  site: "https://deshijs.dev",
  appDir: "src",
  outDir: "dist",
  output: "static",
  trailingSlash: "ignore",
  router: true,
  css: "inline",
  markdown: {
    shikiConfig: {
      theme: "github-dark-default",
      // Extra grammars on top of the built-in defaults.
      langs: ["ts", "tsx", "js", "jsx", "bash", "html", "json", "diff"],
    },
  },
  experimental: {
    contentCollections: true,
  },
});
