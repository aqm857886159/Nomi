// look_at_canvas「当前选中」行内标记量具的步骤本体（PR #1283，E）。
// 真付费走查（look-at-canvas-selection-real.paid.mjs）与零花费演练（look-at-canvas-selection-real.rehearsal.walk.mjs）
// 跑**同一份**步骤：差别只在大脑——真付费是 App 里配好的真模型，演练是夹具里写好剧本的那个。两边各自直接调 openPaidWalk。
//
// 流程（真 Electron、真 IPC、真 Agent lane、真 look_at_canvas 排版）：
//   开项目 → 画布 → 选对话模型 → 经画布 store 的真动作（addNode / selectNodes）布主场景并选中其中 40 个 →
//   用产品自己的排版算一遍「选中标记能否一次列全」（不成立就拒跑，一个 token 不花）→
//   每一轮：新对话 → 重设选区并核对 → 发那一句 → 等这一轮落地（任何要人点头的卡都不替用户答，按停止）→
//   从盘上的 lane 转录读这一轮的工具调用序列与最终回答 → 判分。
// 只读、不花钱、不改画布：问的是「哪几个是视频节点」，不起草、不生成。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { require as tsxRequire } from 'tsx/cjs/api'

import { DEFAULT_TIMEOUT_MS, expect } from './_assert.mjs'
import { envKeyOf } from './_paidEnvKey.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_INPUT, COMPOSER_STOP, EMPTY_STATE, ERROR_BAR,
  chooseAssistantModel, composerText, newConversation, openCanvas, sendCanvas,
} from './agent-runtime-walk-support.mjs'
import {
  LOOK_AT_CANVAS, SELECTION_ASK, SELECTION_PROMPTS, answerTimeView, groundTruthKeys, roundSettled, roundTranscript, sceneFromIds, sceneProblems, sceneProjectionFacts,
  scoreSelectionRound, selectionLinesOf, selectionSceneSpec, summarizeSelectionRounds,
} from './_lookAtCanvasSelectionScore.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * 构建标记：本 PR 新代码里选区行的固定字面量（electron/shared/agentCapabilities/canvasReadCompact.ts）。
 * 产物里找不到它 = 跑的不是这次要验的修复，openPaidWalk 当场拒跑（一分钱不花）。单测核对它确实在源码里。
 */
export const SELECTION_MARKER = '节点行里标了「选中」'
export const OMITTED_CANVAS_MARKER = 'call look_at_canvas with no arguments'
export const SELECTION_EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-10-22-look-at-canvas-selection-truncation/paid')

/** 量具数字的定义（写进证据，PR 正文照抄）。 */
export const SELECTION_METRICS = Object.freeze({
  toolWriteCorrect: '工具写对率 = 不带参数且宿主未退回的 look_at_canvas 调用数 / look_at_canvas 调用总数',
  turnSuccess: '回合成功率 = 最终回答点到的节点集合与 ground truth（选中的 20 个视频节点）完全一致、不多不少的轮数 / 总轮数',
  readPath: '读面路径分档 = 调用 look_at_canvas / 没调读工具的回合数',
})
/** 诊断计数的定义（不进三个数；回合失败时用来分原因）。 */
export const SELECTION_DIAGNOSTICS = Object.freeze({
  roundsReadWholeSelection: '转录里读回的选区（look_at_canvas 节点行的「选中」标记）覆盖全部选中 id 的轮数',
  roundsSawWholeSelectionAtAnswer: '答话那一刻、发给模型的那份消息里仍看得见全部选中 id 的轮数（两种读法的结果都算，被旧读结果替换掉的那一份不算）',
  view: 'rounds[].view：答话那一刻看得见几个选中 id、有几份读结果被旧读结果替换、答话前模型自己记下了几个真值视频',
  prompts: `量具预置 ${SELECTION_PROMPTS.length} 句不同的用户说法，实际回合默认抽样其中前 rounds 句`,
})

/** 一轮的安全上限（不是完成条件：完成看转录里最后一条助手消息落地 + composer 退出运行态）。 */
const ROUND_TIMEOUT_MS = stationTimeout({ turns: 3 })
const KEY_SHAPED = /\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i

