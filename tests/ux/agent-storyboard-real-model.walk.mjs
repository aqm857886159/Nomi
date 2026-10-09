#!/usr/bin/env node
import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 「用户照着文稿让 Agent 出分镜」——**真模型、真应用、真素材**的整机走查（R13 第二/三档）。
//
// ── 它补的是哪一格 ──
//
// 2026-09-18 交接文档里有一张表：「调工具 18/23、落画布 14/23」。那次是真机跑出来的，但**剧本没进
// 仓库**（`docs/plan/2026-09-18-tool-layer-findings-inventory.md` §4 只留了数字，
// `docs/plan/agent-tool-face-v2-evidence/README.md` 明记「这一腿量不到『落到画布』」）。
// 于是「落到画布」那一列在每一次工具层改动之后都得靠人重跑一遍手工操作，没有人这么干过第二次。
// 这个文件把那次走查落成可重跑的脚本。
//
// ── 四件真实（R13，缺一条这条测试不成立）──
//
//   ① 真实应用    真 Electron（`launchNomiApp`），渲染层 / IPC / AgentLane / pi SDK / 落盘全走生产路径；
//   ② 真实页面输入 文稿是**敲进编辑器**的，指令是**打进 composer** 的，模型是**从下拉里选**的，
//                 素材是**从素材库的文件选择器导入**的——没有一处灌状态、没有桥、没有夹具输入；
//   ③ 真实工具轨迹 工具调用从磁盘上的 lane transcript 读（`.nomi/agent-sessions/*.jsonl`），
//                 不信 Agent 的自述；「落到画布」从 `project.json` 读，不信面板上的文字；
//   ④ 真实素材    从 `NOMI_REAL_MEDIA_DIR` 取登记过的 4K HEVC 片子并抽一帧 4K PNG
//                 （`tests/ux/real-media-fixtures.json` 的 `video-4k-hevc-10bit`）。
//                 缺素材**硬红**，不 skip、不退回合成图。
//
// ── 它量四个数（这四个就是 PR 正文要写的） ──
//
//   调到 draft_shots  这一轮有没有真的去调那个唯一能造生成节点的动词
//   落到画布          `project.json` 里的节点数有没有真的变多（**这一列是别的腿量不到的**）
//   工具名写对率      首调工具 ∈ 这句话合理的首调集合
//   参数一次就对      这一轮没有任何一次工具调用因为参数被拒
//
// ── 跑法（要花钱：真模型，一轮 20+ 次对话，DeepSeek 便宜档约 ¥0.x）──
//
//   pnpm run build
//   export NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/"
//   source ~/.nomi-secrets.env            # 只为证明 key 在；模型 key 走本机 catalog，不从这里取
//   node tests/ux/agent-storyboard-real-model.walk.mjs [--rounds 23] [--model "DeepSeek V3.2"]
import { stationTimeout } from './_station-budget.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import ffmpeg from '@ffmpeg-installer/ffmpeg'

import { closeNomiApp, launchNomiApp } from './_launchApp.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import {
  CANVAS_PANEL, COMPOSER, COMPOSER_INPUT, COMPOSER_SEND, DOCUMENT, HISTORY_BUTTON, MODEL_POPOVER,
  COMPOSER_MODEL, THREAD_MENU, escapeForRegExp, expandResidentPanel,
} from './agent-runtime-walk-support.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const { values } = parseArgs({ options: {
  rounds: { type: 'string' }, model: { type: 'string' }, 'output-dir': { type: 'string' }, label: { type: 'string' },
} })

const CASES = JSON.parse(fs.readFileSync(path.join(here, 'agent-storyboard-real-model.cases.json'), 'utf8'))
const ROUNDS = Number(values.rounds || CASES.cases.length)
const MODEL_LABEL = values.model || 'DeepSeek V3.2'
const LABEL = values.label || 'run'
const outputDir = path.resolve(repoRoot, values['output-dir'] || `tests/ux/shots/storyboard-real-model/${LABEL}`)
fs.mkdirSync(outputDir, { recursive: true })

