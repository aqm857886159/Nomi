#!/usr/bin/env node
/**
 * 大文稿项目的「切文稿」与「打开分镜方案」响应量具（性能场景 document-switch-after-storyboard / storyboard-plan-open）。
 *
 * 规模：160 份文稿、挂在第一份文稿下的一份 320 镜头方案。隔离资料目录、零花费、窗口在屏幕外。
 * 量法（同一套，不自写剖析器：tests/perf/canvas-scale/responseTimer.mjs，所有 response 类场景共用）：
 *   点击（捕获阶段）→ 目标界面在 DOM 里到位 → 再过两帧（样式重算 + 布局 + 绘制算进去）= 响应毫秒。
 *   document-switch：先「访问过分镜页」（打开方案再回创作页），之后在文稿下拉里交替切到最后一份 / 第一份。
 *   plan-open：每个样本冷启一次 App，从创作页点开方案，量到「首屏可编辑」：行区报出逻辑总数 320、视口里的行带着可编辑的提示词框。
 *     分镜表窗口化后只挂视口里的行（2026-10-16），「320 个行盒子都可见」不再成立也不该成立；停表后另验末镜够得着（滚到底、第 320 镜挂上）。
 *
 * 用法（先 pnpm run build）：
 *   node tests/perf/document-switch-bench.mjs --scenario document-switch|plan-open|document-switch-unvisited [--runs 5] [--label x] [--docs 160] [--shots 320] [--diag-out <目录>]
 * 产物：tests/perf/results/document-switch-<label>.json
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { launchCoreSmoke } from '../ux/core-smoke/fixture.mjs'
import { armResponse, takeResponse } from './canvas-scale/responseTimer.mjs'
import { IPC_PROBE_MODULE, startDiagnostics } from './canvas-scale/diagnostics.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const argValue = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }
const scenario = argValue('--scenario', 'document-switch')
const runs = Math.max(1, Number(argValue('--runs', 5)))
const label = argValue('--label', 'run')
const docCount = Number(argValue('--docs', 160))
const shotCount = Number(argValue('--shots', 320))
const WARMUP = 1
// 诊断腿：第一个计数样本打开方案的那一下抓 trace / 两个进程的 profile / IPC（数字不进基线）。
const diagOut = argValue('--diag-out', '')

const docId = (n) => `doc-${n}`
const docTitle = (n) => `文稿 ${String(n).padStart(3, '0')}`
const DESIGN = 'perf-plan'
const documents = Array.from({ length: docCount }, (_, i) => ({
  id: docId(i + 1), version: 1, title: docTitle(i + 1), updatedAt: 10 + i,
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `正文标记 ${docTitle(i + 1)}：夜里的街道，雨一直在下。` }] }] },
}))
const plan = {
  title: '大方案',
  anchors: [],
  shots: Array.from({ length: shotCount }, (_, i) => ({
    index: i + 1, shotId: `shot-${i + 1}`, shotKind: 'video', durationSec: 5, anchorIds: [],
    prompt: `镜头 ${i + 1}：人物穿过雨夜的街道，镜头跟拍。`, modelKey: 'doubao-seedance-2.5', modelVendor: 'apimart',
  })),
}

async function launch(suffix) {
  const smoke = await launchCoreSmoke({
    name: `docswitch-${suffix}`, needs: [], locale: 'zh-CN',
    seed: () => ({
      nodes: [], groups: [], edges: [],
      payload: {
        workbenchDocuments: documents, activeDocumentId: docId(1),
        storyboardDesignsByDocumentId: { [docId(1)]: [{ id: DESIGN, documentId: docId(1), title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
      },
    }),
    extras: {
      mainRequire: [path.join(repoRoot, 'tests', 'ux', '_quietWalk.cjs'), ...(diagOut ? [IPC_PROBE_MODULE] : [])],
      // 屏幕外窗口会被 Windows 判成被遮挡而停帧；关掉遮挡判定，量到的才是真的。
      env: { ELECTRON_EXTRA_LAUNCH_ARGS: '--disable-features=CalculateNativeWinOcclusion' },
    },
  })
  await smoke.openProject()
  const win = smoke.win
  await win.locator('.nomi-stepper__step[data-mode="creation"]').first().click()
  await win.locator('[data-creation-document-switcher]').first().waitFor({ timeout: 30000 })
  const raf = await win.evaluate(() => new Promise((resolve) => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t))) }))
  if (raf > 500) throw new Error(`rAF 不走（两帧 ${raf}ms），遮挡判定没关掉，量不准`)
  return smoke
}

// 计时器只有一个（概念 delivery.perf-response-timer）：点击（捕获阶段）起表，判据成立后再过两帧停表。
const collect = (win) => takeResponse(win)

async function openPlan(win, diag = null) {
  await win.locator('[data-creation-document-switcher]').first().click()
  const stopDiagnostics = diag ? await startDiagnostics({ page: win, app: diag.app, cdp: await diag.app.context().newCDPSession(win), outDir: path.resolve(diagOut), label: `plan-open-${shotCount}` }) : null
  await armResponse(win, { trigger: 'click', predicate: 'storyboardPlanOpenReady', arg: shotCount, timeoutMs: 120_000 })
  await win.getByRole('menuitem', { name: plan.title }).first().click()
  const result = await collect(win)
  if (stopDiagnostics) await stopDiagnostics()
  await assertLastShotReachable(win)
  return result
}
/** 停表之后（不计时）：滚到底，最后一镜必须挂上——窗口化不许把末镜弄丢。 */
async function assertLastShotReachable(win) {
  const reached = await win.evaluate(async (n) => {
    const scroll = document.querySelector('[data-storyboard-scroll]')
    if (!scroll) return false
    for (let i = 0; i < 60; i += 1) {
      scroll.scrollTop = scroll.scrollHeight
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      if (document.querySelector(`[data-storyboard-row="${n}"] [data-prompt-box]`)) return true
    }
    return false
  }, shotCount)
  if (!reached) throw new Error(`滚到底也没挂上第 ${shotCount} 镜：窗口化丢了末镜`)
  await win.evaluate(() => { const scroll = document.querySelector('[data-storyboard-scroll]'); if (scroll) scroll.scrollTop = 0 })
}
async function backToCreation(win) {
  await win.locator('.nomi-stepper__step[data-mode="creation"]').first().click()
  await win.locator('[data-creation-document-switcher]').first().waitFor()
  await win.waitForTimeout(600)
}
async function switchTo(win, n) {
  await win.locator('[data-creation-document-switcher]').first().click()
  const title = docTitle(n)
  await armResponse(win, { trigger: 'click', predicate: 'documentShown', arg: { title, marker: `正文标记 ${title}` }, timeoutMs: 60_000 })
  await win.getByRole('menuitemradio', { name: title }).first().click()
  const result = await collect(win)
  await win.waitForTimeout(800)
  return result
}
const hiddenRows = (win) => win.evaluate(() => [...document.querySelectorAll('[data-storyboard-row]')].filter((el) => el.getClientRects().length === 0).length)

