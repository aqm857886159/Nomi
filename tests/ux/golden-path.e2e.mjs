#!/usr/bin/env node
// 金路径 · 每日走查（第二刀）。
//
// 这是**一条固定的、不许缩水的真实用户路径**，每天跑一次当门；红了当天修。
// M0–M5 矩阵留着当地图，不当门——地图告诉你还有哪些地没铺，门只问一件事：
// 「昨天还能走通的那条路，今天还走得通吗」。
//
// 剧本（一个字不许缩）：
//   ① 新建空项目
//   ② 在创作区文本编辑器写三句剧本
//   ③ 显式拆成 3 镜（走现役分镜规划链路：选中正文 →「拆成镜头」→ Agent 提议 → 人批准）
//   ④ 选中第 2 镜
//   ⑤ 改第 2 镜的一句提示词——经 Agent 的 canonical
//      `nomi_canvas_plan(operation=patch_shots)` 提议并批准
//   ⑥ 第 2 镜生成一张图片（loopback fixture 供应商，零额度）
//   ⑦ 结果回到该行
//   ⑧ 关闭 Nomi 重启
//   ⑨ 图和修改仍在
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
// app 之后、重启之前，把盘上第 2 镜的提示词改回旧值——**如果这条断言是活的，它必须红**。
// 没红 = 尺子坏了，本脚本会明确报「阳性对照失效」。
//
// 相关教训（写之前都读过）：
//   · expect-absent-passes-too-early —— 「不存在」断言一律走 _assert.mjs 的 expectAbsent + proveProbe
//   · walkthrough-no-win-reload     —— 冷启动用真 app.close() + 重新 launch，绝不 win.reload()
//   · assert-you-are-in-the-situation-you-claim —— 每步先断言「我到了这儿」再断言业务
//   · dead-selector-lies-both-ways  —— 所有点击走 clickOrFail，点不到就红，不静默跳过
import fs from 'node:fs'
import path from 'node:path'

import { clickOrFail, expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CREATION_PANEL, DOCUMENT, createRuntimeWalk,
  hasToolResult, readProject, recorded,
} from './agent-runtime-walk-support.mjs'

// ── 剧本常量。标记串（GOLDEN_*）让 fixture 的 match 钉死「这一条请求确实是这一步发出的」，
//    而不是「随便哪条文本请求都算」。 ──────────────────────────────────────────────
const SCRIPT_LINE_1 = '清晨的旧书店刚开门，女孩推门进来。'
const SCRIPT_LINE_2 = '她在最里侧的书架前停下，抽出一本旧诗集。'
const SCRIPT_LINE_3 = '窗外的光落在书页上，她轻轻笑了一下。'
const SCRIPT_TEXT = `GOLDEN_SCRIPT：${SCRIPT_LINE_1}${SCRIPT_LINE_2}${SCRIPT_LINE_3}`

const PLAN_TITLE = '金路径 · 旧书店'
const PLAN_CALL_ID = 'golden-plan-1'
const PATCH_CALL_ID = 'golden-patch-1'

const SHOT_PROMPTS = [
  '清晨的旧书店门口，暖光，女孩推门进来的中景。',
  '书架前的女孩侧影，手指抽出一本旧诗集，中近景。',
  '窗光落在摊开的书页上，女孩微笑的特写。',
]
/** 第 2 镜要被改成的那一句。必须与原句可区分，且不含原句子串——否则「改了没」判不出来。 */
const SHOT_2_NEW_PROMPT = 'GOLDEN_PATCHED：逆光下的侧脸，尘埃在光柱里浮动，安静的近景。'
const PATCH_INSTRUCTION = '把选中的这一镜改成逆光侧脸、尘埃浮在光柱里的安静近景。'

/**
 * 阳性对照瞄准的那一条断言。控制组必须**在这一条上**报红——红在别处（超时、路由竞态、
 * 选择器过期）都不算数：那只证明脚本脆，没证明这道门是活的。
 */
const TARGET_ASSERTION = '重启后盘上第 2 镜的提示词丢了'

/** 分镜面的常驻 Agent 面板（WorkbenchShell 的 storyboard dock，见 WorkbenchShell.tsx agentSurface）。 */
const STORYBOARD_PANEL = '[data-agent-resident="true"][data-agent-panel="true"][data-agent-surface="storyboard"]'
const STORYBOARD_EDITOR = '[data-storyboard-editor="true"]'
/**
 * 第 N 行。**必须**作用域到编辑器内：侧栏的分镜设计行用的是同一个 `data-storyboard-row`
 * 属性、值是 design id（DocumentListSidebar.tsx:325），而非活动工作区只是 hidden、并没卸载。
 * 不加作用域，某天某个 design id 恰好长成数字就会静默指错元素。
 */
