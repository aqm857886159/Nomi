#!/usr/bin/env node
import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 「Agent 写参数对不对、被拒后重试几次」——**真模型、真应用**的整机走查（R-agent-quality-025 §6 第 11 类的 B 轻量版）。
//
// ── 它补的是哪一格 ──
//
// 用户反馈 Agent 经常「参数不合法」然后反复重试。仓库里已有的几把量具要么量别的（分镜 / 反问），要么在真工具层不在 App 里
// （R30），要么事实上失效（eval:run 读不到回合）。没有一把能回答：写对率多少？一个回合重试几次？会不会同一个错连发？
// 这个文件沿用 `agent-storyboard-real-model.walk.mjs` 的骨架（真 Electron、隔离资料目录、从 composer 打字、
// 从磁盘读 lane transcript 与 run.json），读 `agent-param-eval.cases.json` 的题，逐题记轨迹，最后打印三个数。
//
// ── 四件真实 ──
//   ① 真实应用    真 Electron（`launchNomiApp`），渲染层 / IPC / AgentLane / pi / 落盘全走生产路径；
//   ② 真实页面输入 文稿敲进编辑器、素材从素材库文件选择器导入、指令打进 composer、模型从下拉里选；
//   ③ 真实轨迹    工具调用 / 拒收原文读磁盘上的 lane transcript，草稿计划读 `.nomi/runs/*/run.json`（宿主准入后的真相）；
//   ④ 钱          生成一律停在付费确认卡，跑器只点「取消」——整场只花大脑模型的文字费用，零生成额度。
//
// ── 每题一个新项目 ──
// 题与题互不干扰：每题开一个全新的空白项目，按 `fixture` 搭起始态（文稿 / 素材 / 先让 Agent 起草 N 镜）。
// 「先起草 N 镜」是 prelude（预演句）：改已有镜头必须有真草稿，而草稿只能由 draft_shots 造出来（look_at_canvas
// 不给种下的普通节点 operationId）。预演没搭到期望镜头数的题记「不可判」，不进分母，不当成产品结论。
//
// ── 跑法（花钱：只有大脑模型的文字费，由协调跑）──
//   pnpm run build
//   node tests/ux/agent-param-eval-real-model.walk.mjs --model "<在线大脑模型展示名>" --label base [--only P01,P02] [--limit 10]
//   node tests/ux/agent-param-eval-real-model.walk.mjs --dry-run      # 不连模型、不要凭据：只验起 App / 读题 / 搭三种起始态 / 写轨迹文件
// 产物：artifacts/agent-param-eval/<label>/（被忽略）：report.json、summary.json、trajectories/<题号>.jsonl、<题号>.outcome.json
import { stationTimeout } from './_station-budget.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import ffmpeg from '@ffmpeg-installer/ffmpeg'

import { closeNomiApp, launchNomiApp } from './_launchApp.mjs'
import { readAlignedCalls } from './askback-trajectory.mjs'
import { createCardDriver } from './agent-param-eval-cards.mjs'
import { lastAssistantText, readAnnotatedCalls, readCanvasSummary, readRunJsons } from './agent-param-eval-collect.mjs'
import { formatSummary, judgeTask, planShotsFromRuns, summarize } from './agent-param-eval-judge.mjs'
import {
  CANVAS_PANEL, COMPOSER_INPUT, COMPOSER_MODEL, COMPOSER_SEND, DOCUMENT, MODEL_POPOVER, escapeForRegExp, expandResidentPanel,
} from './agent-runtime-walk-support.mjs'
import { leaveProjectIfOpen, newProjectEntry, openRailDrawer, switchWorkspace } from './_shell.mjs'

/** 切页 / 导入后给渲染层喘口气的间隔；每一步之后都有观测（点得到 / 落盘数 / 编辑器文字），它不是完成信号。 */
const POLL_MS = 1000
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const { values } = parseArgs({ options: {
  model: { type: 'string' }, label: { type: 'string' }, 'output-dir': { type: 'string' },
  only: { type: 'string' }, limit: { type: 'string' }, 'dry-run': { type: 'boolean' },
} })

