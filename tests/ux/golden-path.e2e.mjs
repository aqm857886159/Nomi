#!/usr/bin/env node
// Document draft → saved Run → original editor/placement → original runner.
// （2026-10-08 起画布不再自动建分镜表，原 --production-table 兼容旅程随之删除。）
// 金路径 · 每日走查（第二刀）。
//
// 这是**一条固定的、不许缩水的真实用户路径**，每天跑一次当门；红了当天修。
// M0–M5 矩阵留着当地图，不当门——地图告诉你还有哪些地没铺，门只问一件事：
// 「昨天还能走通的那条路，今天还走得通吗」。
//
// 剧本（一个字不许缩）：
//   ① 新建空项目
//   ② 在创作区文本编辑器写三句剧本
//   ③ 划词拆镜保存Run→原编辑器→显式放置。
//   ④ 选中第 2 镜
//   ⑤ 改第 2 镜的一句提示词——经 Agent 的 `draft_shots(draftId, shots[{shotId}])`
//   ⑥ 第 2 镜生成一张图片（loopback fixture 供应商，零额度）
//   ⑦ 结果回到该行
//   ⑧ 关闭 Nomi 重启
//   ⑨ 图和修改仍在
//
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

import { expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import {
  CREATION_PANEL, DOCUMENT, createRuntimeWalk,
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

// ── 参数解析。createRuntimeWalk 自己会校验 process.argv（只认 `--packaged <abs>`），
//    所以本脚本的旗标必须在它读之前摘掉，否则它会以「用法错误」报红。 ────────────────
const POSITIVE_CONTROL = process.argv.includes('--positive-control')
process.argv = process.argv.filter((arg) => !['--positive-control'].includes(arg))

const walk = await createRuntimeWalk('golden-path')
// 截图与 report.json 落在剧本自己的目录里（.tmp/golden-path-<ts>/），
// 而不是通用 runtime-walk 的 pi-* 目录——这条路径写进 docs/qa，红了照着找证据。
const outputDir = path.join(process.cwd(), '.tmp', `golden-path-${Date.now()}`)
fs.mkdirSync(outputDir, { recursive: true })
walk.report.outputDir = outputDir
walk.report.positiveControl = POSITIVE_CONTROL
walk.report.journey = 'original-storyboard-editor'

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

// ────────────────────────────────────────────────────────────────────────────────

let failure
try {
  console.log(POSITIVE_CONTROL
    ? '▶ 金路径走查（阳性对照模式：破坏落盘，最后一条断言必须报红）'
    : '▶ 金路径走查（新建空项目 → 三句剧本 → 拆 3 镜落画布 → 选第 2 镜 → Agent 改它 → 生成 → 重启）')
  const { projectId, projectRoot } = await stepNewProject()
  const win = currentWin
  await stepWriteScript(win)
  await runOriginalStoryboardGolden({ walk, win, projectId, projectRoot, shot,
    setCurrentWin: value => { currentWin = value }, prompts: SHOT_PROMPTS, titles: SHOT_TITLES,
    newPrompt: SHOT_2_NEW_PROMPT, instruction: PATCH_INSTRUCTION, planCall: PLAN_CALL_ID,
    patchCall: PATCH_CALL_ID, shotId: SHOT_2_ID, targetAssertion: TARGET_ASSERTION, positiveControl: POSITIVE_CONTROL })

  if (POSITIVE_CONTROL) {
    // 走到这里意味着：盘上的修改被抹掉了，而「重启后修改仍在」的断言居然还是绿的。
    // 那条断言就是死的——它没有在测它命名的那件事。
    throw new Error('阳性对照失效：盘上第 2 镜的修改已被抹回旧值，重启断言却依然通过 —— 这条断言是死的，先修尺子再谈门。')
  }
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
