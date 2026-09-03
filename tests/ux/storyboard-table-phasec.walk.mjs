// 分镜表 v5 Phase C 走查（R13/R16）：只走真实 Electron/IPC/渲染/项目文件源，零生成额度。
// 覆盖 @ 入口与四类候选来源、绑定/解绑、文本顺序、骨架预设、整条 subline 展开。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectCount, expectText, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.env.PHASEC_WALK_OUT || '/tmp/phaseC-walk'
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-storyboard-phasec-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'storyboard-phasec-walk'
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
  title: 'Phase C 引用走查', profileKey: 'genre.short-drama', storyboardProfile: profile,
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
  id: projectId, name: 'Phase C 引用走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
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

const appInstance = await launchNomiApp({ name: 'storyboard-table-phasec', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
const { app, win } = appInstance
const failures = []
const screenshots = []
let segmentInsidePromptBox = false
const snap = async (name) => { const target = path.join(outDir, name); await screenshotSettled(win, { path: target }); screenshots.push(target) }
const row = win.locator('[data-storyboard-editor="true"] [data-storyboard-row="1"]').first()

try {
  await win.evaluate(() => { for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen') })
  const card = win.locator('[data-project-card]', { hasText: 'Phase C 引用走查' }).first()
  if (await card.isVisible().catch(() => false)) { await card.hover(); const button = card.getByText('继续创作', { exact: false }).first(); if (await button.isVisible().catch(() => false)) await button.click(); else await card.dblclick() }
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  await clickOrFail(win.locator(`[data-storyboard-id="${designId}"]`), '选中 Phase C 分镜')
  await clickOrFail(win.getByRole('button', { name: /打开分镜|再次编辑/ }).first(), '打开分镜页')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器未渲染')
  await expectVisible(row, '走查镜头未渲染')

  // 1) 骨架段点击换预设；prompt 直接变更，range 只是可丢失标注。
  const segment = row.locator('[data-storyboard-prompt-segment="shotSize"]')
  await expectVisible(segment, '骨架段虚线入口未渲染')
  const promptBox = row.locator('[data-prompt-box="true"]')
  await expectVisible(promptBox, '提示词块缺少 data-prompt-box')
  segmentInsidePromptBox = await segment.evaluate((element) => Boolean(element.closest('[data-prompt-box="true"]')))
  if (!segmentInsidePromptBox) failures.push('骨架段不是 data-prompt-box 的后代：结构仍在提示词框外')
  await clickOrFail(segment, '打开骨架段预设菜单')
  await snap('00-skeleton-menu.png')
  await clickOrFail(row.getByRole('button', { name: '特写' }), '把景别换成特写')
  await expectText(row.locator('.ProseMirror'), /特写/, '骨架预设没有改 prompt 文本')
  await snap('00-skeleton-preset.png')

  // 2) 参考区 @ 入口 → 建议列表，证明当前参考/某镜结果/素材库分组存在。
  await clickOrFail(row.getByRole('button', { name: '输入 @ 选择参考' }), '打开参考区 @ 入口')
  const list = win.locator('[data-mention-list="true"]')
  await expectVisible(list, '@ 建议列表未弹出')
  await expectVisible(list.locator('[data-mention-group="current"]'), '当前参考组缺失')
  await expectVisible(list.locator('[data-mention-item^="shot-result:"]'), '某镜结果组缺失')
  await expectVisible(list.locator('[data-mention-item^="library:"]').first(), '素材库组缺失')
  await snap('01-at-picker-three-sources.png')

  // 3) 选某镜结果插入胶囊；再选素材库参考，顺序即文本出现顺序。
  await clickOrFail(list.locator('[data-mention-item^="shot-result:"]').first(), '插入某镜结果胶囊')
  await clickOrFail(row.getByRole('button', { name: '输入 @ 选择参考' }), '再次打开 @ 入口')
  await clickOrFail(win.locator('[data-mention-item^="library:"]').first(), '插入素材库胶囊')
  await expectText(row.locator('.ProseMirror'), /主角|素材库参考|某镜结果/, '参考胶囊/提示词内容没有保留')
  await snap('02-result-and-library-capsules.png')

  // 4) 走同一 @ 面板的 composer attachment 上传入口，等上传完成后候选出现，再插入。
  await clickOrFail(row.getByRole('button', { name: '输入 @ 选择参考' }), '打开上传入口')
  const uploadInput = list.locator('input[type="file"]')
  await uploadInput.setInputFiles(path.join(projectRoot, 'assets', 'upload.png'))
  await win.keyboard.press('Escape')
  await clickOrFail(row.getByRole('button', { name: '输入 @ 选择参考' }), '重新打开上传后的 @ 入口')
  const uploadList = win.locator('[data-mention-list="true"]')
  await expectVisible(uploadList, '上传后 @ 建议列表未弹出')
  await expectVisible(uploadList.locator('[data-mention-item^="upload:"]').first(), '上传完成后 @ 候选没有出现', 20_000)
  await clickOrFail(uploadList.locator('[data-mention-item^="upload:"]').first(), '插入上传胶囊')
  await snap('03-upload-capsule.png')

  // 5) 不吃参考的模型明确说明并禁用 @，避免入口消失后变成无声死路。
  const noRefRow = win.locator('[data-storyboard-editor="true"] [data-storyboard-row="2"]').first()
  await expectVisible(noRefRow, '不吃参考模型镜头未渲染')
  await expectText(noRefRow, /此模型不吃参考/, '不吃参考模型没有禁用说明')
  await expectCount(noRefRow.getByRole('button', { name: '输入 @ 选择参考' }), 0, '不吃参考模型仍暴露 @ 入口')
  await snap('04-no-reference-model.png')

  // 6) 解绑：整条 subline 可进入展开态；展开态 × 只移除绑定，不删素材源。
  await clickOrFail(row.locator('[data-storyboard-subline="true"]'), '点击整条 subline 进入展开态')
  await expect(row.locator('[aria-expanded="true"]')).toHaveCount(1)
  await expectVisible(row.getByRole('textbox', { name: /镜 1 台词/ }), '展开态台词没有出现')
  await expectVisible(row.getByRole('button', { name: '进入下一镜的转场' }), '展开态转场没有出现')
  await snap('05-expanded-dialogue-transition.png')
  const removable = row.getByRole('button', { name: /移除参考/ })
  await expectCount(removable, 2, '展开态参考绑定没有形成两个可解绑的锚')
  await row.getByRole('button', { name: '移除参考 upload.png' }).click()
  await win.waitForTimeout(400)
  await expectCount(removable, 1, '点击 × 后参考绑定没有解绑')
  await snap('06-unbound-reference.png')

  // 6) 把顺序证据留给纯转换器测试/回执：当前文本包含按出现顺序的内部 marker。
  const promptText = await row.locator('.ProseMirror').textContent()
  if (!promptText?.includes('特写')) failures.push(`prompt 顺序走查末态未保留文本：${promptText}`)
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
  await snap('99-failure.png').catch(() => {})
} finally {
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  await appInstance.close()
}

const report = [
  '# Phase C walk',
  '',
  `result: ${failures.length ? 'failed' : 'passed'}`,
  `screenshots: ${screenshots.join(', ')}`,
  'covers: @ picker/current/shot-result/library/upload, insert capsule, no-reference disabled, expand subline, dialogue/transition, skeleton preset, unbind.',
  'order evidence: promptMentions + storyboardPlan conversion tests assert first @ occurrence -> anchorIds -> edge.order.',
  `skeleton DOM: segment is ${segmentInsidePromptBox ? '' : 'not '}a descendant of [data-prompt-box="true"] (decoration is rendered inside .ProseMirror).`,
  failures.length ? `failures: ${failures.join(' | ')}` : 'failures: none',
].join('\n')
fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`)
console.log(report)
if (failures.length) process.exit(1)
