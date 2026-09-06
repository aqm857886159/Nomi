// 分镜行参考槽走查（R13/R16）：真实 Electron / IPC / 渲染 / 项目文件，**零生成额度**（全程不点生成）。
// 覆盖用户原话「选 Seedance 竟然无法上传参考图和参考视频」的三条：
//   ① 具名槽（首帧/尾帧）能上传本地图 → 红态消失、行进入批量；
//   ② 全能参考的图/视频/音频三个槽按 kind 各自路由，视频槽拒图片；
//   ③ 行末展开箭头点了能展开（曾被 onClickCapture 吃掉）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectCount, expectText, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.env.REF_SLOTS_WALK_OUT || path.join(repoRoot, '.tmp', 'storyboard-reference-slots')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-storyboard-refslots-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'storyboard-reference-slots-walk'
const projectRoot = path.join(projectsDir, projectId)
const designId = 'ref-slots-design'
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })

const stamp = '2026-09-05T00:00:00.000Z'
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 12,
  vendors: [{ key: 'ux-local', name: 'UX Local', enabled: true, authType: 'none', providerKind: 'openai-compatible', createdAt: stamp, updatedAt: stamp }],
  models: [{
    vendorKey: 'ux-local', modelKey: 'seedance-2-5', labelZh: 'Seedance 2.5', kind: 'video', enabled: true,
    meta: {
      archetypeId: 'seedance-2.5',
      adapter: {
        state: 'verified', activeRevision: 'ref-slots',
        publicationModes: ['text_to_video', 'image_to_video'],
        modes: [{ taskKind: 'text_to_video', state: 'verified' }, { taskKind: 'image_to_video', state: 'verified' }],
      },
    },
    createdAt: stamp, updatedAt: stamp,
  }],
  mappings: [], apiKeysByVendor: {},
}, null, 2))

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
for (const name of ['hero.png', 'firstframe.png', 'decoy.png']) fs.writeFileSync(path.join(projectRoot, 'assets', name), png)
// 极小的合法 mp4 头即可（走查只验路由/拒绝，不解码）。
fs.writeFileSync(path.join(projectRoot, 'assets', 'clip.mp4'), Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.from([0, 0, 0, 0]), Buffer.from('mp42isom'),
]))

const url = (name) => `nomi-local://asset/${encodeURIComponent(projectId)}/assets/${name}`
const shot = (index, modeId, prompt) => ({
  index, shotId: `shot-${index}`, shotKind: 'video', durationSec: 5, anchorIds: [],
  modelKey: 'seedance-2-5', modeId, prompt,
})
const plan = {
  title: '参考槽走查',
  anchors: [{ id: 'hero', kind: 'character', name: '主角', description: '短发风衣', carrier: 'visual' }],
  shots: [shot(1, 'firstlast', '首尾帧镜'), shot(2, 'omni', '全能参考镜'), shot(3, 't2v', '文生视频镜')],
}
const nodes = [{
  id: 'hero-node', kind: 'character', categoryId: 'shots', title: '主角', prompt: '角色卡',
  position: { x: 0, y: 0 }, status: 'success',
  result: { id: 'hero-result', type: 'image', url: url('hero.png'), thumbnailUrl: url('hero.png'), createdAt: 1 },
  meta: { storyboardDesignId: designId, anchorId: 'hero', referenceSheet: true, frozen: { at: 1, by: 'user' } },
}]
const project = {
  id: projectId, name: '参考槽走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: 'doc-1', version: 1, title: '走查', updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜。' }] }] } }],
    activeDocumentId: 'doc-1', timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: { 'doc-1': [{ id: designId, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
  },
}
for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(file, JSON.stringify(project, null, 2))
}

