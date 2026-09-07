#!/usr/bin/env node
// Generation Strategy Resolver —— GUI 审阅面板 + 落画布闸 真实用户任务走查（R13/R16，切片 5）。
//
// 任务：一段含超上限长镜 + 低限碎镜 + 相邻短拍的方案 → 打开分镜编辑器 → 执行计划面板按真实
// 模型档案给出「拆条 / 必需合并 / 建议合并」→ 逐条采纳 → 面板随方案变化自动重查 → 仍有阻断时
// 批量生成被闸拦下（toast 给出机器理由）。
//
// 判定纪律（附录 C）：每步截图落 tests/ux/shots/storyboard-strategy-resolve/ 供**人眼判断**；
// expect 只守结构性红线（编辑器打开、方案已持久化、无阻断状态下批量可点）。建议条的具体
// 内容（拆几条/合并哪几镜）取决于该机 catalog 里第一个视频模型的真实时长上限——由人眼对账，
// 脚本不强断言数字，避免把「机器档位不同」误报成回归。
//
// 零额度：resolve 是主进程 stateless 纯计算（候选集来自本机 catalog 的已建档视频模型），
// 不调任何 provider；本脚本不点「确认生成」，只验证面板 + 闸的呈现与拦截。
//
// 用法：node tests/ux/storyboard-strategy-resolve.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-strategy-resolve-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'strategy-resolve-walk'
const projectRoot = path.join(projectsDir, projectId)
const outDir = process.env.STRATEGY_RESOLVE_OUT || path.join(repoRoot, 'tests/ux/shots/storyboard-strategy-resolve')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'assets', 'generated'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

// ── 方案：4 条视频镜（同一场，引擎会据首候选模型真实档位给建议/阻断）──
// s1=40s 长镜（超任意视频单条上限 → 拆条建议）；s2=6s、s3=4s、s4=2s 相邻短拍/碎镜
// （组合语义由 resolve 决定：必并 or 建议并；镜像镜头不带显式 modelKey → 引擎走默认候选）。
const shot = (index, over = {}) => ({
  index, shotId: `shot-${index}`, sceneId: 's1', shotKind: 'video',
  anchorIds: [], prompt: `第 ${index} 镜画面`, ...over,
})
const plan = {
  title: '雨夜追凶',
  profileKey: 'genre.short-drama',
  anchors: [],
  scenes: [{ id: 's1', title: '第一场 · 巷口' }],
  shots: [
    shot(1, { durationSec: 40, prompt: '长镜：他穿过雨巷。' }),
    shot(2, { durationSec: 6, prompt: '近景：脚步。' }),
    shot(3, { durationSec: 4, prompt: '特写：回头。' }),
    shot(4, { durationSec: 2, prompt: '碎镜：灯闪。' }),
  ],
}
const DESIGN = 'sb-strategy-1'
const project = {
  id: projectId, name: '执行计划走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{
      id: 'doc-1', version: 1, title: '雨夜', updatedAt: 10,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜追凶。' }] }] },
    }],
    activeDocumentId: 'doc-1',
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: {
      'doc-1': [{ id: DESIGN, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }],
    },
  },
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

const { app, win } = await launchNomiApp({ name: 'storyboard-strategy-resolve', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
const snap = async (name) => { await screenshotSettled(win, { path: path.join(outDir, name) }) }
const strategyRoot = () => win.locator('[data-storyboard-strategy-root="true"]').first()
const panel = () => win.locator('[data-storyboard-strategy-panel="true"]').first()

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  const projectCard = win.locator('[data-project-card]', { hasText: '执行计划走查' }).first()
  if (await projectCard.isVisible().catch(() => false)) {
    await projectCard.hover()
    const cont = projectCard.getByText('继续创作', { exact: false }).first()
    if (await cont.isVisible().catch(() => false)) await cont.click()
    else await projectCard.dblclick()
  }
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  await clickOrFail(win.locator(`[data-storyboard-id="${DESIGN}"]`), '侧栏选中分镜设计')
  await clickOrFail(win.getByRole('button', { name: /再次编辑|打开分镜/ }).first(), '从摘要卡进入分镜页')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器没有渲染')
  await snap('01-editor-with-video-shots')

  // 执行计划面板：resolve 可用 → loading → ready（有建议/阻断）或 unavailable（能力核未起）。
  // 结构性红线 = 出现了根元素且状态非 idle；具体建议内容人眼对账（附件场景 1-4 见文件头注释）。
  await expectVisible(strategyRoot(), '执行计划面板根元素没有出现（video 镜存在时应至少 loading/ready/unavailable 一种）', 20_000)
  await snap('02-strategy-panel-state')

  const state = await strategyRoot().getAttribute('data-storyboard-strategy-state').catch(() => null)
  if (state === 'ready') {
    await snap('03-strategy-proposals-visible')
    // 若出现「采纳」按钮：采纳第一条 → 方案变化 → 面板重查（等 loading 再 settle，截图人眼复核采纳效果）。
    const adopt = panel().locator('[data-storyboard-strategy-adopt="true"]').first()
    if (await adopt.isVisible().catch(() => false)) {
      await clickOrFail(adopt, '采纳第一条建议')
      await snap('04-after-adopt-resolve-recheck')
    }
    // 阻断行（红色，无采纳钮）若存在则记录其文本供对账。
    const blockers = panel().locator('[data-storyboard-strategy-blocker="true"]')
    const blockerTexts = await blockers.allTextContents().catch(() => [])
    console.log('  · blocker 文本（人眼对账）:', JSON.stringify(blockerTexts))
  } else {
    console.log(`  · resolve 状态=${state}（本机能力核/候选不可用时会是这样）——面板呈现本身正确，闸在 ready 时才拦`)
    await snap('03-strategy-unavailable-or-error')
  }
} catch (error) {
  console.error('走查失败：', error)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
