/**
 * 上手手册「发群图文版」生成器（第二出口）。
 *
 * 读唯一内容源 src/workbench/onboarding/handbookContent.ts（与 App 内 HandbookPanel 同一份），
 * 渲成自包含的 marketing/handbook.html：内联样式 + tabler 图标 webfont（CDN），明暗自适应，
 * 浏览器打开即可截图发群 / 挂官网。改文案只改 handbookContent.ts，跑 `pnpm build:handbook` 重出。
 *
 * 用 tsx 跑（devDep 已有）：tsx 直接 import .ts 内容源，无需预编译。
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import {
  HANDBOOK_TITLE,
  HANDBOOK_SUBTITLE,
  HANDBOOK_PIPELINE,
  HANDBOOK_FIRST_WIN,
  HANDBOOK_INTENT_ROUTES,
  HANDBOOK_GOTCHAS,
} from '../src/workbench/onboarding/handbookContent.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../marketing/handbook.html')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const icon = (key) => `<i class="ti ti-${esc(key)}" aria-hidden="true"></i>`

const pipeline = HANDBOOK_PIPELINE.map((s, i) => {
  const chip = `<span class="chip${s.accent ? ' chip-accent' : ''}">${icon(s.iconKey)}${esc(s.label)}</span>`
  const arrow = i < HANDBOOK_PIPELINE.length - 1 ? '<i class="ti ti-arrow-right arrow" aria-hidden="true"></i>' : ''
  return chip + arrow
}).join('')

const firstWin = HANDBOOK_FIRST_WIN.map(
  (s) => `<div class="card"><div class="card-h"><span class="num">${s.n}</span><span class="card-t">${esc(s.title)}</span></div><p class="card-b">${esc(s.body)}</p></div>`,
).join('')

const routes = HANDBOOK_INTENT_ROUTES.map((r) => {
  const badge = r.badge ? `<span class="badge">${esc(r.badge)}</span>` : ''
  return `<div class="route${r.warn ? ' route-warn' : ''}">${icon(r.iconKey)}<div><div class="route-t">${esc(r.title)}${badge}</div><div class="route-b">${esc(r.body)}</div></div></div>`
}).join('')

const gotchas = HANDBOOK_GOTCHAS.map(
  (g) => `<div class="gotcha"><div class="gotcha-t">${icon(g.iconKey)}${esc(g.title)}</div><p class="gotcha-b">${esc(g.body)}</p></div>`,
).join('')

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(HANDBOOK_TITLE)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3/dist/tabler-icons.min.css" />
<style>
  :root{--bg:#faf9f6;--paper:#fff;--ink:#1c1b19;--ink80:#3d3c39;--ink60:#6a6862;--ink40:#9b9990;--line:#e6e3db;--soft:#f1efe8;--accent:#534ab7;--accent-soft:#eeedfe}
  @media (prefers-color-scheme: dark){:root{--bg:#161513;--paper:#1f1e1b;--ink:#f3f1ea;--ink80:#d6d3ca;--ink60:#a3a199;--ink40:#76746d;--line:#33312c;--soft:#26241f;--accent:#afa9ec;--accent-soft:#26215c}}
  *{box-sizing:border-box;margin:0}
  body{background:var(--bg);color:var(--ink);font-family:-apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:720px;margin:0 auto;padding:32px 24px}
  .ti{vertical-align:-2px}
  h1{font-size:24px;font-weight:600}
  .sub{color:var(--ink40);font-size:13px;margin:4px 0 0}
  .pipe{background:var(--soft);border-radius:12px;padding:14px 16px;margin:20px 0}
  .pipe-h{font-size:12px;color:var(--ink40);margin-bottom:10px}
  .pipe-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:13px}
  .chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:var(--paper);border:1px solid var(--line);color:var(--ink80)}
  .chip-accent{background:var(--accent-soft);border-color:transparent;color:var(--accent)}
  .arrow{color:var(--ink40)}
  h2{font-size:16px;font-weight:600;margin-top:28px}
  .note{color:var(--ink60);font-size:13px;margin:4px 0 12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  @media(max-width:560px){.grid{grid-template-columns:1fr}}
  .card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px}
  .card-h{display:flex;align-items:center;gap:8px;margin-bottom:4px}
  .num{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:12px;font-weight:600}
  .card-t{font-size:13px;font-weight:500}
  .card-b{font-size:12px;color:var(--ink60)}
  .routes{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-top:4px}
  .route{display:flex;gap:12px;padding:11px 14px;background:var(--paper);color:var(--ink60)}
  .route:nth-child(even){background:var(--soft)}
  .route+.route{border-top:1px solid var(--line)}
  .route-warn{background:var(--soft) !important;color:var(--ink40)}
  .route .ti{font-size:18px;margin-top:1px;flex:none}
  .route-t{font-size:13px;font-weight:500;color:var(--ink)}
  .route-warn .route-t{color:var(--ink60)}
  .route-b{font-size:12px;color:var(--ink60)}
  .route-warn .route-b{color:var(--ink40)}
  .badge{font-size:11px;padding:1px 6px;border-radius:8px;background:var(--accent-soft);color:var(--accent);margin-left:8px;font-weight:400}
  .gotcha{background:var(--soft);border-radius:12px;padding:12px}
  .gotcha-t{font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;margin-bottom:3px}
  .gotcha-b{font-size:12px;color:var(--ink60)}
  .foot{margin-top:28px;color:var(--ink40);font-size:12px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(HANDBOOK_TITLE)}</h1>
  <p class="sub">${esc(HANDBOOK_SUBTITLE)}</p>

  <div class="pipe">
    <div class="pipe-h">一条流水线，全程在你眼皮底下</div>
    <div class="pipe-row">${pipeline}</div>
  </div>

  <h2>90 秒先尝到甜头</h2>
  <p class="note">不用读完手册——先看一条片自己跑出来，再上手做你自己的。</p>
  <div class="grid">${firstWin}</div>

  <h2>我想做 X → 走这条路</h2>
  <p class="note">能做的指清楚路径，做不到的当场标，不让你撞墙找半天。</p>
  <div class="routes">${routes}</div>

  <h2>卡住了看这里</h2>
  <div class="grid" style="margin-top:8px">${gotchas}</div>

  <p class="foot">Nomi · 本地优先 AI 视频创作台 · nomiaqm.com</p>
</div>
</body>
</html>
`

writeFileSync(OUT, html, 'utf8')
console.log(`[handbook] 已生成 ${OUT}`)
