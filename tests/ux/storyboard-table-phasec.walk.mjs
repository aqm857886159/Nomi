// 分镜表 v5 Phase C 走查（R13/R16）：只走真实 Electron/IPC/渲染/项目文件源，零生成额度。
// 覆盖 @ 入口与四类候选来源、绑定（插胶囊）/解绑（删胶囊）、文本顺序、骨架预设。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectCount, expectText, expectVisible, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

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
    // 刻意**不**钉模型：主线上「@ 加参考」入口只在契约未知（默认模型无档案）的行上渲染
    // （2026-10-06 起参考在视觉列 ShotReferenceStrip：契约未知的默认模型不摆「+」）；钉了带槽的模型，参考列就换成槽位 tile、@ 入口消失。
    // 这条走查测的正是 @ 路径。dialogue/transition 字段随 0fc4768fb 删除，不再种。
    index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 3, anchorIds: ['hero'],
    prompt: '远景，雨夜中的主角', promptSegments: [{ key: 'shotSize', start: 0, end: 2 }],
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
  // 侧栏点中方案就直接进分镜页——摘要卡（「打开分镜 / 再次编辑」那一跳）已随 805096d41 删除。
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
  // 挂上去的参考图**就是**素材：@ 插入的外部素材走 addExternalReferenceAnchor → anchorIds，
  // materialize 把它当 `params.referenceImageUrls` 发出去，所以这一行没有任何东西可等。
  // 修复前它被判 `waiting-refs`（「等参考图」），页脚照着报数、批量把它排除——执行层与状态层两份真相。
  await expect(row.locator('[data-storyboard-frame]').first(), '挂了真实参考图的行不该说「等参考图」')
    .not.toHaveAttribute('data-storyboard-frame', 'waiting-refs')
  await snap('02-result-and-library-capsules.png')

  // 4) 走同一 @ 面板的 composer attachment 上传入口，等上传完成后候选出现，再插入。
  await clickOrFail(row.getByRole('button', { name: '输入 @ 选择参考' }), '打开上传入口')
  const uploadInput = list.locator('input[type="file"]')
  await uploadInput.setInputFiles(path.join(projectRoot, 'assets', 'upload.png'))
  // @ 面板是 tiptap Suggestion：候选只在 query 变化时重算（AssetMentionSuggestion.ts items()），
  // 开着的面板**不会**因为上传完成而刷新，上传中也没有任何可见态（useShotMentionSource 只把
  // status==='ready' 的附件喂进候选）。所以「上传完 → 候选出现」只能靠**关掉再开**取证；
  // 上传是真实导入（拷贝 + 哈希），完成时刻不定，这里按真实 DOM 状态重开重查，不猜一个等待数。
  // 用户镜头：上传后面板没动静，得自己关了再开——这条摩擦记在 PR 正文，不在走查里绕。
  const uploadList = win.locator('[data-mention-list="true"]')
  const uploadItem = uploadList.locator('[data-mention-item^="upload:"]').first()
  await expect.poll(async () => {
    await win.keyboard.press('Escape')
    await expect(uploadList).toBeHidden()
    await clickOrFail(row.getByRole('button', { name: '输入 @ 选择参考' }), '重新打开上传后的 @ 入口')
    await expectVisible(uploadList, '上传后 @ 建议列表未弹出')
    return uploadItem.isVisible()
  }, { timeout: stationTimeout({ operations: 2 }), message: '上传完成后 @ 候选没有出现（关掉重开也没有）' }).toBe(true)
  await clickOrFail(uploadItem, '插入上传胶囊')
  await snap('03-upload-capsule.png')

  // 5) 不吃参考的模型明确说明并禁用 @，避免入口消失后变成无声死路。
  const noRefRow = win.locator('[data-storyboard-editor="true"] [data-storyboard-row="2"]').first()
  await expectVisible(noRefRow, '不吃参考模型镜头未渲染')
  await expectText(noRefRow, /不吃参考/, '不吃参考模型没有禁用说明')
  await expectCount(noRefRow.getByRole('button', { name: '输入 @ 选择参考' }), 0, '不吃参考模型仍暴露 @ 入口')
  await snap('04-no-reference-model.png')

  // 6) 解绑。行展开态 / 台词 / 转场已随 0fc4768fb（remove row expansion and editorial fields）删除——
  //    编辑性字段不再挂在分镜行上，这不是回归。@ 路径上「解绑」= 删掉提示词里的那枚 @ 胶囊：
  //    updateShotPrompt 按文本里的 @ URL 重建 anchorIds（storyboardPlanEdits.ts），参考卡与素材源都留着。
  //    取证点用参考卡的**反查过滤**：它直接数 shot.anchorIds（「正在看引用「X」的 N 镜」），
  //    所以「绑没绑上」有据可查，而不是只看提示词里少了一枚胶囊。磁盘上 assets/upload.png 仍在。
  //    （不再看 chip 上的「N 镜在等它」：挂了真图的行本来就不该等，那句话 2026-09-18 起只留给
  //    还要生成的参考卡——见 docs/fixes/2026-09-18-storyboard-external-reference-waiting.root-cause.json。）
  const uploadChip = win.locator('[data-storyboard-anchor-chip]').filter({ hasText: 'upload.png' }).first()
  const filterBar = win.locator('[data-storyboard-filter="true"]')
  const filterByUpload = async (label) => {
    await clickOrFail(uploadChip, label)
    await expectVisible(filterBar, `${label}：反查过滤条没有出现`)
  }
  await filterByUpload('反查上传素材（解绑前）')
  await expectText(filterBar, /正在看引用「upload.png」的 1 镜/, '@ 插入后这张卡应被 1 镜引用')
  await clickOrFail(filterBar.getByRole('button', { name: '退出过滤' }), '退出反查过滤')
  const mentionChips = row.locator('[data-storyboard-mention-chip="true"]')
  const chipsBefore = await mentionChips.count()
  if (chipsBefore < 3) failures.push(`解绑前提示词里应有 3 枚 @ 胶囊（某镜结果 / 素材库 / 上传），实为 ${chipsBefore}`)
  await snap('05-three-mention-chips.png')
  await clickOrFail(mentionChips.last(), '选中最后插入的上传胶囊')
  await win.keyboard.press('Backspace')
  await expect(mentionChips, '删胶囊后提示词里的 @ 胶囊没有少一枚').toHaveCount(chipsBefore - 1)
  await filterByUpload('反查上传素材（解绑后）')
  await expectText(filterBar, /正在看引用「upload.png」的 0 镜/, '删掉 @ 后这张卡不该再被任何镜引用（解绑生效）')
  await expectVisible(win.getByText('没有镜头引用这张卡', { exact: true }), '空过滤态没有说人话')
  await clickOrFail(filterBar.getByRole('button', { name: '退出过滤' }), '退出反查过滤')
  if (!fs.existsSync(path.join(projectRoot, 'assets', 'upload.png'))) failures.push('解绑应只移除绑定，却把素材源 upload.png 删了')
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
  'covers: @ picker/current/shot-result/library/upload, insert capsule, no-reference disabled, skeleton preset, unbind by deleting the @ chip.',
  'order evidence: promptMentions + storyboardPlan conversion tests assert first @ occurrence -> anchorIds -> edge.order.',
  `skeleton DOM: segment is ${segmentInsidePromptBox ? '' : 'not '}a descendant of [data-prompt-box="true"] (decoration is rendered inside .ProseMirror).`,
  failures.length ? `failures: ${failures.join(' | ')}` : 'failures: none',
].join('\n')
fs.writeFileSync(path.join(outDir, 'report.md'), `${report}\n`)
console.log(report)
if (failures.length) process.exit(1)
