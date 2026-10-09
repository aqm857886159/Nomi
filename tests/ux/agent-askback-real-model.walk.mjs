#!/usr/bin/env node
import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 「模型该不该先问一句」——**真模型、真应用、真素材**的整机走查（R13 第三档）。
//
// ── 它补的是哪一格 ──
//
// 2026-09-21 实测（`scratchpad/investigate-askback.md` §3.3）：16 句该反问的话，**反问卡触发 0/16**。
// 那次是真机跑出来的，但剧本没进仓库，于是「模型现在会不会问」在每一次提示词/工具面改动之后
// 都得靠人重跑一遍手工操作。这个文件把那次走查落成可重跑的脚本，**句子逐字照抄那 16 句**——
// 换一批句子再报一个好看的数字是自欺。
//
// ── 四件真实（R13，缺一条这条测试不成立）──
//
//   ① 真实应用    真 Electron（`launchNomiApp`），渲染层 / IPC / AgentLane / pi SDK / 落盘全走生产路径；
//   ② 真实页面输入 文稿敲进编辑器、指令打进 composer、模型从下拉里选、素材从素材库的文件选择器导入；
//   ③ 真实工具轨迹 工具调用从磁盘上的 lane transcript 读（`.nomi/agent-sessions/*.jsonl`），
//                 **不信 Agent 的自述**——它说「我问问你」和它真的调了 `ask_user` 是两件事；
//   ④ 真实素材    A11 那句「用素材库那张图做参考」要求库里真有一张图，取自登记表的 4K HEVC 抽帧。
//
// ── 它量五个数（这五个就是 PR 正文要写的）──
//
//   该问时问了       shouldAsk=true 的轮次里，真的调了 ask_user 的比例（对照：修复前 0/10）
//   不该问时没问     shouldAsk=false 的轮次里，**没有**调 ask_user 的比例（误问率的反面）
//   选项质量         2–4 个、互不重复、至多一个 recommended、没有「其它/让我说说」这种假选项
//   工具参数写对率   这一轮没有任何一次工具调用因为参数被拒
//   答后回合成功率   答完那张卡之后，这一轮有没有真的继续下去（而不是原地停住）
//
// ── 跑法（要花钱：真模型，18 轮对话，DeepSeek 便宜档约 ¥0.x）──
//
//   pnpm run build
//   export NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/"
//   node tests/ux/agent-askback-real-model.walk.mjs [--rounds 18] [--model "DeepSeek V3.2"] [--label run1] [--only N3,N4,N5]
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
// 判据与它的阳性对照住 `askback-option-judges.mjs` / `.test.mjs`：一把尺子只能有一个家，
// 而且它得能在不起 App、不花额度的情况下被喂夹具（用户看到的那张卡就是那份夹具）。
import { asksPermissionForReversible, judgeAskOptions, judgeProseQuestion } from './askback-option-judges.mjs'
// 轨迹（每次调用的入参/返回/校验错误原文/第几次重试）落 JSONL：用户 2026-09-21 点名
// 「里面经常有重试、参数出错，这些轨迹都对我们后续优化有帮助」。
import { writeTrajectories } from './askback-trajectory.mjs'
import {
  CANVAS_PANEL, COMPOSER, COMPOSER_INPUT, COMPOSER_SEND, CREATION_PANEL, DOCUMENT, HISTORY_BUTTON,
  MODEL_POPOVER, COMPOSER_MODEL, THREAD_MENU, escapeForRegExp, expandResidentPanel,
} from './agent-runtime-walk-support.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const { values } = parseArgs({ options: {
  rounds: { type: 'string' }, model: { type: 'string' }, 'output-dir': { type: 'string' }, label: { type: 'string' },
  only: { type: 'string' },
} })

const CASES = JSON.parse(fs.readFileSync(path.join(here, 'agent-askback-real-model.cases.json'), 'utf8'))
// `--only N3,N4,N5`：**按 id 挑用例**，给连通性探测用。
//
// 没有它的时候 `--rounds 3` 取的是表头前三句（A1/A2/A3），而那三句是创作面「该问」的用例，
// 一路跑下去会调 `generate`——探一次连通性不该花生成额度。挑 id 才能只跑只读的那几句。
// 写错的 id **直接报错退出**，不静默忽略：探测跑完才发现少跑了一句，比不跑更坏。
const ONLY = values.only ? values.only.split(',').map((id) => id.trim()).filter(Boolean) : null
if (ONLY) {
  const known = new Set(CASES.cases.map((item) => item.id))
  const unknown = ONLY.filter((id) => !known.has(id))
  if (unknown.length) throw new Error(`--only 里这些 id 不在用例表里：${unknown.join(', ')}`)
}
const SELECTED = ONLY
  ? ONLY.map((id) => CASES.cases.find((item) => item.id === id))
  : CASES.cases
