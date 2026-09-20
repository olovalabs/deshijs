// Builds the publishable `deshi` package: bundled ESM entry points in dist/
// (esbuild) plus rolled-up type declarations (tsc). Dependencies stay external
// so consumers dedupe against their own copies of parse5 / css-tree / esbuild.
import { rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(pkgRoot);

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: {
    index: 'src/index.ts',
    vite: 'src/vite.ts',
    config: 'src/config.ts',
    runtime: 'src/runtime.ts',
    content: 'src/content.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  splitting: true,
  packages: 'external',
  logLevel: 'info',
});

execSync('tsc -p tsconfig.build.json', { stdio: 'inherit' });
