#!/usr/bin/env node
// 剧本 PB07 · 「分镜里写的提示词，就是发出去的提示词」
//
// 已知问题（2026-09-30，花钱错）：用户在分镜方案里把某一镜的图片提示词写成「一条巨龙盘在山顶」，
// 生成出来的却是人物。这条镜头引用着一张角色定妆卡（anchorIds），编译层会把定妆卡的「身份特征」文字
// 追加进提示词、把定妆卡那张图连成参考图——而分镜行上只显示用户写的那一句、参考列里也不画这张图。
//
// 这条剧本把分镜里**每一个能花钱的入口**各走一遍，同一句「巨龙」，每次都在用户点头那一刻读下他眼前的东西，
// 监视器（铁律 3）拿它和供应商真正收到的请求比：
//   E1  分镜行上按 ↑ 生成                       （行内直接生成，用户自己点，不弹确认卡）
//   E2  分镜页脚「生成剩余」                     （批量，弹花钱确认框）
//   E3  「放到画布」→ 在画布节点上按 ↑            （铺到画布再生成）
//   E4  Agent 把方案端到端确认框                  （storyboard.present，弹花钱确认框）
// 对照组（不该红）：镜 1 没引用任何锚、镜 3 只引用了文本风格锚——但文本锚整段也会被追加，所以镜 3 同样是被测对象。
//
// 零花费：供应商是本机回环夹具，出网闸拦真实域名。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from '../../_assert.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from '../../agent-runtime-fixture.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from '../../_canvasHit.mjs'
import { clickNodeGenerate, SPEND_DIALOG } from '../actions.mjs'
import { startPlaybook } from '../launch.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const DESIGN = 'walk-sb-truth'
const DOC = 'doc-1'
const DRAGON = '一条巨龙盘在山顶'
const HERO_STATIC = '黑色齐肩短发、瓜子脸的年轻女子，左眉有一道浅疤'
const MOOD = '赛博霓虹，冷蓝洋红'

const anchors = [
  { id: 'hero', kind: 'character', name: '林薇', description: '短发，风衣，眼神冷', staticFeatures: HERO_STATIC, carrier: 'visual' },
  { id: 'mood', kind: 'style', name: '全片风格', description: MOOD, carrier: 'text' },
]
const shot = (index, prompt, anchorIds) => ({
  index, shotId: `shot-${index}`, shotKind: 'image', durationSec: 3, anchorIds, prompt,
  modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR,
})
/** 方案里的第 4、5、6 镜行上摆着一张参考图（heroUrl）：一镜发出去的参考图只有行上摆着的这张。 */
const makePlan = (heroUrl) => ({
  title: '巨龙走查',
  profileKey: 'genre.short-drama',
  anchors,
  shots: [
    // 对照：带片种骨架的一镜（「远景」是提示词里一段可点的骨架标注）——骨架只是提示词文字上的视图标注，发出去必须和写的一字不差。
    { ...shot(1, '远景，清晨的海边，一只白鸟掠过水面', []), promptSegments: [{ key: 'shotSize', start: 0, end: 2 }] },
    shot(2, '林薇站在天台边缘，风衣被吹起', ['hero', 'mood']), // E1：用户会把它改写成「巨龙」
    shot(3, '一座冰封的城堡在夜色里', ['mood']),
    // 改图模式 + 行上摆着一张参考图（来自林薇的定妆照）：行上显示一张，就只发这一张。
    { ...shot(4, '林薇站在天台边缘，风衣被吹起', ['hero', 'mood']), modeId: 'edit', referenceBindings: { image_ref: [{ url: heroUrl, name: '林薇', anchorId: 'hero' }] } }, // E3：改写成「巨龙」后放到画布再生成
    { ...shot(5, '林薇站在天台边缘，风衣被吹起', ['hero', 'mood']), modeId: 'edit', referenceBindings: { image_ref: [{ url: heroUrl, name: '林薇', anchorId: 'hero' }] } }, // E4：改写成「巨龙」后让 Agent 端出确认框
    // 文生图模式、行上却摆着一张参考图：这一行说「参考图「林薇」不会发出去」，供应商也确实一张都没收到。
    { ...shot(6, '黄昏的街角，一只黑猫回头', []), referenceBindings: { image_ref: [{ url: heroUrl, name: '林薇', anchorId: 'hero' }] } },
  ],
})