// ── ④ 真实素材：登记表里那条 4K HEVC，加上它**派生**的那张 4K PNG。
//
// 派生那条（`image-4k-png`）在登记表里只有 `derivedFrom`、没有 `relativePath`——素材本身不进仓库、
// 也不写进用户的素材目录，所以 `requireRealMediaAssets` 对它只返回「这是派生素材」，抽帧由调用方做
// （登记表 `derivedFrom.how` 写的就是这条命令）。这里照那句话抽到 tmp，**规格从登记表读**，不硬写数字。
const { assets } = requireRealMediaAssets(['video-4k-hevc-10bit', 'image-4k-png'])
const sourceVideo = assets.get('video-4k-hevc-10bit').file
const derivedSpec = assets.get('image-4k-png').spec
const mediaTmp = makeTempDir('storyboard-real-media-')
const referenceImage = path.join(mediaTmp, 'reference-4k.png')
execFileSync(ffmpeg.path, ['-y', '-ss', '00:00:05', '-i', sourceVideo, '-frames:v', '1', referenceImage], { stdio: 'pipe' })
const referenceBytes = fs.statSync(referenceImage).size
if (referenceBytes < derivedSpec.minBytes) {
  throw new Error(`抽出来的参考帧只有 ${referenceBytes} 字节，登记表 image-4k-png 要求 ≥${derivedSpec.minBytes}`
    + '——多半抽到了黑帧或抽帧失败，别拿它当「真实素材」往下跑')
}

// ── ① 真实应用：隔离 profile + 本机真实 catalog（真模型、真 key；项目与浏览器状态全隔离）。
const { prepareIsolation } = await import(path.join(repoRoot, 'evals/lib/isoApp.mjs'))
const isoDir = path.join(os.tmpdir(), `storyboard-real-model-${Date.now()}`)
const iso = prepareIsolation(isoDir)

const report = {
  label: LABEL, model: MODEL_LABEL, rounds: ROUNDS,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  realMedia: { video: sourceVideo, referenceImage, referenceBytes },
  startedAt: new Date().toISOString(), cases: [],
}

/**
 * 「这一次调用的**参数**被拒了」的机器判据。
 *
 * 只认参数那一族：pi 的 ajv（`Validation failed for tool`）、宿主的准入码、以及宿主 zod 的字段级拒绝。
 * **不认**「模型选了错的东西」或「世界里没有这个对象」那两类——它们是失败，但不是参数写错，
 * 混在一起这个数就没法用来判「工具面好不好用」。
 */
const ARG_REJECTED = /Validation failed for tool|capability_input_invalid|generation_input_invalid|Unrecognized key\(s\)|must be (array|string|number|object)|Required/i

function readCanvasNodeCount(projectDir) {
  const file = path.join(projectDir, '.nomi', 'project.json')
  if (!fs.existsSync(file)) return 0
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'))?.payload
  return Array.isArray(payload?.generationCanvas?.nodes) ? payload.generationCanvas.nodes.length : 0
}

/**
 * 这一轮的工具轨迹：从**磁盘上的 lane transcript** 读（`.nomi/agent-sessions/*.jsonl`），
 * 不信面板上的文字、不信 Agent 的自述。
 *
 * 形状（2026-09-18 真机实测，不是从文档抄的）：工具调用是 assistant 消息 `content` 里
 * `{type:'toolCall', id, name, arguments}` 的一片；结果是独立的 `role:'toolResult'` 消息，
 * 带 `toolName` / `isError` / `content[].text`。
 */
function readRoundTrajectory(projectDir, seenToolCallIds, seenResultIds) {
  const calls = []
  const results = []
  for (const session of readLaneTranscripts(projectDir)) {
    for (const message of laneMessages(session)) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type !== 'toolCall' || seenToolCallIds.has(part.id)) continue
          seenToolCallIds.add(part.id)
          calls.push({ id: part.id, name: part.name, args: part.arguments })
        }
      } else if (message.role === 'toolResult') {
        if (seenResultIds.has(message.toolCallId)) continue
        seenResultIds.add(message.toolCallId)
        const text = (Array.isArray(message.content) ? message.content : [])
          .filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
        results.push({ id: message.toolCallId, name: message.toolName, isError: message.isError === true, text })
      }
    }
  }
  return { calls, results }
}