const row = (index) => `${STORYBOARD_EDITOR} [data-storyboard-row="${index}"]`

// ── 参数解析。createRuntimeWalk 自己会校验 process.argv（只认 `--packaged <abs>`），
//    所以本脚本的旗标必须在它读之前摘掉，否则它会以「用法错误」报红。 ────────────────
const POSITIVE_CONTROL = process.argv.includes('--positive-control')
process.argv = process.argv.filter((arg) => arg !== '--positive-control')

const walk = await createRuntimeWalk('golden-path')
// 截图与 report.json 落在剧本自己的目录里（.tmp/golden-path-<ts>/），
// 而不是通用 runtime-walk 的 pi-* 目录——这条路径写进 docs/qa，红了照着找证据。
const outputDir = path.join(process.cwd(), '.tmp', `golden-path-${Date.now()}`)
fs.mkdirSync(outputDir, { recursive: true })
walk.report.outputDir = outputDir
walk.report.positiveControl = POSITIVE_CONTROL

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

/**
 * 盘上真相源：分镜方案按 documentId 存在 storyboardDesignsByDocumentId 里。
 * 这里刻意只认 owner，避免兼容形状制造假绿。
 * 这里刻意**只**认这一份 —— 多认一份「兼容形状」就等于给假绿开后门。
 */
function planFromPayload(payload) {
  const documentId = payload?.activeDocumentId
  const entry = documentId ? payload?.storyboardDesignsByDocumentId?.[documentId]?.[0] : null
  return entry?.plan ?? null
}

function shotPrompts(payload) {
  return (planFromPayload(payload)?.shots ?? []).map((item) => item.prompt)
}

/**
 * 第 position 个镜头（0 基）的稳定 id —— 结果节点用它归位。
 * 规划没显式给 shotId 时，生产侧按镜号 derive 成 `shot-<index>`
 * （src/workbench/generationCanvas/agent/storyboardPlan.ts:338）。这里照同一条规则算，
 * 不另起一套；生产改了规则，这条断言应当跟着红。
 */
