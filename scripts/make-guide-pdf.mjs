// Turns GO-LIVE-STEPS.md into GO-LIVE-STEPS.pdf (A4, printable, page numbers), using the Chromium that Playwright
// already has. Handles what the guide uses: headings, paragraphs, lists (nested, numbered, [ ] boxes), tables,
// code blocks, rules, `code`, **bold**, *italic* and [links](url).
//   node scripts/make-guide-pdf.mjs [in.md] [out.pdf]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const src = process.argv[2] || 'GO-LIVE-STEPS.md';
const out = process.argv[3] || 'GO-LIVE-STEPS.pdf';
// A list item that wraps onto indented lines is one item: join those lines first (so **bold** across a wrap works).
const lines = [];
let inCode = false;
for (const l of readFileSync(src, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
  if (/^\s*```/.test(l)) inCode = !inCode;
  const prev = lines[lines.length - 1];
  const wrapped = !inCode && /^\s+\S/.test(l) && !/^\s*([-*]|\d+\.) /.test(l) && !/^\s*[|`]/.test(l)
    && prev !== undefined && /^\s*([-*]|\d+\.) /.test(prev);
  if (wrapped) lines[lines.length - 1] = prev + ' ' + l.trim(); else lines.push(l);
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(t) {
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, h) => `<a href="${h.replace(/"/g, '%22')}">${a}</a>`)
    .replace(/^\[ \] /, '<span class="box"></span>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

const html = [];
const lists = []; // open lists: { indent, tag }
const closeLists = (toIndent = -1) => { while (lists.length && lists[lists.length - 1].indent > toIndent) html.push(`</li></${lists.pop().tag}>`); };
let para = [];
const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const trimmed = l.trim();
  if (/^\s*```/.test(l)) { // code block (may sit inside a list item)
    flushPara();
    const buf = [];
    const pad = l.match(/^\s*/)[0].length;
    for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) buf.push(lines[i].slice(Math.min(pad, lines[i].match(/^\s*/)[0].length)));
    if (!lists.length || pad === 0) closeLists();
    html.push(`<pre>${esc(buf.join('\n'))}</pre>`);
    continue;
  }
  if (!trimmed) { flushPara(); continue; }
  const h = /^(#{1,4}) (.*)$/.exec(l);
  if (h) { flushPara(); closeLists(); html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
  if (trimmed === '---') { flushPara(); closeLists(); html.push('<hr>'); continue; }
  if (trimmed.startsWith('|')) { // table
    flushPara(); closeLists();
    const rows = [];
    for (; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(lines[i].trim());
    i--;
    const cells = (r) => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')));
    const [head, , ...body] = rows;
    html.push(`<table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
      body.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    continue;
  }
  const li = /^(\s*)([-*]|\d+\.) (.*)$/.exec(l);
  if (li) {
    flushPara();
    const indent = li[1].length;
    const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
    if (!lists.length || indent > lists[lists.length - 1].indent) { html.push(`<${tag}><li>`); lists.push({ indent, tag }); }
    else {
      closeLists(indent);
      if (lists.length && lists[lists.length - 1].indent === indent) html.push('</li><li>');
      else { html.push(`<${tag}><li>`); lists.push({ indent, tag }); }
    }
    html.push(inline(li[3]));
    continue;
  }
  if (lists.length && /^\s+/.test(l)) { html.push(' ' + inline(trimmed)); continue; } // continuation of a list item
  closeLists();
  para.push(trimmed);
}
flushPara(); closeLists();

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(lines[0].replace(/^#\s*/, ''))}</title><style>
@page{size:A4;margin:16mm 14mm 18mm}
body{font-family:"Noto Sans","Noto Sans Devanagari",system-ui,sans-serif;font-size:10pt;line-height:1.45;color:#14202e}
h1{font-size:20pt;color:#0b2545;margin:0 0 8px}
h2{font-size:14pt;color:#0e7468;border-bottom:2px solid #f5a623;padding-bottom:3px;margin-top:22px;page-break-after:avoid}
h3{font-size:11.5pt;color:#0b2545;margin-top:14px;page-break-after:avoid}
h4{font-size:10.5pt;margin-top:12px;page-break-after:avoid}
p{margin:6px 0}
ul,ol{margin:4px 0 6px;padding-left:20px}li{margin:2px 0}
code{background:#eef3f7;padding:1px 4px;border-radius:3px;font-size:9pt;font-family:"Noto Sans Mono",ui-monospace,monospace}
pre{background:#0b2545;color:#e8f1f8;padding:8px 10px;border-radius:6px;font-size:8.6pt;white-space:pre-wrap;page-break-inside:avoid;font-family:"Noto Sans Mono",ui-monospace,monospace}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9.2pt}tr{page-break-inside:avoid}thead{display:table-header-group}
th,td{border:1px solid #cfd8e3;padding:4px 6px;vertical-align:top;text-align:left}th{background:#eef3f7}
hr{border:0;border-top:1px solid #cfd8e3;margin:14px 0}
a{color:#0e7468}
.box{display:inline-block;width:9pt;height:9pt;border:1.3px solid #0e7468;border-radius:2px;margin-right:5px;vertical-align:-1px}
</style></head><body>${html.join('\n')}</body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'guide-pdf-'));
try {
  const file = join(dir, 'guide.html');
  writeFileSync(file, page);
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + file);
  await p.pdf({
    path: out, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#6b7785">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
  });
  await b.close();
  console.log(`ok ${out}`);
} finally { rmSync(dir, { recursive: true, force: true }); }
