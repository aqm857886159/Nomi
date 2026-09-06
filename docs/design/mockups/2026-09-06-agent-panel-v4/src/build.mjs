/* global URL, console */
import fs from 'node:fs'; import path from 'node:path';
const D = path.dirname(new URL(import.meta.url).pathname);
const P = JSON.parse(fs.readFileSync(path.join(D,'_tabler.json'),'utf8'));
const icon = (n, s=14, w=2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${P[n]||'<circle cx="12" cy="12" r="6"/>'}</svg>`;
const css = fs.readFileSync(path.join(D,'_tokens.css'),'utf8') + '\n' + fs.readFileSync(path.join(D,'_agent.css'),'utf8');
for (const f of fs.readdirSync(D).filter(f=>f.endsWith('.body.html'))) {
  const name = f.replace('.body.html','');
  let body = fs.readFileSync(path.join(D,f),'utf8');
  body = body.replace(/\{\{part:([\w-]+)\}\}/g,(m,n)=>fs.readFileSync(path.join(D,`${n}.part.html`),'utf8'));
  body = body.replace(/\{\{ACTIVE_(CREATION|GENERATION|PREVIEW)\}\}/g,(m,k)=> (body.includes(`<!--active:${k}-->`)?'background:var(--nomi-paper);color:var(--nomi-ink);box-shadow:0 1px 2px oklch(0 0 0/.05)':''));
  body = body.replace(/\{\{part:([\w-]+)\}\}/g,(m,n)=>fs.readFileSync(path.join(D,`${n}.part.html`),'utf8'));
  body = body.replace(/\{\{i:([a-z]+)(?::(\d+))?(?::([\d.]+))?\}\}/g,(m,n,s,w)=>icon(n, s?+s:14, w?+w:2));
  const out = `<!doctype html>\n<html${body.includes("<!--theme:dark-->")?" data-mantine-color-scheme=\"dark\"":""}>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n  <style>\n${css}\n  </style>\n</helmet>\n${body}\n</x-dc>\n</body>\n</html>\n`;
  fs.writeFileSync(path.join(D,`${name}.dc.html`), out);
  console.log('built', name);
}