function shotIdOf(payload, position) {
  const shot = planFromPayload(payload)?.shots?.[position]
  if (!shot) return null
  return typeof shot.shotId === 'string' && shot.shotId ? shot.shotId : `shot-${shot.index}`
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

// ────────────────────────────────────────────────────────────────────────────────
// 步骤函数。每个函数：先证明「我到了这一屏」，再做业务动作，再断言结果，最后取证。
// ────────────────────────────────────────────────────────────────────────────────

/** ① 新建空项目 —— 走项目库里那个真按钮，不 seed 工程。 */
async function stepNewProject() {
  const { win } = await walk.start({ first: true })
  currentWin = win
  win.setDefaultTimeout(30_000)
  const created = await walk.newProject()
  await expectVisible(win.locator(DOCUMENT), '新建空项目后创作区文本编辑器没有出现')
  say(`新建空项目：${created.projectId}`)
  await shot('new-empty-project')
  return created
}

/**
 * ② 在创作区文本编辑器写三句剧本。
 *
 * 这里先断言常驻 Agent 面板已经挂上：它现在是**无条件挂载**的（#194 那个
 * `agentHostEnabled` 发布闸已删），所以原来那一步「走 Settings 打开常驻 Agent」
 * 连同它的截图一起删掉了——闸没了还留着那一步，就是留一个「有时开有时关」的并行态（P1）。
 */
async function stepWriteScript(win) {
  await expectVisible(win.locator(CREATION_PANEL), '创作区没有出现常驻 Agent 面板')
  const document = win.locator(DOCUMENT)
  await document.fill(SCRIPT_TEXT)
  await expect(document, '三句剧本没有落进创作区编辑器').toHaveText(SCRIPT_TEXT)
  say('三句剧本已写入创作区')
  await shot('script-written')
}

/**
 * ③ 显式拆成 3 镜。走现役链路：选中正文 → 划词浮条「拆成镜头」→ Agent 规划提议 → 人批准。
 * 规划本身零扣费（只落方案，不碰画布），扣费那道门在第 ⑥ 步。
 */
async function stepSplitIntoThreeShots(win, projectId) {
  const planner = walk.fixture.expectText({
    label: '划词拆镜头触发真实规划请求',
    match: (body) => flattenRequestText(body).includes('GOLDEN_SCRIPT') && !hasToolResult(body, PLAN_CALL_ID),
    reply: {
      type: 'tool', id: PLAN_CALL_ID, name: 'nomi_canvas_plan',
      args: {
        operation: 'propose_storyboard_plan', title: PLAN_TITLE, anchors: [],
        shots: SHOT_PROMPTS.map((prompt, position) => ({
          index: position + 1, shotKind: 'image', durationSec: 0, anchorIds: [],
          modelKey: FIXTURE_IMAGE_MODEL, modeId: 't2i', params: { size: '1024x1024' }, prompt,
        })),
      },
    },
  })
  const plannerDone = walk.fixture.expectText({
    label: '规划工具结果在同一轮回流',
    match: (body) => hasToolResult(body, PLAN_CALL_ID),
    reply: { type: 'text', text: 'GOLDEN_PLAN_DONE：三镜方案已生成，请审阅。' },
  })

  const document = win.locator(DOCUMENT)
  await document.click()
  await document.selectText()
  const splitButton = win.locator('.workbench-selection-popover').getByRole('button', { name: '拆成镜头', exact: true })
  await expect(splitButton, '选中正文后划词浮条上的「拆成镜头」不可用').toBeEnabled()
  await clickOrFail(splitButton, '在创作区就地拆镜头')
  await recorded(planner.received, '分镜规划请求')

  const approval = win.locator(`${CREATION_PANEL} [data-agent-approval="true"][data-agent-approval-state="pending"]`)
  const approvalProof = await proveProbe(approval, '拆镜头提议停在真实的人工批准边界')
  await shot('plan-awaits-approval')
  await clickOrFail(approval.locator('[data-agent-action="approve"]'), '批准分镜规划', { noWaitAfter: true })
  await expectAbsent(approval, { provenBy: approvalProof, message: '批准后这张提议卡应持续不再可操作' })
  await recorded(plannerDone.received, '分镜规划工具结果')

  await expect.poll(async () => shotPrompts((await readProject(win, projectId)).payload).length,
    { message: '批准后方案没有落成 3 镜', timeout: 30_000 }).toBe(3)
  const prompts = shotPrompts((await readProject(win, projectId)).payload)
  expect(prompts, '落盘的三镜提示词与规划不一致').toEqual(SHOT_PROMPTS)
  expect(walk.fixture.images, '规划阶段不得发生任何图片生成调用').toHaveLength(0)
  say('已显式拆成 3 镜（规划零扣费）')
  await shot('plan-committed-three-shots')
}

/** 进分镜页，并断言表里就是 3 行。 */
async function stepOpenStoryboard(win) {
  // 方案卡就是常驻 Agent 里的分镜收据行「分镜方案已生成 [打开]」。按钮文案是「打开」，
  // 不是「打开分镜」——这条走查钉的是早已改掉的旧文案，于是在 main 上一直红着，
  // 报的是「元素找不到」，看不出根因（docs/lessons/dead-selector-lies-both-ways.md）。
  // 作用域收到收据卡里，免得哪天别处也出现一个叫「打开」的按钮时指错。
  await clickOrFail(
    win.locator('[data-agent-storyboard-receipt="true"]').first().getByRole('button', { name: '打开', exact: true }),
    '从方案卡进入分镜页',
  )
  await expectVisible(win.locator(STORYBOARD_EDITOR), '分镜编辑器没有渲染')
  await expect(win.locator(`${STORYBOARD_EDITOR} [data-storyboard-row]`), '分镜表不是 3 行').toHaveCount(3)
  await expectVisible(win.locator(STORYBOARD_PANEL), '分镜页没有出现常驻 Agent 面板')
  say('已进入分镜页，表里 3 行')
  await shot('storyboard-three-rows')
}

/** ④ 选中第 2 镜。选中态是第 ⑤ 步的前提——先证明「我确实选中了它」。 */
async function stepSelectShot2(win) {
  await clickOrFail(win.locator(`${row(2)} [aria-label="选择镜 2"]`), '勾选第 2 镜')
  // 行自己的选中态是第一真相源；浮条只是它的投影。两个都断，才排除「浮条出来了但选的是别人」。
  await expect(win.locator(row(2)), '第 2 行没有进入选中态').toHaveAttribute('data-selected', 'true')
  const selectionBar = win.locator('[data-storyboard-selection-toolbar="true"]')
  await expectVisible(selectionBar, '选中第 2 镜后没有出现多选浮条')
  await expect(selectionBar, '选中作用域不是 1 镜').toContainText('已选 1 镜')
  say('已选中第 2 镜')
  await shot('shot2-selected')
}

/**
 * ⑤ 改第 2 镜的一句提示词 —— 经 Agent 的 canonical
 * `nomi_canvas_plan(operation=patch_shots)` 提议、人批准后才落。
 * 断言分三层：工具确实是 canonical 那一个 / 只有第 2 行变 / 1、3 行逐字未变。
 */
async function stepAgentPatchShot2(win, projectId) {
  const patch = walk.fixture.expectText({
    label: 'Agent 把改提示词表达成 canonical patch_shots 提议',
    match: (body) => flattenRequestText(body).includes(PATCH_INSTRUCTION) && !hasToolResult(body, PATCH_CALL_ID),
    reply: {
      type: 'tool', id: PATCH_CALL_ID, name: 'nomi_canvas_plan',
      args: {
        operation: 'patch_shots',
        select: { kind: 'indexes', indexes: [2] },
        patch: { prompt: SHOT_2_NEW_PROMPT },
      },
    },
  })
  const patchDone = walk.fixture.expectText({
    label: 'patch_shots 工具结果在同一轮回流',
    match: (body) => hasToolResult(body, PATCH_CALL_ID),
    reply: { type: 'text', text: 'GOLDEN_PATCH_DONE：第 2 镜提示词已更新。' },
  })

  const input = win.locator(`${STORYBOARD_PANEL} [data-agent-input="true"]`)
  await expectVisible(input, '分镜页 Agent 面板没有输入框')
  await input.fill(PATCH_INSTRUCTION)
  await clickOrFail(win.locator(`${STORYBOARD_PANEL} [data-agent-composer-send="true"]`), '发送改提示词指令')
  const patchWire = await recorded(patch.received, 'patch_shots 提议请求')
  expect(flattenRequestText(patchWire.body), 'Agent 请求里没有带上用户这句指令').toContain(PATCH_INSTRUCTION)

  const approval = win.locator(`${STORYBOARD_PANEL} [data-agent-approval="true"][data-agent-approval-state="pending"]`)
  const approvalProof = await proveProbe(approval, '改提示词停在真实的人工批准边界')
  const beforePrompts = shotPrompts((await readProject(win, projectId)).payload)
  expect(beforePrompts, '批准之前第 2 镜就已经被改了 —— 提议没有守住写入').toEqual(SHOT_PROMPTS)
  await shot('patch-awaits-approval')
  await clickOrFail(approval.locator('[data-agent-action="approve"]'), '批准改第 2 镜提示词', { noWaitAfter: true })
  await expectAbsent(approval, { provenBy: approvalProof, message: '批准后这张提议卡应持续不再可操作' })
  await recorded(patchDone.received, 'patch_shots 工具结果')

  await expect.poll(async () => shotPrompts((await readProject(win, projectId)).payload)[1],
    { message: '批准后第 2 镜提示词没有落盘', timeout: 30_000 }).toBe(SHOT_2_NEW_PROMPT)
  const after = shotPrompts((await readProject(win, projectId)).payload)
  expect(after[0], '第 1 镜被误改').toBe(SHOT_PROMPTS[0])
  expect(after[2], '第 3 镜被误改').toBe(SHOT_PROMPTS[2])
  await expect(win.locator(row(2)), '分镜表第 2 行没有显示改后的提示词').toContainText('逆光下的侧脸')
  say('第 2 镜提示词已经 Agent 提议 + 人工批准后改掉，1/3 镜逐字未变')
  await shot('shot2-prompt-patched')
}

/** ⑥⑦ 第 2 镜生成一张图片（loopback，零额度），结果回到该行。 */
// 注：行内单镜生成**不**触发画面审片（那条 judge 请求只在批量完成时发，见
// agent-runtime-production.walk.mjs）。这里不预登记 judge 期望——预登记会在收尾时
// 以「未消费的期望」报红，而那是尺子的错，不是产品的错。
async function stepGenerateShot2Image(win, projectId) {
  await expect(win.locator(`${row(2)} [data-storyboard-frame]`), '第 2 镜不在可生成态')
    .toHaveAttribute('data-storyboard-frame', 'ready')
  await clickOrFail(win.locator(row(2)).getByRole('button', { name: '生成镜 2' }), '生成第 2 镜')
  const spendDialog = win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }).last()
  const spendProof = await proveProbe(spendDialog, '生成前必须先弹花钱确认卡')
  expect(walk.fixture.images, '确认之前不得发生任何图片生成调用').toHaveLength(0)
  await shot('generation-awaits-confirm')
  await clickOrFail(spendDialog.getByRole('button', { name: '生成', exact: true }), '确认生成（loopback 零额度）')
  await expectAbsent(spendDialog, { provenBy: spendProof, message: '确认后花钱确认卡应持续消失' })

  await expect(win.locator(`${row(2)} [data-storyboard-frame]`), '第 2 镜没有变成已生成')
    .toHaveAttribute('data-storyboard-frame', 'done', { timeout: 60_000 })
  // 结果节点认 `meta.shotId`（稳定镜头 id），**不认** `node.shotIndex` ——
  // 后者是画布内的序数（本例里第 2 镜的节点 shotIndex=1，因为它是画布上的第一张），
  // 拿它当镜号会静默匹配不到，长得像「产品没落节点」。
  const shotId = shotIdOf((await readProject(win, projectId)).payload, 1)
  expect(shotId, '盘上第 2 镜没有稳定的 shotId，结果无从归位').toBeTruthy()
  await expect.poll(async () => {
    const payload = (await readProject(win, projectId)).payload
    return (payload.generationCanvas?.nodes ?? []).some((item) => item.meta?.shotId === shotId && item.result?.url)
  }, { message: '第 2 镜的生成结果没有落成画布节点', timeout: 60_000 }).toBe(true)
  const payload = (await readProject(win, projectId)).payload
  const shot2Node = payload.generationCanvas.nodes.find((item) => item.meta?.shotId === shotId)
  expect(shot2Node.result.url, '结果 URL 不是本地资产').toMatch(/^nomi-local:\/\//)
  expect(walk.fixture.images, '这一步应当恰好发生 1 次图片生成调用').toHaveLength(1)
  say(`第 2 镜（${shotId}）已生成，结果回到该行`)
  await shot('shot2-generated')
  return { shotId, resultUrl: shot2Node.result.url }
}

