#!/usr/bin/env node
// Default: document draft → saved Run → original editor/placement → original runner.
// --production-table: original canvas Agent → production shot table compatibility;
// retains full table density, selection, viewport, generation and cold-restart assertions.
// 金路径 · 每日走查（第二刀）。
//
// 这是**一条固定的、不许缩水的真实用户路径**，每天跑一次当门；红了当天修。
// M0–M5 矩阵留着当地图，不当门——地图告诉你还有哪些地没铺，门只问一件事：
// 「昨天还能走通的那条路，今天还走得通吗」。
//
// 剧本（一个字不许缩）：
//   ① 新建空项目
//   ② 在创作区文本编辑器写三句剧本
//   ③ 默认：划词拆镜保存Run→原编辑器→显式放置。production-table模式：画布Agent建三镜及表。
//   ④ 选中第 2 镜（在画布的分镜表里勾选）
//   ⑤ 改第 2 镜的一句提示词——经 Agent 的 `draft_shots(draftId, shots[{shotId}])`
//   ⑥ 第 2 镜生成一张图片（loopback fixture 供应商，零额度）
//   ⑦ 结果回到该行
//   ⑧ 关闭 Nomi 重启
//   ⑨ 图和修改仍在
//
// production-table兼容模式的原账本：Run generationPlan落成production画布节点；
// 分镜表（`shot_table` · source=production）是那组节点的表格表示版，行从节点 derive、零缓存。
// 所以这里所有「落盘真相」都读 `generationCanvas.nodes`，**不**读 `storyboardDesignsByDocumentId`
// （那是用户手写方案的账本，Agent 不写它；多认一份就是给假绿开后门）。
//
// 零额度：只有远端供应商是本地 loopback（tests/ux/agent-runtime-fixture.mjs）。
// 真 SDK / 真 IPC / 真渲染层 / 真存储 / 真进程重启，一个都不假。
//
// 怎么跑：
//   pnpm run test:golden                      # 全绿门
//   node tests/ux/golden-path.e2e.mjs --positive-control   # 阳性对照：必须报红
//
// 阳性对照（为什么必须有）：最后那条「重启后修改仍在」的断言，如果读的是内存而不是盘，
// 它会永远绿（docs/lessons/vacuous-probe-passes-forever.md）。`--positive-control` 在关掉
// app 之后、重启之前，把盘上第 2 镜节点的提示词改回旧值——**如果这条断言是活的，它必须红**。
// 没红 = 尺子坏了，本脚本会明确报「阳性对照失效」。
//
// 相关教训（写之前都读过）：
//   · expect-absent-passes-too-early —— 「不存在」断言一律走 _assert.mjs 的 expectAbsent + proveProbe
//   · walkthrough-no-win-reload     —— 冷启动用真 app.close() + 重新 launch，绝不 win.reload()
//   · assert-you-are-in-the-situation-you-claim —— 每步先断言「我到了这儿」再断言业务
//   · dead-selector-lies-both-ways  —— 所有点击走 clickOrFail，点不到就红，不静默跳过
import { runOriginalStoryboardGolden } from './_goldenOriginalStoryboard.mjs'
import fs from 'node:fs'
import path from 'node:path'

