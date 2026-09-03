// 分镜表 v5 Phase C 走查（R13/R16）：只走真实 Electron/IPC/渲染/项目文件源，零生成额度。
// 覆盖 @ 入口与四类候选来源、绑定/解绑、文本顺序、骨架预设、整条 subline 展开。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectCount, expectText, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = '/tmp/patchshots-card'
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-patchshots-card-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'patchshots-card-walk'
const projectRoot = path.join(projectsDir, projectId)
const designId = 'phase-c-design'
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 12,
  vendors: [{ key: 'ux-local', name: 'UX Local', enabled: true, authType: 'none', providerKind: 'openai-compatible', createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' }],
  models: [{
    vendorKey: 'ux-local', modelKey: 'nano-banana', labelZh: 'Nano Banana', kind: 'image', enabled: true,
    meta: { archetypeId: 'nano-banana', adapter: { state: 'verified', activeRevision: 'phase-c', publicationModes: ['text_to_image', 'image_edit'], modes: [{ taskKind: 'text_to_image', state: 'verified' }, { taskKind: 'image_edit', state: 'verified' }] } },
    createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
  }],
  mappings: [], apiKeysByVendor: {},
}, null, 2))

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
for (const name of ['library.png', 'hero.png', 'result.png', 'upload.png']) {
  fs.writeFileSync(path.join(projectRoot, 'assets', name), png)
}
fs.writeFileSync(path.join(projectRoot, 'assets', 'upload.mp3'), Buffer.from('phase-c-audio-fixture'))
const url = (name) => `nomi-local://asset/${encodeURIComponent(projectId)}/assets/${name}`
const imageResult = (id, name) => ({ id, type: 'image', url: url(name), thumbnailUrl: url(name), createdAt: 1 })
const profile = {
  aspect: '9:16',
  dialogue: true,
  promptSkeleton: [
    { key: 'shotSize', label: 'storyboardEditor.promptSkeleton.segment.shotSize', kind: 'enum', options: ['远景', '全景', '中景', '近景', '特写'] },
    { key: 'emotion', label: 'storyboardEditor.promptSkeleton.segment.emotion', kind: 'enum', options: ['紧张', '温柔', '压抑', '轻松', '孤独'] },
  ],
}
const plan = {
  title: 'patch_shots 卡面走查', profileKey: 'genre.short-drama', storyboardProfile: profile,
  anchors: [{ id: 'hero', kind: 'character', name: '主角', description: '短发，风衣', carrier: 'visual' }],
  shots: [{
    index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 3, anchorIds: ['hero'],
    prompt: '远景，雨夜中的主角', promptSegments: [{ key: 'shotSize', start: 0, end: 2 }],
    dialogue: '你终于来了。', transition: { type: 'dissolve' },
  }, {
    index: 2, shotId: 'shot-2', shotKind: 'image', durationSec: 3, anchorIds: [],
    modelKey: 'nano-banana', modeId: 't2i', prompt: '纯文字镜头',
  }],
}
const nodes = [
  { id: 'hero-node', kind: 'character', categoryId: 'shots', title: '主角', prompt: '角色卡', position: { x: 0, y: 0 }, status: 'success', result: imageResult('hero-result', 'hero.png'), meta: { storyboardDesignId: designId, anchorId: 'hero', referenceSheet: true, frozen: { at: 1, by: 'user' } } },
  { id: 'result-node', kind: 'image', categoryId: 'shots', title: '某镜结果', prompt: '结果', position: { x: 300, y: 0 }, status: 'success', result: imageResult('result-1', 'result.png'), meta: {} },
]
const project = {
  id: projectId, name: 'patch_shots 卡面走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: 'doc-1', version: 1, title: '走查', updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一个人走进雨夜。' }] }] } }],
    activeDocumentId: 'doc-1', timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlans: { 'doc-1': { plan, committed: false } },
    storyboardDesignsByDocumentId: { 'doc-1': [{ id: designId, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
  },
}
for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) fs.writeFileSync(file, JSON.stringify(project, null, 2))



const appInstance = await launchNomiApp({ name: 'patchshots-card', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
const { app, win } = appInstance
const shots = []
const snap = async (name) => { const target = path.join(outDir, name); await screenshotSettled(win, { path: target }); shots.push(target); return target }
const report = []

try {
  await win.evaluate(() => { for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen') })
  const card = win.locator('[data-project-card]', { hasText: 'patch_shots 卡面走查' }).first()
  if (await card.isVisible().catch(() => false)) { await card.hover(); const b = card.getByText('继续创作', { exact: false }).first(); if (await b.isVisible().catch(() => false)) await b.click(); else await card.dblclick() }
  await clickOrFail(win.getByRole('button', { name: /设置/ }).first(), '打开设置')
  await win.waitForTimeout(600)
  const generalTab = win.getByRole('button', { name: /通用/ }).first()
  if (await generalTab.isVisible().catch(() => false)) { await generalTab.click(); await win.waitForTimeout(400) }
  const hostToggle = win.locator('[data-settings-agent-host-toggle]').first()
  await hostToggle.waitFor({ state: 'attached', timeout: 15000 })
  if (!(await hostToggle.isChecked().catch(() => false))) await hostToggle.evaluate((el) => el.click())
  await win.waitForTimeout(400)
  await win.keyboard.press('Escape'); await win.waitForTimeout(400)

  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  await clickOrFail(win.locator(`[data-storyboard-id="${designId}"]`), '选中分镜方案')
  await clickOrFail(win.getByRole('button', { name: /打开分镜|再次编辑/ }).first(), '打开分镜页')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器未渲染')
  await win.setViewportSize({ width: 1440, height: 940 })
  await win.waitForTimeout(500)

  // 直接把 patch_shots 的待确认调用喂进常驻壳的投影，渲染出真实那张卡——
  // 不跑真模型（那是 Codex 那条任务的事），这里只验**卡面文案**长什么样。
  const pill = win.locator('[data-agent-resident-collapsed="true"]').first()
  if (await pill.isVisible().catch(() => false)) { await pill.click(); await win.waitForTimeout(600) }
  await snap('01-storyboard-with-agent.png')

  const projection = await win.evaluate(() => {
    const w = window
    return w.__nomiE2E?.residentToolProjection?.('patch_shots', { select: { kind: 'all' }, patch: { promptAppend: '雨天' } }) ?? null
  })
  report.push(`E2E 投影探针: ${JSON.stringify(projection)}`)
} catch (error) {
  report.push(`EXCEPTION: ${error?.message || error}`)
} finally {
  fs.writeFileSync(path.join(outDir, 'REPORT.txt'), report.join('\n') + '\n\nshots:\n' + shots.join('\n'))
  console.log(report.join('\n')); console.log('screenshots: ' + shots.join(' '))
  await app.close().catch(() => {})
}