/** 产品自己的读面与排版（canvas.read 投影 + look_at_canvas 紧凑文本），场景检查用。 */
function loadProjector() {
  const { projectCanvasRead } = tsxRequire('../../electron/shared/agentCapabilities/canvasRead.ts', import.meta.url)
  const { projectCanvasForAgent } = tsxRequire('../../electron/shared/agentCapabilities/canvasReadCompact.ts', import.meta.url)
  return { projectCanvasRead, projectCanvasForAgent }
}

function loadSnapshotProjector() {
  const { projectAgentContextSnapshot } = tsxRequire('../../electron/shared/agentContextSnapshot.ts', import.meta.url)
  const { resolveResidentSelection } = tsxRequire('../../src/workbench/ai/resident/residentContextSnapshot.ts', import.meta.url)
  return (canvasSnapshot) => projectAgentContextSnapshot(resolveResidentSelection({
    canvas: {
      revision: 1,
      nodes: (canvasSnapshot.nodes ?? []).map((node) => ({ id: node.id, title: node.title, kind: node.kind, subtitle: node.subtitle })),
      selectedNodeIds: canvasSnapshot.selectedNodeIds ?? [],
    },
  }).snapshot)
}

function loadContextSnapshotProjector() {
  const { projectAgentContextSnapshot } = tsxRequire('../../electron/shared/agentContextSnapshot.ts', import.meta.url)
  return projectAgentContextSnapshot
}

/** 宿主发给模型之前对消息做的那一步（laneHost 的 transform_context = omitSupersededReads + 内部工具声明），诊断用。 */
function loadSentTransform() {
  const { omitSupersededReads } = tsxRequire('../../electron/agentLane/laneSupersededReads.mts', import.meta.url)
  const { modelFacingToolSpecs } = tsxRequire('../../electron/shared/agentCapabilities/modelFacingToolRegistry.ts', import.meta.url)
  const specs = modelFacingToolSpecs('internal')
  return (messages) => omitSupersededReads(messages, specs)
}

/** 经画布 store 的真动作布场景：44 个节点按 spec 顺序落画布（不选），再选中其中 40 个。返回带真 id 的场景。 */
export async function seedSelectionScene(win, spec = selectionSceneSpec()) {
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  const seeded = await win.evaluate((nodes) => {
    const store = () => window.__nomiCanvasStore.getState()
    if (store().nodes.length) return { error: `画布不是空的：已有 ${store().nodes.length} 个节点` }
    const ids = nodes.map((node, index) => store().addNode({
      kind: node.kind, title: node.title, select: false, exactPosition: true,
      position: { x: 80 + (index % 11) * 300, y: 120 + Math.floor(index / 11) * 380 },
      // 分镜的首帧图身份（与分镜落画布同一个标记）：读面里这一类节点的角色是「首帧图」。
      ...(node.role === 'first_frame' ? { meta: { storyboardKeyframe: true } } : {}),
    }).id)
    store().selectNodes(ids.filter((_, index) => nodes[index].selected))
    return { ids, storeIds: store().nodes.map((node) => node.id), storeSelected: [...store().selectedNodeIds] }
  }, spec)
  if (seeded.error) throw new Error(`布场景失败：${seeded.error}`)
  const scene = sceneFromIds(spec, seeded.ids)
  expect(seeded.storeIds, '画布上恰好是布的这些节点，顺序同布的顺序').toEqual(seeded.ids)
  expect(seeded.storeSelected, '选区恰好是该选的那一批，顺序同画布').toEqual([...scene.selectedIds])
  return scene
}

/** 每一轮发话前：选区设回那 40 个，并核对画布没被改过（节点一个不多一个不少）。返回此刻选中数。 */
async function reapplySelection(win, scene) {
  const state = await win.evaluate((selected) => {
    window.__nomiCanvasStore.getState().selectNodes(selected)
    const now = window.__nomiCanvasStore.getState()
    return { nodeIds: now.nodes.map((node) => node.id), selected: [...now.selectedNodeIds] }
  }, [...scene.selectedIds])
  const expected = scene.nodes.map((node) => node.id)
  if (state.nodeIds.join() !== expected.join()) throw new Error(`画布被改过：现在 ${state.nodeIds.length} 个节点，场景是 ${expected.length} 个`)
  if (state.selected.join() !== scene.selectedIds.join()) throw new Error(`选区设不回那 ${scene.selectedIds.length} 个（现在 ${state.selected.length} 个）`)
  return state.selected.length
}