import { clickOrFail, expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { CANVAS_STAGE_SELECTOR, findCanvasBlankPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { FIXTURE_IMAGE_MODEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CANVAS_PANEL, COMPOSER_INPUT, COMPOSER_SEND, CREATION_PANEL, DOCUMENT,
  createRuntimeWalk, hasToolResult, openCanvas, readProject, recorded,
} from './agent-runtime-walk-support.mjs'

// ── 剧本常量。标记串（GOLDEN_*）让 fixture 的 match 钉死「这一条请求确实是这一步发出的」，
//    而不是「随便哪条文本请求都算」。 ──────────────────────────────────────────────
const SCRIPT_LINE_1 = '清晨的旧书店刚开门，女孩推门进来。'
const SCRIPT_LINE_2 = '她在最里侧的书架前停下，抽出一本旧诗集。'
const SCRIPT_LINE_3 = '窗外的光落在书页上，她轻轻笑了一下。'
const SCRIPT_TEXT = `GOLDEN_SCRIPT：${SCRIPT_LINE_1}${SCRIPT_LINE_2}${SCRIPT_LINE_3}`

const PLAN_CALL_ID = 'golden-plan-1'
const PATCH_CALL_ID = 'golden-patch-1'

const SHOT_PROMPTS = [
  '清晨的旧书店门口，暖光，女孩推门进来的中景。',
  '书架前的女孩侧影，手指抽出一本旧诗集，中近景。',
  '窗光落在摊开的书页上，女孩微笑的特写。',
]
/** 模型拟的镜头标题（信封字段）。它必须一路走到节点标签——不是「镜头 N」兜底——所以带标记串。 */
const SHOT_TITLES = ['GOLDEN_TITLE_1：推门', 'GOLDEN_TITLE_2：抽书', 'GOLDEN_TITLE_3：窗光']
/** 第 2 镜要被改成的那一句。必须与原句可区分，且不含原句子串——否则「改了没」判不出来。 */
const SHOT_2_NEW_PROMPT = 'GOLDEN_PATCHED：逆光下的侧脸，尘埃在光柱里浮动，安静的近景。'
const PATCH_INSTRUCTION = '把选中的这一镜改成逆光侧脸、尘埃浮在光柱里的安静近景。'
/** 宿主给没显式 shotId 的镜按序派的稳定 id（mcpGenerationMultiShot.shotEnvelope：`shot-<index+1>`）。 */
const SHOT_2_ID = 'shot-2'

/**
 * 阳性对照瞄准的那一条断言。控制组必须**在这一条上**报红——红在别处（超时、路由竞态、
 * 选择器过期）都不算数：那只证明脚本脆，没证明这道门是活的。
 */
const TARGET_ASSERTION = '重启后盘上第 2 镜的提示词丢了'

const SHOT_TABLE = '[data-testid="shot-table-node"]'
/** 分镜表的第 N 行（行 id = 节点 id；行序 = 落地序 = 镜序）。不带表前缀：调用处自己决定是从表还是从窗口找。 */
const row = (nodeId) => `[data-shot-table-row="${nodeId}"]`

// ── 参数解析。createRuntimeWalk 自己会校验 process.argv（只认 `--packaged <abs>`），
//    所以本脚本的旗标必须在它读之前摘掉，否则它会以「用法错误」报红。 ────────────────
const POSITIVE_CONTROL = process.argv.includes('--positive-control')
const PRODUCTION_TABLE = process.argv.includes('--production-table')
process.argv = process.argv.filter((arg) => !['--positive-control', '--production-table'].includes(arg))

const walk = await createRuntimeWalk('golden-path')
// 截图与 report.json 落在剧本自己的目录里（.tmp/golden-path-<ts>/），
// 而不是通用 runtime-walk 的 pi-* 目录——这条路径写进 docs/qa，红了照着找证据。
const outputDir = path.join(process.cwd(), '.tmp', `golden-path-${Date.now()}`)
fs.mkdirSync(outputDir, { recursive: true })
walk.report.outputDir = outputDir
walk.report.positiveControl = POSITIVE_CONTROL
walk.report.journey = PRODUCTION_TABLE ? 'production-table-compatibility' : 'original-storyboard-editor'

// 当前活着的窗口。刻意**不**挂在 report 上：report 会被 JSON 序列化落盘，
// 塞一个 Playwright Page 进去会当场炸成循环引用。
let currentWin = null

let shotIndex = 0
async function shot(label) {
  shotIndex += 1
  const file = path.join(outputDir, `${String(shotIndex).padStart(2, '0')}-${label}.png`)
  await screenshotSettled(currentWin, { path: file })
  walk.report.screenshots.push(file)
  return file
}

function say(line) {
  console.log(`  · ${line}`)
}

// ── 盘上真相源（只认账本 A）────────────────────────────────────────────────────

/** Run 落地的镜头节点（锚是参考卡，不占镜号）。数组序 = 落地序 = 镜序。 */
function landedShotNodes(payload) {
  return (payload?.generationCanvas?.nodes ?? []).filter((node) =>
    typeof node.meta?.productionRunId === 'string' && node.meta.productionRunId && node.meta?.productionShotRole !== 'anchor')
}

function shotPrompts(payload) {
  return landedShotNodes(payload).map((node) => node.prompt)
}

function shotNode(payload, shotId) {
  return landedShotNodes(payload).find((node) => node.meta?.productionShotId === shotId) ?? null
}

/** 那张只认 Run 的分镜表节点（source.kind === 'production'）。 */
function productionShotTable(payload) {
  return (payload?.generationCanvas?.nodes ?? []).find((node) =>
    node.kind === 'shot_table' && node.meta?.shotTable?.source?.kind === 'production') ?? null
}

function projectFiles(projectRoot) {
  return [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]
    .filter((file) => fs.existsSync(file))
}

function readPersistedPayload(projectRoot) {
  const files = projectFiles(projectRoot)
  if (!files.length) throw new Error(`盘上没有 project.json：${projectRoot}`)
  return JSON.parse(fs.readFileSync(files[0], 'utf8')).payload
}

// ── 画布：把分镜表带进视口并铺开。React Flow 开着 onlyRenderVisibleElements（视口外的节点连 DOM 都不进），
//    表在低缩放（<80%）下又只剩镜号/关键帧两列（compact），画面与状态列都不在。所以按用户会做的三下来：
//    ① 先等画布停下：落节点本身不再挪画布（2026-09-25 拍板，以前这里等的是落地后那次延迟自动 fit），
//       但进画布 / 重开项目那一刻，若记住的视角里一个节点都看不见，画布会一次性摆全貌（useAutoFitOnLoad，
//       350ms 后判一次）——人是看它摆好了才动手的；Agent 在创作页落的镜头若在屏外，舞台边会出一颗
//       「新节点在…」的边缘提示，这里不点它（下一步的「适应视图」是同样由用户发起、且框住全部节点的那一下）；
//    ② 「适应视图」——全部节点入视口，证明表在；
//    ③ 在空白处按住拖动，把表拖到舞台正中，再把缩放滑块（产品自己的控件）拨到 80%——滑块绕视口中心缩放，
//       ≥80% 表就铺开成完整表格（shotTableDensityForZoom 的 full 档），而 100% 时 960px 宽的表在 800px 的舞台里
//       左沿会出界、第一列的勾选框点不到（真机量到的）。不用「重置视图」：它回到画布原点，表并不在那儿。 ──────
async function bringShotTableIntoFullView(win) {
  await waitForCanvasViewportSettled(win)
  await clickOrFail(win.getByRole('button', { name: '适应视图', exact: true }), '适应全部节点')
  const table = win.locator(SHOT_TABLE)
  await proveProbe(table, '画布上没有出现分镜表节点')
  await waitForCanvasViewportSettled(win)

  const centers = async () => win.evaluate(({ tableSelector, stageSelector }) => {
    const rect = (el) => el?.getBoundingClientRect()
    const stage = rect(document.querySelector(stageSelector))
    const node = rect(document.querySelector(tableSelector))
    if (!stage || !node) return null
    return { stage: { x: stage.left + stage.width / 2, y: stage.top + stage.height / 2, left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom },
      table: { x: node.left + node.width / 2, y: node.top + node.height / 2, left: node.left, top: node.top, right: node.right, bottom: node.bottom } }
  }, { tableSelector: SHOT_TABLE, stageSelector: CANVAS_STAGE_SELECTOR })
  // 拖到正中（最多三次逼近：起点必须是空白处，而空白处离边太近时一次拖不完整段）。
  for (let pass = 0; pass < 3; pass += 1) {
    const before = await centers()
    expect(before, '拖动前读不到舞台或分镜表的位置').toBeTruthy()
    const delta = { x: before.stage.x - before.table.x, y: before.stage.y - before.table.y }
    if (Math.abs(delta.x) < 8 && Math.abs(delta.y) < 8) break
    const blank = await findCanvasBlankPoint(win, { inset: 24 })
    expect(blank, '画布上找不到可以按住拖动的空白处').toBeTruthy()
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
    const target = { x: clamp(blank.x + delta.x, before.stage.left + 12, before.stage.right - 12), y: clamp(blank.y + delta.y, before.stage.top + 12, before.stage.bottom - 12) }
    await win.mouse.move(blank.x, blank.y)
    await win.mouse.down()
    await win.mouse.move(target.x, target.y, { steps: 12 })
    await win.mouse.up()
  }
  const centered = await centers()
  expect(Math.hypot(centered.stage.x - centered.table.x, centered.stage.y - centered.table.y), '分镜表没有被拖到舞台正中').toBeLessThan(24)

  // 滑块 → 80%：绕视口中心（此刻 = 表的中心）缩放。走真实 input 事件（同 app-page-zoom.e2e.mjs）。
  const slider = win.getByRole('slider', { name: '缩放比例', exact: true })
  await slider.evaluate((element) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, '80')
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(slider, '缩放没有到 80%').toHaveValue('80')
  await expect(table, '80% 下分镜表没有铺开成完整表格').toHaveAttribute('data-density', 'full')
  const final = await centers()
  expect(final.table.left >= final.stage.left && final.table.right <= final.stage.right && final.table.top >= final.stage.top && final.table.bottom <= final.stage.bottom,
    `80% 下分镜表没有整张落在舞台内（表 ${JSON.stringify(final.table)} · 舞台 ${JSON.stringify(final.stage)}）`).toBe(true)
  return table
}

// ────────────────────────────────────────────────────────────────────────────────
// 步骤函数。每个函数：先证明「我到了这一屏」，再做业务动作，再断言结果，最后取证。
// ────────────────────────────────────────────────────────────────────────────────

/** ① 新建空项目 —— 走项目库里那个真按钮，不 seed 工程。 */
async function stepNewProject() {
  const { win } = await walk.start({ first: true })
  currentWin = win
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  const created = await walk.newProject()
  await expectVisible(win.locator(DOCUMENT), '新建空项目后创作区文本编辑器没有出现')
  say(`新建空项目：${created.projectId}`)
  await shot('new-empty-project')
  return created
}

/** ② 在创作区文本编辑器写三句剧本。常驻 Agent 面板是无条件挂载的，先证明它在。 */
async function stepWriteScript(win) {
  await expectVisible(win.locator(CREATION_PANEL), '创作区没有出现常驻 Agent 面板')
  const document = win.locator(DOCUMENT)
  await document.fill(SCRIPT_TEXT)
  await expect(document, '三句剧本没有落进创作区编辑器').toHaveText(SCRIPT_TEXT)
  say('三句剧本已写入创作区')
  await shot('script-written')
}

/**
 * ③ 显式拆成 3 镜。现役链路：选中正文 → 划词浮条「拆成镜头」→ Agent 发一次 `draft_shots`。
 * `draft_shots` 是 reversible_local、默认 safe-auto 档自动放行——**没有**审批卡：草稿直接落画布
 * （3 个占位节点 + 分镜组 + 一张分镜表，一个撤销步），带单价角标，不出报价卡、不花钱。
 */
async function stepSplitIntoThreeShots(win, projectId) {
  const planner = walk.fixture.expectText({
    label: '划词拆镜头触发真实规划请求',
    match: (body) => flattenRequestText(body).includes('GOLDEN_SCRIPT') && !hasToolResult(body, PLAN_CALL_ID),
    reply: {
      type: 'tool', id: PLAN_CALL_ID, name: 'draft_shots',
      args: {
        shots: SHOT_PROMPTS.map((prompt, position) => ({
          title: SHOT_TITLES[position], taskKind: 'text_to_image', modelId: FIXTURE_IMAGE_MODEL, modeId: 't2i', parameters: { size: '1024x1024' }, prompt,
        })),
      },
    },
  })
  const plannerDone = walk.fixture.expectText({
    label: '规划工具结果在同一轮回流',
    match: (body) => hasToolResult(body, PLAN_CALL_ID),
    reply: { type: 'text', text: 'GOLDEN_PLAN_DONE：三镜草稿已落到画布，请审阅。' },
  })

  // This compatibility journey uses the existing canvas Agent entry, which has
  // no document admission. Document drafting is tested by the default journey.
  await openCanvas(win)
  await win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`).fill(`把以下故事做成三个画布镜头：${SCRIPT_TEXT}`)
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`), '从画布Agent建立原production分镜表')
  await recorded(planner.received, '分镜规划请求')
  await recorded(plannerDone.received, '分镜规划工具结果')

  // 账本 A：3 个镜头节点同属一个 Run，提示词逐字等于草稿；一张 production 分镜表指着同一个 Run；
  // 一个带幂等章的分镜组。三者缺一都是「Agent 说落了、用户看不到」。
  await expect.poll(async () => shotPrompts((await readProject(win, projectId)).payload).length,
    { message: '草稿没有落成 3 个镜头节点', timeout: stationTimeout({ operations: 2 }) }).toBe(3)
  const payload = (await readProject(win, projectId)).payload
  const nodes = landedShotNodes(payload)
  expect(nodes.map((node) => node.prompt), '落盘的三镜提示词与草稿不一致').toEqual(SHOT_PROMPTS)
  // 断「值真的抵达了」，不是「没报错」：模型拟的标题成了节点标签（不是渲染层的「镜头 N」兜底），
  // 模型点名的模型成了节点的模型（不是用户默认的那个）。2026-09-18 这两条各在链路上死过。
  expect(nodes.map((node) => node.title), '模型拟的镜头标题没有一路走到节点标签').toEqual(SHOT_TITLES)
  expect(nodes.map((node) => node.meta.modelKey), '节点的模型不是草稿里点名的那个').toEqual(SHOT_PROMPTS.map(() => FIXTURE_IMAGE_MODEL))
  const runId = nodes[0].meta.productionRunId
  expect(nodes.map((node) => node.meta.productionRunId), '三镜不属于同一个 Run').toEqual([runId, runId, runId])
  expect(nodes.map((node) => node.meta.productionShotId), '镜头 id 不是宿主按序派的稳定 id').toEqual(['shot-1', SHOT_2_ID, 'shot-3'])
  const table = productionShotTable(payload)
  expect(table, '画布上没有落下只认 Run 的分镜表').toBeTruthy()
  expect(table.meta.shotTable.source.runId, '分镜表指的不是这个 Run').toBe(runId)
  expect(table.meta.shotTable, '分镜表不许缓存行（行必须从节点 derive）').not.toHaveProperty('rows')
  const group = (payload.generationCanvas?.groups ?? []).find((item) => item.materializationOperationId === `canvas-landing:${runId}`)
  expect(group, '三镜没有编成带幂等章的分镜组').toBeTruthy()
  expect(walk.fixture.images, '规划阶段不得发生任何图片生成调用').toHaveLength(0)
  say(`已显式拆成 3 镜（草稿落画布，零扣费）· run=${runId}`)
  await shot('plan-landed-three-shots')
  return { runId, nodeIds: nodes.map((node) => node.id) }
}

