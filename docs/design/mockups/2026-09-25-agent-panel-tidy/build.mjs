#!/usr/bin/env node
// 样张构建：docs/design/mockups/2026-09-25-agent-panel-tidy/index.html
// 图标只从 @tabler/icons-react 的 __iconNode 抽真实路径（找不到就报错，不画近似线条）；
// 改前截图取自真实应用走查（docs/evidence/2026-09-25-agent-panel-tidy/*-before-*.png，main 构建）；
// 颜色只用 src/theme/nomi-tokens.css 的 token（光 + 暗两套，值逐字抄自该文件）。
// 用法：node docs/design/mockups/2026-09-25-agent-panel-tidy/build.mjs
/* global console */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const evidence = path.join(repo, 'docs/evidence/2026-09-25-agent-panel-tidy')

function icon(name, size, stroke = 1.8, extraClass = '') {
  const file = path.join(repo, 'node_modules/@tabler/icons-react/dist/esm/icons', `${name}.mjs`)
  if (!fs.existsSync(file)) throw new Error(`Tabler icon not found: ${name}`)
  const match = fs.readFileSync(file, 'utf8').match(/__iconNode = (\[.*\]);/)
  if (!match) throw new Error(`Tabler icon has no __iconNode: ${name}`)
  const nodes = JSON.parse(match[1])
  const body = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')
  return `<svg class="ti ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

// NomiLoadingMark = 旋转的 logo mark（src/design/identity.tsx NomiMarkShapes，几何逐项照抄）。
const mark = (size) => `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="var(--nomi-logo-ground)"/><rect x="5.5" y="5.5" width="4" height="17" rx="1.2" fill="white"/><rect x="18.5" y="5.5" width="4" height="17" rx="1.2" fill="white"/><polygon points="9.5,5.5 13.5,5.5 18.5,22.5 14.5,22.5" fill="white"/></svg>`

const png = (file) => `data:image/png;base64,${fs.readFileSync(path.join(evidence, file)).toString('base64')}`

const L = {
  zh: {
    title: '任务', summary: '2 等你处理 · 1 进行中',
    attention: '等你处理', running: '进行中', done: '已完成',
    timedOut: '等待超时 · 上游可能仍在跑', recover: '重新拉取', recoverHint: '只查结果，不重新生成，不花钱',
    from: '来自 Nomi', stale: '供应商长时间没有返回新状态',
    staleDesc: 'Nomi 仍会查询已有任务，但不会因为等待过久而重复提交。',
    playbook: '镜头生成', stages: '0 / 4 个阶段已完成', openStage: '查看当前阶段', details: '制作详情',
    saved: '已保存到项目', video: '视频', shop: '相机店内景', copy: '复制', copied: '已复制',
  },
  en: {
    title: 'Tasks', summary: '2 waiting on you · 1 running',
    attention: 'Waiting on you', running: 'Running', done: 'Done',
    timedOut: 'Timed out · may still be running upstream', recover: 'Retrieve result', recoverHint: 'Only fetches the result — no new generation, no charge',
    from: 'From Nomi', stale: 'The provider has not returned a new state for a while',
    staleDesc: 'Nomi will keep checking the existing task without resubmitting it because of the delay.',
    playbook: 'Shot generation', stages: '0 / 4 stages done', openStage: 'Open current stage', details: 'Production details',
    saved: 'Saved to project', video: '视频', shop: '相机店内景', copy: 'Copy', copied: 'Copied',
  },
}

function taskPanel(lang, { hoverFirst = false } = {}) {
  const t = L[lang]
  const row = (title, sub, pill, hover) => `
      <div class="row">
        <div class="row-main"><div class="row-title">${title}</div><div class="row-sub">${sub}</div></div>
        ${pill ? `<span class="pill-wrap">${hover ? `<span class="tip">${t.recoverHint}</span>` : ''}<button class="pill" type="button">${pill}</button></span>` : ''}
      </div>`
  return `
  <div class="panel" lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
    <div class="panel-head">${icon('IconProgress', 16, 1.8, 'ink80')}<span class="panel-title">${t.title}</span><span class="grow"></span><span class="close">${icon('IconX', 15)}</span></div>
    <div class="summary">${t.summary}</div>
    <div class="scroll">
      <div class="section">${icon('IconAlertTriangle', 13)}<span>${t.attention}</span><span class="num">2</span></div>
      ${row('老陈', t.timedOut, t.recover, false)}
      ${row('小鹿', t.timedOut, t.recover, hoverFirst)}
      <div class="section">${icon('IconLoader2', 13)}<span>${t.running}</span><span class="num">1</span></div>
      <div class="card-wrap"><section class="card">
        <div class="card-top"><span class="dot"></span><span class="from">${t.from}</span><span class="chip-run">${mark(10)}${t.running}</span></div>
        <div class="card-copy"><h3>${t.stale}</h3><p>${t.staleDesc}</p></div>
        <div class="chips"><span class="chip">${t.playbook}</span><span class="chip">${t.stages}</span></div>
        <button class="primary" type="button">${icon('IconChevronRight', 13, 1.6)}${t.openStage}</button>
        <div class="disclosure">${icon('IconChevronRight', 12, 1.5)}${t.details}</div>
      </section></div>
      <div class="section">${icon('IconCheck', 13)}<span>${t.done}</span><span class="num">3</span></div>
      ${row(t.video, t.saved)}
      ${row(t.video, t.saved)}
      ${row(t.shop, t.saved)}
    </div>
  </div>`
}

const PROMPT_ZH = '清晨的老相机店，暖金色的光从橱窗斜照进来，空气里飘着细小的灰尘，货架上摆满胶片相机和镜头，柜台上一只小鹿摆件，电影感构图，35mm 胶片颗粒，浅景深。'
const PROMPT_EN = 'A cozy vintage camera shop at dawn, warm golden light slanting through the display window, dust motes floating in the air, shelves lined with film cameras and lenses, a small deer figurine on the counter, cinematic composition, 35mm film grain, shallow depth of field, soft shadows, photorealistic, 16:9'
const JSON_LINE = '{ "aspect_ratio": "16:9", "style": "cinematic", "negative_prompt": "text, watermark, low quality, blurry, extra fingers" }'
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

function fence(text, { kind = 'prose', copyLabel, hover = false, header = null, scroll = false } = {}) {
  const copy = `<span class="copy-wrap">${hover ? `<span class="tip tip-copy">${copyLabel}</span>` : ''}<button class="copy${hover ? ' is-hover' : ''}" type="button" aria-label="${copyLabel}">${icon('IconCopy', 14, 1.8)}</button></span>`
  if (header) {
    return `<div class="fence fence-headed"><div class="fence-head"><span class="lang">${header}</span>${copy}</div><pre class="${kind}${scroll ? ' nowrap' : ''}">${esc(text)}</pre></div>`
  }
  return `<div class="fence">${copy}<pre class="${kind}${scroll ? ' nowrap' : ''}">${esc(text)}</pre></div>`
}

function codeBoard(lang, { hover = false } = {}) {
  const t = L[lang]
  return `
  <div class="msg" lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
    <p>可以，这是给生图模型的提示词。</p>
    <p>中文版：</p>
    ${fence(PROMPT_ZH, { copyLabel: t.copy })}
    <p>英文版（如果用的模型更吃英文）：</p>
    ${fence(PROMPT_EN, { copyLabel: t.copy, hover })}
    <p>批量生成时的参数：</p>
    ${fence(JSON_LINE, { kind: 'code', copyLabel: t.copy })}
  </div>`
}

const shot = (file, alt) => `<img class="shot" src="${png(file)}" alt="${alt}" width="${alt.includes('代码') ? 354 : 380}" loading="lazy">`

const html = `<title>Agent 面板整理样张</title>
<meta name="description" content="PR #869 的视觉改动样张：任务面板与 Agent 回复代码块，改前真实截图对照提议稿，附五条待拍板决定。">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
/* ── Nomi tokens：逐字取自 src/theme/nomi-tokens.css（光） ── */
:root {
  --nomi-bg: oklch(0.985 0.003 90); --nomi-paper: oklch(1 0 0);
  --nomi-ink: oklch(0.22 0.01 80); --nomi-ink-80: oklch(0.32 0.01 80); --nomi-ink-60: oklch(0.50 0.01 80);
  --nomi-ink-40: oklch(0.68 0.01 80); --nomi-ink-30: oklch(0.78 0.01 80); --nomi-ink-20: oklch(0.88 0.005 80);
  --nomi-ink-10: oklch(0.94 0.003 80); --nomi-ink-05: oklch(0.97 0.003 80);
  --nomi-line: oklch(0.91 0.004 80); --nomi-line-soft: oklch(0.95 0.003 80);
  --nomi-accent: oklch(0.55 0.13 250); --nomi-accent-soft: color-mix(in srgb, var(--nomi-accent) 12%, var(--nomi-paper));
  --nomi-warning: oklch(0.55 0.085 72); --nomi-warning-ink: oklch(0.45 0.085 72); --nomi-warning-soft: oklch(0.968 0.024 72); --nomi-warning-edge: oklch(0.905 0.07 72);
  --nomi-success: oklch(0.55 0.09 145);
  --nomi-logo-ground: oklch(0.22 0.01 80);
  --nomi-shadow-sm: 0 1px 2px oklch(0 0 0 / 0.04), 0 1px 1px oklch(0 0 0 / 0.03);
  --nomi-shadow-lg: 0 4px 8px oklch(0 0 0 / 0.05), 0 20px 50px oklch(0 0 0 / 0.08);
  --nomi-font-sans: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  --nomi-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
/* 暗色：逐字取自 nomi-tokens.css 的 dark 块 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --nomi-bg: oklch(0.18 0.006 80); --nomi-paper: oklch(0.235 0.007 80);
    --nomi-ink: oklch(0.93 0.006 85); --nomi-ink-80: oklch(0.84 0.006 85); --nomi-ink-60: oklch(0.70 0.006 85);
    --nomi-ink-40: oklch(0.62 0.006 85); --nomi-ink-30: oklch(0.50 0.006 85); --nomi-ink-20: oklch(0.42 0.006 85);
    --nomi-ink-10: oklch(0.34 0.006 85); --nomi-ink-05: oklch(0.30 0.006 85);
    --nomi-line: oklch(0.36 0.007 80); --nomi-line-soft: oklch(0.31 0.007 80);
    --nomi-accent: oklch(0.70 0.13 250); --nomi-accent-soft: color-mix(in srgb, var(--nomi-accent) 26%, var(--nomi-paper));
    --nomi-warning: oklch(0.72 0.085 72); --nomi-warning-ink: oklch(0.82 0.085 72); --nomi-warning-soft: oklch(0.295 0.04 72); --nomi-warning-edge: oklch(0.395 0.058 72);
    --nomi-success: oklch(0.72 0.09 145); --nomi-logo-ground: oklch(0.30 0.01 80);
    --nomi-shadow-sm: 0 1px 2px oklch(0 0 0 / 0.32), 0 1px 1px oklch(0 0 0 / 0.22);
    --nomi-shadow-lg: 0 4px 10px oklch(0 0 0 / 0.30), 0 24px 64px oklch(0 0 0 / 0.40);
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --nomi-bg: oklch(0.18 0.006 80); --nomi-paper: oklch(0.235 0.007 80);
  --nomi-ink: oklch(0.93 0.006 85); --nomi-ink-80: oklch(0.84 0.006 85); --nomi-ink-60: oklch(0.70 0.006 85);
  --nomi-ink-40: oklch(0.62 0.006 85); --nomi-ink-30: oklch(0.50 0.006 85); --nomi-ink-20: oklch(0.42 0.006 85);
  --nomi-ink-10: oklch(0.34 0.006 85); --nomi-ink-05: oklch(0.30 0.006 85);
  --nomi-line: oklch(0.36 0.007 80); --nomi-line-soft: oklch(0.31 0.007 80);
  --nomi-accent: oklch(0.70 0.13 250); --nomi-accent-soft: color-mix(in srgb, var(--nomi-accent) 26%, var(--nomi-paper));
  --nomi-warning: oklch(0.72 0.085 72); --nomi-warning-ink: oklch(0.82 0.085 72); --nomi-warning-soft: oklch(0.295 0.04 72); --nomi-warning-edge: oklch(0.395 0.058 72);
  --nomi-success: oklch(0.72 0.09 145); --nomi-logo-ground: oklch(0.30 0.01 80);
  --nomi-shadow-sm: 0 1px 2px oklch(0 0 0 / 0.32), 0 1px 1px oklch(0 0 0 / 0.22);
  --nomi-shadow-lg: 0 4px 10px oklch(0 0 0 / 0.30), 0 24px 64px oklch(0 0 0 / 0.40);
}

/* ── 画布外壳（样张页本身） ── */
* { box-sizing: border-box; }
body { background: var(--nomi-bg); color: var(--nomi-ink); font-family: var(--nomi-font-sans); font-size: 14px; line-height: 1.5; }
.page { max-width: 1180px; margin: 0 auto; padding-inline: 20px; padding-block: 28px 64px; display: grid; gap: 40px; }
header.intro { display: grid; gap: 8px; }
.eyebrow { font-size: 12px; color: var(--nomi-ink-60); letter-spacing: .02em; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.status { font-size: 11px; font-weight: 600; color: var(--nomi-warning-ink); background: var(--nomi-warning-soft); border: 1px solid var(--nomi-warning-edge); border-radius: 999px; padding: 1px 8px; }
h1 { font-size: 24px; line-height: 1.25; margin: 0; font-weight: 650; text-wrap: balance; }
.lede { margin: 0; max-width: 68ch; color: var(--nomi-ink-80); }
.task-card { margin: 0; max-width: 68ch; color: var(--nomi-ink-80); font-size: 13px; padding: 10px 12px; border-left: 2px solid var(--nomi-line); }
.task-card b { color: var(--nomi-ink); font-weight: 600; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 12px; color: var(--nomi-ink-60); }
.toolbar button { font: inherit; font-size: 12px; color: var(--nomi-ink-80); background: var(--nomi-paper); border: 1px solid var(--nomi-line); border-radius: 999px; padding: 3px 10px; cursor: pointer; }
.toolbar button[aria-pressed="true"] { color: var(--nomi-accent); border-color: var(--nomi-accent); }
h2 { font-size: 16px; margin: 0; font-weight: 650; }
.h2-note { margin: 2px 0 0; font-size: 12px; color: var(--nomi-ink-60); max-width: 72ch; }
section.block { display: grid; gap: 14px; }

/* 决定清单 */
.decisions { display: grid; gap: 10px; }
.dec { background: var(--nomi-paper); border: 1px solid var(--nomi-line); border-radius: 10px; padding: 14px 16px; display: grid; gap: 8px; }
.dec-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.dec-id { font-family: var(--nomi-font-mono); font-size: 12px; color: var(--nomi-ink-60); }
.dec-q { font-weight: 600; font-size: 14px; }
.conflict { font-size: 11px; color: var(--nomi-warning-ink); background: var(--nomi-warning-soft); border-radius: 999px; padding: 1px 8px; }
.opts { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.opt { display: grid; grid-template-columns: 22px 1fr; gap: 6px; font-size: 13px; color: var(--nomi-ink-80); }
.opt .k { font-family: var(--nomi-font-mono); font-size: 12px; color: var(--nomi-ink-60); padding-top: 1px; }
.opt.rec .k { color: var(--nomi-accent); font-weight: 700; }
.rec-tag { font-size: 11px; font-weight: 600; color: var(--nomi-accent); background: var(--nomi-accent-soft); border-radius: 999px; padding: 0 7px; margin-right: 4px; }
.why { font-size: 12px; color: var(--nomi-ink-60); margin: 0; }
.why b { color: var(--nomi-ink-80); font-weight: 600; }

/* 画板：改前 / 提议 */
.pairs { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px; }
.board { display: grid; gap: 8px; align-content: start; }
.board-label { font-size: 12px; color: var(--nomi-ink-60); display: flex; gap: 6px; align-items: center; }
.board-label b { color: var(--nomi-ink); font-weight: 600; }
.stage { overflow-x: auto; padding: 16px; background: var(--nomi-ink-05); border-radius: 10px; }
.stage-inner { width: max-content; margin: 0 auto; }
.shot { display: block; max-width: none; border-radius: 16px; box-shadow: var(--nomi-shadow-lg); }
.shot-plain { border-radius: 6px; }
.notes { margin: 0; padding-left: 18px; font-size: 12px; color: var(--nomi-ink-80); display: grid; gap: 3px; }
.notes code { font-family: var(--nomi-font-mono); font-size: 11px; }
.ti { display: block; flex: none; }

/* ── 任务面板（真实比例：380 宽；类名对应 TaskCenterPanel.tsx 的 token） ── */
.panel { width: 380px; background: var(--nomi-paper); border: 1px solid var(--nomi-line); border-radius: 16px; box-shadow: var(--nomi-shadow-lg); overflow: hidden; font-family: var(--nomi-font-sans); color: var(--nomi-ink-80); }
.panel-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 10px; border-bottom: 1px solid var(--nomi-line); }
.panel-head .ink80 { color: var(--nomi-ink-80); }
.panel-title { font-size: 16px; color: var(--nomi-ink); }
.grow { flex: 1; }
.close { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 6px; color: var(--nomi-ink-60); }
.summary { padding: 8px 14px; border-bottom: 1px solid var(--nomi-line); background: var(--nomi-ink-05); font-size: 12px; color: var(--nomi-ink-80); }
.scroll { padding-block: 4px; }
.section { display: flex; align-items: center; gap: 6px; padding: 8px 14px 4px; font-size: 11px; color: var(--nomi-ink-60); }
.section .ti { color: var(--nomi-ink-40); }
.section .num { font-variant-numeric: tabular-nums; }
.row { display: flex; gap: 10px; align-items: flex-start; padding: 8px 14px; }
.row-main { flex: 1; min-width: 0; }
.row-title { font-size: 13px; color: var(--nomi-ink-80); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-sub { font-size: 11px; color: var(--nomi-ink-60); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pill-wrap { position: relative; flex: none; }
.pill { font: inherit; font-size: 11px; color: var(--nomi-ink-60); background: transparent; border: 1px solid var(--nomi-line); border-radius: 999px; padding: 2px 8px; }
.tip { position: absolute; right: calc(100% + 6px); top: 50%; transform: translateY(-50%); white-space: nowrap; font-size: 11px; color: var(--nomi-paper); background: var(--nomi-ink); border-radius: 6px; padding: 3px 7px; box-shadow: var(--nomi-shadow-sm); }
.card-wrap { padding: 0 10px 6px; }
.card { display: grid; gap: 10px; border: 1px solid var(--nomi-line-soft); background: var(--nomi-bg); border-radius: 10px; padding: 10px; }
.card-top { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.dot { width: 6px; height: 6px; border-radius: 999px; background: var(--nomi-accent); }
.from { font-weight: 500; color: var(--nomi-ink-80); }
.chip-run { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 600; background: var(--nomi-accent-soft); color: var(--nomi-accent); }
.card-copy { display: grid; gap: 4px; }
.card-copy h3 { margin: 0; font-size: 12px; font-weight: 600; line-height: 1.35; color: var(--nomi-ink); }
.card-copy p { margin: 0; font-size: 11px; line-height: 1.625; color: var(--nomi-ink-60); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { border-radius: 999px; background: var(--nomi-ink-05); padding: 2px 8px; font-size: 11px; color: var(--nomi-ink-60); }
.primary { font: inherit; height: 28px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: 6px; background: var(--nomi-ink); color: var(--nomi-paper); font-size: 11px; font-weight: 600; }
.disclosure { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; color: var(--nomi-ink-60); }

/* ── Agent 回复里的代码块（真实比例：消息列 354 宽，对应 NomiMarkdown.tsx 皮肤） ── */
.msg { width: 354px; font-family: var(--nomi-font-sans); font-size: 13px; line-height: 1.625; color: var(--nomi-ink-80); background: var(--nomi-paper); padding: 10px 12px; border-radius: 10px; }
.msg p { margin: 4px 0; }
.fence { position: relative; margin: 8px 0; border: 1px solid var(--nomi-line); border-radius: 6px; background: var(--nomi-ink-05); }
.fence pre { margin: 0; padding: 10px 32px 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--nomi-ink-80); }
.fence pre.prose { font-family: var(--nomi-font-sans); font-size: 13px; line-height: 1.625; }
.fence pre.code { font-family: var(--nomi-font-mono); font-size: 12px; line-height: 1.625; }
.fence pre.nowrap { white-space: pre; overflow-x: auto; overflow-wrap: normal; }
.copy-wrap { position: absolute; top: 4px; right: 4px; }
.copy { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--nomi-ink-40); }
.copy.is-hover { background: var(--nomi-ink-10); color: var(--nomi-ink); }
.tip-copy { right: -2px; top: auto; bottom: calc(100% + 6px); transform: none; }
.fence-headed .fence-head { display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 4px 0 12px; border-bottom: 1px solid var(--nomi-line); }
.fence-headed .copy-wrap { position: static; }
.fence-headed pre { padding-right: 12px; }
.lang { font-family: var(--nomi-font-mono); font-size: 11px; color: var(--nomi-ink-60); }
.mark { flex: none; }
@media (prefers-reduced-motion: no-preference) { .chip-run .mark { animation: spin 1.6s linear infinite; } }
@keyframes spin { to { transform: rotate(360deg); } }

/* 备选小画板 */
.alts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.alt { display: grid; gap: 6px; align-content: start; }
.alt .stage { padding: 12px; }
.alt .msg { width: 300px; }
.ghost-pill { font-size: 11px; color: var(--nomi-ink-40); border: 1px dashed var(--nomi-ink-30); border-radius: 999px; padding: 2px 8px; flex: none; }

/* 参考与卡点表 */
table { border-collapse: collapse; width: 100%; font-size: 12px; }
.table-wrap { overflow-x: auto; background: var(--nomi-paper); border: 1px solid var(--nomi-line); border-radius: 10px; }
th, td { text-align: left; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid var(--nomi-line-soft); }
th { font-weight: 600; color: var(--nomi-ink-60); font-size: 11px; letter-spacing: .02em; }
tr:last-child td { border-bottom: 0; }
td:first-child { white-space: nowrap; color: var(--nomi-ink); font-weight: 500; }
a { color: var(--nomi-accent); }
[contenteditable="true"] { outline: 1px dashed var(--nomi-accent); outline-offset: 2px; }
button:focus-visible { outline: 2px solid var(--nomi-accent); outline-offset: 2px; }
@media (max-width: 480px) { .pairs, .alts { grid-template-columns: 1fr; } .page { padding-inline: 16px; } }
</style>

<main class="page">
  <header class="intro">
    <div class="eyebrow"><span>Nomi · PR #869</span><span class="status">待你拍板 · 拍板前 PR 代码不动</span></div>
    <h1>Agent 面板整理样张：任务面板 + 回复里的代码块</h1>
    <p class="lede">左边是 main 上的真实截图（改前），右边是按设计系统 token、Tabler 真字形、真实尺寸画的提议稿（中英各一）。下面五条决定你点头后，我再把 PR 逐项对到这张样张上。</p>
    <p class="task-card"><b>任务卡：</b>做片的人在生成跑完或卡住时打开「任务」，一眼看清哪些要他动手、点一下就走；在 Agent 回复里拿到提示词，完整看到、一键复制。</p>
    <div class="toolbar"><button id="edit-toggle" type="button" aria-pressed="false">改文案</button><span>打开后可直接在画板上改字（只存在你这台浏览器里），改完截图或把想法发我。</span></div>
  </header>

  <section class="block" aria-labelledby="h-dec">
    <div><h2 id="h-dec">要你拍板的五件事</h2><p class="h2-note">每条的推荐项就是右边提议稿画的样子；选别的我照选项改稿。</p></div>
    <div class="decisions">
      <article class="dec">
        <div class="dec-head"><span class="dec-id">D1</span><span class="dec-q">「等你处理」这一组和它的按钮</span></div>
        <ul class="opts">
          <li class="opt rec"><span class="k">A</span><span><span class="rec-tag">推荐</span>新增「等你处理」组、放在最上面；组里每行右侧常驻文字钮「重新拉取」，悬停说明「只查结果，不重新生成，不花钱」。行下小字去掉重复的「可重新拉取」。</span></li>
          <li class="opt"><span class="k">B</span><span>同一组，但按钮悬停才出现（AI Elements · Queue 的做法）。</span></li>
          <li class="opt"><span class="k">C</span><span>这一组放在「进行中」下面（PR 现在的顺序）。</span></li>
        </ul>
        <p class="why"><b>为什么推荐 A：</b>这组存在就是在等你做一件事，按钮藏起来等于让人去猜；放最上面，打开面板第一眼就是要你动手的。用文字不用刷新图标，是因为刷新图形会和旁边付费的「重试」读成一回事。</p>
      </article>
      <article class="dec">
        <div class="dec-head"><span class="dec-id">D2</span><span class="dec-q">顶栏「任务」按钮上的数字，算不算「等你处理」</span></div>
        <ul class="opts">
          <li class="opt rec"><span class="k">A</span><span><span class="rec-tag">推荐</span>算：在跑 + 排队 + 等你处理，没了结的都算。</span></li>
          <li class="opt"><span class="k">B</span><span>不算：数字只表示「在跑 / 排队」，等你处理只在面板里看得到。</span></li>
        </ul>
        <p class="why"><b>为什么推荐 A：</b>不算的话，超时的生成会从顶栏消失，只有记得打开面板的人才知道还有结果没拉回来。代价：数字会一直亮着，直到你拉回或处理掉。</p>
      </article>
      <article class="dec">
        <div class="dec-head"><span class="dec-id">D3</span><span class="dec-q">代码块去掉语言标题行，复制钮进右上角</span><span class="conflict">与 09-09 定案冲突</span></div>
        <ul class="opts">
          <li class="opt rec"><span class="k">A</span><span><span class="rec-tag">推荐</span>不要标题行：一个框、右上角 24px 复制图标，正文右边留出位置，按钮不压字。</span></li>
          <li class="opt"><span class="k">B</span><span>保留一条细标题行：左边语言名（如 json）、右边复制图标。AI Elements、Beautiful UI 都是这样，09-09 定案也写的是「复制按钮位于独立头栏」。</span></li>
        </ul>
        <p class="why"><b>为什么推荐 A：</b>在 Nomi 的对话里，大多数代码块是要粘去用的提示词，没有语言可标；标题行只多一条线和一个很少用到的词。选 A 等于改掉 <code>docs/plan/2026-09-09-b2e-streamdown.md</code> 第 55 行那条定案。</p>
      </article>
      <article class="dec">
        <div class="dec-head"><span class="dec-id">D4</span><span class="dec-q">长行：自动换行还是横向滚动</span><span class="conflict">与 09-09 定案冲突</span></div>
        <ul class="opts">
          <li class="opt rec"><span class="k">A</span><span><span class="rec-tag">推荐</span>全部自动换行，提示词和代码都一样。</span></li>
          <li class="opt"><span class="k">B</span><span>提示词换行，真正的代码仍横向滚动（保留 09-09 定案「代码横向滚动」，缩进不会被折乱）。</span></li>
        </ul>
        <p class="why"><b>为什么推荐 A：</b>面板只有 340 宽，横滚会把后半截藏起来，这次反馈的正是这个；对话里的代码多是一行参数，折行比藏起来更好读。</p>
      </article>
      <article class="dec">
        <div class="dec-head"><span class="dec-id">D5</span><span class="dec-q">代码块用什么字体</span></div>
        <ul class="opts">
          <li class="opt rec"><span class="k">A</span><span><span class="rec-tag">推荐</span>按内容判断：标了编程语言就等宽；没标或标的是文字类，看内容像不像代码（JSON、语句、标签像代码就等宽，否则用正文字体）。</span></li>
          <li class="opt"><span class="k">B</span><span>只看语言标签：标了编程语言等宽，其余一律正文字体。规则最简单、结果最好预测。</span></li>
          <li class="opt"><span class="k">C</span><span>全部等宽（改前的样子）。</span></li>
        </ul>
        <p class="why"><b>为什么推荐 A：</b>模型经常不给代码标语言，只看标签的话，没标的 JSON 会变成正文字体、对不齐。代价是判断偶尔会错（比如没标签、也没符号的一行命令会显示成正文字体）。</p>
      </article>
    </div>
  </section>

  <section class="block" aria-labelledby="h-task">
    <div><h2 id="h-task">任务面板</h2><p class="h2-note">现场：两份没出价的 Agent 草稿 + 一份供应商 6 分钟没回状态的在跑制作 + 五条生成（两条等待超时）。改前两张来自 main 的真实应用走查。</p></div>
    <div class="pairs">
      <div class="board"><div class="board-label"><b>改前</b> · 中文 · 真实截图</div><div class="stage"><div class="stage-inner">${shot('task-center-before-zh.png', '任务面板改前（中文）')}</div></div></div>
      <div class="board"><div class="board-label"><b>提议</b> · 中文 · D1-A / D2-A</div><div class="stage"><div class="stage-inner editable">${taskPanel('zh', { hoverFirst: true })}</div></div></div>
      <div class="board"><div class="board-label"><b>改前</b> · English · 真实截图</div><div class="stage"><div class="stage-inner">${shot('task-center-before-en.png', '任务面板改前（英文）')}</div></div></div>
      <div class="board"><div class="board-label"><b>提议</b> · English</div><div class="stage"><div class="stage-inner editable">${taskPanel('en')}</div></div></div>
    </div>
    <ul class="notes">
      <li>「等你处理」在最上面，两行各有常驻的「重新拉取」；中文稿里「小鹿」那颗画的是悬停时的说明。</li>
      <li>在跑的那张卡：状态签写它所在分组的名字「进行中」（不再是「等待确认」），流程名写「镜头生成」（不再是 <code>generation.single-shot</code>），阶段数带单位「0 / 4 个阶段已完成」。这几条是修错，不需要拍板。</li>
      <li>两行「Nomi 制作 · generation.single-shot / 等待开始」不再出现：它们是 Agent 拟好但没出价的草稿，什么都没在跑。草稿本身还在画布上。</li>
      <li>顶栏按钮数字（D2-A）：这一屏是 3（2 等你处理 + 1 进行中）。</li>
    </ul>
  </section>

  <section class="block" aria-labelledby="h-code">
    <div><h2 id="h-code">Agent 回复里的代码块</h2><p class="h2-note">现场：Agent 按用户截图那样回了中文提示词、英文提示词和一段 JSON 参数。消息列 354 宽，与改前截图同宽。</p></div>
    <div class="pairs">
      <div class="board"><div class="board-label"><b>改前</b> · 中文 · 真实截图</div><div class="stage"><div class="stage-inner">${shot('code-block-before-zh.png', '代码块改前（中文界面）').replace('class="shot"', 'class="shot shot-plain"')}</div></div></div>
      <div class="board"><div class="board-label"><b>提议</b> · 中文 · D3-A / D4-A / D5-A</div><div class="stage"><div class="stage-inner editable">${codeBoard('zh')}</div></div></div>
      <div class="board"><div class="board-label"><b>改前</b> · English · 真实截图</div><div class="stage"><div class="stage-inner">${shot('code-block-before-en.png', '代码块改前（英文界面）').replace('class="shot"', 'class="shot shot-plain"')}</div></div></div>
      <div class="board"><div class="board-label"><b>提议</b> · English · 悬停复制</div><div class="stage"><div class="stage-inner editable">${codeBoard('en', { hover: true })}</div></div></div>
    </div>
    <ul class="notes">
      <li>回复正文是模型写的，中英界面里内容相同；界面语言只影响复制钮的说明（复制 / Copy，点后 2 秒显示「已复制 / Copied」）。</li>
      <li>一层框：外框 6px 圆角、<code>--nomi-line</code> 描边、<code>--nomi-ink-05</code> 底；复制钮 24px、图标 14px、平时 <code>--nomi-ink-40</code>。</li>
      <li>两段提示词用正文字体（13px），JSON 仍是等宽（12px）。</li>
    </ul>
    <div class="alts">
      <div class="alt"><div class="board-label"><b>D1-B</b> · 按钮悬停才出现</div><div class="stage"><div class="stage-inner"><div class="panel" style="width:300px"><div class="row"><div class="row-main"><div class="row-title">小鹿</div><div class="row-sub">等待超时 · 上游可能仍在跑</div></div><span class="ghost-pill">悬停才出现</span></div></div></div></div></div>
      <div class="alt"><div class="board-label"><b>D3-B</b> · 保留细标题行</div><div class="stage"><div class="stage-inner"><div class="msg">${fence(JSON_LINE, { kind: 'code', copyLabel: '复制', header: 'json' })}</div></div></div></div>
      <div class="alt"><div class="board-label"><b>D4-B</b> · 代码横向滚动</div><div class="stage"><div class="stage-inner"><div class="msg">${fence(JSON_LINE, { kind: 'code', copyLabel: '复制', scroll: true })}</div></div></div></div>
      <div class="alt"><div class="board-label"><b>D5-B</b> · 没标语言的 JSON 用正文字体</div><div class="stage"><div class="stage-inner"><div class="msg">${fence(JSON_LINE, { kind: 'prose', copyLabel: '复制' })}</div></div></div></div>
    </div>
  </section>

  <section class="block" aria-labelledby="h-ref">
    <div><h2 id="h-ref">两家参考：拿了什么、没拿什么</h2><p class="h2-note">按 2026-09-01 定案：Beautiful UI 优先、AI Elements 其次；任务行对应定案表第 11/12/15 行（Beautiful UI · Task Rows）。2026-09-25 看的线上页面。</p></div>
    <div class="table-wrap"><table>
      <thead><tr><th>参考</th><th>拿了</th><th>没拿，为什么</th></tr></thead>
      <tbody>
        <tr><td><a href="https://www.beautifului.dev/#task-rows" target="_blank" rel="noreferrer">Beautiful UI · Task Rows</a></td><td>一行 = 标题 + 灰色补充 + 行尾一个元素（我们的行尾是那颗动作钮）。</td><td>每行的状态圈、状态徽章、展开箭头：分组标题已经说了状态，每行再贴一次是重复（认知负荷）；点行已经是「去画布找这个节点」，不能再兼作展开（领域约束）。</td></tr>
        <tr><td><a href="https://www.beautifului.dev/#code-block" target="_blank" rel="noreferrer">Beautiful UI · Code Block</a></td><td>一个容器、一颗小的复制钮。</td><td>文件名标题栏和行号：对话里的块没有文件名，多数是提示词，行号对文字是噪音（领域约束）。</td></tr>
        <tr><td><a href="https://elements.ai-sdk.dev/components/code-block" target="_blank" rel="noreferrer">AI Elements · Code Block</a></td><td>只有图标的复制钮、点后 2 秒变勾（Streamdown 自带，同一上游）；默认不显示行号。</td><td>带语言选择器的标题行：同上，交给 D3 由你定。</td></tr>
        <tr><td><a href="https://elements.ai-sdk.dev/components/queue" target="_blank" rel="noreferrer">AI Elements · Queue</a></td><td>分组 = 「名字 + 数量」一行；已完成的弱化。</td><td>动作悬停才出：「等你处理」那颗按钮就是这一行存在的理由，藏起来要用户去猜（认知负荷），见 D1。</td></tr>
        <tr><td><a href="https://elements.ai-sdk.dev/components/task" target="_blank" rel="noreferrer">AI Elements · Task</a></td><td>—</td><td>可折叠步骤列表：制作卡已经有「制作详情」折叠，再加一层就是同一件事的第二个入口（一功能一个家）。</td></tr>
      </tbody>
    </table></div>
  </section>

  <section class="block" aria-labelledby="h-path">
    <div><h2 id="h-path">卡点表：等待超时的那一行</h2><p class="h2-note">一步（点「重新拉取」），砍不掉：拉取必须是用户点的，自动拉会在他不知道时写进画布。</p></div>
    <div class="table-wrap"><table>
      <thead><tr><th>问题</th><th>答案</th><th>证据</th></tr></thead>
      <tbody>
        <tr><td>怎么知道有这件事</td><td>顶栏数字（D2-A）→ 面板最上面「等你处理 2」→ 行上常驻按钮。</td><td>本样张；PR 当前实现在第二组</td></tr>
        <tr><td>动手前知不知道代价</td><td>悬停说明「只查结果，不重新生成，不花钱」。</td><td>拉取走 <code>recoverNodeResult</code>，只查询、不铸付费令牌（<code>src/workbench/generationCanvas/runner/recoverTaskActions.ts</code>）</td></tr>
        <tr><td>错了看到什么</td><td>还没出片：行留在「等你处理」，可再点。网络出错：行同样留下，但行上看不到出错原因，只在画布节点上有——<b>这次不做</b>，因为原因住在节点上，面板再抄一份就是第二个地方。</td><td>同文件第 109、127 行把节点退回可重新拉取</td></tr>
        <tr><td>凭什么信结果</td><td>拉到后这一行移到「已完成」、显示「已保存到项目」；点这一行去画布看到图。</td><td>PR 的 <code>generationRowState</code></td></tr>
      </tbody>
    </table></div>
  </section>

  <section class="block" aria-labelledby="h-cut">
    <div><h2 id="h-cut">没放上去的</h2></div>
    <div class="table-wrap"><table>
      <thead><tr><th>没放</th><th>为什么</th><th>要用时去哪找</th></tr></thead>
      <tbody>
        <tr><td>行上的「标记失败」</td><td>低频，节点卡上已经有，面板再放是第二个入口。</td><td>点这一行 → 画布上那个节点的超时卡</td></tr>
        <tr><td>每行的状态圈 / 徽章</td><td>分组标题已经说了状态。</td><td>分组标题</td></tr>
        <tr><td>代码块的语言名、行号</td><td>见 D3；行号对提示词没用。</td><td>选 D3-B 就回来</td></tr>
        <tr><td>没出价的 Agent 草稿</td><td>什么都没在跑、也不在等你。</td><td>画布上的草稿节点、Agent 面板</td></tr>
      </tbody>
    </table></div>
  </section>
</main>

<script>
(() => {
  const toggle = document.getElementById('edit-toggle')
  const boards = () => document.querySelectorAll('.editable')
  const KEY = 'nomi-mockup-edit'
  function set(on) {
    toggle.setAttribute('aria-pressed', String(on))
    toggle.textContent = on ? '改完了' : '改文案'
    boards().forEach((el) => { el.contentEditable = on ? 'true' : 'false'; el.spellcheck = false })
    try { localStorage.setItem(KEY, on ? '1' : '0') } catch (_) {}
  }
  let initial = false
  try { initial = localStorage.getItem(KEY) === '1' } catch (_) {}
  set(initial)
  toggle.addEventListener('click', () => set(toggle.getAttribute('aria-pressed') !== 'true'))
})()
</script>
`

fs.writeFileSync(path.join(here, 'index.html'), html, 'utf8')
console.log('wrote', path.relative(repo, path.join(here, 'index.html')), `${Math.round(html.length / 1024)} KB`)
