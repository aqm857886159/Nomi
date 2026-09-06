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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  HANDBOOK_TITLE,
  HANDBOOK_SUBTITLE,
  HANDBOOK_PIPELINE,
  HANDBOOK_FIRST_WIN,
  HANDBOOK_INTENT_ROUTES,
  HANDBOOK_GOTCHAS,
} from '../src/workbench/onboarding/handbookContent.ts'
import { shared } from './marketing/content.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../marketing/handbook.html')
const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'))
const handbookUrl = `${shared.siteUrl}${shared.handbookUrl}`
const handbookDescription = `${HANDBOOK_SUBTITLE} 按照安装、模型接入、分镜、生成、时间线与导出顺序，快速完成 Nomi 的第一条 AI 视频。`
const handbookImage = `${shared.siteUrl}/assets/social-preview-zh.jpg`
const handbookJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${shared.siteUrl}/#website`,
      name: 'Nomi',
      url: `${shared.siteUrl}/`,
      inLanguage: ['zh-CN', 'en'],
    },
    {
      '@type': 'WebPage',
      '@id': handbookUrl,
      url: handbookUrl,
      name: HANDBOOK_TITLE,
      description: handbookDescription,
      inLanguage: 'zh-CN',
      isPartOf: { '@id': `${shared.siteUrl}/#website` },
      about: { '@id': `${shared.siteUrl}/#application` },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${shared.siteUrl}/#application`,
      name: 'Nomi',
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'macOS, Windows',
      codeRepository: shared.repositoryUrl,
      license: shared.licenseUrl,
      softwareVersion: packageJson.version,
      url: `${shared.siteUrl}/`,
      downloadUrl: shared.releaseUrl,
    },
  ],
}).replaceAll('<', '\\u003c')

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
<meta name="description" content="${esc(handbookDescription)}" />
<meta name="robots" content="index,follow,max-image-preview:large" />
<meta name="theme-color" content="#faf9f6" />
<link rel="canonical" href="${esc(handbookUrl)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Nomi" />
<meta property="og:locale" content="zh_CN" />
<meta property="og:title" content="${esc(HANDBOOK_TITLE)}" />
<meta property="og:description" content="${esc(handbookDescription)}" />
<meta property="og:url" content="${esc(handbookUrl)}" />
<meta property="og:image" content="${esc(handbookImage)}" />
<meta property="og:image:alt" content="${esc(HANDBOOK_TITLE)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(HANDBOOK_TITLE)}" />
<meta name="twitter:description" content="${esc(handbookDescription)}" />
<meta name="twitter:image" content="${esc(handbookImage)}" />
<meta name="twitter:image:alt" content="${esc(HANDBOOK_TITLE)}" />
<script type="application/ld+json">${handbookJsonLd}</script>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<!-- Icon font loads non-render-blocking so a slow or blocked jsdelivr cannot blank first paint. -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3/dist/tabler-icons.min.css" media="print" onload="this.media='all'" />
<noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3/dist/tabler-icons.min.css" /></noscript>
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
  .next{margin-top:28px;padding-top:20px;border-top:1px solid var(--line)}
  .next-links{display:flex;flex-wrap:wrap;gap:8px}
  .next-links a{display:inline-flex;align-items:center;padding:7px 10px;border:1px solid var(--line);border-radius:8px;color:var(--ink80);font-size:12px;text-decoration:none}
  .next-links a:hover{border-color:var(--accent);color:var(--accent)}
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

  <div class="next">
    <h2>继续下一步</h2>
    <p class="note">看完流程后，直接选择你的下一步：先做首胜、下载客户端，或进入社区。</p>
    <nav class="next-links" aria-label="继续下一步">
      <a href="${esc(shared.quickstartUrl)}">打开新手指南 →</a>
      <a href="${esc(shared.releaseUrl)}" target="_blank" rel="noreferrer">下载 Nomi →</a>
      <a href="${esc(shared.repositoryUrl)}" target="_blank" rel="noreferrer">查看源码 →</a>
      <a href="${esc(shared.discussionUrl)}" target="_blank" rel="noreferrer">加入 Discussions →</a>
    </nav>
  </div>

  <p class="foot">Nomi · 本地优先 AI 视频创作台 · nomiaqm.com</p>
</div>
</body>
</html>
`

if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== html) {
    console.error(`[handbook] 输出过期：${OUT}`)
    process.exitCode = 1
  } else {
    console.log('[handbook] CHECK PASS')
  }
} else {
  writeFileSync(OUT, html, 'utf8')
  console.log(`[handbook] 已生成 ${OUT}`)
}