/** 进画布，把分镜表铺开，并断言表里就是 3 行、行序即镜序。 */
async function stepOpenShotTable(win, nodeIds) {
  await openCanvas(win)
  await shot('canvas-opened-after-landing')
  const table = await bringShotTableIntoFullView(win)
  await expect(table.locator('[data-shot-table-row]'), '分镜表不是 3 行').toHaveCount(3)
  const rowIds = await table.locator('[data-shot-table-row]').evaluateAll((rows) => rows.map((el) => el.getAttribute('data-shot-table-row')))
  expect(rowIds, '分镜表的行不是那三个镜头节点（按落地序）').toEqual(nodeIds)
  // 表是节点的投影：那一行的画面列必须就是那一镜节点的提示词（不是别的行、不是缓存的旧值）。
  await expect(table.locator(row(nodeIds[1])), '表里第 2 行的画面列不是第 2 镜的提示词').toContainText(SHOT_PROMPTS[1].slice(0, 10))
  await expect(table, '表头没有说这是 3 镜').toContainText('3 镜')
  say('已进入画布，分镜表 3 行')
  await shot('shot-table-three-rows')
}

/** ④ 选中第 2 镜。选中态是第 ⑥ 步的前提——先证明「我确实选中了它」。 */
async function stepSelectShot2(win, nodeIds) {
  const table = win.locator(SHOT_TABLE)
  await clickOrFail(table.locator(`${row(nodeIds[1])} [aria-label="选择第 2 镜"]`), '勾选第 2 镜')
  await expect(table.locator(`${row(nodeIds[1])} input[type="checkbox"]`), '第 2 行没有进入选中态').toBeChecked()
  await expect(table.locator('footer'), '选中作用域不是 1 镜').toContainText('已选 1 镜')
  say('已选中第 2 镜')
  await shot('shot2-selected')
}