const result = { scenario, label, docs: docCount, shots: shotCount, machine: `${os.platform()} ${os.cpus()[0]?.model?.trim()} x${os.cpus().length}`, samples: [] }
if (scenario === 'plan-open') {
  for (let i = 0; i < runs + WARMUP; i += 1) {
    const smoke = await launch(`open-${i}`)
    try {
      const r = await openPlan(smoke.win, diagOut && i === WARMUP ? { app: smoke.app } : null)
      if (i >= WARMUP) result.samples.push({ responseMs: Math.round(r.ms * 10) / 10, longTasks: r.longTasks })
      console.log(`[bench] plan-open #${i}${i < WARMUP ? '（预热）' : ''}: ${Math.round(r.ms)}ms longTasks=${r.longTasks}`)
    } finally { await smoke.close() }
  }
} else {
  const visited = scenario !== 'document-switch-unvisited'
  const smoke = await launch('switch')
  try {
    const win = smoke.win
    if (visited) { await openPlan(win); await backToCreation(win) }
    for (let i = 0; i < runs + WARMUP; i += 1) {
      const last = await switchTo(win, docCount)
      const hiddenAfterLast = await hiddenRows(win)
      const first = await switchTo(win, 1)
      const hiddenAfterFirst = await hiddenRows(win)
      if (i >= WARMUP) result.samples.push({ responseMs: Math.round(first.ms * 10) / 10, longTasks: first.longTasks, responseLastMs: Math.round(last.ms * 10) / 10, longTasksLast: last.longTasks, hiddenRowsAfterFirst: hiddenAfterFirst, hiddenRowsAfterLast: hiddenAfterLast })
      console.log(`[bench] ${scenario} #${i}${i < WARMUP ? '（预热）' : ''}: first ${Math.round(first.ms)}ms / last ${Math.round(last.ms)}ms hiddenRows ${hiddenAfterFirst}/${hiddenAfterLast}`)
    }
    // 冻结不能冻坏：切完文稿再打开方案，320 行必须到位（openPlan 超时就会抛）。
    const reveal = await openPlan(win)
    result.revealAfterSwitchesMs = Math.round(reveal.ms * 10) / 10
    console.log('[bench] 切完文稿后再打开方案：' + Math.round(reveal.ms) + 'ms，320 行到位')
  } finally { await smoke.close() }
}
const outDir = path.join(repoRoot, 'tests/perf/results')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, `document-switch-${label}.json`), JSON.stringify(result, null, 2))
console.log(`[bench] 结果：tests/perf/results/document-switch-${label}.json`)
process.exit(0)