const pb = await startPlaybook({
  id: 'pb14-storyboard-prompt-truth',
  needs: ['loopbackProvider', 'fixtureTextModel', 'paidGenerationRoute'],
  seed: ({ imageResult, imageMeta }) => ({
    nodes: [
      { id: 'n-hero', kind: 'character', categoryId: 'shots', title: '林薇', prompt: '定妆', position: { x: 80, y: 120 }, status: 'success', references: [], runs: [],
        result: imageResult('hero-r1', 2, 1), history: [imageResult('hero-r1', 2, 1)],
        meta: { ...imageMeta(), storyboardDesignId: DESIGN, anchorId: 'hero', referenceSheet: true, frozen: { at: 1, by: 'user' } } },
    ],
    groups: [],
    edges: [],
    payload: {
      workbenchDocuments: [{
        id: DOC, version: 1, title: '巨龙', updatedAt: 10,
        contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一场关于龙与人的故事。' }] }] },
      }],
      activeDocumentId: DOC,
      storyboardDesignsByDocumentId: {
        [DOC]: [{ id: DESIGN, documentId: DOC, title: '巨龙走查', plan: makePlan(imageResult('hero-r1', 2, 1).url), committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }],
      },
    },
  }),
})
const { smoke, fixture, monitor } = pb
const win = () => smoke.win
const editor = () => win().locator('[data-storyboard-editor="true"]:visible')
const rowPrompt = (index) => editor().locator(`[data-storyboard-row="${index}"] [data-storyboard-prompt-block] [contenteditable="true"]`).first()
const images = () => fixture.images.filter((record) => record.path === '/v1/images/generations' || record.path?.includes('images'))
const waitImages = (count, message) => expect.poll(() => images().length, { message, timeout: stationTimeout({ operations: 4 }) }).toBeGreaterThanOrEqual(count)

/** 像用户一样把某一镜的提示词改写成一句新的（点进框、全选、打字）。 */
async function rewritePrompt(index, text) {
  const box = rowPrompt(index)
  await box.scrollIntoViewIfNeeded()
  await clickOrFail(box, `第 ${index} 镜的提示词框`)
  await win().keyboard.press('Control+A')
  await win().keyboard.type(text, { delay: 15 })
  await expect(box, `第 ${index} 镜的提示词框里就是刚打的那句`).toHaveText(text)
  await win().waitForTimeout(400)
}

