#!/usr/bin/env node
// 「用户给了提示词原文，Agent 逐字落；用户让它写，它才扩写」——真模型、真应用的整机走查（R13 第三档）。
// 设计卡：docs/plan/2026-11-07-agent-verbatim-prompt.md（★1 指标 · ★9 检查 9）。
//
// ── 量两个数 ──
//   逐字率             给了原文的用例（V1–V7）里，最后一轮落进起草 / 改草稿参数的提示词与原文逐字相同的比例
//   该扩写时扩写率      让 Agent 写 / 润色 / 扩写的用例（W1–W7）里，落下的提示词明显比用户那句想法更具体的比例
// 另报：给了原文却被扩写的比例、没落下任何提示词的轮次（单列，不进分子）。
//
// ── 四件真实 ──
//   ① 真实应用：真 Electron（launchNomiApp）+ 隔离资料目录；② 真实页面输入：话打进 composer、模型从下拉里选；
//   ③ 真实工具轨迹：从磁盘上的 lane transcript 读工具参数，不信 Agent 的自述；④ 本走查不需要素材。
//
// ── 跑法（真模型，约 20 轮对话，文本档几分钱；不会生成媒体：报价卡一律拒绝）──
//   协调在**修前提交**与**修后提交**上各跑一遍，同一模型、同一用例表：
//   pnpm run build
//   node tests/ux/agent-verbatim-prompt-real-model.walk.mjs --label before --model "DeepSeek V4 Flash" [--only V1,W1]
//   --model 必填，且必须是内置目录里的、该资料里真有的模型（没有就退出）；修前修后各用自己的 --label，报告按 label 分文件。
//   模型服务商报错 / 回合没起来的轮记「不可判」，不进比率分母；连续 2 轮不可判就停、退出码非 0、打印最后一屏截图。
//   判据与离线对照：tests/ux/verbatim-prompt-judges.mjs / .test.mjs；用例表：agent-verbatim-prompt.cases.json
//
// ── 已知局限 ──
//   中文界面下跑（按钮按中文名找）；英文句子在中文界面里说。英文界面整轮另跑。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { stationTimeout } from './_station-budget.mjs'
import { closeNomiApp, launchNomiApp } from './_launchApp.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { collectPrompts, judgeExpansion, judgeVerbatim, summarize } from './verbatim-prompt-judges.mjs'
import {
  CANVAS_PANEL, COMPOSER, TURN_OUTCOME, classifyTurnOutcome, isJudgeableOutcome, COMPOSER_INPUT, COMPOSER_SEND, HISTORY_BUTTON,
  MODEL_POPOVER, COMPOSER_MODEL, THREAD_MENU, escapeForRegExp, expandResidentPanel,
} from './agent-runtime-walk-support.mjs'
import { switchWorkspace } from './_shell.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const { values } = parseArgs({ options: {
  model: { type: 'string' }, 'output-dir': { type: 'string' }, label: { type: 'string' }, only: { type: 'string' },
} })

const CASES = JSON.parse(fs.readFileSync(path.join(here, 'agent-verbatim-prompt.cases.json'), 'utf8')).cases
const ONLY = values.only ? values.only.split(',').map((id) => id.trim()).filter(Boolean) : null
if (ONLY) {
  const unknown = ONLY.filter((id) => !CASES.some((item) => item.id === id))
  if (unknown.length) throw new Error(`--only 里这些 id 不在用例表里：${unknown.join(', ')}`)
}
const SELECTED = ONLY ? CASES.filter((item) => ONLY.includes(item.id)) : CASES
const MODEL_LABEL = values.model
if (!MODEL_LABEL) {
  console.error('必须显式传 --model "<模型显示名>"（内置目录里的、这份资料里真有的模型，例如 "DeepSeek V4 Flash"）；不再默认一个用户未必有的模型。')
  process.exit(2)
}
const MAX_CONSECUTIVE_UNJUDGEABLE = 2
let consecutiveUnjudgeable = 0
const LABEL = values.label || 'run'
const outputDir = path.resolve(repoRoot, values['output-dir'] || `tests/ux/shots/verbatim-prompt-real-model/${LABEL}`)
const reportFile = path.join(outputDir, `report-${LABEL}.json`)
fs.mkdirSync(outputDir, { recursive: true })

const { prepareIsolation, dismissSplashIfPresent, createBlankProject } = await import(pathToFileURL(path.join(repoRoot, 'evals/lib/isoApp.mjs')).href)
const isoDir = path.join(os.tmpdir(), `verbatim-prompt-real-model-${Date.now()}`)
const iso = prepareIsolation(isoDir)