const BANK = JSON.parse(fs.readFileSync(path.join(here, 'agent-param-eval.cases.json'), 'utf8'))
const DRY_RUN = values['dry-run'] === true
const MODEL_LABEL = values.model
if (!DRY_RUN && !MODEL_LABEL) {
  throw new Error('必须用 --model "<在线大脑模型展示名>" 指定被测大脑模型（走查里的默认模型会下架，不留默认）。只想验仪器用 --dry-run。')
}
const LABEL = values.label || (DRY_RUN ? 'dry-run' : 'run')
const outputDir = path.resolve(repoRoot, values['output-dir'] || `artifacts/agent-param-eval/${LABEL}`)
fs.mkdirSync(path.join(outputDir, 'trajectories'), { recursive: true })

const ONLY = values.only ? values.only.split(',').map((id) => id.trim()).filter(Boolean) : null
if (ONLY) {
  const unknown = ONLY.filter((id) => !BANK.tasks.some((task) => task.id === id))
  if (unknown.length) throw new Error(`--only 里这些 id 不在题库里：${unknown.join(', ')}`)
}
let TASKS = ONLY ? ONLY.map((id) => BANK.tasks.find((task) => task.id === id)) : BANK.tasks
if (values.limit) TASKS = TASKS.slice(0, Number(values.limit))

const { prepareIsolation, dismissSplashIfPresent } = await import(pathToFileURL(path.join(repoRoot, 'evals/lib/isoApp.mjs')).href)
// 干跑不要凭据（requireCatalog:false = App 自带目录的干净 profile）；真跑拷本机真实 catalog 与钥匙（密文，不经手明文）。
const isoDir = path.join(os.tmpdir(), `agent-param-eval-${Date.now()}`)
const iso = prepareIsolation(isoDir, { requireCatalog: !DRY_RUN })
const mediaTmp = makeTempDir('agent-param-eval-media-')