/**
 * ⑧⑨ 关闭 Nomi 重启 —— 真进程退出（stopRuntimeApp 会断言进程真的死了），
 * 再用同一份 userData/settings/projects 冷启动，从项目库「继续创作」回到分镜页。
 *
 * 这里刻意不 win.reload()：原地刷新后活动项目恒 null，面板会静默空掉，
 * 那是走查独有的死法，不是用户路径（docs/lessons/walkthrough-no-win-reload.md）。
 */
async function stepRestartAndVerify(projectRoot, projectId, { shotId, resultUrl }) {
  await walk.stopApp()
  say('Nomi 已真正退出')

  if (POSITIVE_CONTROL) {
    // 阳性对照：破坏「落盘」这一环——把盘上第 2 镜的提示词改回旧值。
    // 下面那条重启断言如果是活的，必须在这里报红。
    for (const file of projectFiles(projectRoot)) {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'))
      const plan = planFromPayload(record.payload)
      if (!plan?.shots?.[1]) throw new Error(`阳性对照无法生效：${file} 里读不到第 2 镜`)
      plan.shots[1].prompt = SHOT_PROMPTS[1]
      fs.writeFileSync(file, JSON.stringify(record, null, 2))
    }
    say('⚠️ 阳性对照已注入：盘上第 2 镜提示词被改回旧值，重启断言必须报红')
  }

  const { win } = await walk.start()
  currentWin = win
  win.setDefaultTimeout(30_000)

  // 先问盘，再开 UI。两个理由：
  //   ① 「重启后还在」的真相源是盘，不是重新渲染出来的那一屏；先读盘，结论不依赖任何交互；
  //   ② 阳性对照瞄的就是这一条——它必须在这里红，而不是被后面的交互/竞态先绊倒。
  // 顺带一条踩过的坑：app 关着时改 project.json，重开会被「另一台电脑有新版本」的外部改动
  // 守卫拦住（这是产品的正确行为）。所以对照组的红必须落在这条盘断言上，不能拖到开工程之后。
  const persisted = readPersistedPayload(projectRoot)
  expect(shotPrompts(persisted)[1], TARGET_ASSERTION).toBe(SHOT_2_NEW_PROMPT)
  expect(persisted.generationCanvas.nodes.find((item) => item.meta?.shotId === shotId)?.result?.url,
    '重启后盘上第 2 镜的结果图丢了').toBe(resultUrl)

  // 冷启动落在项目库。走用户真实入口回到工程：卡片上的「继续创作」。
  const card = win.locator('[data-project-card]').first()
  await expectVisible(card, '重启后项目库里没有那个项目')
  await card.hover()
  await clickOrFail(card.getByText('继续创作', { exact: false }).first(), '重启后继续创作')
  await shot('restart-project-reopened')

  // 先证明「我回到了同一个工程」，再谈它里面的东西对不对。
  // 路由是异步落的：点完「继续创作」立刻读 URL 会拿到 null（首跑就栽过一次，
  // 表现为「重启后打开的不是同一个工程 · Received: null」）。等它带上 projectId 再读。
  await win.waitForFunction(() => {
    const url = new URL(location.href)
    return Boolean(url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId'))
  }, null, { timeout: 30_000 })
  const reopenedId = await win.evaluate(() => {
    const url = new URL(location.href)
    return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  })
  expect(reopenedId, '重启后打开的不是同一个工程').toBe(projectId)

  // 盘对了还不够：用户看得见的那一屏也得对。
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '切到创作页')
  await clickOrFail(win.locator('[data-storyboard-id]').first(), '侧栏选中分镜方案')
  await clickOrFail(win.locator('[data-agent-storyboard-receipt="true"]').first().getByRole('button', { name: '打开', exact: true }), '重启后进入分镜页')
  await expectVisible(win.locator(STORYBOARD_EDITOR), '重启后分镜编辑器没有渲染')
  await expect(win.locator(`${STORYBOARD_EDITOR} [data-storyboard-row]`), '重启后分镜表不是 3 行').toHaveCount(3)
  await expect(win.locator(row(2)), '重启后第 2 行没有显示改后的提示词').toContainText('逆光下的侧脸')
  await expect(win.locator(`${row(2)} [data-storyboard-frame]`), '重启后第 2 镜不是已生成态')
    .toHaveAttribute('data-storyboard-frame', 'done', { timeout: 30_000 })
  // 只比 src 字符串会假绿：src 在、图挂了也照样通过。判据取 naturalWidth——
  // 它 >0 意味着这张图**真的解码出来了**。
  const restoredImage = win.locator(`${row(2)} [data-storyboard-frame] img`).first()
  await expect.poll(async () => restoredImage.evaluate((el) => el.naturalWidth),
    { message: '重启后第 2 行的画面格没有真的把那张图解码出来', timeout: 20_000 })
    .toBeGreaterThan(0)
  const restored = await restoredImage.evaluate((el) => ({ src: el.getAttribute('src'), w: el.naturalWidth, h: el.naturalHeight, complete: el.complete }))
  console.log('  · 重启后画面格 img：', JSON.stringify(restored))
  expect(restored.src, '重启后第 2 行画面格的图不是本地资产').toContain('nomi-local://')
  expect(restored.w, '重启后第 2 行的画面格有 img 标签但图没解码出来（宽 0）').toBeGreaterThan(0)
  say('重启后：第 2 镜的修改和图片都还在')
  await shot('restart-changes-persist')
}

