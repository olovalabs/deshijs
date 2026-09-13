/**
 * Markdown pages for Deshi SSG (Astro-style .md routes).
 * Frontmatter becomes script bindings; body is HTML via set:html.
 */

export interface MarkdownPage {
  data: Record<string, unknown>;
  body: string;
  html: string;
  deshi: string;
}

export function parseFrontmatter(source: string): { data: Record<string, unknown>; body: string } {
  if (!source.startsWith('---')) return { data: {}, body: source };
  const nl = source.indexOf('\n');
  if (nl === -1) return { data: {}, body: source };
  const end = source.indexOf('\n---', nl);
  if (end === -1) return { data: {}, body: source };
  const raw = source.slice(nl + 1, end);
  const body = source.slice(end + 4).replace(/^\r?\n/, '');
  const data: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(':');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    if (!/^[A-Za-z_][\w]*$/.test(key)) continue;
    data[key] = parseYamlScalar(t.slice(i + 1).trim());
  }
  return { data, body };
}

function parseYamlScalar(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '') return null;
  if (v === '[]') return [];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];
  const flushP = () => {
    if (!para.length) return;
    out.push('<p>' + inline(para.join(' ')) + '</p>');
    para = [];
  };
  const isTableRow = (l: string) => l.includes('|') && l.trim().startsWith('|') === false ? false : /^\s*\|.*\|\s*$/.test(l) || /^\s*[^|]+\|[^|]+/.test(l);
  const isTableSep = (l: string) => /^\s*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*\|?)\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    // table: header | sep | rows
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i+1])) {
      flushP();
      const headerCells = line.split('|').filter(c=>c.trim()).map(c=>c.trim());
      i+=2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(lines[i].split('|').filter(c=>c.trim()).map(c=>c.trim()));
        i++;
      }
      out.push('<table><thead><tr>' + headerCells.map(c=>'<th>'+inline(c)+'</th>').join('') + '</tr></thead><tbody>' + rows.map(r=>'<tr>'+r.map(c=>'<td>'+inline(c)+'</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (line.startsWith('```')) {
      flushP();
      const lang = escapeHtml(line.slice(3).trim());
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      flushP();
      out.push('<hr>');
      i++;
      continue;
    }
    const hm = /^(#{1,6})\s+(.+)$/.exec(line);
    if (hm) {
      flushP();
      const n = hm[1].length;
      const text = hm[2].trim();
      const id = text.toLowerCase().replace(/[^\w]+/g,'-').replace(/^-|-$/g,'');
      out.push(`<h${n} id="${escapeHtml(id)}">${inline(text)}</h${n}>`);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushP();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + inline(q.join(' ')) + '</blockquote>');
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      flushP();
      out.push('<ul>');
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        // task list
        const m = /^\s*[-*+]\s+\[([ xX])\]\s+/.exec(lines[i]);
        if (m) out.push('<li><input type="checkbox" disabled'+(m[1].toLowerCase()==='x'?' checked':'')+'> '+ inline(lines[i].replace(m[0], '')) + '</li>');
        else out.push('<li>' + inline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>');
        i++;
      }
      out.push('</ul>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      flushP();
      out.push('<ol>');
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        out.push('<li>' + inline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>');
        i++;
      }
      out.push('</ol>');
      continue;
    }
    if (!line.trim()) {
      flushP();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushP();
  return out.join('\n');
}

export function markdownToDeshi(source: string): string {
  const { data, body } = parseFrontmatter(source);
  const html = markdownToHtml(body);
  const bindings = Object.entries(data)
    .filter(([k])=>k!=='layout')
    .map(([k, v]) => `  const ${k} = ${JSON.stringify(v)};`)
    .join('\n');
  const title = typeof data.title === 'string' ? data.title : '';
  const description = typeof data.description === 'string' ? data.description : '';
  const layout = typeof (data as any).layout === 'string' ? String((data as any).layout) : null;
  // If frontmatter specifies a layout, import it and wrap
  const layoutImport = layout ? `  import Layout from '${layout}';\n` : '';
  const layoutWrapStart = layout ? `<Layout title={title}><article class="deshi-md" set:html={html}></article></Layout>` : `<article class="deshi-md" set:html={html}></article>`;
  return `<script>
${layoutImport}${bindings}
  const html = ${JSON.stringify(html)};
</script>
${title || description ? `<head>
  ${title ? `<title>{title}</title>` : ''}
  ${description ? `<meta name="description" content={description} />` : ''}
</head>` : ''}
${layout ? layoutWrapStart : `<article class="deshi-md" set:html={html}></article>`}
<style>
  .deshi-md { max-width: 720px; margin: 0 auto; }
  .deshi-md h1 { font-size: 2rem; color: #fafafa; }
  .deshi-md h2 { font-size: 1.4rem; color: #fafafa; margin-top: 1.5rem; }
  .deshi-md h3 { font-size: 1.15rem; color: #e4e4e7; margin-top: 1.25rem; }
  .deshi-md p, .deshi-md li { color: #a1a1aa; line-height: 1.7; }
  .deshi-md a { color: #a3e635; text-decoration: underline; text-underline-offset: 2px; }
  .deshi-md pre { background: #18181b; padding: 1rem; border-radius: 8px; overflow: auto; border: 1px solid #27272a; }
  .deshi-md code { font-family: ui-monospace, monospace; font-size: 0.9em; }
  .deshi-md table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
  .deshi-md th, .deshi-md td { border: 1px solid #27272a; padding: 0.5rem 0.75rem; text-align: left; }
  .deshi-md th { background: #18181b; color: #fafafa; }
  .deshi-md blockquote { border-left: 3px solid #3f3f46; padding-left: 1rem; margin: 1.5rem 0; color: #a1a1aa; }
</style>
`;
}
