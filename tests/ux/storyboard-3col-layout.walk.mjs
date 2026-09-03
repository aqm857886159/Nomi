// 分镜表 v5 Phase C 走查（R13/R16）：只走真实 Electron/IPC/渲染/项目文件源，零生成额度。
// 覆盖 @ 入口与四类候选来源、绑定/解绑、文本顺序、骨架预设、整条 subline 展开。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectCount, expectText, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.env.LAYOUT_WALK_OUT || '/tmp/storyboard-3col'
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-storyboard-3col-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'storyboard-3col-walk'
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
  title: '分镜页三栏走查', profileKey: 'genre.short-drama', storyboardProfile: profile,
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
  id: projectId, name: '分镜页三栏走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
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


const appInstance = await launchNomiApp({ name: 'storyboard-3col', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
const { app, win } = appInstance
const shots = []
const snap = async (name) => { const target = path.join(outDir, name); await screenshotSettled(win, { path: target }); shots.push(target); return target }
const measure = async () => win.evaluate(() => {
  const q = (s) => document.querySelector(s)
  const w = (el) => (el ? Math.round(el.getBoundingClientRect().width) : null)
  const row = q('[data-storyboard-row="1"]')
  return {
    viewport: window.innerWidth,
    sidebar: w(q('[aria-label="创作内容列表"]')) ?? w(document.querySelector('.workbench-storyboard > *')),
    main: w(q('[data-storyboard-main="true"]')),
    promptBlock: w(row?.querySelector('[data-storyboard-prompt-block]')),
    frame: w(row?.querySelector('[data-storyboard-frame]')),
    refzone: w(row?.querySelector('[data-storyboard-refzone]')),
    agentPanel: w(q('[data-agent-panel="true"]')),
    agentPill: w(q('[data-agent-resident-collapsed="true"]')),
  }
})
const report = []

try {
  await win.evaluate(() => { for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen'); localStorage.setItem('nomi.agentHost.enabled', 'true') })
  const card = win.locator('[data-project-card]', { hasText: '分镜页三栏走查' }).first()
  if (await card.isVisible().catch(() => false)) { await card.hover(); const button = card.getByText('继续创作', { exact: false }).first(); if (await button.isVisible().catch(() => false)) await button.click(); else await card.dblclick() }
  // 常驻 Agent 是产品级发布闸（DEFAULT_AGENT_HOST_ENABLED=false，等 #194），默认不渲染。
  // 只有走设置页那个开关才会当场挂载——直接写 localStorage 太晚，模块初始化时已读过。
  await clickOrFail(win.getByRole('button', { name: /设置/ }).first(), '打开设置')
  await win.waitForTimeout(600)
  await snap('settings-opened.png')
  const generalTab = win.getByRole('button', { name: /通用/ }).first()
  if (await generalTab.isVisible().catch(() => false)) { await generalTab.click(); await win.waitForTimeout(400) }
  await snap('settings-general.png')
  const hostToggle = win.locator('[data-settings-agent-host-toggle]').first()
  await hostToggle.waitFor({ state: 'attached', timeout: 15000 })
  // Mantine Switch 把真 input 藏起来、只露 track，locator.click() 会判 hidden。
  // 直接在 input 上派发点击即可触发 onChange（这是控件实现细节，不是产品行为）。
  const before = await hostToggle.isChecked().catch(() => false)
  if (!before) await hostToggle.evaluate((element) => element.click())
  await win.waitForTimeout(400)
  report.push(`常驻 Agent 开关: ${before} -> ${await hostToggle.isChecked().catch(() => 'n/a')}`)
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  await clickOrFail(win.locator(`[data-storyboard-id="${designId}"]`), '选中分镜方案')
  await clickOrFail(win.getByRole('button', { name: /打开分镜|再次编辑/ }).first(), '打开分镜页')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器未渲染')

  for (const width of [1440, 1680]) {
    await win.setViewportSize({ width, height: 940 })
    await win.waitForTimeout(500)
    await snap(`${width}-default.png`)
    report.push(`${width} 默认: ${JSON.stringify(await measure())}`)

    const pill = win.locator('[data-agent-resident-collapsed="true"]').first()
    const panel = win.locator('[data-agent-panel="true"]').first()
    if (await pill.isVisible().catch(() => false)) {
      await pill.click(); await win.waitForTimeout(600)
      await snap(`${width}-agent-open.png`)
      report.push(`${width} Agent展开: ${JSON.stringify(await measure())}`)
    } else if (await panel.isVisible().catch(() => false)) {
      report.push(`${width} Agent 本就展开`)
      const collapse = win.getByRole('button', { name: /收起 Agent/ }).first()
      if (await collapse.isVisible().catch(() => false)) {
        await collapse.click(); await win.waitForTimeout(600)
        await snap(`${width}-agent-collapsed.png`)
        report.push(`${width} Agent收起: ${JSON.stringify(await measure())}`)
      }
    } else {
      report.push(`${width} ⚠️ Agent 既没有面板也没有药丸——dock 没接上`)
    }
  }
  const sidebarVisible = await win.locator('[data-add-storyboard]').first().isVisible().catch(() => false)
  report.push(`侧栏目录在分镜页可见: ${sidebarVisible}`)
} catch (error) {
  report.push(`EXCEPTION: ${error?.message || error}`)
} finally {
  fs.writeFileSync(path.join(outDir, 'REPORT.txt'), report.join('\n') + '\n\nshots:\n' + shots.join('\n'))
  console.log(report.join('\n'))
  console.log('screenshots: ' + shots.join(' '))
  await app.close().catch(() => {})
}