// ────────────────────────────────────────────────────────────────────────────────

let failure
try {
  console.log(POSITIVE_CONTROL
    ? '▶ 金路径走查（阳性对照模式：破坏落盘，最后一条断言必须报红）'
    : '▶ 金路径走查（新建空项目 → 三句剧本 → 拆 3 镜 → 改第 2 镜 → 批准 → 生成 → 重启）')
  const { projectId, projectRoot } = await stepNewProject()
  const win = currentWin
  await stepWriteScript(win)
  await stepSplitIntoThreeShots(win, projectId)
  await stepOpenStoryboard(win)
  await stepSelectShot2(win)
  await stepAgentPatchShot2(win, projectId)
  const generated = await stepGenerateShot2Image(win, projectId)
  await stepRestartAndVerify(projectRoot, projectId, generated)

  if (POSITIVE_CONTROL) {
    // 走到这里意味着：盘上的修改被抹掉了，而「重启后修改仍在」的断言居然还是绿的。
    // 那条断言就是死的——它没有在测它命名的那件事。
    throw new Error('阳性对照失效：盘上第 2 镜的修改已被抹回旧值，重启断言却依然通过 —— 这条断言是死的，先修尺子再谈门。')
  }
  walk.report.verified = [
    'new-empty-project', 'three-line-script', 'explicit-three-shot-plan',
    'shot2-selection', 'canonical-patch-shots-approval', 'loopback-image-generation',
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
