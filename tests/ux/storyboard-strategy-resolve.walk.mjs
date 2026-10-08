#!/usr/bin/env node
// Generation Strategy Resolver —— 执行计划面板 + 行内警示 + 落画布闸 真实用户任务走查（R13/R16）。
//
// 任务：一段含「超上限长镜 + 同场碎镜」的方案 → 打开分镜编辑器 → 执行计划面板按真实模型档案给出
// 「拆条 / 必需合并」，同一批判据在**分镜行上**也直接看得见 → 点整批生成被闸拦下（toast 给出机器
// 理由，不落画布不花钱）→ 采纳拆条 → 面板随方案变化自动重查、那条建议消失。
//
// 为什么这一版把断言写死（上一版是假绿，三处）：
//   ① 候选模型由**本走查自己种**（settingsDir/model-catalog.json 里一条绑 minimax-h3 档案的视频模型，
//      4–15s），每一镜显式指名它 —— 于是「拆几条、并哪几镜」是确定的，可以硬断言而不是靠人眼。
//   ② 因此 `state=unavailable` / 没有候选模型 **必须报红**：上一版的 `if (state === 'ready') … else 打印一行`
//      让「能力核没起来」和「一切正常」都走绿灯，正是那种看不见的假绿。
//   ③ 闸不是看看就算：真点一次「生成剩余」，断言页脚行内提示出现且带着机器理由（含模型名）。
//   ④ 四张截图逐张比 md5：字节相同 = 中间那几步根本没发生（`_assert.mjs` 头注释里那条老坑）。
//
// 零额度：resolve 是主进程 stateless 纯计算，不调任何 provider；闸把整批拦在 materialize 之前，
// 本走查不会走到任何付费路径。
//
// 用法：node tests/ux/storyboard-strategy-resolve.walk.mjs
//   STRATEGY_RESOLVE_SCHEME=dark  暗色取证（默认 light）
//   STRATEGY_RESOLVE_OUT=<dir>    截图输出目录
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { applyColorSchemeForShot, clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-strategy-resolve-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'strategy-resolve-walk'
const projectRoot = path.join(projectsDir, projectId)
const scheme = process.env.STRATEGY_RESOLVE_SCHEME === 'dark' ? 'dark' : 'light'
const outDir = process.env.STRATEGY_RESOLVE_OUT || path.join(repoRoot, 'tests/ux/shots/storyboard-strategy-resolve')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'assets', 'generated'), { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

// ── 候选模型：一条绑 minimax-h3 档案（duration 4–15s）的视频模型。种在 catalog 里，
//    能力核启动时 buildVideoModelCandidates 从这里读——与真机同一条路，没有测试专用旁路。
const NOW = '2026-09-07T00:00:00.000Z'
const VIDEO_MODEL = 'walk-video-h3'
const VIDEO_MODEL_LABEL = '走查视频模型'
const VENDOR = 'strategy-walk-vendor'
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), `${JSON.stringify({
  version: 8,
  vendors: [{
    key: VENDOR, name: '走查供应商', enabled: true, baseUrlHint: 'http://127.0.0.1:1/v1',
    authType: 'none', authHeader: null, authQueryParam: null, providerKind: 'openai-compatible',
    createdAt: NOW, updatedAt: NOW,
  }],
  models: [{
    vendorKey: VENDOR, modelKey: VIDEO_MODEL, labelZh: VIDEO_MODEL_LABEL, kind: 'video',
    enabled: true, published: true, meta: { archetypeId: 'minimax-h3' }, createdAt: NOW, updatedAt: NOW,
  }],
  // 一条启用的 text_to_video 映射：候选名单只收**可用**模型（usableVideoModelCandidates.ts，88a485019 起
  // 不再只看 enabled），而「发布资格」对无认证 revision 的行就看有没有启用的可执行映射
  // （modelPublication.ts derivePublishedExecution）。没有这条，引擎会把方案里钉的模型换成清单里
  // 别家的（面板会写「清单里没有模型 walk-video-h3，已改用 …」），断言里的模型名就对不上。
  mappings: [{
    id: `${VIDEO_MODEL}-text_to_video`, vendorKey: VENDOR, modelKey: VIDEO_MODEL, taskKind: 'text_to_video',
    name: '走查 t2v', enabled: true,
    create: {
      method: 'POST', path: '/v1/videos/generations',
      headers: { 'Content-Type': 'application/json' },
      body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}' },
      response_mapping: { video_url: 'data.0.url' },
    },
    createdAt: NOW, updatedAt: NOW,
  }],
  apiKeysByVendor: {},
}, null, 2)}\n`)