/**
 * ⑤ 改第 2 镜的一句提示词 —— 经 Agent 的 `draft_shots(draftId=Run, shots[{shotId:'shot-2'}])`。
 * 走的是 Run 账本那扇门（那一镜候选 revision +1 → 已落的节点按它重绑定），不是另一份方案。
 * 断言分三层：工具确实是 draft_shots / 只有第 2 个节点变 / 1、3 逐字未变 / 表里那一行跟着变。
 */
async function stepAgentPatchShot2(win, projectId, runId, nodeIds) {
  const patch = walk.fixture.expectText({
    label: 'Agent 把改提示词表达成 draft_shots(draftId, shotId) 调用',
    match: (body) => flattenRequestText(body).includes(PATCH_INSTRUCTION) && !hasToolResult(body, PATCH_CALL_ID),
    reply: {
      type: 'tool', id: PATCH_CALL_ID, name: 'draft_shots',
      // 20 动词：改一镜提示词 = draft_shots(operationId, shots[{shotId}])。
      // 字段名用 main 改名后的 operationId；值仍从真实 Run 账本读回（runId / SHOT_2_ID），
      // 不写字面量——这条走查的意义就是「Agent 改的那一镜真的回到了表里」。
      args: { operationId: runId, shots: [{ shotId: SHOT_2_ID, prompt: SHOT_2_NEW_PROMPT }] },
    },
  })
  const patchDone = walk.fixture.expectText({
    label: 'draft_shots 工具结果在同一轮回流',
    match: (body) => hasToolResult(body, PATCH_CALL_ID),
    reply: { type: 'text', text: 'GOLDEN_PATCH_DONE：第 2 镜提示词已更新。' },
  })

  const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
  await expectVisible(input, '画布 Agent 面板没有输入框')
  await waitForCanvasViewportSettled(win)
  const viewport = win.locator('.react-flow__viewport')
  const beforeViewport = await viewport.evaluate(element => getComputedStyle(element).transform)
  const beforePrompts = shotPrompts((await readProject(win, projectId)).payload)
  expect(beforePrompts, '发指令之前第 2 镜就已经变了').toEqual(SHOT_PROMPTS)
  await input.fill(PATCH_INSTRUCTION)
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`), '发送改提示词指令')
  const patchWire = await recorded(patch.received, 'draft_shots 改镜请求')
  expect(flattenRequestText(patchWire.body), 'Agent 请求里没有带上用户这句指令').toContain(PATCH_INSTRUCTION)
  await recorded(patchDone.received, 'draft_shots 改镜工具结果')

  await expect.poll(async () => shotNode((await readProject(win, projectId)).payload, SHOT_2_ID)?.prompt,
    { message: '改镜之后第 2 镜节点的提示词没有落盘', timeout: stationTimeout({ operations: 2 }) }).toBe(SHOT_2_NEW_PROMPT)
  const after = shotPrompts((await readProject(win, projectId)).payload)
  expect(after[0], '第 1 镜被误改').toBe(SHOT_PROMPTS[0])
  expect(after[2], '第 3 镜被误改').toBe(SHOT_PROMPTS[2])
  // 改提示词应保留阅读位置：落地层早已不再发延迟 fit（2026-09-25），但仍先等视口停稳再逐字比——
  // 真有程序移动，停下来的那一帧就和改前不同；抢在动画中途比会漏掉它。
  await waitForCanvasViewportSettled(win)
  await expect(viewport, '仅改已有镜头提示词不应移动或缩放画布').toHaveCSS('transform', beforeViewport)
  await expect(win.locator(SHOT_TABLE), '改提示词后完整表格应继续可读').toHaveAttribute('data-density', 'full')
  await expect(win.locator(SHOT_TABLE).locator(row(nodeIds[1])), '分镜表第 2 行没有显示改后的提示词').toContainText('逆光下的侧脸')
  say('第 2 镜提示词已经 Agent 改掉（Run 账本 → 节点 → 表），1/3 镜逐字未变')
  await shot('shot2-prompt-patched')
}

/**
 * ⑥⑦ 第 2 镜生成一张图片（loopback，零额度），结果回到该行。
 * 表里的「生成 N 镜」走节点自己那扇既有的付费门（confirmAndRunPlan → 画布批次 runner）；批次跑完 runner 会
 * 拿真图去问一次审片（「资深影视分镜审片」，零额度 loopback）——它是产品行为，必须预登记，否则收尾时
 * 以「未登记的模型请求」报红（第一次真跑就是这么红的）。审片的提示词里带的是模型拟的镜头标题与改后的
 * 提示词——这也是「值抵达了」的又一处证据，下面顺手断它。
 */
async function stepGenerateShot2Image(win, projectId, nodeIds) {
  const judge = walk.fixture.expectText({
    label: '批次完成后 runner 拿真图问审片',
    match: (body) => flattenRequestText(body).includes('资深影视分镜审片'),
    reply: { type: 'text', text: JSON.stringify({ reason: 'GOLDEN_JUDGE：构图与意图一致。', scores: { identity: 5, composition: 5 } }) },
  })
  const table = win.locator(SHOT_TABLE)
  await expect(table.locator(row(nodeIds[1])), '第 2 镜不在未生成态').toContainText('未生成')
  await clickOrFail(table.locator('footer').getByRole('button', { name: '生成 1 镜', exact: true }), '生成选中的第 2 镜')
  const spendDialog = win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }).last()
  const spendProof = await proveProbe(spendDialog, '生成前必须先弹花钱确认卡')
  expect(walk.fixture.images, '确认之前不得发生任何图片生成调用').toHaveLength(0)
  await shot('generation-awaits-confirm')
  await clickOrFail(spendDialog.getByRole('button', { name: '生成', exact: true }), '确认生成（loopback 零额度）')
  await expectAbsent(spendDialog, { provenBy: spendProof, message: '确认后花钱确认卡应持续消失' })

  await expect(table.locator(row(nodeIds[1])), '第 2 镜没有变成已生成').toContainText('已生成', { timeout: stationTimeout({ operations: 4 }) })
  await expect.poll(async () => shotNode((await readProject(win, projectId)).payload, SHOT_2_ID)?.result?.url ?? null,
    { message: '第 2 镜的生成结果没有回到它的节点', timeout: stationTimeout({ operations: 4 }) }).toMatch(/^nomi-local:\/\//)
  const resultUrl = shotNode((await readProject(win, projectId)).payload, SHOT_2_ID).result.url
  expect(shotPrompts((await readProject(win, projectId)).payload), '生成不许改动任何一镜的提示词')
    .toEqual([SHOT_PROMPTS[0], SHOT_2_NEW_PROMPT, SHOT_PROMPTS[2]])
  expect(walk.fixture.images, '这一步应当恰好发生 1 次图片生成调用').toHaveLength(1)
  const judgeWire = await recorded(judge.received, '审片请求')
  const judgeText = flattenRequestText(judgeWire.body)
  expect(judgeText, '审片看到的不是模型拟的那个镜头标题').toContain(SHOT_TITLES[1])
  expect(judgeText, '审片看到的不是改后的提示词').toContain(SHOT_2_NEW_PROMPT)
  say(`第 2 镜（${SHOT_2_ID}）已生成，结果回到该行；审片拿到的是它的标题与改后提示词`)
  await shot('shot2-generated')
  return { resultUrl }
}

/**
 * ⑧⑨ 关闭 Nomi 重启 —— 真进程退出（stopRuntimeApp 会断言进程真的死了），
 * 再用同一份 userData/settings/projects 冷启动，从项目库「继续创作」回到画布。
 *
 * 这里刻意不 win.reload()：原地刷新后活动项目恒 null，面板会静默空掉，
 * 那是走查独有的死法，不是用户路径（docs/lessons/walkthrough-no-win-reload.md）。
 */
async function stepRestartAndVerify(projectRoot, projectId, nodeIds, { resultUrl }) {
  const sessionsBeforeRestart = readLaneTranscripts(projectRoot)
  expect(sessionsBeforeRestart, '分镜规划和改镜必须留在同一 lane').toHaveLength(1)
  const sessionBeforeRestart = sessionsBeforeRestart[0]
  const messagesBeforeRestart = laneMessages(sessionBeforeRestart)
  const draftResults = messagesBeforeRestart.filter((message) => message.role === 'toolResult'
    && [PLAN_CALL_ID, PATCH_CALL_ID].includes(message.toolCallId))
  expect(draftResults.map((message) => [message.toolCallId, message.toolName, message.isError]),
    '两次 draft_shots 的工具结果必须都在转录里且都不是错误')
    .toEqual([[PLAN_CALL_ID, 'draft_shots', false], [PATCH_CALL_ID, 'draft_shots', false]])
  const modelRequestsBeforeRestart = walk.fixture.requests.length
  await walk.stopApp()
  say('Nomi 已真正退出')

  if (POSITIVE_CONTROL) {
    // 阳性对照：破坏「落盘」这一环——把盘上第 2 镜节点的提示词改回旧值。
    // 下面那条重启断言如果是活的，必须在这里报红。
    for (const file of projectFiles(projectRoot)) {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'))
      const node = shotNode(record.payload, SHOT_2_ID)
      if (!node) throw new Error(`阳性对照无法生效：${file} 里读不到第 2 镜节点`)
      node.prompt = SHOT_PROMPTS[1]
      fs.writeFileSync(file, JSON.stringify(record, null, 2))
    }
    say('⚠️ 阳性对照已注入：盘上第 2 镜提示词被改回旧值，重启断言必须报红')
  }

  const { win } = await walk.start()
  currentWin = win
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))

  // 先问盘，再开 UI。两个理由：
  //   ① 「重启后还在」的真相源是盘，不是重新渲染出来的那一屏；先读盘，结论不依赖任何交互；
  //   ② 阳性对照瞄的就是这一条——它必须在这里红，而不是被后面的交互/竞态先绊倒。
  const persisted = readPersistedPayload(projectRoot)
  expect(shotPrompts(persisted)[1], TARGET_ASSERTION).toBe(SHOT_2_NEW_PROMPT)
  expect(shotNode(persisted, SHOT_2_ID)?.result?.url, '重启后盘上第 2 镜的结果图丢了').toBe(resultUrl)
  expect(productionShotTable(persisted), '重启后盘上那张分镜表丢了').toBeTruthy()

  // 冷启动落在项目库。走用户真实入口回到工程：卡片上的「继续创作」。
  const card = win.locator('[data-project-card]').first()
  await expectVisible(card, '重启后项目库里没有那个项目')
  await card.hover()
  await clickOrFail(card.getByText('继续创作', { exact: false }).first(), '重启后继续创作')
  await shot('restart-project-reopened')

  // 先证明「我回到了同一个工程」，再谈它里面的东西对不对。路由是异步落的，等它带上 projectId 再读。
  await win.waitForFunction(() => {
    const url = new URL(location.href)
    return Boolean(url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId'))
  }, null, { timeout: stationTimeout({ operations: 2 }) })
  const reopenedId = await win.evaluate(() => {
    const url = new URL(location.href)
    return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  })
  expect(reopenedId, '重启后打开的不是同一个工程').toBe(projectId)

  // 盘对了还不够：用户看得见的那一屏也得对。
  await openCanvas(win)
  const table = await bringShotTableIntoFullView(win)
  await expect(table.locator('[data-shot-table-row]'), '重启后分镜表不是 3 行').toHaveCount(3)
  await expect(table.locator(row(nodeIds[1])), '重启后第 2 行没有显示改后的提示词').toContainText('逆光下的侧脸')
  await expect(table.locator(row(nodeIds[1])), '重启后第 2 镜不是已生成态').toContainText('已生成', { timeout: stationTimeout({ operations: 2 }) })
  // 只比 src 字符串会假绿：src 在、图挂了也照样通过。判据取 naturalWidth——它 >0 意味着这张图**真的解码出来了**。
  const restoredImage = table.locator(`${row(nodeIds[1])} img`).first()
  await expect.poll(async () => restoredImage.evaluate((el) => el.naturalWidth),
    { message: '重启后第 2 行的关键帧格没有真的把那张图解码出来', timeout: stationTimeout({ operations: 2 }) })
    .toBeGreaterThan(0)
  const restored = await restoredImage.evaluate((el) => ({ src: el.getAttribute('src'), w: el.naturalWidth, h: el.naturalHeight, complete: el.complete }))
  console.log('  · 重启后关键帧格 img：', JSON.stringify(restored))
  expect(restored.src, '重启后第 2 行关键帧格的图不是本地资产').toContain('nomi-local://')
  const restoredSession = readLaneTranscripts(projectRoot).find((session) => session.sessionId === sessionBeforeRestart.sessionId)
  expect(restoredSession, '重启后的 Agent 面必须仍用原 SDK session').toBeTruthy()
  expect(laneMessages(restoredSession), '冷重启不能补造旧工具结果或重跑分镜').toEqual(messagesBeforeRestart)
  expect(walk.fixture.requests, '恢复历史不能调用模型').toHaveLength(modelRequestsBeforeRestart)
  say('重启后：第 2 镜的修改和图片都还在')
  await shot('restart-changes-persist')
}

// ────────────────────────────────────────────────────────────────────────────────

let failure
try {
  console.log(POSITIVE_CONTROL
    ? '▶ 金路径走查（阳性对照模式：破坏落盘，最后一条断言必须报红）'
    : '▶ 金路径走查（新建空项目 → 三句剧本 → 拆 3 镜落画布 → 表里选第 2 镜 → Agent 改它 → 生成 → 重启）')
  const { projectId, projectRoot } = await stepNewProject()
  const win = currentWin
  await stepWriteScript(win)
  if (PRODUCTION_TABLE) {
    const { runId, nodeIds } = await stepSplitIntoThreeShots(win, projectId)
    await stepOpenShotTable(win, nodeIds)
    await stepSelectShot2(win, nodeIds)
    await stepAgentPatchShot2(win, projectId, runId, nodeIds)
    const generated = await stepGenerateShot2Image(win, projectId, nodeIds)
    await stepRestartAndVerify(projectRoot, projectId, nodeIds, generated)
  } else {
    await runOriginalStoryboardGolden({ walk, win, projectId, projectRoot, shot,
      setCurrentWin: value => { currentWin = value }, prompts: SHOT_PROMPTS, titles: SHOT_TITLES,
      newPrompt: SHOT_2_NEW_PROMPT, instruction: PATCH_INSTRUCTION, planCall: PLAN_CALL_ID,
      patchCall: PATCH_CALL_ID, shotId: SHOT_2_ID, targetAssertion: TARGET_ASSERTION, positiveControl: POSITIVE_CONTROL })
  }

  if (POSITIVE_CONTROL) {
    // 走到这里意味着：盘上的修改被抹掉了，而「重启后修改仍在」的断言居然还是绿的。
    // 那条断言就是死的——它没有在测它命名的那件事。
    throw new Error('阳性对照失效：盘上第 2 镜的修改已被抹回旧值，重启断言却依然通过 —— 这条断言是死的，先修尺子再谈门。')
  }
  if (PRODUCTION_TABLE) walk.report.verified = [
    'new-empty-project', 'three-line-script', 'draft-shots-land-on-canvas-with-shot-table',
    'shot2-selection-in-shot-table', 'draft-shots-patch-one-shot', 'loopback-image-generation',
    'cold-restart-persistence',
  ]
  console.log(`\n✅ 金路径全绿。截图与 report.json 在 ${outputDir}`)
} catch (error) {
  failure = error
  process.exitCode = 1
  const text = String(error?.message || error)
  if (POSITIVE_CONTROL && text.includes(TARGET_ASSERTION)) {
    console.error(`\n✅ 阳性对照成立：破坏落盘后，「${TARGET_ASSERTION}」这条断言如期报红 —— 这道门是活的。\n${error?.stack || error}`)
  } else if (POSITIVE_CONTROL && !/阳性对照失效/.test(text)) {
    console.error(`\n✖ 阳性对照红错了地方：期望红在「${TARGET_ASSERTION}」，实际红在下面这条。\n先修脚本，再谈这道门算不算数。\n${error?.stack || error}`)
  }
} finally {
  await walk.finish(failure)
  if (POSITIVE_CONTROL) {
    console.log(process.exitCode
      ? `\n▲ 阳性对照跑完：本次运行按设计报红（exit 1）。合格的红必须是「${TARGET_ASSERTION}」那一条。`
      : '\n✖ 阳性对照跑完却是绿的 —— 不应该发生，请检查脚本。')
  }
}