const ROUNDS = Number(values.rounds || SELECTED.length)
const MODEL_LABEL = values.model || 'DeepSeek V3.2'
const LABEL = values.label || 'run'
const outputDir = path.resolve(repoRoot, values['output-dir'] || `tests/ux/shots/askback-real-model/${LABEL}`)
fs.mkdirSync(outputDir, { recursive: true })

const ASK_TOOL = 'ask_user'
const ARG_REJECTED = /Validation failed for tool|capability_input_invalid|generation_input_invalid|Unrecognized key\(s\)|must be (array|string|number|object)|Required/i

// ── ④ 真实素材 ────────────────────────────────────────────────────────────
const { assets } = requireRealMediaAssets(['video-4k-hevc-10bit', 'image-4k-png'])
const sourceVideo = assets.get('video-4k-hevc-10bit').file
const derivedSpec = assets.get('image-4k-png').spec
const mediaTmp = makeTempDir('askback-real-media-')
const referenceImage = path.join(mediaTmp, 'reference-4k.png')
execFileSync(ffmpeg.path, ['-y', '-ss', '00:00:05', '-i', sourceVideo, '-frames:v', '1', referenceImage], { stdio: 'pipe' })
const referenceBytes = fs.statSync(referenceImage).size
if (referenceBytes < derivedSpec.minBytes) {
  throw new Error(`抽出来的参考帧只有 ${referenceBytes} 字节，登记表 image-4k-png 要求 ≥${derivedSpec.minBytes}`)
}

// ── ① 真实应用：隔离 profile + 本机真实 catalog（真模型、真 key；项目与浏览器状态全隔离）。
const { prepareIsolation } = await import(path.join(repoRoot, 'evals/lib/isoApp.mjs'))
const isoDir = path.join(os.tmpdir(), `askback-real-model-${Date.now()}`)
const iso = prepareIsolation(isoDir)

const report = {
  label: LABEL, model: MODEL_LABEL, rounds: ROUNDS,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  baseline: '2026-09-21 修复前同样这 16 句：反问卡触发 0/16（scratchpad/investigate-askback.md §3.3）',
  startedAt: new Date().toISOString(), cases: [],
}

/** 这一轮的工具轨迹：从磁盘上的 lane transcript 读，不信面板文字、不信 Agent 自述。 */
function readRoundTrajectory(projectDir, seenToolCallIds, seenResultIds) {
  const calls = []
  const results = []
  // 这一轮模型**自己写的正文**。2026-09-22 起要数它：模型多数时候是在正文里把问题问出来的
  // （带编号选项、问号收尾、回合就此结束），只数 `ask_user` 调用的话这些全部记 0。
  // 读的是 transcript 里的 assistant 文本段——`*.trace/trace.md` 的 `### Response` 就是它的渲染。
  const prose = []
  // 这一轮**到底有没有跑到模型**。run6 实测：7 轮连着 `assistant_error: Connection error.`
  // （四次重试全是 0 token），而走查照旧记 `roundErrors: 0`——它只捕自己的异常，不读 lane
  // 那边这次 operation 的结局。后果不是少一行日志，是**所有比率的分母都掺进了没跑到的轮次**，
  // 报告看上去完全正常（证据 docs/evidence/2026-09-22-askback-real-model-run6 发现 ①）。
  const outcomes = []
  for (const session of readLaneTranscripts(projectDir)) {
    for (const write of session.writes) {
      if (write?.namespace !== 'pi.result' || write.op !== 'set' || !write.value) continue
      outcomes.push({ key: write.key, status: write.value.status, error: write.value.error })
    }
    for (const message of laneMessages(session)) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type === 'text' && typeof part.text === 'string') prose.push(part.text)
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
  return { calls, results, prose, outcomes }
}