const report = {
  label: LABEL, model: MODEL_LABEL, rounds: SELECTED.length,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  baseline: '用户 2026-11-07 一例：「提示词写：一只橘猫坐在窗台上」→「改成：一只黑猫坐在窗台上」落下的是加了氛围和风格词的句子；其余未量',
  startedAt: new Date().toISOString(), cases: [],
}

/** 读 lane transcript：只取还没见过的工具调用（按调用 id 去重），不信面板文字。 */
function readNewCalls(projectDir, seenCallIds) {
  const calls = []
  for (const session of readLaneTranscripts(projectDir)) {
    for (const message of laneMessages(session)) {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
      for (const part of message.content) {
        if (part?.type !== 'toolCall' || seenCallIds.has(part.id)) continue
        seenCallIds.add(part.id)
        calls.push({ id: part.id, name: part.name, args: part.arguments })
      }
    }
  }
  return calls
}

let app, win, failure
try {
  ;({ app, win } = await launchNomiApp({ name: 'verbatim-prompt-real-model', userDataDir: iso.chromiumDir,
    projectsDir: iso.projectsDir, settingsDir: iso.settingsDir, capabilityDir: iso.capabilityDir }))
  await dismissSplashIfPresent(win)
  const projectDir = await createBlankProject(win, iso.projectsDir)
  report.projectDir = projectDir
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.count()) { await consent.click({ timeout: stationTimeout({ operations: 2 }) }); await win.waitForTimeout(600) }

  await switchWorkspace(win, 'generation', '切到生成区')
  await win.waitForTimeout(1000)
  await expandResidentPanel(win)
  await win.locator(`${CANVAS_PANEL} ${COMPOSER_MODEL}`).click({ timeout: stationTimeout({ operations: 2 }) })
  await win.locator(`${CANVAS_PANEL} ${MODEL_POPOVER} [data-v4-model-row]`).first().locator('button').first()
    .click({ timeout: stationTimeout({ operations: 2 }) })
  await win.locator('[data-nomi-select-dropdown] [data-nomi-select-option-label]')
    .filter({ hasText: new RegExp(escapeForRegExp(MODEL_LABEL)) }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  await win.waitForTimeout(800)

  const running = win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)
  const spendCard = win.locator(`${CANVAS_PANEL} [data-v4-block="intervention"][data-kind="spend"]`)
  const irreversibleCard = win.locator(`${CANVAS_PANEL} [data-v4-block="intervention"][data-kind="approval-irreversible"]`)
  const questionCard = win.locator(`${CANVAS_PANEL} [data-v4-block="intervention"][data-kind="question"]`)

  /** 回合停在等人的卡上时像真人一样答：报价卡 / 不可逆卡拒绝（整场不花生成额度），提问卡点第一颗选项。绝不点确认。 */
  async function driveTurnToIdle(answered) {
    const deadline = Date.now() + stationTimeout({ turns: 3 })
    while (Date.now() < deadline) {
      const overlay = win.locator('[data-settings-overlay]').first()
      if (await overlay.isVisible().catch(() => false)) {
        await win.locator('[data-settings-close]').first().click({ timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
        answered.push('settings:closed')
        continue
      }
      const dialog = win.locator('[data-spend-confirm-dialog]').first()
      if (await dialog.isVisible().catch(() => false)) {
        await win.locator('div:has(> [data-spend-confirm-dialog])').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
        answered.push('spend-dialog:declined')
        await win.waitForTimeout(1000)
        continue
      }
      for (const [card, tag] of [[spendCard, 'spend:declined'], [irreversibleCard, 'approval-irreversible:declined']]) {
        if (!await card.first().isVisible().catch(() => false)) continue
        const reject = card.locator('[data-v4-control="confirm-reject"]')
        if (!await reject.isVisible().catch(() => false)) await card.locator('[data-v4-control="slot-dismiss"]').click({ timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
        if (await reject.isVisible().catch(() => false)) await reject.click({ timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
        answered.push(tag)
        await win.waitForTimeout(1000)
      }
      if (await questionCard.count() > 0) {
        const chip = questionCard.locator('[data-ask-question][data-active="true"] [data-v4-control="question-option"]').first()
        const proceed = questionCard.locator('[data-v4-control="ask-continue"]').first()
        if (await proceed.isEnabled().catch(() => false)) await proceed.click().catch(() => {})
        else if (await chip.count() > 0) await chip.click().catch(() => {})
        else {
          const own = questionCard.locator('[data-ask-question][data-active="true"] [data-v4-control="question-answer"]').first()
          await own.fill('按你的理解来').catch(() => {})
          await own.press('Enter').catch(() => {})
        }
        answered.push('question:answered')
        await win.waitForTimeout(1000)
        continue
      }
      if (!await running.isVisible().catch(() => false)) break
      await win.waitForTimeout(1000)
    }
    await running.waitFor({ state: 'hidden', timeout: stationTimeout({ turns: 1 }) }).catch(() => {})
    await win.waitForTimeout(1200)
  }

  const seenCallIds = new Set()
  for (const item of SELECTED) {
    const row = { id: item.id, lang: item.lang, kind: item.kind, turns: item.turns, expected: item.expected ?? null, seed: item.seed ?? null, turnCalls: [], cardsAnswered: [] }
    const started = Date.now()
    try {
      // 每个用例一个新对话；同一用例的多轮在同一对话里接着说（「改成：…」要接在上一轮建的节点之后）。
      await win.locator(`${CANVAS_PANEL} ${HISTORY_BUTTON}`).click({ timeout: stationTimeout({ operations: 2 }) })
      await win.locator(THREAD_MENU).getByRole('button', { name: '新对话', exact: true }).click({ timeout: stationTimeout({ operations: 2 }) })
      await win.waitForTimeout(500)
      for (const text of item.turns) {
        const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
        await input.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
        await input.fill(text)
        await win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`).click({ timeout: stationTimeout({ operations: 2 }) })
        const sawRunning = await running.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) }).then(() => true, () => false)
        await driveTurnToIdle(row.cardsAnswered)
        const turnCalls = readNewCalls(projectDir, seenCallIds).map((call) => ({ name: call.name, args: call.args }))
        row.turnCalls.push(turnCalls)
        row.turnOutcome = await classifyTurnOutcome(win, { panel: CANVAS_PANEL, toolCallCount: turnCalls.length, sawRunning })
      }
    } catch (roundError) {
      row.roundError = roundError.message
    }
    row.ms = Date.now() - started
    // 只看**最后一轮**的调用：V1 的第一轮「提示词写：橘猫」是对的，被改掉的才是要量的那一条。
    const finalCalls = row.turnCalls.at(-1) ?? []
    row.toolsInFinalTurn = finalCalls.map((call) => call.name)
    const prompts = finalCalls.flatMap((call) => collectPrompts(call.args))
    row.finalPrompts = prompts
    row.outcome = row.turnOutcome?.outcome ?? TURN_OUTCOME.NOT_STARTED
    if (!isJudgeableOutcome(row.outcome)) {
      // 服务商报错 / 回合没起来：Agent 没干活，这一轮不能进逐字率 / 扩写率的分母。
      row.unjudgeable = true
      report.unjudgeable = (report.unjudgeable ?? 0) + 1
      consecutiveUnjudgeable += 1
      row.verdict = null
      report.cases.push(row)
      console.log(`${item.id} UNJUDGEABLE outcome=${row.outcome} error=${JSON.stringify(row.turnOutcome?.errorText ?? null)} ${row.ms}ms`)
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
      if (consecutiveUnjudgeable >= MAX_CONSECUTIVE_UNJUDGEABLE) {
        const shot = path.join(outputDir, `stopped-${LABEL}.png`)
        await win.screenshot({ path: shot }).catch(() => {})
        report.stoppedEarly = `连续 ${consecutiveUnjudgeable} 轮不可判（${row.outcome}），已停`
        process.exitCode = 1
        console.error(`${report.stoppedEarly}。最后一屏截图：${shot}`)
        break
      }
      continue
    }
    consecutiveUnjudgeable = 0
    row.verdict = item.kind === 'verbatim' ? judgeVerbatim(item.expected, prompts) : judgeExpansion(item.seed, prompts)
    report.cases.push(row)
    console.log(`${item.id} ${item.kind} wrote=${row.verdict.wrotePrompt} ${item.kind === 'verbatim' ? `exact=${row.verdict.exact} expanded=${row.verdict.expanded}` : `expanded=${row.verdict.expanded}`} tools=[${row.toolsInFinalTurn.join(',')}] ${row.ms}ms`)
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  }
  report.summary = { rounds: report.cases.length, unjudgeable: report.cases.filter((row) => row.unjudgeable).length, roundErrors: report.cases.filter((row) => row.roundError).length, ...summarize(report.cases.filter((row) => !row.unjudgeable)) }
  console.log('SUMMARY', JSON.stringify(report.summary))
} catch (error) {
  failure = error
  process.exitCode = 1
  report.error = error instanceof Error ? error.stack : String(error)
  if (win) await win.screenshot({ path: path.join(outputDir, 'failure.png') }).catch(() => {})
} finally {
  report.endedAt = new Date().toISOString()
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
  console.log(`report → ${pathToFileURL(reportFile).href}`)
  if (app) await closeNomiApp(app).catch(() => {})
  fs.rmSync(isoDir, { recursive: true, force: true })
  if (failure) console.error(failure)
}