// ── 方案：同一场 4 镜，全部指名上面那条模型（4–15s）——引擎的判定因此是确定的：
//    shot-1 = 40s → 超 15s 上限 → 拆 15+15+10；shot-2/3/4 = 6+4+2 = 12s，其中 2s 低于 4s 下限
//    → 三镜「必需合并」成一条 12s。断言就照这两条写死。
const shot = (index, durationSec, prompt) => ({
  index, shotId: `shot-${index}`, sceneId: 's1', shotKind: 'video',
  anchorIds: [], prompt, durationSec, modelKey: VIDEO_MODEL,
})
const plan = {
  title: '雨夜追凶',
  profileKey: 'genre.short-drama',
  anchors: [],
  scenes: [{ id: 's1', title: '第一场 · 巷口' }],
  shots: [
    shot(1, 40, '长镜：他穿过雨巷，从巷口一路走到尽头。'),
    shot(2, 6, '近景：脚步踩进积水。'),
    shot(3, 4, '特写：他回头。'),
    shot(4, 2, '碎镜：路灯闪了一下。'),
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
const shots = []
/** 整屏取证。局部证据用 snapOf(locator, name)——裁到那块本身也让「这一步真的发生了」有字节级证据。 */
const snap = async (name) => snapOf(win, name)
const snapOf = async (target, name) => {
  const file = path.join(outDir, `${name}.${scheme}.png`)
  await screenshotSettled(target, { path: file })
  shots.push(file)
  return file
}
const strategyRoot = () => win.locator('[data-storyboard-strategy-root="true"]').first()
const panel = () => win.locator('[data-storyboard-strategy-panel="true"]').first()
const proposals = () => panel().locator('[data-storyboard-strategy-proposal="true"]')
const rowWarnings = () => win.locator('[data-storyboard-row-duration-warning]')
// 闸的提示是**行内**反馈（notificationPolicy `level:'inline'`，4a5f52130 起不再走 Mantine toast）：
// StoryboardPlanEditor 把 reportFailure 渲染成页脚那行 `<p role="status" data-storyboard-action-feedback>`。
const gateFeedback = () => win.locator('[data-storyboard-action-feedback]').first()

try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await applyColorSchemeForShot(win, scheme)

  const projectCard = win.locator('[data-project-card]', { hasText: '执行计划走查' }).first()
  if (await projectCard.isVisible().catch(() => false)) {
    await projectCard.hover()
    const cont = projectCard.getByText('继续创作', { exact: false }).first()
    if (await cont.isVisible().catch(() => false)) await cont.click()
    else await projectCard.dblclick()
  }
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  // 侧栏分镜条目**就是**进入分镜页的按钮（不存在「再次编辑 / 打开分镜」这一步——
  // 上一版等的是一个从没渲染过的按钮，`clickOrFail` 前它就该红）。
  await openStoryboardEditor(win, DESIGN, '从侧栏进入分镜方案')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器没有渲染')
  await snap('01-editor-with-video-shots')

  // ── 阳性对照：面板必须真的**算出来**了。unavailable / 没有候选模型 / 只 loading 一律红。
  await expectVisible(strategyRoot(), '执行计划面板根元素没有出现', 20_000)
  await expect(strategyRoot(), '执行计划没有算成 ready —— 候选模型没种进去或能力核没起来，这一轮的绿灯全部不作数')
    .toHaveAttribute('data-storyboard-strategy-state', 'ready', { timeout: 20_000 })
  await expect(proposals(), 'ready 却没有两条建议：预期 shot-1 拆条 + shot-2/3/4 必需合并').toHaveCount(2, { timeout: 10_000 })
  await expect(panel(), '拆条建议没有写出 15+15+10 这三段').toContainText('15s + 15s + 10s')
  await snapOf(panel(), '02-strategy-panel-ready')

  // ── 行内警示（D1）：超限/低于下限在**行上**就看得见，不必点开面板。
  await expect(rowWarnings(), '分镜行上没有出现时长警示（shot-1 超上限、shot-4 低于下限各一条）')
    .toHaveCount(2, { timeout: 10_000 })
  await expect(rowWarnings().first(), 'shot-1 的行内警示不是「超上限」语义')
    .toHaveAttribute('data-storyboard-row-duration-warning', 'overflow')
  await snapOf(win.locator('[data-storyboard-row="1"]'), '03-row-inline-warning')

  // ── 闸：真点一次整批生成，必须被拦（toast 带机器理由），而且不落画布。
  const batchButton = win.locator('[data-storyboard-batch="true"]')
  await expect(batchButton, '整批生成按钮不可点 —— 闸拦没拦得住这一步就无从判断').toBeEnabled({ timeout: 10_000 })
  await clickOrFail(batchButton, '点整批生成（应被执行计划闸拦下）')
  await expectVisible(gateFeedback(), '闸没有给出任何提示 —— 整批生成可能已经放行了', stationTimeout({ operations: 1 }))
  await expect(gateFeedback(), '闸的提示没有带机器理由（应含模型名与单条上限）').toContainText(VIDEO_MODEL_LABEL)
  await snap('04-gate-blocked-inline')

  // ── 面板必须真的占着高度。2026-09-07 实测过一次反例：section 高 2px + overflow-hidden，
  //    建议画在盒外、「采纳」点不到，而 toBeVisible（只看 bounding box 非空）照样绿。
  const panelHeight = await panel().evaluate((el) => el.getBoundingClientRect().height)
  if (panelHeight < 40) throw new Error(`执行计划面板被压扁成 ${panelHeight}px —— 用户看不到它（flex-shrink 塌陷）`)

  // ── 采纳拆条：方案变化 → 面板自动重查 → 这条建议消失（「已采纳」由消失本身表达）。
  const adopt = proposals().filter({ hasText: '拆条' }).locator('[data-storyboard-strategy-adopt="true"]').first()
  await clickOrFail(adopt, '采纳拆条建议')
  await expect(proposals(), '采纳后面板没有重查：拆条建议应当消失，只剩必需合并那一条').toHaveCount(1, { timeout: 15_000 })
  await expect(rowWarnings(), '拆条采纳后 shot-1 的超限警示应当消失，只剩 shot-4 的低于下限').toHaveCount(1, { timeout: 10_000 })
  await snap('05-after-adopt-recheck')

  // ── 截图必须彼此不同：字节相同 = 中间那些步骤根本没发生。
  const digests = shots.map((file) => [path.basename(file), crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')])
  const unique = new Set(digests.map(([, digest]) => digest))
  if (unique.size !== digests.length) {
    throw new Error(`截图有重复字节（说明中间步骤没真的发生）：${JSON.stringify(digests)}`)
  }
  console.log(`  · ${digests.length} 张截图（${scheme}）互不相同 →`, outDir)
} catch (error) {
  console.error('走查失败：', error)
  await win.screenshot({ path: path.join(outDir, `99-FAIL.${scheme}.png`) }).catch(() => undefined)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