let app, win, failure
try {
  ;({ app, win } = await launchNomiApp({ name: 'askback-real-model', userDataDir: iso.chromiumDir,
    projectsDir: iso.projectsDir, settingsDir: iso.settingsDir, capabilityDir: iso.capabilityDir }))
  const { dismissSplashIfPresent, createBlankProject } = await import(path.join(repoRoot, 'evals/lib/isoApp.mjs'))
  await dismissSplashIfPresent(win)
  const projectDir = await createBlankProject(win, iso.projectsDir)
  report.projectDir = projectDir

  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.count()) { await consent.click({ timeout: stationTimeout({ operations: 2 }) }); await win.waitForTimeout(600) }

  // ② 真实页面输入 · 导入真实素材（A11 那句话要求库里真有一张图）
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
  if (importedAssets === 0) throw new Error('真实素材导入没落盘——A11 那一轮就不成立了')
  const closeLibrary = win.locator('section[aria-label="素材库"] button[aria-label*="关闭"]').first()
  if (await closeLibrary.count()) await closeLibrary.click({ timeout: stationTimeout({ operations: 1 }) }).catch(() => {})

  // ② 真实页面输入 · 文稿敲进编辑器
  await win.getByRole('button', { name: '创作', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  await win.waitForTimeout(1200)
  const doc = win.locator(DOCUMENT)
  await doc.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  await doc.fill(CASES.script)

  // ② 真实页面输入 · 模型从下拉里选（两个面各选一次：面板是分面的）
  async function pickModelOn(panel) {
    await expandResidentPanel(win)
    await win.locator(`${panel} ${COMPOSER_MODEL}`).click({ timeout: stationTimeout({ operations: 2 }) })
    await win.locator(`${panel} ${MODEL_POPOVER} [data-v4-model-row]`).first().locator('button').first()
      .click({ timeout: stationTimeout({ operations: 2 }) })
    const option = win.locator('[data-nomi-select-dropdown] [data-nomi-select-option-label]')
      .filter({ hasText: new RegExp(escapeForRegExp(MODEL_LABEL)) }).first()
    await option.click({ timeout: stationTimeout({ operations: 2 }) })
    await win.waitForTimeout(800)
  }
  await pickModelOn(CREATION_PANEL)
  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: stationTimeout({ operations: 2 }) })
  await win.waitForTimeout(1500)
  await pickModelOn(CANVAS_PANEL)

  /** 面板被模态挡住时解除；解除不了就明说（别让 30s 超时冒充产品结论）。 */
  async function ensureComposerUsable(panel) {
    const input = win.locator(`${panel} ${COMPOSER_INPUT}`)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const usable = await input.click({ trial: true, timeout: 3_000 }).then(() => true).catch(() => false)
      if (usable) return attempt
      await win.keyboard.press('Escape')
      await win.waitForTimeout(800)
    }
    return -1
  }

  /**
   * 「设置」是**应用级模态**（`aria-modal`、整屏黑底，z 在 applicationModal 档）。它一挂上来，
   * 切页钮、composer、介入槽里的卡全都点不动。run4 第五次起跑就是这么死的：A1 里模型自己调了
   * `start_model_setup`——这是那个动词的**设计**（把「设置 · 模型」打开、预填供应商，让用户去填 key），
   * 不是故障；但面板挂上之后没人收，接下来 17 轮每一轮的第一下（切「创作」/「生成」）都被它拦掉，
   * 每轮恰好 30 秒超时、`tools=[]`。真人这时候要么去填 key、要么把它关掉；这条走查不配模型、零额度，
   * 所以照真人的另一半做：点面板自己的关闭钮。
   *
   * **只点关闭，不碰任何确认框**：这一层看不出弹出来的是「放弃修改」还是分镜编辑器那个花钱确认，
   * 而后者点确认就是真花钱。关不掉就让它关不掉——下面的循环会把确认框按「取消」，这一轮如实记失败。
   */
  async function closeSettingsPanelIfOpen() {
    const overlay = win.locator('[data-settings-overlay]').first()
    if (!await overlay.isVisible().catch(() => false)) return false
    await win.locator('[data-settings-close]').first()
      .click({ timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
    await overlay.waitFor({ state: 'hidden', timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
    return true
  }

  /**
   * 画布的花钱确认 `SpendConfirmDialog`——**第三张**要答的面，也是 2026-09-22 起等待不再受工具超时管的那一张。
   * 它同样是盖满整窗的模态（`fixed inset-0` + `pointer-events-auto`，z 在 dialog 档），
   * 而且 `generate` 对「文稿方案」走的就是它：run4 第六次起跑里 A1 在这张卡前面干等到回合预算见底（20.6 分钟），
   * 之后 A2 起每一轮的第一下又被它拦掉，30 秒超时、`tools=[]`。
   *
   * 真人不想花钱时点遮罩/「先不」；走查点**遮罩**——`onPointerDown` 里 `target === currentTarget`
   * 就是 `resolvePending(false)`，一颗按钮都不用认，多镜/形象/普通三种形态通吃。
   * **绝不去碰 `data-production-action="confirm"`**：那一下是真花钱。
   */
  async function declineSpendDialogIfOpen(caseId) {
    const card = win.locator('[data-spend-confirm-dialog]').first()
    if (!await card.isVisible().catch(() => false)) return false
    await win.screenshot({ path: path.join(outputDir, `${caseId}-spend-dialog.png`) }).catch(() => {})
    const backdrop = win.locator('div:has(> [data-spend-confirm-dialog])').first()
    await backdrop.click({ position: { x: 5, y: 5 }, timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
    await card.waitFor({ state: 'hidden', timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
    return true
  }

  const seenToolCallIds = new Set()
  const seenResultIds = new Set()
  // 正文按轮切：`readRoundTrajectory` 每次读的是全量，这个游标记住上一轮读到哪。
  let seenProse = 0
  let seenOutcomes = 0
  let answeredOnce = false
  for (const item of SELECTED.slice(0, ROUNDS)) {
    const panel = item.surface === 'creation' ? CREATION_PANEL : CANVAS_PANEL
    const row = { id: item.id, kind: item.kind, shouldAsk: item.shouldAsk, surface: item.surface, text: item.text }
    const started = Date.now()
    try {
      // 上一轮可能留下一个应用级模态（`start_model_setup` 开的设置面板）。它得在这一轮的
      // **第一下**之前收掉，否则连切页钮都点不动——那一下超时，这一轮就什么都没发生。
      row.closedSettingsPanel = await closeSettingsPanelIfOpen()
      row.declinedSpendDialogBefore = await declineSpendDialogIfOpen(`${item.id}-before`)
      await win.getByRole('button', { name: item.surface === 'creation' ? '创作' : '生成', exact: true })
        .first().click({ timeout: stationTimeout({ operations: 2 }) })
      await win.waitForTimeout(1200)
      row.unblockedByEscape = await ensureComposerUsable(panel)
      if (row.unblockedByEscape === -1) throw new Error('这一轮开始前 composer 就不可用——仪器故障，不是产品结论')
      // 每一轮都是**新对话**：量的是「这句话单独说出来时它会怎么做」。
      await win.locator(`${panel} ${HISTORY_BUTTON}`).click({ timeout: stationTimeout({ operations: 2 }) })
      await win.locator(THREAD_MENU).getByRole('button', { name: '新对话', exact: true })
        .click({ timeout: stationTimeout({ operations: 2 }) })
      await win.waitForTimeout(500)
      const input = win.locator(`${panel} ${COMPOSER_INPUT}`)
      await input.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
      await input.fill(item.text)
      await win.locator(`${panel} ${COMPOSER_SEND}`).click({ timeout: stationTimeout({ operations: 2 }) })
      const running = win.locator(`${panel} ${COMPOSER}[data-mode="running"]`)
      await running.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) }).catch(() => {})

      // 有卡在等人的时候回合是**停着**的（审批闸在等），`running` 不会自己消失——所以这里像真人一样：
      // 看到卡就答，答完接着等，直到这一轮真的走完。run3 作废的原因正是没答卡：第一张卡之后 15 句全压在它后面。
      //   · 提问卡 → 点第一颗选项（没有选项就在卡上打一句）。**每一张都答**，不再「只答第一张、其余按停」——
      //     按停量不到「答完之后它走不走得下去」，而 2026-09-22 起同一回合里可能连着问两次；
      //   · 报价卡 → ×。真人不想花钱时就是这么做的；这条走查量的是「问不问」，不是出片，整场零生成额度。
      //   · 不可逆审批卡 → ×（拒绝）。T-QA-29（A4「把那个删了」）走的是 `delete_from_canvas`：
      //     它声明不可逆，闸是**硬**的、没有墙钟，没人答就一直停着。上一版等待循环只认 question / spend，
      //     于是 A4 每轮白等满 20.6 分钟（run5/run6 都是）。这里像真人一样**拒绝**——走查不真删东西，
      //     量的是「它问不问」，批准了反而会毁掉下一轮的画布。
      const questionCard = win.locator(`${panel} [data-v4-block="intervention"][data-kind="question"]`)
      const spendCard = win.locator(`${panel} [data-v4-block="intervention"][data-kind="spend"]`)
      const irreversibleCard = win.locator(`${panel} [data-v4-block="intervention"][data-kind="approval-irreversible"]`)
      const deadline = Date.now() + stationTimeout({ turns: 3 })
      let sawCard = false
      row.cardsAnswered = []
      while (Date.now() < deadline) {
        // 回合中途也可能弹设置面板（模型调 `start_model_setup`），它会把下面那张卡整个盖住。
        // 关掉的次数单独记，**不进 `cardsAnswered`**：那一栏是「答了几张卡」，掺进来这个数就不能看了。
        if (await closeSettingsPanelIfOpen()) {
          row.settingsPanelClosed = (row.settingsPanelClosed ?? 0) + 1
          await win.waitForTimeout(1000)
          continue
        }
        // 花钱确认同样盖在卡之上，而且回合就停在它那儿等人——先答它。
        if (await declineSpendDialogIfOpen(item.id)) {
          row.cardsAnswered.push('spend-dialog:declined')
          await win.waitForTimeout(1500)
          continue
        }
        if (await questionCard.count() > 0) {
          if (!sawCard) await win.screenshot({ path: path.join(outputDir, `${item.id}-question-card.png`) }).catch(() => {})
          sawCard = true
          // 一张卡 1–3 题：单选点了自己往下走（480ms），多选 / 自己打字要按「继续 / 发送」。像人一样：
          // 能点的选项就点第一颗，「继续」亮着就按它；哪一下没点到不算仪器故障（卡可能正在翻题），下一圈再看。
          const tap = { timeout: stationTimeout({ operations: 1 }) }
          // 多题卡里**每一题都在 DOM 里**，只有 `data-active="true"` 的那一题点得动；`.first()` 不限定它，
          // 翻到第 2 题之后就会一直去点第 1 题那颗已经滑走的选项（run4 第三次起跑在 1/3 上卡了十几分钟）。
          const chip = questionCard.locator('[data-ask-question][data-active="true"] [data-v4-control="question-option"]').first()
          const proceed = questionCard.locator('[data-v4-control="ask-continue"]').first()
          // 先数再问：`isEnabled()` 会**等**元素出现，这一题一颗选项都没有时（卡上永远有自由输入那一行，
          // 选项却可以是零个）它要白等满一个默认动作超时才轮得到下面的打字支。
          const chipCount = await chip.count()
          // 「继续 / 发送」未作答时置灰走的是原生 `disabled`（`WorkbenchButton` 把 `disabled` 直接透给 `<button>`，
          // 见 src/design/actions.tsx），而 Playwright 1.60 的 `isEnabled()` = 原生 disabled ∪ aria-disabled 都算禁用，
          // 所以问它比自己写属性选择器稳：设计系统哪天把置灰换成 aria-disabled，这里也不用跟着改。
          if (await proceed.isEnabled().catch(() => false)) {
            await proceed.click(tap).then(() => row.cardsAnswered.push('question:continue')).catch(() => {})
          } else if (chipCount > 0 && await chip.isEnabled().catch(() => false)) {
            await chip.click(tap).then(() => row.cardsAnswered.push('question:chip')).catch(() => {})
          } else {
            const own = questionCard.locator('[data-ask-question][data-active="true"] [data-v4-control="question-answer"]').first()
            await own.fill('你定就好，按最稳妥的来').catch(() => {})
            await own.press('Enter').then(() => row.cardsAnswered.push('question:typed')).catch(() => {})
          }
          row.answeredByChip = true
          answeredOnce = true
          await win.waitForTimeout(1500)
          continue
        }
        if (await spendCard.count() > 0) {
          await win.screenshot({ path: path.join(outputDir, `${item.id}-spend-card.png`) }).catch(() => {})
          const confirmReject = spendCard.locator('[data-v4-control="confirm-reject"]')
          if (!await confirmReject.isVisible().catch(() => false)) await spendCard.locator('[data-v4-control="slot-dismiss"]').click({ timeout: stationTimeout({ operations: 2 }) }).catch(() => {})
          if (await confirmReject.isVisible().catch(() => false)) await confirmReject.click({ timeout: stationTimeout({ operations: 2 }) }).catch(() => {})
          row.cardsAnswered.push('spend:declined')
          await win.waitForTimeout(1500)
          continue
        }
        // 不可逆审批卡（delete_from_canvas 等）：和报价卡同一套 DOM——右上那颗 ×（`slot-dismiss`）先把
        // 「不要」摊开成填原因的那一档，再按 `confirm-reject` 落定。`reasonPlaceholder` 在介入槽里是
        // **恒给**的（agentPanelV4Intervention.ts），所以两步都要走；先问一次 `confirm-reject` 可不可见，
        // 是为了在卡已经处于拒绝态时不再多点一次 ×（那一下会把卡关掉、闸永远等不到答复）。
        if (await irreversibleCard.count() > 0) {
          await win.screenshot({ path: path.join(outputDir, `${item.id}-approval-irreversible-card.png`) }).catch(() => {})
          const confirmReject = irreversibleCard.locator('[data-v4-control="confirm-reject"]')
          if (!await confirmReject.isVisible().catch(() => false)) await irreversibleCard.locator('[data-v4-control="slot-dismiss"]').click({ timeout: stationTimeout({ operations: 2 }) }).catch(() => {})
          if (await confirmReject.isVisible().catch(() => false)) await confirmReject.click({ timeout: stationTimeout({ operations: 2 }) }).catch(() => {})
          row.cardsAnswered.push('approval-irreversible:declined')
          await win.waitForTimeout(1500)
          continue
        }
        // 文稿方案的 `generate` 走的是分镜编辑器**原来那一套**花钱确认（一个居中的确认框 / 批量预览条），不是介入槽里的卡。
        // 2026-09-22 起这次等待不再受工具超时管——没人答它，回合就一直等着（run4 第四次起跑在这里等了十几分钟）。
        // 真人不想花钱时点「取消」；走查照做。
        const dialogCancel = win.locator('[data-confirm-dialog-cancel="true"]').first()
        const batchCancel = win.locator('[data-batch-plan-overlay] button').filter({ hasText: /取消|Cancel/ }).first()
        if (await dialogCancel.isVisible().catch(() => false)) {
          await win.screenshot({ path: path.join(outputDir, `${item.id}-editor-confirm.png`) }).catch(() => {})
          await dialogCancel.click({ timeout: stationTimeout({ operations: 1 }) }).then(() => row.cardsAnswered.push('editor-confirm:cancelled')).catch(() => {})
          await win.waitForTimeout(1500)
          continue
        }
        if (await batchCancel.isVisible().catch(() => false)) {
          await win.screenshot({ path: path.join(outputDir, `${item.id}-batch-preview.png`) }).catch(() => {})
          await batchCancel.click({ timeout: stationTimeout({ operations: 1 }) }).then(() => row.cardsAnswered.push('batch-preview:cancelled')).catch(() => {})
          await win.waitForTimeout(1500)
          continue
        }
        if (!await running.isVisible().catch(() => false)) break
        await win.waitForTimeout(1000)
      }
      row.questionCardVisible = sawCard
      // 判据写成**正向的**：「composer 回到 idle」——这一轮走完了、输入框还回来了。
      row.turnContinuedAfterAnswer = row.cardsAnswered.length > 0
        ? await win.locator(`${panel} ${COMPOSER}[data-mode="idle"]`).isVisible().catch(() => false) : undefined
      if (row.cardsAnswered.length > 0) await win.screenshot({ path: path.join(outputDir, `${item.id}-after-answer.png`) }).catch(() => {})
      await running.waitFor({ state: 'hidden', timeout: stationTimeout({ turns: 1 }) }).catch(() => {})
      await win.waitForTimeout(1200)
    } catch (roundError) {
      row.roundError = roundError.message
    }
    const { calls, results, prose, outcomes } = readRoundTrajectory(projectDir, seenToolCallIds, seenResultIds)
    // 这一轮新增的那几个 operation 结局。`failed` = 根本没跑到模型，这一轮的任何比率都不该数它。
    const roundOutcomes = outcomes.slice(seenOutcomes)
    seenOutcomes = outcomes.length
    const failedOutcome = roundOutcomes.find((outcome) => outcome.status === 'failed')
    if (failedOutcome) {
      row.roundFailed = failedOutcome.status
      row.assistantError = failedOutcome.error?.code ?? null
      row.assistantErrorMessage = failedOutcome.error?.message ?? null
    }
    row.ms = Date.now() - started
    row.toolCalls = calls.map((call) => call.name)
    // 「跑到模型」= **这一轮模型真的回过话**。判据放宽成两条并列（run7 起）：
    //   · lane 结局不是 `assistant_error`（那一档是连接中断，模型一个 token 都没吐）；
    //   · **或者**这一轮至少有一次工具调用——调用只可能由模型发出，有调用就是回过话了。
    //
    // 原来的写法是「这一轮没有 failed 结局」，一刀切。run7 的 A1 被它误伤：
    // 结局是 `summarization_failed`（回合跑完之后**压缩上下文**那一步挂了），
    // 而那一轮模型发了 9 次工具调用、最后一次正是 `ask_user`——它显然回过话。
    // 把这种轮次踢出分母，等于把「模型问了、但那次调用被 schema 拒了」这条最要紧的证据
    // 一起丢掉（run7 发现 ①）。分母宁可宽一格，也不能把量到的行为当没发生。
    const connectionDropped = failedOutcome?.error?.code === 'assistant_error'
    row.reachedModel = !connectionDropped || calls.length > 0
    if (failedOutcome && row.reachedModel) row.reachedModelDespiteFailure = true
    row.firstTool = calls[0]?.name ?? null
    const askCalls = calls.filter((call) => call.name === ASK_TOOL)
    row.askedUser = askCalls.length > 0
    row.askCount = askCalls.length
    row.askArgs = askCalls.map((call) => call.args)
    row.optionQuality = askCalls.map((call) => judgeAskOptions(call.args))
    row.correct = row.askedUser === item.shouldAsk
    // ① 为一个**可撤销**的动作问「要不要」。判据：题目是征询许可的句式，而选项里
    //    没有两个真候选（真的指代不明时选项就是候选本身，题目不会是「要不要」）。
    row.askedForReversibleConfirmation = askCalls.some((call) => asksPermissionForReversible(call.args))
    // 「它其实问了，只是没用那个工具」：量的是**回合的收尾那段话**。
    // 这一格和 `askedUser` 不是一个数——一个说「模型自己认为该问」，一个说「问对了地方」。
    // 收尾正文只在这一轮新增的那几段里取最后一段（`prose` 是本轮之前读过的全量，按轮切）。
    // 这一轮的工具调用要一起喂给判据：第二档要分「以问代做」和「答完顺口一问」，
    // 而「这一轮到底有没有交付」的一半证据就在工具里（调过写类动词就是交付了）。
    const proseJudged = judgeProseQuestion(prose.slice(seenProse), { toolCalls: row.toolCalls })
    seenProse = prose.length
    row.askedInProse = proseJudged.askedInProse
    // **以问代做**：该做的没做，回合停在问题上等人。H1 要压的是它，验收也只看它。
    row.askedInsteadOfActing = proseJudged.askedInsteadOfActing
    // **答完顺口一问**：用户要的东西已经给了，末尾提议下一步。不该记进误问。
    row.askedAfterDelivering = proseJudged.askedAfterDelivering
    row.proseQuestion = { endsWithQuestion: proseJudged.endsWithQuestion, numberedOptions: proseJudged.numberedOptions,
      questionMarks: proseJudged.questionMarks, wroteSomething: proseJudged.wroteSomething,
      menuAfterQuestion: proseJudged.menuAfterQuestion, deliveredInProse: proseJudged.deliveredInProse,
      closing: proseJudged.closing.slice(0, 600) }
    row.rejectedArgs = results.filter((result) => ARG_REJECTED.test(result.text)).map((result) => result.name)
    row.argsOkFirstTry = calls.length > 0 && row.rejectedArgs.length === 0
    report.cases.push(row)
    console.log(`${item.id} shouldAsk=${item.shouldAsk} asked=${row.askedUser} inProse=${row.askedInProse} card=${row.questionCardVisible === true} reached=${row.reachedModel} tools=[${row.toolCalls.join(',')}] ${row.ms}ms`)
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  }

  const count = (predicate) => report.cases.filter(predicate).length
  // **没跑到模型的轮次不进任何分母**：一轮「模型根本没回话」和一轮「模型想了想决定不问」
  // 在比率里长得一模一样，那正是 run6 那 7 轮把整份报告变成假绿的原因。
  const reached = report.cases.filter((c) => c.reachedModel !== false)
  // 有效轮里数一格：**分母只能是 `reached`**。上一版（d1b45b909）只把反问那几格换过来，
  // `questionCardRendered` / `argsOkFirstTry` 还在拿 `report.cases.length` 当分母，
  // 于是 run7 的同一份报告里两种分母并排——`argsOkFirstTry: "7/18"` 看着像模型退步了一半，
  // 按有效轮其实是 7/9（run7 README 发现 ③）。读的人无从分辨哪一格缩了，所以这里统一。
  const ofReached = (predicate) => `${reached.filter(predicate).length}/${reached.length}`
  const should = reached.filter((c) => c.shouldAsk)
  const shouldNot = reached.filter((c) => !c.shouldAsk)
  const allQualities = report.cases.flatMap((c) => c.optionQuality ?? [])
  report.summary = {
    rounds: report.cases.length,
    // 跑到模型的轮次。低于 `rounds` 就说明下面每一格的分母都缩了——这一份不能和别的轮次直接比。
    roundsReachedModel: `${reached.length}/${report.cases.length}`,
    roundsFailedBeforeModel: report.cases.filter((c) => c.reachedModel === false).map((c) => `${c.id}:${c.assistantError ?? 'failed'}`),
    askedWhenShould: `${should.filter((c) => c.askedUser).length}/${should.length}`,
    // 「模型自己认为该问」= 调了工具 **或** 在正文里问了。它与上一行的差额就是
    // 「它想问、但问在了用户答不了的地方」——2026-09-22 run4/run5 那 4 句 / 6 句。
    askedInProseWhenShould: `${should.filter((c) => c.askedInProse).length}/${should.length}`,
    wantedToAskWhenShould: `${should.filter((c) => c.askedUser || c.askedInProse).length}/${should.length}`,
    askedInProseWhenShouldNot: `${shouldNot.filter((c) => c.askedInProse).length}/${shouldNot.length}`,
    didNotAskWhenShouldNot: `${shouldNot.filter((c) => !c.askedUser).length}/${shouldNot.length}`,
    // ── 第二档：把上面那几格里的「正文提问」拆成两种（2026-09-22 run7 之后加）──
    // **H1 的验收只看 `askedInsteadOfActing*` 这两格**：H1 要堵的是「在正文里把问题问出来然后停住」，
    // 而上面的 `askedInProse*` 连「答完了顺口问一句下一步」也算进去了——run7 的 4 次「正文误问」
    // 里有 3 次是后者（N3/N4/N5，用户要的答案已经拿到了）。两件事混在一格，改动有没有效就永远说不清。
    askedInsteadOfActingWhenShould: `${should.filter((c) => c.askedInsteadOfActing).length}/${should.length}`,
    askedAfterDeliveringWhenShould: `${should.filter((c) => c.askedAfterDelivering).length}/${should.length}`,
    // 误问只数「以问代做」那一半：不该问的用例上，答完了顺口提议下一步不是毛病。
    askedInsteadOfActingWhenShouldNot: `${shouldNot.filter((c) => c.askedInsteadOfActing).length}/${shouldNot.length}`,
    askedAfterDeliveringWhenShouldNot: `${shouldNot.filter((c) => c.askedAfterDelivering).length}/${shouldNot.length}`,
    // 「真·误问」= 调了 `ask_user` **或** 以问代做。这是误问那一格该用的口径。
    misaskedWhenShouldNot: `${shouldNot.filter((c) => c.askedUser || c.askedInsteadOfActing).length}/${shouldNot.length}`,
    questionCardRendered: ofReached((c) => c.questionCardVisible === true),
    optionSets: allQualities.length,
    optionsInRange: `${allQualities.filter((q) => q.inRange).length}/${allQualities.length}`,
    optionsDistinct: `${allQualities.filter((q) => q.distinct).length}/${allQualities.length}`,
    atMostOneRecommended: `${allQualities.filter((q) => q.atMostOneRecommended).length}/${allQualities.length}`,
    fakeOptionSets: allQualities.filter((q) => q.fakeOptions.length > 0).length,
    // 09-21 用户点名的五条，各算一次失败
    askedForReversibleConfirmation: `${reached.filter((c) => c.askedForReversibleConfirmation).length}/${reached.filter((c) => c.askedUser).length}`,
    yesNoNestingSets: allQualities.filter((q) => q.yesNoNesting.length > 0).length,
    cancelOptionSets: allQualities.filter((q) => q.cancelOptions.length > 0).length,
    internalIdentifierSets: allQualities.filter((q) => q.internalIdentifiers.length > 0).length,
    labelTooLongSets: allQualities.filter((q) => q.labelsTooLong.length > 0).length,
    questionEchoSets: allQualities.filter((q) => q.questionEchoes.length > 0).length,
    argsOkFirstTry: ofReached((c) => c.argsOkFirstTry),
    askToolArgsRejected: count((c) => (c.rejectedArgs ?? []).includes(ASK_TOOL)),
    answeredTurnContinued: report.cases.filter((c) => c.answeredByChip).map((c) => `${c.id}:${c.turnContinuedAfterAnswer}`),
    roundErrors: count((c) => c.roundError),
  }
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
  if (report.projectDir && fs.existsSync(report.projectDir)) {
    // 轨迹先写：它要读隔离目录里那份 transcript，而这个目录马上就要被删掉。
    try {
      report.trajectories = writeTrajectories(outputDir, report, report.projectDir)
      console.log('trajectories →', path.join(outputDir, 'trajectories'))
    } catch (trajectoryError) {
      // 轨迹写不出来是**仪器**的问题，不该把整轮评测的数字一起判死；如实记进报告。
      report.trajectoryError = trajectoryError instanceof Error ? trajectoryError.message : String(trajectoryError)
    }
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
