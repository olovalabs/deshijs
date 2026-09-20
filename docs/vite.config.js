import { defineConfig } from "vite";
import deshi from "deshijs/vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(resolve(process.cwd(), "package.json"));

/**
 * Compile the global Tailwind stylesheet to `src/public/tailwind.css`.
 *
 * Deshi renders HTML outside Vite's module graph (the build entry is a virtual
 * module), so a `<link>` in the generated HTML is never processed by Vite.
 * Writing the compiled sheet into `publicDir` gives one stable URL — served in
 * dev, copied to `dist/` on build — and keeps `@tailwindcss/cli` as the single
 * source of truth for utilities + the `@theme` tokens in `src/tailwind.css`.
 */
function tailwindStylesheet() {
  const input = resolve("src/tailwind.css");
  const output = resolve("src/public/tailwind.css");

  // Pin to the locally installed CLI (declared in devDependencies) — no `bunx`
  // auto-install, no version drift, works offline.
  const cli = (() => {
    try {
      return resolve(dirname(require.resolve("@tailwindcss/cli/package.json")), "dist/index.mjs");
    } catch {
      return null;
    }
  })();

  const build = () => {
    if (!cli) {
      console.error("[tailwind] @tailwindcss/cli is not installed — run `bun install`.");
      return;
    }
    try {
      execFileSync(process.execPath, [cli, "-i", input, "-o", output, "--minify"], { stdio: "pipe" });
      console.log(`[tailwind] src/tailwind.css → src/public/tailwind.css (${readFileSync(output).length} B)`);
    } catch (err) {
      // Surface the real Tailwind error instead of silently shipping stale CSS.
      console.error("[tailwind] build failed:\n" + (err?.stderr?.toString() || err?.message || String(err)));
    }
  };

  // Debounce: a single edit can fire several watcher events.
  let timer;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(build, 60);
  };
  const isRelevant = (file) =>
    file.endsWith(".deshi") || file.endsWith(".mdx") || file.endsWith("tailwind.css");

  return {
    name: "deshi-tailwind-stylesheet",
    buildStart() {
      // Runs before Vite copies publicDir → dist (and before the SSG closeBundle).
      build();
    },
    configureServer(server) {
      build();
      for (const event of ["change", "add", "unlink"]) {
        server.watcher.on(event, (file) => {
          if (isRelevant(file)) schedule();
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [tailwindStylesheet(), deshi({ router: true })],
  appType: "mpa",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
