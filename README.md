# Deshi Framework

A compiler-based SSG (Static Site Generation) framework for `.deshi` files, inspired by Astro.

## Structure

```text
├── compiler/          # Full compiler & Vite plugin (independent from your app)
├── src/               # Your application routes ONLY
│   ├── layout.deshi   # Main entry point layout
│   └── page.deshi     # Root ("/") route page
├── dist/              # Pure static SSG output after build
│   └── index.html     # Zero-JS static HTML
├── vite.config.ts     # Vite configuration powered by deshi()
└── package.json
```

## Workflows

### 1. In Development (`npm run dev`)
- Starts the Vite development server.
- The server runtime middleware intercepts route requests and compiles `.deshi` files on the fly into HTML with live HMR.

### 2. In Production (`npm run build`)
- Runs the AST compiler and SSG build.
- Compiles `src/layout.deshi` and `src/page.deshi`.
- Emits pure static HTML into `dist/index.html` (like Astro).
- Ships **0 bytes of client JS**.

### 3. Preview Production Build (`npm run preview`)
- Serves the static `dist/` directory locally.