let app, win, failure
try {
  ;({ app, win } = await launchNomiApp({ name: 'storyboard-real-model', userDataDir: iso.chromiumDir,
    projectsDir: iso.projectsDir, settingsDir: iso.settingsDir, capabilityDir: iso.capabilityDir }))
  const { dismissSplashIfPresent, createBlankProject } = await import(path.join(repoRoot, 'evals/lib/isoApp.mjs'))
  await dismissSplashIfPresent(win)
  const projectDir = await createBlankProject(win, iso.projectsDir)
  report.projectDir = projectDir

  // 首启的遥测征询卡会盖住面板。按最保护隐私的那一档答（「不分享」），这也是真人该看到的默认路径。
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.count()) { await consent.click({ timeout: stationTimeout({ operations: 2 }) }); await win.waitForTimeout(600) }

  // ② 真实页面输入 · 导入真实素材：素材库的文件选择器，等价真人在 OS 对话框里选文件。
  // 素材库入口只在**生成**工作区（创作区那一屏没有它），所以先切过去。
  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  await win.waitForTimeout(2000)
  await win.getByRole('button', { name: '素材库', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  const uploadInput = win.locator('section[aria-label="素材库"] input[type="file"]').first()
  await uploadInput.waitFor({ state: 'attached', timeout: stationTimeout({ operations: 2 }) })
  await uploadInput.setInputFiles(referenceImage)
  const importDeadline = Date.now() + stationTimeout({ operations: 8 })
  let importedAssets = 0
  while (Date.now() < importDeadline) {
    const dir = path.join(projectDir, 'assets')
    importedAssets = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0
    if (importedAssets > 0) break
    await win.waitForTimeout(1000)
  }
  report.importedAssets = importedAssets
  if (importedAssets === 0) throw new Error('真实素材导入没落盘——后面「用素材库那张图当参考」那几轮就不成立了')
  const closeLibrary = win.locator('section[aria-label="素材库"] button[aria-label*="关闭"]').first()
  if (await closeLibrary.count()) await closeLibrary.click({ timeout: stationTimeout({ operations: 1 }) }).catch(() => {})

  // ② 真实页面输入 · 文稿是敲进编辑器的
  await win.getByRole('button', { name: '创作', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  await win.waitForTimeout(1200)
  const doc = win.locator(DOCUMENT)
  await doc.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  await doc.fill(CASES.script)

  // ② 真实页面输入 · 模型从下拉里选
  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  await win.waitForTimeout(1500)
  await expandResidentPanel(win)
  await win.locator(`${CANVAS_PANEL} ${COMPOSER_MODEL}`).click({ timeout: stationTimeout({ operations: 2 }) })
  await win.locator(`${CANVAS_PANEL} ${MODEL_POPOVER} [data-v4-model-row]`).first().locator('button').first().click({ timeout: stationTimeout({ operations: 2 }) })
  const option = win.locator('[data-nomi-select-dropdown] [data-nomi-select-option-label]')
    .filter({ hasText: new RegExp(escapeForRegExp(MODEL_LABEL)) }).first()
  await option.click({ timeout: stationTimeout({ operations: 2 }) })
  await win.waitForTimeout(800)

  /**
   * **每一轮开始前先证明面板真的能用。**
   *
   * 2026-09-18 第一次跑 origin/main 那一臂时，第 5 轮起连续 19 轮全部 30s 超时、零工具调用——
   * 看起来像「main 上 Agent 不干活」，实际上是第 4 轮里 Agent 调了 `start_model_setup`，把「设置 · 模型」
   * 那张**模态**摆到了面板前面，后面每一轮的点击都打在遮罩上。那不是产品结论，是仪器故障
   * （`docs/lessons/harness-catch-launders-bugs-into-verdicts.md`：自家 catch 会把仪器的 bug 洗成产品结论）。
   *
   * 所以守卫不是「保险起见按一下 Esc」：它先**观察**输入框可不可用，只有不可用时才按 Esc，
   * 并把「这一轮是被挡过的」记进报告——被挡这件事本身是数据，不许静默抹掉。
   */
  let blockedShotTaken = false
  async function ensureComposerUsable() {
    const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // **trial click，不是 isEditable。** 模态是一张盖在上面的遮罩：输入框自己在 DOM 上仍然
      // 「可编辑」，只是点不到它。`isEditable()` 看不见遮挡，第一版守卫因此完全没起作用
      // （19 轮照旧 30s 超时）。`click({ trial: true })` 走的是 Playwright 的完整可操作性检查，
      // 含命中测试——「点得到吗」这个问题只有它答得准，而那正是真人会遇到的那件事。
      const usable = await input.click({ trial: true, timeout: 3_000 }).then(() => true).catch(() => false)
      if (usable) return attempt
      if (!blockedShotTaken) {
        blockedShotTaken = true
        await win.screenshot({ path: path.join(outputDir, 'panel-blocked.png') }).catch(() => {})
      }
      await win.keyboard.press('Escape')
      await win.waitForTimeout(800)
    }
    return -1
  }

  const seenToolCallIds = new Set()
  const seenResultIds = new Set()
  for (const item of CASES.cases.slice(0, ROUNDS)) {
    const before = readCanvasNodeCount(projectDir)
    const row = { id: item.id, who: item.who, text: item.text, nodesBefore: before }
    const started = Date.now()
    try {
      // 面板被挡住时先解除；解除不了就明说，不要让后面那串 30s 超时冒充产品结论。
      row.unblockedByEscape = await ensureComposerUsable()
      if (row.unblockedByEscape === -1) throw new Error('这一轮开始前 composer 就不可用（连按 Esc 也没解除）——仪器故障，不是产品结论')
      // 每一轮都是**新对话**：量的是「这句话单独说出来时它会怎么做」，不是「上一轮铺垫之后」。
      await win.locator(`${CANVAS_PANEL} ${HISTORY_BUTTON}`).click({ timeout: stationTimeout({ operations: 2 }) })
      await win.locator(THREAD_MENU).getByRole('button', { name: '新对话', exact: true }).click({ timeout: stationTimeout({ operations: 2 }) })
      await win.waitForTimeout(500)
      const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
      await input.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
      await input.fill(item.text)
      await win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`).click({ timeout: stationTimeout({ operations: 2 }) })
      const running = win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)
      await running.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) }).catch(() => {})
      await running.waitFor({ state: 'hidden', timeout: stationTimeout({ turns: 2 }) })
      await win.waitForTimeout(1500)
    } catch (roundError) {
      row.roundError = roundError.message
    }
    const { calls, results } = readRoundTrajectory(projectDir, seenToolCallIds, seenResultIds)
    const after = readCanvasNodeCount(projectDir)
    row.ms = Date.now() - started
    row.nodesAfter = after
    row.toolCalls = calls.map((call) => call.name)
    row.firstTool = calls[0]?.name ?? null
    row.calledDraftShots = calls.some((call) => call.name === 'draft_shots')
    row.draftShotsAccepted = results.some((result) => result.name === 'draft_shots' && !result.isError)
    row.landedOnCanvas = after > before
    row.toolNameOk = row.firstTool !== null && CASES.expectedFirstTools.includes(row.firstTool)
    row.rejectedArgs = results.filter((result) => ARG_REJECTED.test(result.text)).map((result) => result.name)
    row.argsOkFirstTry = calls.length > 0 && row.rejectedArgs.length === 0
    report.cases.push(row)
    console.log(`${item.id} tools=[${row.toolCalls.join(',')}] draft_shots=${row.calledDraftShots} canvas=${before}→${after} ${row.ms}ms`)
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  }

  const n = report.cases.length
  const count = (predicate) => report.cases.filter(predicate).length
  report.summary = {
    rounds: n,
    calledDraftShots: `${count((c) => c.calledDraftShots)}/${n}`,
    draftShotsAccepted: `${count((c) => c.draftShotsAccepted)}/${n}`,
    landedOnCanvas: `${count((c) => c.landedOnCanvas)}/${n}`,
    toolNameOk: `${count((c) => c.toolNameOk)}/${n}`,
    blockedRounds: count((c) => (c.unblockedByEscape ?? 0) !== 0),
    argsOkFirstTry: `${count((c) => c.argsOkFirstTry)}/${n}`,
  }
  await win.screenshot({ path: path.join(outputDir, 'canvas-after-all-rounds.png') })
  console.log('SUMMARY', JSON.stringify(report.summary))
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
  // 轨迹与终态是**证据**，隔离目录清掉之前先搬出来：PR 里「落到画布」那一列要有人能自己复核。
  if (report.projectDir && fs.existsSync(report.projectDir)) {
    const evidence = path.join(outputDir, 'evidence')
    fs.rmSync(evidence, { recursive: true, force: true })
    fs.mkdirSync(evidence, { recursive: true })
    for (const relative of ['.nomi/agent-sessions', '.nomi/project.json']) {
      const source = path.join(report.projectDir, relative)
      if (fs.existsSync(source)) fs.cpSync(source, path.join(evidence, path.basename(relative)), { recursive: true })
    }
  }
  fs.rmSync(mediaTmp, { recursive: true, force: true })
  fs.rmSync(isoDir, { recursive: true, force: true })
  if (failure) console.error(failure)
}