/** 素材库起始态要的三个文件：ffmpeg 现生成，不依赖私有素材。文件名就是素材在库里的名字（题里用的叫法）。 */
function makeAssetFiles() {
  const dir = path.join(mediaTmp, 'assets')
  fs.mkdirSync(dir, { recursive: true })
  const png = (name, color) => {
    const file = path.join(dir, name)
    execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360`, '-frames:v', '1', file], { stdio: 'pipe' })
    return file
  }
  const video = path.join(dir, '跑步素材.mp4')
  execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=640x360:rate=24', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', video], { stdio: 'pipe' })
  return [png('小林.png', 'orange'), png('便利店.png', 'teal'), video]
}

const report = {
  label: LABEL, dryRun: DRY_RUN, model: MODEL_LABEL ?? null, tasks: TASKS.length,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), cases: [],
}
const results = []
const unscorable = []

let app, win, failure
try {
  ;({ app, win } = await launchNomiApp({ name: 'agent-param-eval', userDataDir: iso.chromiumDir,
    projectsDir: iso.projectsDir, settingsDir: iso.settingsDir, capabilityDir: iso.capabilityDir, hostConfigDir: iso.hostConfigDir }))
  await dismissSplashIfPresent(win)
  const assetFiles = TASKS.some((task) => task.fixture === 'assets') ? makeAssetFiles() : []

  /** 回到项目库，开一个全新的空白项目，返回它的目录（用「新出现的目录」认，不靠位置）。 */
  async function openFreshProject() {
    await leaveProjectIfOpen(win, 'back to library before a fresh project')
    const known = new Set(fs.existsSync(iso.projectsDir) ? fs.readdirSync(iso.projectsDir) : [])
    await newProjectEntry(win).click({ timeout: stationTimeout({ operations: 2 }) })
    const deadline = Date.now() + stationTimeout({ operations: 2 })
    while (Date.now() < deadline) {
      const fresh = fs.readdirSync(iso.projectsDir).filter((name) => !known.has(name)
        && fs.existsSync(path.join(iso.projectsDir, name, '.nomi', 'project.json')))
      if (fresh.length === 1) return path.join(iso.projectsDir, fresh[0])
      await win.waitForTimeout(300)
    }
    throw new Error('新建项目超时：项目目录未落盘')
  }

  async function answerTelemetryConsentIfShown() {
    // 首启的遥测征询卡会盖住面板。按最保护隐私的那一档答（「不分享」）。
    const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
    if (await consent.count()) { await consent.click({ timeout: stationTimeout({ operations: 2 }) }); await win.waitForTimeout(600) }
  }

  async function importAssets(projectDir) {
    await switchWorkspace(win, 'generation', '切到生成区')
    await win.waitForTimeout(POLL_MS)
    await openRailDrawer(win, 'assets', '打开素材库')
    const uploadInput = win.locator('section[aria-label="素材库"] input[type="file"]').first()
    await uploadInput.waitFor({ state: 'attached', timeout: stationTimeout({ operations: 2 }) })
    await uploadInput.setInputFiles(assetFiles)
    const deadline = Date.now() + stationTimeout({ operations: 8 })
    let count = 0
    while (Date.now() < deadline) {
      const dir = path.join(projectDir, 'assets')
      count = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((name) => /\.(png|mp4)$/i.test(String(name))).length : 0
      if (count >= assetFiles.length) break
      await win.waitForTimeout(POLL_MS)
    }
    const closeLibrary = win.locator('section[aria-label="素材库"] button[aria-label*="关闭"]').first()
    if (await closeLibrary.count()) await closeLibrary.click({ timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
    return count
  }

  async function writeScript() {
    await win.getByRole('button', { name: '创作', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
    await win.waitForTimeout(POLL_MS)
    const doc = win.locator(DOCUMENT)
    await doc.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
    await doc.fill(BANK.script)
    await win.waitForTimeout(800)
    return (await doc.innerText()).includes('阿桥')
  }

  async function pickModel() {
    await expandResidentPanel(win)
    await win.locator(`${CANVAS_PANEL} ${COMPOSER_MODEL}`).click({ timeout: stationTimeout({ operations: 2 }) })
    await win.locator(`${CANVAS_PANEL} ${MODEL_POPOVER} [data-v4-model-row]`).first().locator('button').first().click({ timeout: stationTimeout({ operations: 2 }) })
    const option = win.locator('[data-nomi-select-dropdown] [data-nomi-select-option-label]')
      .filter({ hasText: new RegExp(escapeForRegExp(MODEL_LABEL)) }).first()
    await option.click({ timeout: stationTimeout({ operations: 2 }) })
    await win.waitForTimeout(800)
  }

  const cards = createCardDriver({ win, panel: CANVAS_PANEL, outputDir })

  /** 在生成面板发一句话并答卡直到回合走完。 */
  async function say(text, label) {
    const blocked = await cards.ensureComposerUsable()
    if (blocked === -1) throw new Error('这一句发出前 composer 就不可用（连按 Esc 也没解除）——仪器故障，不是产品结论')
    const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
    await input.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
    await input.fill(text)
    await win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`).click({ timeout: stationTimeout({ operations: 2 }) })
    const turn = await cards.driveTurn(label)
    await win.waitForTimeout(POLL_MS)
    return turn
  }

  const shotsOf = (projectDir) => planShotsFromRuns(readRunJsons(projectDir).runs)

  for (const task of TASKS) {
    const row = { id: task.id, lang: task.lang, family: task.family, fixture: task.fixture, say: task.say }
    const started = Date.now()
    let projectDir
    try {
      projectDir = await openFreshProject()
      await answerTelemetryConsentIfShown()
      // ── 起始态 ──
      if (task.fixture === 'assets') {
        row.importedAssets = await importAssets(projectDir)
        if (row.importedAssets < assetFiles.length) throw Object.assign(new Error(`素材只导进 ${row.importedAssets}/${assetFiles.length}`), { setup: true })
      }
      if (task.fixture === 'script') {
        row.scriptTyped = await writeScript()
        if (!row.scriptTyped) throw Object.assign(new Error('文稿没敲进编辑器'), { setup: true })
      }
      await switchWorkspace(win, 'generation', '切到生成区')
      await win.waitForTimeout(POLL_MS)
      if (DRY_RUN) {
        // 干跑：到这里起始态已搭好（空 / 文稿 / 素材）。不选模型、不发话。确认面板和输入框在。
        await expandResidentPanel(win)
        row.composerUsable = (await cards.ensureComposerUsable()) !== -1
        row.dryRunOk = row.composerUsable
        report.cases.push(row)
        const empty = judgeTask({ task, calls: [], shotsBefore: [], shotsAfter: shotsOf(projectDir), finalText: '' })
        results.push(empty)
        writeOutcome(task, projectDir, { turns: [], judged: empty })
        console.log(`${task.id} [dry-run] fixture=${task.fixture} composer=${row.composerUsable}`)
        continue
      }
      await pickModel()
      // ── 预演：先让 Agent 起草 N 镜，量「改已有镜头」要的起始态 ──
      let shotsBefore = []
      let preludeCalls = 0
      if (task.fixture.startsWith('drafts')) {
        const prelude = BANK.preludes[task.fixture]
        row.prelude = await say(prelude[task.lang], `${task.id}-prelude`)
        shotsBefore = shotsOf(projectDir).filter((shot) => shot.included)
        preludeCalls = readAlignedCalls(projectDir).length
        row.preludeShots = shotsBefore.length
        if (shotsBefore.length !== prelude.expectShots) {
          throw Object.assign(new Error(`预演只搭出 ${shotsBefore.length}/${prelude.expectShots} 镜`), { setup: true })
        }
      }
      // ── 被测的那句话 ──
      const turn = await say(task.say, task.id)
      row.cardsAnswered = turn.cardsAnswered
      row.timedOut = turn.timedOut
      const finalText = lastAssistantText(projectDir)
      const calls = readAlignedCalls(projectDir).slice(preludeCalls)
      const shotsAfter = shotsOf(projectDir)
      const judged = judgeTask({ task, calls, finalText, shotsBefore, shotsAfter, cardsAnswered: turn.cardsAnswered })
      results.push(judged)
      row.judged = judged
      row.ms = Date.now() - started
      writeOutcome(task, projectDir, { turns: [turn], finalText, shotsBefore, shotsAfter, judged, preludeCalls })
      console.log(`${task.id} ${judged.passed ? 'PASS' : 'FAIL'} calls=[${judged.calls.join(',')}] retries=${judged.retries}${judged.failed.length ? ` failed=${judged.failed.join(' | ')}` : ''}`)
    } catch (error) {
      row.error = error.message
      if (error.setup) { row.unscorable = true; unscorable.push(task.id) } else { row.instrumentError = true; unscorable.push(task.id) }
      console.log(`${task.id} UNSCORABLE ${error.message}`)
      if (projectDir) writeOutcome(task, projectDir, { error: error.message })
    }
    report.cases.push(row)
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  }

  function writeOutcome(task, projectDir, extra) {
    // 轨迹（每次调用的入参 / 返回原文 / 第几次重试）+ 草稿计划 + 画布概况，一题一份，留给人复核与后续优化。
    const calls = readAnnotatedCalls(projectDir)
    fs.writeFileSync(path.join(outputDir, 'trajectories', `${task.id}.jsonl`),
      calls.map((call, index) => JSON.stringify({ caseId: task.id, userSays: index === 0 ? task.say : undefined, ...call })).join('\n') + (calls.length ? '\n' : ''))
    const { runs, unreadable } = readRunJsons(projectDir)
    fs.writeFileSync(path.join(outputDir, `${task.id}.outcome.json`), JSON.stringify({
      id: task.id, say: task.say, ...extra,
      runs: runs.map((item) => item.run ?? item), unreadableRuns: unreadable, canvas: readCanvasSummary(projectDir),
    }, null, 2))
  }

  report.summary = summarize(results.filter((item) => !unscorable.includes(item.id)), unscorable, BANK.tasks)
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report.summary, null, 2))
  console.log(`\n${DRY_RUN ? '（干跑：没连模型，下面的数是空轨迹的底数，不是产品结论）\n' : ''}${formatSummary(report.summary)}`)
  await win.screenshot({ path: path.join(outputDir, 'last-screen.png') }).catch(() => {})
} catch (error) {
  failure = error
  process.exitCode = 1
  report.error = error instanceof Error ? error.stack : String(error)
  if (win) await win.screenshot({ path: path.join(outputDir, 'failure.png') }).catch(() => {})
} finally {
  report.endedAt = new Date().toISOString()
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`report → ${pathToFileURL(path.join(outputDir, 'report.json')).href}`)
  if (app) await closeNomiApp(app).catch(() => {})
  fs.rmSync(mediaTmp, { recursive: true, force: true })
  fs.rmSync(isoDir, { recursive: true, force: true })
  if (failure) console.error(failure)
}