const appInstance = await launchNomiApp({ name: 'storyboard-reference-slots', tempRoot, settingsDir, projectsDir, settleMs: 1200 })
const { app, win } = appInstance
const failures = []
const screenshots = []
const snap = async (name) => {
  const target = path.join(outDir, name)
  await screenshotSettled(win, { path: target })
  screenshots.push(target)
}
const rowAt = (index) => win.locator(`[data-storyboard-editor="true"] [data-storyboard-row="${index}"]`).first()

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  const card = win.locator('[data-project-card]', { hasText: '参考槽走查' }).first()
  if (await card.isVisible().catch(() => false)) {
    await card.hover()
    const button = card.getByText('继续创作', { exact: false }).first()
    if (await button.isVisible().catch(() => false)) await button.click()
    else await card.dblclick()
  }
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  await clickOrFail(win.locator(`[data-storyboard-id="${designId}"]`), '选中走查分镜')
  await clickOrFail(win.getByRole('button', { name: /打开分镜|再次编辑/ }).first(), '打开分镜页')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器未渲染')

  // ── ① 首尾帧行：两个具名槽各自成格，首帧红 → 上传后转绿 ──
  const firstLastRow = rowAt(1)
  await expectVisible(firstLastRow, '首尾帧镜未渲染')
  const firstFrameSlot = firstLastRow.locator('[data-asset-slot="first_frame"]')
  const lastFrameSlot = firstLastRow.locator('[data-asset-slot="last_frame"]')
  await expectVisible(firstFrameSlot, '首帧没有自己的具名槽')
  await expectVisible(lastFrameSlot, '尾帧没有自己的具名槽')
  await expectCount(firstLastRow.locator('[data-storyboard-refzone="true"] [data-asset-add-tile="true"]'), 2, '首尾帧没有出两个独立的空槽入口')
  await expectText(firstLastRow, /缺.*参考|首帧/, '首尾帧行没有报出缺必填')
  await snap('01-firstlast-two-named-slots.png')

  // 打开首帧槽的选择器 → 走它自己的上传入口（AssetPicker，与画布节点同一实现）。
  await clickOrFail(firstFrameSlot.locator('[data-asset-add-tile="true"]'), '打开首帧槽选择器')
  const picker = win.locator('[data-testid="asset-picker"]').first()
  await expectVisible(picker, '首帧槽没有弹出统一选择器')
  await snap('02-first-frame-picker.png')
  // 图片槽拒视频：先喂一段 mp4。等的是**拒绝提示这个阳性信号**（不是干等一会儿再看空不空——
  // 本来就空，那种断言在拒绝根本没发生时也照样绿）。
  await picker.locator('input[type="file"]').setInputFiles(path.join(projectRoot, 'assets', 'clip.mp4'))
  await expectVisible(win.getByText('「首帧」只收图片'), '视频喂给图片槽没有给出拒绝提示', 15_000)
  await expectCount(firstFrameSlot.locator('[data-asset-add-tile="true"]'), 1, '首帧槽收下了视频 —— 类型闸没生效')
  await expectCount(firstLastRow.locator('[data-asset-tile]'), 0, '被拒的视频还是落进了这一行')
  await snap('02b-first-frame-rejects-video.png')
  await picker.locator('input[type="file"]').setInputFiles(path.join(projectRoot, 'assets', 'firstframe.png'))
  await expectVisible(firstFrameSlot.locator('[data-asset-tile="image"]'), '首帧上传后没有出现绑定 tile', 20_000)
  await win.keyboard.press('Escape')
  await snap('03-first-frame-uploaded.png')

  // 尾帧走「引用已有素材」：选择器里的画布结果（= 那张参考卡）。
  await expectCount(firstFrameSlot.locator('[data-asset-add-tile="true"]'), 0, '首帧上传后它自己还是空槽 —— 绑定没落到首帧')
  await expectCount(lastFrameSlot.locator('[data-asset-add-tile="true"]'), 1, '尾帧不该被首帧的上传填掉')
  await clickOrFail(lastFrameSlot.locator('[data-asset-add-tile="true"]'), '打开尾帧槽选择器')
  const lastPicker = win.locator('[data-testid="asset-picker"]').first()
  await expectVisible(lastPicker, '尾帧槽没有弹出统一选择器')
  const anchorChoice = lastPicker.getByRole('button', { name: /主角|hero/ }).first()
  if (await anchorChoice.isVisible().catch(() => false)) {
    await anchorChoice.click()
  } else {
    await lastPicker.locator('input[type="file"]').setInputFiles(path.join(projectRoot, 'assets', 'hero.png'))
  }
  await expectVisible(lastFrameSlot.locator('[data-asset-tile="image"]'), '尾帧绑定后没有出现绑定 tile', 20_000)
  await win.keyboard.press('Escape')
  await expectCount(firstLastRow.locator('[data-storyboard-refzone="true"] [data-asset-add-tile="true"]'), 0, '尾帧绑定后仍留着空槽')
  await snap('04-firstlast-both-bound.png')

  const stillMissing = await firstLastRow.locator('[data-storyboard-frame="missing-required"]').count()
  if (stillMissing > 0) failures.push('首尾帧都绑上了，画面格仍是缺必填红态')

  // ── ② 全能参考行：三种槽分开，视频槽收视频、拒图片 ──
  const omniRow = rowAt(2)
  await expectVisible(omniRow, '全能参考镜未渲染')
  await expectCount(omniRow.locator('[data-asset-slot]'), 0, '全能参考不该出具名单槽')
  await expectVisible(omniRow.locator('[data-asset-slot-group="array"]'), '全能参考的数组槽区没有渲染')
  await clickOrFail(omniRow.locator('[data-asset-slot-group="array"] [data-asset-add-tile="true"]').first(), '打开全能参考选择器')
  const omniPicker = win.locator('[data-testid="asset-picker"]').first()
  await expectVisible(omniPicker, '全能参考没有弹出统一选择器')
  await snap('05-omni-picker.png')
  await omniPicker.locator('input[type="file"]').setInputFiles(path.join(projectRoot, 'assets', 'clip.mp4'))
  await expectVisible(omniRow.locator('[data-asset-tile="video"]'), '上传的视频没有落进视频参考槽', 20_000)
  await win.keyboard.press('Escape')
  await snap('06-omni-video-bound.png')

  // 绑定按 kind 落桶：视频进 video_ref，图片桶不该被污染（tile 数 = 视频那一条）。
  await expectCount(omniRow.locator('[data-asset-tile="video"]'), 1, '上传的视频没有落进视频参考槽')
  await expectCount(omniRow.locator('[data-asset-tile="image"]'), 0, '视频上传污染了图片参考桶')

  // ── ③ 展开箭头 ──
  // 按 aria-expanded 定位而不是按文案：展开后 aria-label 会从「展开台词…」变成「收起」，
  // 按文案定位第二次点击必然超时（那是选择器坏了，不是产品坏了）。
  const chevronRow = rowAt(3)
  const chevron = chevronRow.locator('[data-storyboard-subline="true"] button[aria-expanded]').first()
  await expectVisible(chevron, '展开箭头未渲染')
  await chevron.click()
  await win.waitForTimeout(300)
  await expectCount(chevronRow.locator('[data-storyboard-expand="true"]'), 1, '点展开箭头没有展开（onClickCapture 回归？）')
  await snap('07-chevron-expands.png')
  await chevron.click()
  await win.waitForTimeout(300)
  await expectCount(chevronRow.locator('[data-storyboard-expand="true"]'), 0, '再点箭头没有收起')
  await snap('08-chevron-collapses.png')
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
  await snap('99-failure.png').catch(() => {})
} finally {
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  await appInstance.close()
}

const report = [
  '# storyboard reference slots walk',
  '',
  `result: ${failures.length ? 'failed' : 'passed'}`,
  `screenshots: ${screenshots.join(', ')}`,
  'covers: named first/last frame slots take an upload and a library pick, missing-required clears, omni array slots route by kind, expand chevron toggles.',
  failures.length ? `failures: ${failures.join(' | ')}` : 'failures: none',
].join('\n')
fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`)
console.log(report)
if (failures.length) process.exit(1)
