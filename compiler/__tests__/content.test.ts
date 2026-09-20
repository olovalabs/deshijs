import { describe, expect, it } from 'vitest';
import { defineCollection, getCollection } from '../content';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('defineCollection', () => {
  it('returns the config unchanged', () => {
    const cfg = { type: 'content' as const };
    expect(defineCollection(cfg)).toBe(cfg);
  });
});

describe('getCollection', () => {
  it('returns [] when there is no content dir', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deshi-'));
    await expect(getCollection('blog', dir)).resolves.toEqual([]);
  });

  it('loads md entries with frontmatter data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deshi-'));
    const coll = path.join(dir, 'src', 'content', 'blog');
    fs.mkdirSync(coll, { recursive: true });
    fs.writeFileSync(path.join(coll, 'hello.md'), '---\ntitle: Hi\n---\n# body\n');
    const entries = await getCollection('blog', dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'hello', slug: 'hello', collection: 'blog' });
    expect(entries[0].data).toMatchObject({ title: 'Hi' });
  });
});
