#!/usr/bin/env node
import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 执行计划面板的「没有可用视频模型」态（R13，返工 6）。
//
// 为什么单独一条：这是同一块 UI 的**另一个真实结局**，而且是最容易被做坏的那个——
// 上一版把内部错误码 `generation_core_unavailable` 直接摆给用户看（「执行计划暂不可用
// （generation_core_unavailable）」），既不是人话也没有下一步。现在它必须是：
// 一句人话说清发生了什么 + 一枚「去设置」把人送到能解决的地方（R2 / D4）。
//
// 怎么造出这个现场（不许用假旁路）：内置种子会往新装机里种 50+ 条可用视频模型，
// 所以先起一次让种子写完 catalog，再把**所有** kind=video 的模型 enabled 置 false，
// 然后冷启动。种子「不碰 enabled（那是用户数据）」，于是第二次启动时候选集真的是空的——
// 与「用户把视频模型全关了」在生产里走的是同一条路。
//
// 零额度：没有候选模型，连 resolve 都算不出东西，更不会碰任何 provider。
//
// 用法：node tests/ux/storyboard-strategy-no-model.walk.mjs
//   STRATEGY_RESOLVE_SCHEME=dark / STRATEGY_RESOLVE_OUT=<dir> 同主走查
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { applyColorSchemeForShot, clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = makeTempDir('nomi-strategy-no-model-')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'strategy-no-model-walk'
const projectRoot = path.join(projectsDir, projectId)
const scheme = process.env.STRATEGY_RESOLVE_SCHEME === 'dark' ? 'dark' : 'light'
const outDir = process.env.STRATEGY_RESOLVE_OUT || path.join(repoRoot, 'tests/ux/shots/storyboard-strategy-resolve')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

const DESIGN = 'sb-no-model-1'
const plan = {
  title: '雨夜追凶',
  profileKey: 'genre.short-drama',
  anchors: [],
  scenes: [{ id: 's1', title: '第一场 · 巷口' }],
  shots: [
    { index: 1, shotId: 'shot-1', sceneId: 's1', shotKind: 'video', anchorIds: [], durationSec: 8, prompt: '长镜：他穿过雨巷。' },
    { index: 2, shotId: 'shot-2', sceneId: 's1', shotKind: 'video', anchorIds: [], durationSec: 6, prompt: '近景：脚步踩进积水。' },
  ],
}
const project = {
  id: projectId, name: '无视频模型走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
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

// 第一次启动：只为让 ensureBuiltinModelSeeds 把内置模型写进 catalog。
{
  const seedRun = await launchNomiApp({ name: 'storyboard-strategy-no-model-seed', tempRoot, settingsDir, projectsDir, settleMs: 800 })
  await seedRun.app.close().catch(() => undefined)
}
const catalogFile = path.join(settingsDir, 'model-catalog.json')
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
const videoModels = catalog.models.filter((model) => model.kind === 'video')
if (videoModels.length === 0) {
  throw new Error('内置种子没有种出任何视频模型 —— 这一轮造不出「有模型 → 关掉 → 没模型」的对照，结论不作数')
}
for (const model of videoModels) model.enabled = false
fs.writeFileSync(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`  · 已关闭 ${videoModels.length} 条内置视频模型（种子不碰 enabled，重启后候选集为空）`)

const { app, win } = await launchNomiApp({ name: 'storyboard-strategy-no-model', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
const strategyRoot = () => win.locator('[data-storyboard-strategy-root="true"]').first()

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await applyColorSchemeForShot(win, scheme)

  const projectCard = win.locator('[data-project-card]', { hasText: '无视频模型走查' }).first()
  if (await projectCard.isVisible().catch(() => false)) {
    await projectCard.hover()
    const cont = projectCard.getByText('继续创作', { exact: false }).first()
    if (await cont.isVisible().catch(() => false)) await cont.click()
    else await projectCard.dblclick()
  }
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  await openStoryboardEditor(win, DESIGN, '从侧栏进入分镜方案')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器没有渲染')

  await expect(strategyRoot(), '没有视频模型时，面板应当进入 no-video-model 态（而不是把内部错误码摆出来）')
    .toHaveAttribute('data-storyboard-strategy-state', 'no-video-model', { timeout: 20_000 })
  await expectVisible(
    win.locator('[data-storyboard-strategy-settings="true"]'),
    '「去设置」下一步没有出现 —— 只告诉用户「不可用」而不给出路，等于没说',
  )
  await expect(strategyRoot(), '面板里仍然出现了内部错误码，说明人话那一层没生效')
    .not.toContainText('generation_core_unavailable')
  await screenshotSettled(strategyRoot(), { path: path.join(outDir, `06-no-video-model.${scheme}.png`) })
  console.log(`  · no-video-model 态取证（${scheme}）→ ${outDir}`)
} catch (error) {
  console.error('走查失败：', error)
  await win.screenshot({ path: path.join(outDir, `99-no-model-FAIL.${scheme}.png`) }).catch(() => undefined)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
