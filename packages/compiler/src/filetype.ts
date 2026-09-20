// Centralized file classification — structural, no regex.
// One source of truth for "is this a source/route/page/reserved file", shared by
// routes.ts, build.ts and vite.ts so extension handling can never drift again.

export const SOURCE_EXTENSIONS = ['deshi', 'html', 'md', 'mdx'] as const;
export const CODE_EXTENSIONS = ['js', 'ts'] as const;
export const DOCUMENT_EXTENSIONS = ['md', 'mdx'] as const;
export const LAYOUT_EXTENSIONS = ['deshi', 'html'] as const;

const SOURCE = new Set<string>(SOURCE_EXTENSIONS);
const CODE = new Set<string>(CODE_EXTENSIONS);
const DOCUMENT = new Set<string>(DOCUMENT_EXTENSIONS);

const PAGE_STEMS = new Set(['page', 'index']);
const RESERVED_STEMS = new Set(['layout', 'template', 'not-found']);

/** Extension without the dot, `''` when there is none (or it is a dotfile). */
export function extname(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const base = slash === -1 ? p : p.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1);
}

export function splitFilename(name: string): { stem: string; ext: string } {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const base = slash === -1 ? name : name.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return { stem: base, ext: '' };
  return { stem: base.slice(0, dot), ext: base.slice(dot + 1) };
}

export function isSourceExt(ext: string): boolean {
  return SOURCE.has(ext);
}
export function isCodeExt(ext: string): boolean {
  return CODE.has(ext);
}
export function isDocumentExt(ext: string): boolean {
  return DOCUMENT.has(ext);
}

/** A `.deshi` / `.html` / `.md` / `.mdx` file. */
export function isSourceFile(p: string): boolean {
  return SOURCE.has(extname(p));
}
/** A `.js` / `.ts` helper/endpoint module. */
export function isCodeFile(p: string): boolean {
  return CODE.has(extname(p));
}
/** A markdown document (`.md` / `.mdx`). */
export function isDocumentFile(p: string): boolean {
  return DOCUMENT.has(extname(p));
}

export function isPageStem(stem: string): boolean {
  return PAGE_STEMS.has(stem);
}
export function isReservedStem(stem: string): boolean {
  return RESERVED_STEMS.has(stem);
}

function isUppercaseFirst(s: string): boolean {
  if (!s) return false;
  const c = s.charCodeAt(0);
  return c >= 65 && c <= 90;
}

export function isPageFile(name: string): boolean {
  const { stem, ext } = splitFilename(name);
  return isPageStem(stem) && SOURCE.has(ext);
}

export function isReservedFile(name: string): boolean {
  const { stem, ext } = splitFilename(name);
  return isReservedStem(stem) && SOURCE.has(ext);
}

/** `layout.deshi` / `template.html` (Astro alias) — a layout file path. */
export function isLayoutPath(p: string): boolean {
  const { stem, ext } = splitFilename(p);
  return (stem === 'layout' || stem === 'template') && (LAYOUT_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Is this base filename a route page?
 * - `page.*` / `index.*` → always
 * - `layout.*` / `template.*` / `not-found.*` → never (reserved)
 * - `.md` / `.mdx` / `.html` → always
 * - `.deshi` → unless Capitalized (capitalized .deshi files are components)
 */
export function isRouteFile(name: string): boolean {
  const { stem, ext } = splitFilename(name);
  if (!SOURCE.has(ext)) return false;
  if (isPageStem(stem)) return true;
  if (isReservedStem(stem)) return false;
  if (ext === 'html' || ext === 'md' || ext === 'mdx') return true;
  return !isUppercaseFirst(stem);
}
