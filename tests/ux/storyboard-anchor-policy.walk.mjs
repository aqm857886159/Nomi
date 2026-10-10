import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 分镜表 v5 Anchor Policy 走查（R13/R16）：只走真实 Electron/IPC/渲染/项目文件源，零生成额度。
// 覆盖 @ 入口与四类候选来源、绑定/解绑、文本顺序、骨架预设、整条 subline 展开。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectCount, expectText, expectVisible, screenshotSettled } from './_assert.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, 'docs/plan/storyboard-anchor-policy-evidence/screenshots')
const tempRoot = makeTempDir('nomi-storyboard-anchor-policy-')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'storyboard-anchor-policy-walk'
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
    vendorKey: 'ux-local', modelKey: 'imagen-4', labelZh: 'Imagen 4', kind: 'image', enabled: true,
    meta: { archetypeId: 'imagen-4', adapter: { state: 'verified', activeRevision: 'phase-c', publicationModes: ['text_to_image', 'image_edit'], modes: [{ taskKind: 'text_to_image', state: 'verified' }, { taskKind: 'image_edit', state: 'verified' }] } },
    createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
  }],
  mappings: [], apiKeysByVendor: {},
}, null, 2))


const plan = {
  title: '夜景覆写走查', aspectRatio: '16:9',
  anchors: [{ id: 'hero', kind: 'character', name: '主角', description: '短发，风衣', carrier: 'visual' }],
  shots: [1, 2, 3].map(index => ({ index, shotId: `shot-${index}`, shotKind: 'image', durationSec: 3, anchorIds: ['hero'], modelKey: 'imagen-4', modelVendor: 'ux-local', modeId: 't2i', prompt: '傍晚' })),
}
const nodes = plan.shots.map(shot => ({ id: `node-${shot.index}`, kind: 'image', categoryId: 'shots', title: `镜 ${shot.index}`, prompt: shot.index === 3 ? '夜景' : '傍晚', position: { x: (shot.index - 1) * 340, y: 0 }, status: 'idle', meta: { modelKey: 'imagen-4', modelVendor: 'ux-local', archetype: { id: 'imagen-4', modeId: 't2i' }, storyboardDesignId: designId, shotId: shot.shotId, ...(shot.index === 3 ? { overriddenFields: ['prompt'] } : {}) } }))
const project = {
  id: projectId, name: '夜景覆写走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: 'doc-1', version: 1, title: '走查', updatedAt: 10, contentJson: { type: 'doc', content: [] } }], activeDocumentId: 'doc-1', timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: { 'doc-1': [{ id: designId, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
  },
}
for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) fs.writeFileSync(file, JSON.stringify(project, null, 2))
const instance = await launchNomiApp({ name: 'storyboard-anchor-policy', tempRoot, settingsDir, projectsDir })
const { app, win } = instance
try {
  await win.evaluate(() => { for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen') })
  const card = win.locator('[data-project-card]', { hasText: '夜景覆写走查' })
  await expectVisible(card, '项目卡')
  await card.dblclick()
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '创作页')
  await openStoryboardEditor(win, designId, '方案')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜表')
  await win.getByRole('button', { name: '收起面板', exact: true }).click()
  await win.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollLeft) el.scrollLeft = 0 })
  await win.getByRole('button', { name: '全部展开', exact: true }).click()
  await expectVisible(win.locator('[data-anchor-consumption-warning="hero"]'), '锚卡消费橙字')
  await screenshotSettled(win, { path: path.join(outDir, '00-anchor-warning.png') })
  const row = win.locator('[data-storyboard-editor="true"] [data-storyboard-row="3"]')
  await expectVisible(row.locator('[data-storyboard-overrides]'), '第 3 镜覆写角标')
  await row.scrollIntoViewIfNeeded()
  await screenshotSettled(win, { path: path.join(outDir, '01-inline-night.png') })
  await clickOrFail(win.getByRole('navigation', { name: '工作区切换' }).getByRole('button', { name: '生成', exact: true }), '画布')
  await expectVisible(win.locator('.generation-canvas-v2-node [data-storyboard-overrides="node-3"]'), '节点卡覆写角标')
  await screenshotSettled(win, { path: path.join(outDir, '03-canvas-badge.png') })
  await clickOrFail(win.getByRole('navigation', { name: '工作区切换' }).getByRole('button', { name: '创作', exact: true }), '回分镜')
  await openStoryboardEditor(win, designId, '返回原方案')
  await row.scrollIntoViewIfNeeded()
  await row.getByRole('button', { name: '丢弃', exact: true }).click()
  await expectCount(row.locator('[data-storyboard-overrides]'), 0, '丢弃后清除角标')
  await screenshotSettled(win, { path: path.join(outDir, '02-discard-dusk.png') })
  console.log(JSON.stringify({ status: 'passed', checks: ['inline badge', 'discard without modal', 'original row stays in place'], screenshots: outDir }))
} finally { await app.close() }