let harnessError = null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })
  await monitor.step('切到创作页，从侧栏点开这份分镜方案', async () => {
    await clickOrFail(win().locator('.nomi-stepper__step[data-mode="creation"]').first(), '顶栏「创作」')
    const item = win().locator(`[data-storyboard-id="${DESIGN}"]`).first()
    await expect(item, '侧栏里有这份分镜方案').toBeVisible({ timeout: stationTimeout() })
    await clickOrFail(item, '侧栏选中分镜方案')
    await expect(editor(), '分镜编辑器出现').toBeVisible({ timeout: stationTimeout() })
    await expect(editor().locator('[data-storyboard-row]'), '六镜').toHaveCount(6, { timeout: stationTimeout() })
  }, { surfaces: ['*'], critical: true })
  await monitor.screenshot('01-storyboard-initial')

  // ── E1：分镜行上按 ↑ ──────────────────────────────────────────────────────────────
  await monitor.step('E1 · 用户把第 2 镜的提示词改写成「巨龙」', () => rewritePrompt(2, DRAGON), { surfaces: [] })
  await monitor.screenshot('e1-row-shown')
  await monitor.step('E1 · 在第 2 镜上按 ↑ 生成', async () => {
    await monitor.consentStoryboardRows([2], { label: '第 2 镜行内 ↑' })
    await clickOrFail(editor().locator('[data-storyboard-row="2"] [data-storyboard-generate-state]').first(), '第 2 镜行内的 ↑', { noWaitAfter: true })
    await waitImages(1, '供应商收到第 2 镜的请求')
  }, { surfaces: ['*'] })

  // ── 行上摆着参考图、当前模式用不上：点名是哪一张（其余行不说这句）──
  await monitor.step('看第 6 镜行上的提示：文生图模式、摆着一张参考图', async () => {
    const hint = editor().locator('[data-storyboard-anchor-ignored="6"]')
    await rowPrompt(6).scrollIntoViewIfNeeded()
    await expect(hint, '第 6 镜行上点名那张不会发出去的参考图').toBeVisible({ timeout: stationTimeout() })
    await expect(hint).toContainText('林薇')
    const proof = await proveProbe(hint, '第 6 镜那句提示真的出现过')
    await monitor.screenshot('row6-ignored-reference-hint')
    await expectAbsent(editor().locator('[data-storyboard-anchor-ignored="2"]'), { provenBy: proof, message: '第 2 镜行上没摆参考图，不许说「参考图不会被使用」' })
  }, { user: false, surfaces: [] })

  // ── E3：放到画布，在画布节点上按 ↑ ──────────────────────────────────────────────────
  await monitor.step('E3 · 用户把第 4 镜的提示词改写成「巨龙」', () => rewritePrompt(4, DRAGON), { surfaces: [] })
  await monitor.step('E3 · 点「放到画布」', async () => {
    await clickOrFail(editor().locator('[data-place-storyboard]').first(), '「放到画布」', { noWaitAfter: true })
    await clickOrFail(win().locator('.nomi-stepper__step[data-mode="generation"]').first(), '顶栏「生成」（去画布看）')
  }, { surfaces: ['*'] })
  await monitor.step('E3 · 在画布上找到第 4 镜的节点，按它的 ↑', async () => {
    const nodes = async () => (await monitor.readProject())?.payload?.generationCanvas?.nodes ?? []
    await expect.poll(async () => (await nodes()).some((node) => node.meta?.shotId === 'shot-4'), { message: '第 4 镜落成了画布节点', timeout: stationTimeout({ operations: 2 }) }).toBe(true)
    const node = (await nodes()).find((candidate) => candidate.meta?.shotId === 'shot-4')
    // 十几张卡摊在画布上，第 4 镜多半在舞台外：像人一样按住 Ctrl 滚轮缩小，直到点得到它。
    for (let attempt = 0; attempt < 10 && !(await findNodeHitPoint(win(), { nodeSelector: `[data-node-id="${node.id}"]` })); attempt += 1) {
      const blank = await findCanvasBlankPoint(win())
      if (!blank) break
      await win().mouse.move(blank.x, blank.y)
      await win().keyboard.down('Control')
      await win().mouse.wheel(0, 240)
      await win().keyboard.up('Control')
      await win().waitForTimeout(300)
    }
    await monitor.screenshot('e3-canvas-node-shown')
    await monitor.consentNodeGenerate(node.id, { label: '画布上第 4 镜节点的 ↑' })
    await clickNodeGenerate(win(), node.id)
    await waitImages(2, '供应商收到第 4 镜的请求')
  }, { surfaces: ['*'] })

  // ── 回到分镜表：E2 批量 / E4 Agent 确认框 ──────────────────────────────────────────
  await monitor.step('回到创作页的分镜表', async () => {
    await clickOrFail(win().locator('.nomi-stepper__step[data-mode="creation"]').first(), '顶栏「创作」')
    if (!(await editor().isVisible().catch(() => false))) await clickOrFail(win().locator(`[data-storyboard-id="${DESIGN}"]`).first(), '侧栏选中分镜方案')
    await expect(editor(), '分镜编辑器回来').toBeVisible({ timeout: stationTimeout() })
  }, { surfaces: ['*'] })
  await monitor.step('E4 · 用户把第 5 镜的提示词改写成「巨龙」，并勾上「本次跳过」把它留给 Agent', async () => {
    await rewritePrompt(5, DRAGON)
  }, { surfaces: [] })
  await monitor.step('E2 · 跳过第 5 镜，按「生成剩余」', async () => {
    await clickOrFail(editor().locator('[data-storyboard-row="5"] input[type="checkbox"]').first(), '第 5 镜的「本次跳过」')
    await monitor.screenshot('e2-batch-shown')
    await monitor.consentStoryboardRows([1, 3, 6], { kind: 'storyboard-batch', label: '「生成剩余」（镜 1、镜 3、镜 6）' })
    await clickOrFail(editor().locator('[data-storyboard-batch="true"]').first(), '「生成剩余」', { noWaitAfter: true })
    const dialog = win().locator(SPEND_DIALOG).first()
    await expect(dialog, '批量生成弹花钱确认框').toBeVisible({ timeout: stationTimeout() })
    await monitor.screenshot('e2-batch-dialog')
    await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '花钱确认框「确认」', { noWaitAfter: true })
    await waitImages(5, '供应商收到镜 1、镜 3、镜 6 的请求')
  }, { surfaces: ['*'] })

  await monitor.step('E4 · Agent 把这份方案端出确认框（storyboard.present）', async () => {
    const project = await monitor.readProject()
    await win().evaluate(({ projectId, designId, documentId }) => {
      window.__nomiPresent = window.__nomiCapabilityApply('storyboard.present', { projectId, designId, sourceDocumentId: documentId })
        .then((reply) => ({ ok: true, reply }), (error) => ({ ok: false, message: String(error?.message ?? error) }))
    }, { projectId: project.id, designId: DESIGN, documentId: DOC })
    const dialog = win().locator(SPEND_DIALOG).first()
    await expect(dialog, 'Agent 端出花钱确认框').toBeVisible({ timeout: stationTimeout() })
    await monitor.screenshot('e4-agent-dialog')
    await monitor.consentStoryboardRows([5], { kind: 'storyboard-agent', label: 'Agent 端出的确认框（只剩镜 5 没生成）' })
    await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '花钱确认框「确认」', { noWaitAfter: true })
    await waitImages(6, '供应商收到第 5 镜的请求')
  }, { surfaces: ['*'] })

  await monitor.step('出站请求逐条核对：一镜发出去的 = 行上写的提示词 + 行上看得见的参考图', async () => {
    const byPrompt = (needle) => monitor.submissions.filter((submission) => submission.prompt.includes(needle))
    const dragons = byPrompt('巨龙')
    expect(dragons.length, '三个入口各发了一条巨龙').toBe(3)
    for (const submission of dragons) expect(submission.prompt, '巨龙那一镜发出去的提示词逐字等于行上写的，没有任何追加').toBe(DRAGON)
    expect(dragons.map((submission) => submission.refs).sort(), '行内那一镜（文生图、行上没摆参考）0 张；画布与 Agent 那两镜（行上摆着一张）各 1 张').toEqual([0, 1, 1])
    const plain = { '远景，清晨的海边，一只白鸟掠过水面': 0, '一座冰封的城堡在夜色里': 0, '黄昏的街角，一只黑猫回头': 0 }
    for (const [text, refs] of Object.entries(plain)) {
      const hit = byPrompt(text)
      expect(hit.length, `「${text}」发了一条`).toBe(1)
      expect(hit[0].prompt, `「${text}」逐字相同`).toBe(text)
      expect(hit[0].refs, `「${text}」参考图 ${refs} 张（镜 6 行上的那张被模式忽略，行上已点名）`).toBe(refs)
    }
  }, { user: false, surfaces: [] })
  await monitor.settle('五个入口都生成完')
  await monitor.screenshot('99-final')
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb07 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