/** 发一句话，并证明面板真的收下了它（输入框清空，或这一轮已经在跑）。 */
async function sendAccepted(win, text) {
  const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
  const running = win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await sendCanvas(win, text)
    const accepted = await expect.poll(async () => (await running.count()) > 0 || (await composerText(input).catch(() => '')).trim() === '',
      { timeout: DEFAULT_TIMEOUT_MS }).toBe(true).then(() => true, () => false)
    if (accepted) return attempt
  }
  throw new Error('composer 连发 3 次都没收下这句话')
}

async function stopTurn(win) {
  const stop = win.locator(`${CANVAS_PANEL} ${COMPOSER_STOP}`)
  if (await stop.count()) await stop.first().click().catch(() => {})
}

/**
 * 等这一轮落地：转录里最后一条助手消息不再停在工具调用上，且 composer 退出运行态。
 * 冒出任何介入卡（批准 / 反问 / 付费）都不替用户答——按停止结束这一轮，如实记下卡的种类。
 */
async function settleRound({ win, roundSessions, timeout = ROUND_TIMEOUT_MS, pollMs = 500 }) {
  const running = win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}`)
  const errorBar = win.locator(`${CANVAS_PANEL} ${ERROR_BAR}`)
  const facts = { interventions: [], stoppedByWalk: false, errorBar: null, timedOut: false }
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await card.count()) {
      const kind = (await card.first().getAttribute('data-kind').catch(() => null)) ?? 'unknown'
      if (!facts.interventions.includes(kind)) facts.interventions.push(kind)
      if (!facts.stoppedByWalk) { await stopTurn(win); facts.stoppedByWalk = true }
    }
    const isRunning = (await running.count()) > 0
    if (!isRunning && roundSettled(roundSessions())) return facts
    // 走查按了停止：composer 退出运行态、卡也收了，这一轮到此为止（转录可能停在工具调用上——那就是没有最终回答）。
    if (facts.stoppedByWalk && !isRunning && !(await card.count())) return facts
    if (!isRunning && Date.now() - started > 8_000 && (await errorBar.count())) {
      facts.errorBar = (await errorBar.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
      return facts
    }
    await win.waitForTimeout(pollMs)
  }
  facts.timedOut = true
  await stopTurn(win)
  return facts
}

/** 证据里的一次调用：工具名、模型写的原样参数、有没有被退回；look_at_canvas 另记结果里的「当前选中」行。 */
function callEvidence(call) {
  return {
    name: call.name, args: call.args, isError: call.isError,
    ...(call.name === LOOK_AT_CANVAS ? { selectionLines: selectionLinesOf(call.resultText) } : {}),
    ...(call.isError ? { errorText: String(call.resultText ?? '').slice(0, 300) } : {}),
    resultChars: String(call.resultText ?? '').length,
  }
}

function projectionLedgerFromTranscript(transcript, sessions) {
  const messages = sessions.flatMap((session) => laneMessages(session))
    .filter((message) => message.role === 'user' || message.role === 'nomi.input')
  const contextSnapshot = messages.find((message) => message.context?.contextSnapshot?.handles)?.context?.contextSnapshot
  if (contextSnapshot) {
    const projection = loadContextSnapshotProjector()(contextSnapshot)
    return { total: projection.total, listed: projection.listed, omitted: projection.omitted, truncated: projection.truncated }
  }
  const raw = [String(transcript.userTexts?.join('\n') ?? ''), ...messages.map((message) => JSON.stringify({ content: message.content, context: message.context }))].join('\n')
  const match = raw.replaceAll('\\"', '"').match(/"total":(\d+),"listed":(\d+)(?:,"omitted":(\d+))?/)
  if (!match) return undefined
  const total = Number(match[1])
  const listed = Number(match[2])
  const omitted = match[3] === undefined ? total - listed : Number(match[3])
  return { total, listed, omitted, truncated: listed < total }
}

/** 一轮：新对话 → 重设选区 → 发话 → 等落地 → 读这一轮新出现的转录 → 判分。量具自己出的错记在 harnessError，不算模型的。 */
export async function runSelectionRound({ win, projectRoot, scene, round, transform, ask = SELECTION_ASK, score = scoreSelectionRound, beforeSend = async () => {} }) {
  const record = { round, startedAt: new Date().toISOString(), harnessError: null }
  const startedAt = Date.now()
  const before = new Set(readLaneTranscripts(projectRoot).map((session) => session.path))
  const roundSessions = () => readLaneTranscripts(projectRoot).filter((session) => !before.has(session.path))
  try {
    await newConversation(win, CANVAS_PANEL)
    await expect(win.locator(`${CANVAS_PANEL} ${EMPTY_STATE}`), '新对话的空态').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const noShare = win.getByRole('button', { name: '不分享', exact: true }).first()
    if (await noShare.isVisible().catch(() => false)) await noShare.click()
    record.selectedBeforeSend = await reapplySelection(win, scene)
    const snapshot = await win.evaluate(() => JSON.parse(JSON.stringify(window.__nomiCanvasStore.getState().readSnapshot())))
    const projection = loadSnapshotProjector()(snapshot)
    record.projection = { total: projection.total, listed: projection.listed, omitted: projection.omitted, truncated: projection.truncated }
    await beforeSend({ record, scene, projection: record.projection })
    record.sendAttempts = await sendAccepted(win, ask)
    record.settle = await settleRound({ win, roundSessions })
  } catch (error) {
    record.harnessError = String(error?.message ?? error).split('\n')[0].slice(0, 300)
  }
  record.ms = Date.now() - startedAt
  const sessions = roundSessions()
  const transcript = roundTranscript(sessions)
  record.sessions = sessions.length
  record.models = transcript.models
  record.calls = transcript.calls.map(callEvidence)
  record.finalAnswer = transcript.finalAnswer
  if (transcript.assistantTexts.length > 1) record.assistantTexts = transcript.assistantTexts
  record.projection = projectionLedgerFromTranscript(transcript, sessions) ?? record.projection
  record.score = score({ scene, transcript, projection: record.projection })
  record.view = answerTimeView({ scene, sessions, transform })
  return record
}

/** 量具自己的问题（不是模型的）：哪一轮量具出了错、哪一轮答话的不是被授权的那个模型、哪一轮没落地。空 = 这一场的数可以用。 */
export function gaugeProblems(rounds, { expectedModelKey }) {
  const problems = []
  for (const record of rounds) {
    if (record.harnessError) problems.push(`第 ${record.round} 轮量具出错：${record.harnessError}`)
    if (record.settle?.timedOut) problems.push(`第 ${record.round} 轮超时没落地（已按停止）`)
    if (!record.sessions) problems.push(`第 ${record.round} 轮盘上没有新的 lane 转录`)
    const foreign = (record.models ?? []).filter((model) => !model.endsWith(`/${expectedModelKey}`))
    if (foreign.length) problems.push(`第 ${record.round} 轮答话的模型不是 ${expectedModelKey}：${foreign.join('、')}`)
  }
  return problems
}

/**
 * 整条旅程。`journey` 由调用方传入并就地填写：中途出错时调用方手里仍有已跑完的那几轮（证据照写）。
 * `beforeRound(round, scene)`：演练在这里给夹具大脑换剧本；真付费不传。
 */
export async function runSelectionJourney(journey, { walk, modelLabel, expectedModelKey, rounds, beforeRound = async () => {} }) {
  journey.rounds ??= []
  const { win } = await walk.start({ first: true })
  // 画布 store 的走查桥（localStorage.__nomiE2E，开项目之前置上）：布场景、设选区都走 store 的真动作。
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  const { projectRoot } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, modelLabel(), CANVAS_PANEL)
  const scene = await seedSelectionScene(win)
  const snapshot = await win.evaluate(() => JSON.parse(JSON.stringify(window.__nomiCanvasStore.getState().readSnapshot())))
  const facts = sceneProjectionFacts(scene, snapshot, loadProjector())
  const transform = loadSentTransform()
  const byKey = new Map(scene.nodes.map((node) => [node.key, node]))
  journey.scene = {
    nodes: scene.nodes.length, selected: scene.selectedIds.length, total: facts.total, markedSelected: facts.markedSelectedCount,
    groundTruth: groundTruthKeys(scene).map((key) => byKey.get(key).title),
    selectionLine: facts.selectionLine, distractorVideoTitles: facts.distractorVideoTitles,
    distractors: scene.nodes.filter((node) => !node.selected).map((node) => node.title),
    canvasOrder: scene.nodes.map(({ id, kind, title, selected }) => ({ id, kind, title, selected })),
    firstText: facts.firstText,
  }
  await walk.snap('00-scene-selected')
  const problems = sceneProblems(facts, scene)
  if (problems.length) throw new Error(`场景不成立，没有发话（一个 token 都没花）：\n  ${problems.join('\n  ')}`)
  for (let round = 1; round <= rounds; round += 1) {
    await beforeRound(round, scene)
    const record = await runSelectionRound({ win, projectRoot, scene, round, transform })
    journey.rounds.push(record)
    await walk.snap(`r${round}-answer`).catch(() => {})
    const { score, view } = record
    console.log(`[selection] 第 ${round} 轮 ${Math.round(record.ms / 1000)}s：look_at_canvas ${score.legalCalls}/${score.lookAtCanvasCalls} 合法 · 读到选区 ${score.selectionRead}/${score.selectionTotal} · 答话时眼里 ${view?.selectedIdsVisible ?? '-'}/${score.selectionTotal} · 少列 ${score.missing.length} · 多列 ${score.extra.length} · 成功=${score.success}${record.harnessError ? ` · 量具错=${record.harnessError}` : ''}`)
  }
  journey.numbers = {
    ...summarizeSelectionRounds(journey.rounds),
  }
  journey.gaugeProblems = gaugeProblems(journey.rounds, { expectedModelKey })
  journey.canvasIntactAfter = await win.evaluate(() => window.__nomiCanvasStore.getState().nodes.length)
  return journey
}

/**
 * 证据摘要写进仓库（docs/evidence/…/paid/<fileName>）。落盘前最后一道：内容里不许有 key 原串（环境变量里那把 + 调用方给的），
 * 也不许有形如 key 的串（真实资料那条路不读 key，原串无从比对，就按形状拦）。命中就不写、抛错。返回写下的相对路径。
 */
export function writeSelectionEvidence(fileName, report, { secrets = [] } = {}) {
  const text = `${JSON.stringify(report, null, 2)}\n`
  for (const secret of [envKeyOf(process.env), ...secrets]) {
    if (secret && secret.length >= 8 && text.includes(secret)) throw new Error('证据里出现了 key 原串，拒绝写入仓库——请更换这把 key')
  }
  if (KEY_SHAPED.test(text)) throw new Error('证据里有形如 key 的串（sk-… / Bearer …），拒绝写入仓库')
  fs.mkdirSync(SELECTION_EVIDENCE_DIR, { recursive: true })
  const file = path.join(SELECTION_EVIDENCE_DIR, fileName)
  fs.writeFileSync(file, text)
  return path.relative(REPO_ROOT, file)
}

/** 证据摘要的公共部分（两边同一份形状）。 */
export function selectionEvidence({ script, mode, startedAt, journey, walk, failure, model }) {
  return {
    script, mode, startedAt, finishedAt: new Date().toISOString(),
    result: failure ? 'failed' : 'passed',
    failure: failure ? String(failure?.message ?? failure).slice(0, 2000) : null,
    buildMarker: SELECTION_MARKER,
    model, ask: SELECTION_ASK, promptBank: SELECTION_PROMPTS, metrics: SELECTION_METRICS, diagnostics: SELECTION_DIAGNOSTICS,
    numbers: journey.numbers ?? null,
    gaugeProblems: journey.gaugeProblems ?? null,
    canvasNodesAfter: journey.canvasIntactAfter ?? null,
    scene: journey.scene ?? null,
    rounds: journey.rounds ?? [],
    spend: { text: walk.report.spend?.text ?? null, mediaCalls: walk.report.spend?.media?.length ?? null },
    networkBlocked: walk.report.networkBlocked ?? [],
    walkOutputDir: walk.report.outputDir ? path.relative(REPO_ROOT, walk.report.outputDir) : null,
  }
}
