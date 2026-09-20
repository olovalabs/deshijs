// Deshi Content Collections — Astro-style parity.
// Define collections in `src/content/config.ts` (or .js) and query them via `getCollection`.
//
// Example `src/content/config.ts`:
//
//   import { defineCollection, z } from 'deshi:content';
//   export const collections = {
//     blog: defineCollection({ schema: z.object({ title: z.string(), date: z.string() }) })
//   };
//
// For Deshi v1 we keep the runtime tiny: collections are file-system based
// (src/content/<collection>/*.{md,deshi}) and validated at build time via the schema.

export type CollectionEntry<C = unknown> = {
  id: string;
  slug: string;
  body: string;
  collection: string;
  data: C;
  render(): Promise<{ Content: unknown; headings: Array<{ depth: number; text: string; slug: string }> }>;
};

export interface CollectionConfig<C = unknown> {
  schema?: { parse?(data: unknown): C; safeParse?(data: unknown): { success: boolean; data?: C; error?: unknown } };
  type?: 'content' | 'data';
}

export function defineCollection<C>(config: CollectionConfig<C>): CollectionConfig<C> {
  return config;
}

// Minimal `z` re-export: if the user has `zod` we proxy it, else we provide a no-op stub.
let _z: any = null;
export const z: any = new Proxy({}, {
  get(_t, prop) {
    if (!_z) {
      try { _z = (globalThis as any).require?.('zod') ?? null; } catch {}
      if (!_z) _z = { string: () => ({ optional: () => ({}) }), object: () => ({ parse: (x:any)=>x }), number: () => ({}), boolean: () => ({}), array: () => ({}) };
    }
    return (_z as any)[prop];
  }
});

// Build-time loader (used by build.ts): enumerate entries under `src/content/<name>/`
export async function loadCollections(root: string, appDir = 'src'): Promise<Record<string, CollectionEntry[]>> {
  const fs = await import('fs');
  const path = await import('path');
  const contentDir = path.resolve(root, appDir, 'content');
  const out: Record<string, CollectionEntry[]> = {};
  if (!fs.existsSync(contentDir)) return out;
  for (const coll of fs.readdirSync(contentDir, { withFileTypes: true })) {
    if (!coll.isDirectory()) continue;
    const collName = coll.name;
    const collPath = path.join(contentDir, collName);
    const entries: CollectionEntry[] = [];
    for (const file of fs.readdirSync(collPath)) {
      if (!file.endsWith('.md') && !file.endsWith('.deshi') && !file.endsWith('.mdx')) continue;
      const full = path.join(collPath, file);
      const raw = fs.readFileSync(full, 'utf-8');
      // naive frontmatter parse fallback to loader; body is everything after
      const id = file.replace(/\.(md|mdx|deshi)$/, '');
      const slug = id;
      // try to parse yaml frontmatter quickly
      let data: Record<string, unknown> = {};
      let body = raw;
      if (raw.startsWith('---')) {
        const nl = raw.indexOf('\n');
        const end = raw.indexOf('\n---', nl);
        if (end !== -1) {
          const fm = raw.slice(nl + 1, end);
          for (const line of fm.split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.startsWith('#')) continue;
            const i = t.indexOf(':');
            if (i <= 0) continue;
            const key = t.slice(0, i).trim();
            if (!/^[A-Za-z_][\w]*$/.test(key)) continue;
            let v: unknown = t.slice(i + 1).trim();
            if (v === 'true') v = true; else if (v === 'false') v = false; else if ((v as string).startsWith('"') || (v as string).startsWith("'")) v = (v as string).slice(1, -1);
            data[key] = v;
          }
          body = raw.slice(end + 4).replace(/^\r?\n/, '');
        }
      }
      entries.push({ id, slug, body, collection: collName, data: data as any, async render() { return { Content: body, headings: [] }; } });
    }
    out[collName] = entries;
  }
  return out;
}

export async function getCollection<C = unknown>(name: string, root = process.cwd(), appDir = 'src'): Promise<CollectionEntry<C>[]> {
  const all = await loadCollections(root, appDir);
  return (all[name] ?? []) as CollectionEntry<C>[];
}
