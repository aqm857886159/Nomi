// 「Agent 接着说下一句时，付费卡只摆还没定的镜」整条旅程的步骤本体，唯一一份。
// 真付费走查（agent-shot-scope-real.paid.mjs）与零花费演练（agent-shot-scope-real.rehearsal.walk.mjs）都只调它：
// 差别只在大脑（真付费是 App 里配好的真模型，演练是夹具里写好剧本的那个）和「供应商几个任务」从哪读。
//
// 流程（真 Electron、真 IPC、真 Agent lane、真付费卡）：
//   接入 → 开项目 → 开画布 → 选对话模型 → 权限档选「请求批准」→ 一场对话 8 个回合（量具表见 _agentShotScopeScore.mjs 的 TURNS）。
//   每个回合：在画布的 Agent 输入框打字发出 → 等「出卡」或「落地」→ 从盘上的 lane 转录读这一回合的工具调用（不信面板文字），
//   卡上指着哪几个节点从界面读，再对账出价账与卡的投影 → 判硬断言（宿主和钱）、打分（模型写得对不对）。
//   整场只在 T4 按一次「生成」，卡上去掉别的镜，只花 1 张图；T8 之后取消那张卡，再等一段，数供应商任务数仍是 1。
//
// 卡待决时用户打字 = 那句话就是对这张卡的回答（这一次出价收回，没定的镜留在账上），所以 T2–T8 里大多是「在上一张卡还开着时说下一句」；
// T4 例外（T3 之后卡已经收了，T4 是一个新回合）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { require as tsxRequire } from 'tsx/cjs/api'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { envKeyOf } from './_paidEnvKey.mjs'
import { readProductionRuns, spendReceipt } from './_paidRun.mjs'
import { readLaneSpend } from './_laneSpendProbe.mjs'
import { CARD_PRIMARY, CARD_TITLE, SPEND_CARD, armCanvasBridges, cardFacts, excludeShot, nodeMeta, pointerAway } from './_spendCardWalk.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { readLaneTranscripts } from './agent-lane-observer.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_INPUT, COMPOSER_PERMISSION, COMPOSER_STOP, ERROR_BAR,
  chooseAssistantModel, closeSpendCard, composerText, openCanvas, permissionTier, sendCanvas,
} from './agent-runtime-walk-support.mjs'
import {
  GENERATE, SHOT_SCOPE_METRICS, TURNS,
  callEvidence, expectedUnnamedScope, gaugeProblems, judgeCardAgreement, judgeGenerateCall, judgeSpend, namedAgainBy, namedShotIds,
  scoreTurn, shotKey, spendGateProblems, summarizeTurns, transcriptFacts, vendorTaskCount,
} from './_agentShotScopeScore.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SHOT_SCOPE_EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-10-27-shot-scope-undecided')
const KEY_SHAPED = /\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i

/** T8 之后再等多久、看供应商任务数还是不是 1。 */
export const HOLD_SECONDS = 60
/** 一个回合的安全上限（不是完成条件：完成看「出卡」或「转录里最后一条助手消息落地」）。 */
const TURN_MS = stationTimeout({ turns: 2 })

/** 产品自己的出价账读口（事实的唯一出处，量具用它复述宿主的规则，不另抄一份「什么叫还没定」）。 */
function loadPresentationReaders() {
  return tsxRequire('../../electron/shared/productionGenerationPresentation.ts', import.meta.url)
}

const presentationIdOf = (run, presentation, index) => presentation.presentationId ?? `${run.runId}:presentation:${index + 1}`
const relativeToRepo = (file) => (file ? path.relative(REPO_ROOT, file) : null)

/** 证据文本落进仓库前最后一道：不许有 key 原串（环境变量里那把 + 调用方给的），也不许有形如 key 的串。命中就抛错。 */
export function assertEvidenceHasNoKey(text, secrets = []) {
  for (const secret of [envKeyOf(process.env), ...secrets]) {
    if (secret && secret.length >= 8 && text.includes(secret)) throw new Error('证据里出现了 key 原串，拒绝写入仓库——请更换这把 key')
  }
  if (KEY_SHAPED.test(text)) throw new Error('证据里有形如 key 的串（sk-… / Bearer …），拒绝写入仓库')
}

/** 证据摘要写进仓库（docs/evidence/…/<paid|rehearsal>/report.json）。落盘前过 assertEvidenceHasNoKey。返回写下的相对路径。 */
export function writeShotScopeEvidence(relativeFile, report, { secrets = [] } = {}) {
  // 公开仓库：证据里不留本机路径（错误信息里偶尔带着工作树 / 家目录的绝对路径）。
  const text = `${JSON.stringify(report, null, 2)}\n`.split(REPO_ROOT).join('<repo>').split(os.homedir()).join('~')
  assertEvidenceHasNoKey(text, secrets)
  const file = path.join(SHOT_SCOPE_EVIDENCE_DIR, relativeFile)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return path.relative(REPO_ROOT, file)
}

/** 证据摘要的公共部分（两边同一份形状）。 */
export function shotScopeEvidence({ script, mode, startedAt, journey, walk, failure, model, image, buildMarker }) {
  return {
    script, mode, startedAt, finishedAt: new Date().toISOString(),
    result: failure ? 'failed' : 'passed',
    failure: failure ? String(failure?.message ?? failure).slice(0, 4000) : null,
    buildMarker, model, image,
    metrics: SHOT_SCOPE_METRICS,
    numbers: journey.numbers ?? null,
    hard: { checks: journey.hard?.length ?? 0, failures: (journey.hard ?? []).filter((entry) => !entry.ok) },
    gaugeProblems: journey.gaugeProblems ?? null,
    spend: journey.spend ?? null,
    turns: journey.turns ?? [],
    notes: journey.notes ?? [],
    brain: { text: walk.report.spend?.text ?? null, mediaCalls: walk.report.spend?.media?.length ?? null },
    networkBlocked: walk.report.networkBlocked ?? [],
    walkOutputDir: relativeToRepo(walk.report.outputDir),
  }
}

/**
 * 整条旅程。`journey` 由调用方传入并就地填写：中途出错时调用方手里仍有已跑完的那几个回合（证据照写）。
 * @param {object} journey
 * @param {{ walk: any, paid: any, brainLabel: () => string, expectedModelKey: string, image: { vendorKey: string, modelKey: string },
 *   vendorTasks: () => { creates: number, recorderAlive: boolean }, holdSeconds?: number }} options
 *   image：被授权的那一个图片模型（花钱前核对要保留的那一镜用的就是它）；
 *   vendorTasks：供应商那边收到了几个图片创建请求（真付费读网络闸账本，演练读夹具）。
 */
export async function runShotScopeJourney(journey, { walk, paid, brainLabel, expectedModelKey, image, vendorTasks, holdSeconds = HOLD_SECONDS }) {
  journey.turns ??= []
  journey.hard ??= []
  journey.notes ??= []
  const readers = loadPresentationReaders()
  const { win } = await walk.start({ first: true })
  // 画布 store / 对话投影的只读 E2E 桥（localStorage.__nomiE2E，开项目之前置上再重载一次）：读卡的投影、节点上的提示词都走它。
  await armCanvasBridges(win)
  await paid.lockToAuthorizedModels(win)
  const { projectRoot } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, brainLabel(), CANVAS_PANEL)
  const noShare = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await noShare.isVisible().catch(() => false)) await noShare.click()
  // 第一句话之前先把权限档钉在「请求批准」：这一档下 generate 一定先摆卡，花钱只有人点了才发生。
  const panel = win.locator(CANVAS_PANEL)
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), '权限档选择器')
  await clickOrFail(panel.locator(permissionTier('request')), '权限档选回「请求批准」')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'request')

  const card = win.locator(SPEND_CARD)
  const runsOnDisk = () => readProductionRuns(projectRoot)
  // Agent 起草的草稿（origin.host = nomi）。卡「生成」交给画布的那一镜另有一份画布单镜 Run（origin.host = canvas），它自己也带一条出价，
  // 不是 Agent 摆给用户的卡，不能算进「这一回合摆出了新卡」。
  const agentRuns = () => runsOnDisk().filter((run) => run.generationPlan && run.origin?.host === readers.IN_APP_AGENT_ORIGIN_HOST)
  const draftRuns = () => agentRuns().filter((run) => run.generationPlan.presentations?.length)
  const check = (turn, id, ok, detail) => { journey.hard.push({ turn, id, ok, detail }); return ok }
  const pendingRows = async () => {
    const read = await readLaneSpend(win)
    return read?.surface === 'ready' ? read.rows : []
  }
  const canvasPrompts = () => win.evaluate(() => Object.fromEntries((window.__nomiCanvasStore?.getState().nodes ?? [])
    .filter((node) => node.meta?.productionRunId && node.meta?.productionShotId)
    .map((node) => [`${node.meta.productionRunId}/${node.meta.productionShotId}`, node.prompt ?? ''])))
  /** 画布上每一镜自己的节点（读画布 store，不经卡的投影）：`操作号/镜号` → 节点 id。 */
  const canvasNodeIds = () => win.evaluate(() => (window.__nomiCanvasStore
    ? Object.fromEntries(window.__nomiCanvasStore.getState().nodes
      .filter((node) => node.meta?.productionRunId && node.meta?.productionShotId)
      .map((node) => [`${node.meta.productionRunId}/${node.meta.productionShotId}`, node.id]))
    : null))
  const presentationById = (operationId, presentationId) => {
    const run = draftRuns().find((candidate) => candidate.runId === operationId)
    return run?.generationPlan.presentations.find((presentation, index) => presentationIdOf(run, presentation, index) === presentationId)
  }

  /** 此刻盘上账本、转录、计划里的镜：下一回合判「新出现了什么」的基线，也是不点名 generate 的规则要对着的「这一回合开始之前」的事实。 */
  function snapshotKnown() {
    const facts = transcriptFacts(readLaneTranscripts(projectRoot))
    const runs = runsOnDisk()
    return {
      callIds: new Set(facts.calls.map((call) => call.id)),
      finals: facts.finals,
      textCount: facts.texts.length,
      presentationIds: new Set(draftRuns().flatMap((run) => run.generationPlan.presentations.map((presentation, index) => presentationIdOf(run, presentation, index)))),
      // 单镜草稿（旧形态）没有 shots[]，它那一镜的 id 是顶层候选的 id：读计划的镜号只走产品自己的读口。
      shotKeys: new Set(agentRuns().flatMap((run) => readers.planShotIds(run.generationPlan).map((shotId) => shotKey(run.runId, shotId)))),
      runsById: new Map(runs.map((run) => [run.runId, run])),
    }
  }

  const freshPresentations = (knownIds) => draftRuns().flatMap((run) => run.generationPlan.presentations
    .map((presentation, index) => ({ run, presentation, id: presentationIdOf(run, presentation, index) })))
    .filter((entry) => !knownIds.has(entry.id))
    .sort((left, right) => String(left.presentation.openedAt).localeCompare(String(right.presentation.openedAt)))

  async function sendAccepted(text) {
    const input = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
    const running = win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await sendCanvas(win, text)
      const taken = await expect.poll(async () => (await running.count()) > 0 || (await composerText(input).catch(() => '')).trim() === '',
        { timeout: DEFAULT_TIMEOUT_MS }).toBe(true).then(() => true, () => false)
      if (taken) return attempt
    }
    throw new Error('composer 连发 3 次都没收下这句话')
  }

  async function stopTurn() {
    const stop = win.locator(`${CANVAS_PANEL} ${COMPOSER_STOP}`)
    if (await stop.count()) await stop.first().click().catch(() => {})
  }

  /**
   * 这一回合在等什么：出了一张新卡（账本里多了一次出价）/ 这一轮说完了（转录里多了一条停在文字上的助手消息，composer 退出运行态）/
   * 冒出别的介入卡（批准 / 反问）——不替用户答，按停止 / 面板报错 / 超时。
   */
  async function observeTurn(label, before) {
    const errorBar = win.locator(`${CANVAS_PANEL} ${ERROR_BAR}`)
    const running = win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)
    const strangers = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}:not([data-kind="spend"])`)
    const watchedAt = Date.now()
    let outcome = { kind: 'timeout' }
    try {
      await expect.poll(async () => {
        const fresh = freshPresentations(before.presentationIds)
        if (fresh.length) { outcome = { kind: 'card', fresh }; return 'card' }
        if (await strangers.count()) {
          outcome = { kind: 'intervention', text: (await strangers.first().getAttribute('data-kind').catch(() => null)) ?? 'unknown' }
          return 'intervention'
        }
        const idle = (await running.count()) === 0
        const facts = transcriptFacts(readLaneTranscripts(projectRoot))
        if (idle && facts.finals > before.finals && facts.settled) { outcome = { kind: 'settled' }; return 'settled' }
        if (idle && Date.now() - watchedAt > 8_000 && (await errorBar.count())) {
          outcome = { kind: 'error', text: (await errorBar.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300) }
          return 'error'
        }
        return 'waiting'
      }, { message: `${label}：既没出卡也没落地`, timeout: TURN_MS, intervals: [500] }).not.toBe('waiting')
    } catch {
      outcome = { kind: 'timeout' }
    }
    if (outcome.kind === 'timeout' || outcome.kind === 'intervention') await stopTurn()
    return outcome
  }

  /** 摆在用户面前的那张卡：账（出价账）、卡的投影（宿主推给面板的那一份）、界面（指向元素）三处读到的镜与节点。 */
  async function readVisibleCard(entry) {
    const operationId = entry.run.runId
    const result = { operationId, presentationId: entry.id, ledgerShotIds: [...entry.presentation.shotIds], projectionShotIds: null, pointerShotIds: null, pointerNodeIds: [], nodeOfShot: {}, title: null, confirm: null }
    let row
    const projected = await expect.poll(async () => {
      row = (await pendingRows()).find((candidate) => candidate.operationId === operationId && (candidate.presentationId ?? entry.id) === entry.id)
      return Boolean(row)
    }, { message: `${operationId}：宿主的卡投影里没有这次出价`, timeout: stationTimeout({ operations: 4 }) }).toBe(true).then(() => true, () => false)
    if (projected) {
      result.projectionShotIds = row.shots.map((shot) => shot.shotId)
      result.nodeOfShot = Object.fromEntries(row.shots.filter((shot) => shot.nodeId).map((shot) => [shot.shotId, shot.nodeId]))
    }
    await expect(card.locator(CARD_TITLE), `${operationId}：卡出现在介入槽里`).toBeVisible({ timeout: stationTimeout({ operations: 4 }) }).catch(() => undefined)
    // 指向元素是卡按投影渲染出来的：等它和投影说的节点一致再读（超时不抛，不一致本身就是硬断言要报的事）。
    const wantedNodes = Object.values(result.nodeOfShot).sort().join()
    await expect.poll(async () => ((await cardFacts(win))?.pointers ?? []).map((pointer) => pointer.id).sort().join(),
      { message: `${operationId}：界面指向的节点和卡的投影对不上`, timeout: stationTimeout({ operations: 2 }) }).toBe(wantedNodes).catch(() => undefined)
    await pointerAway(win)
    const facts = await cardFacts(win)
    result.pointerNodeIds = (facts?.pointers ?? []).map((pointer) => pointer.id)
    const shotOfNode = new Map(Object.entries(result.nodeOfShot).map(([shotId, nodeId]) => [nodeId, shotId]))
    result.pointerShotIds = result.pointerNodeIds.map((nodeId) => shotOfNode.get(nodeId) ?? `?节点 ${nodeId}`)
    // 画布 store 的桥没挂上（null）就不核节点本身，只核镜；挂上了就读不到的镜不算它的节点。
    const nodeIndex = await canvasNodeIds().catch(() => null)
    result.storeNodeIds = nodeIndex ? result.ledgerShotIds.map((shotId) => nodeIndex[shotKey(operationId, shotId)]).filter(Boolean) : undefined
    result.title = facts?.title ?? null
    result.confirm = facts?.confirm?.text ?? null
    return result
  }

  /** 不点名 generate 的规则要对着的事实：这份草稿在「这一回合开始之前」的出价账；这一回合才起草的草稿，之前没有出价。 */
  function oracleFactsOf(operationId, before) {
    const existing = before.runsById.get(operationId)
    const run = existing?.generationPlan ? existing : runsOnDisk().find((candidate) => candidate.runId === operationId)
    if (!run?.generationPlan) return null
    const plan = run.generationPlan
    const planShotIds = readers.planShotIds(plan)
    const includedShotIds = planShotIds.filter((shotId) => plan.shots?.find((shot) => shot.shotId === shotId)?.included !== false)
    if (!existing?.generationPlan) return { planShotIds, includedShotIds, hasOffer: false, undecided: [], standing: includedShotIds, sent: [] }
    const outcome = readers.generationPresentationOutcome(run)
    return {
      planShotIds, includedShotIds,
      hasOffer: Boolean(outcome),
      undecided: outcome ? outcome.undecided.map((entry) => entry.shotId) : [],
      standing: readers.standingShotIds(run),
      sent: planShotIds.filter((shotId) => readers.shotEverSent(run, shotId)),
    }
  }

  let primary = null

  /** T1 的起草核对：不是一份 3 镜的草稿就在花钱前停下（一分钱没花，卡已关）。 */
  async function afterFirstCard(record, cardRead) {
    const run = runsOnDisk().find((candidate) => candidate.runId === cardRead.operationId)
    const shots = (run?.generationPlan?.shots ?? []).filter((shot) => shot.included !== false)
    const shotIds = shots.map((shot) => shot.shotId)
    primary = { operationId: cardRead.operationId, shotIds }
    record.draft = { operationId: cardRead.operationId, shotIds, prompts: shots.map((shot) => shot.candidate?.prompt ?? null) }
    if (shotIds.length !== 3) {
      await closeSpendCard(card, '起草不符，关卡不花钱').catch(() => undefined)
      throw Object.assign(new Error(`起草不符，一分钱没花（卡已关）：T1 起草出来的草稿是 ${shotIds.length} 镜（${shotIds.join(', ') || '无'}），应是 3 镜`), { stopJourney: true })
    }
  }

  /**
   * T4：整场唯一一次真花钱。卡上要生效的只有一镜（有别的镜就先「不生成 ×」去掉），花钱前再核一遍那一镜的参数，才按主按钮。
   * 保留的镜优先是 T1 的第一镜；模型没把它摆上卡就保留卡上第一个（只多花这一张），后面的回合照常按账本里的事实判。
   */
  async function spendOnlyOne(record, cardRead) {
    const keeperShotId = cardRead.pointerShotIds.includes(primary.shotIds[0]) ? primary.shotIds[0] : cardRead.pointerShotIds[0]
    const keeperNodeId = cardRead.nodeOfShot[keeperShotId]
    if (!keeperNodeId) {
      await closeSpendCard(card, 'T4 的卡上没有可按的镜，关卡不花钱').catch(() => undefined)
      throw Object.assign(new Error('T4 前置不成立，一分钱没花（卡已关）：卡上没有任何一个指向节点的镜'), { stopJourney: true })
    }
    const shotOfNode = new Map(Object.entries(cardRead.nodeOfShot).map(([shotId, nodeId]) => [nodeId, shotId]))
    const others = cardRead.pointerNodeIds.filter((nodeId) => nodeId !== keeperNodeId)
    for (const nodeId of others) await excludeShot(card, nodeId, `T4：去掉卡上多出来的一镜（${shotOfNode.get(nodeId)}）`)
    const removed = () => (presentationById(cardRead.operationId, cardRead.presentationId)?.removed ?? []).map((entry) => entry.shotId)
    await expect.poll(() => [...removed()].sort().join(), { message: 'T4：去掉的镜记进了出价账', timeout: stationTimeout({ operations: 4 }) })
      .toBe(others.map((nodeId) => shotOfNode.get(nodeId)).sort().join())
    const effective = cardRead.ledgerShotIds.filter((shotId) => !removed().includes(shotId))
    const run = runsOnDisk().find((candidate) => candidate.runId === cardRead.operationId)
    const shotCandidate = run?.generationPlan?.shots?.find((shot) => shot.shotId === keeperShotId)?.candidate
    const candidateParams = shotCandidate?.parameters ?? {}
    const meta = await nodeMeta(win, keeperNodeId).catch(() => null)
    const problems = spendGateProblems({
      effectiveShotIds: effective, candidate: { providerId: shotCandidate?.providerId, modelId: shotCandidate?.modelId },
      candidateParams, meta: meta ?? {}, authorized: image,
    })
    record.spendGate = {
      keeperShotId, excluded: others.map((nodeId) => shotOfNode.get(nodeId)), effective, problems, candidateParams,
      candidateModel: `${shotCandidate?.providerId}/${shotCandidate?.modelId}`, nodeModel: meta ? `${meta.modelVendor}/${meta.modelKey}` : null, nodeResolution: meta?.resolution ?? null,
    }
    if (problems.length) {
      await closeSpendCard(card, '花钱前核对不过，关卡不花钱').catch(() => undefined)
      throw Object.assign(new Error(`付费前拦下（一分钱没花，卡已关）：${problems.join('；')}`), { stopJourney: true })
    }
    await pointerAway(win)
    const shot = await walk.snap('t4-before-the-one-press').catch(() => null)
    if (shot && await card.isVisible().catch(() => false)) await card.screenshot({ path: shot.replace(/\.png$/, '-card.png') }).catch(() => undefined)
    const probe = await proveProbe(card, 'T4：去掉了多余镜头的那张卡')
    // 基线要在点之前取：点下去 generate 马上带着结局回给模型，模型的收尾话可能在我们取基线之前就落盘了。
    const baseline = snapshotKnown()
    const pressedAt = new Date().toISOString()
    await clickOrFail(card.locator(CARD_PRIMARY), 'T4：卡上的主按钮（真花钱，一张）', { noWaitAfter: true })
    await expectAbsent(card, { provenBy: probe, message: 'T4：交给画布之后卡关掉' }, stationTimeout({ operations: 4 }))
    return { spend: { pressedAt, keeperShotId, shotsApproved: effective.length }, baseline }
  }

  /** T4 交给画布的那一笔要等它有结论（交到了 / 没发出去 / 结果未知）再往下走：后面每个回合的「已送出」都读它。 */
  async function waitHandOverSettled(record, operationId) {
    const outcomes = () => (draftRuns().find((run) => run.runId === operationId)?.generationPlan.presentations ?? [])
      .flatMap((presentation) => presentation.handOvers ?? []).map((entry) => entry.settled?.outcome ?? 'pending')
    await expect.poll(() => outcomes().length > 0 && outcomes().every((outcome) => outcome !== 'pending'),
      { message: 'T4：交给画布的那一镜有结论', timeout: stationTimeout({ operations: 8 }) }).toBe(true).catch(() => undefined)
    record.spend.handOverOutcomes = outcomes()
  }

  /** 这一回合每一次 generate 的宿主表现：硬断言。 */
  function judgeCalls(turnId, record, before, freshCalls, freshOffers, cardRead) {
    let nextOffer = 0
    for (const call of freshCalls.filter((candidate) => candidate.name === GENERATE)) {
      const operationId = typeof call.args?.operationId === 'string' ? call.args.operationId : primary?.operationId
      let outcome
      if (call.isError === true) outcome = { kind: 'refused', text: call.resultText ?? '' }
      else {
        const entry = freshOffers[nextOffer]
        nextOffer += 1
        if (!entry) { (record.notes ??= []).push(`generate ${call.id} 被收下，但账本里没有对应的新出价`); continue }
        const visible = Boolean(cardRead) && cardRead.presentationId === entry.id
        outcome = { kind: 'card', ledgerShotIds: [...entry.presentation.shotIds], ...(visible ? { pointerShotIds: cardRead.pointerShotIds, projectionShotIds: cardRead.projectionShotIds } : {}) }
        if (visible) {
          const agreement = judgeCardAgreement({
            ledgerShotIds: outcome.ledgerShotIds, pointerShotIds: cardRead.pointerShotIds, projectionShotIds: cardRead.projectionShotIds ?? [],
            pointerNodeIds: cardRead.pointerNodeIds, storeNodeIds: cardRead.storeNodeIds,
          })
          check(turnId, agreement.id, agreement.ok, agreement.detail)
        }
      }
      const facts = oracleFactsOf(operationId, before)
      if (!facts) { (record.notes ??= []).push(`generate ${call.id} 指的草稿 ${operationId} 不在账上，没法对规则`); continue }
      const unnamed = namedShotIds(call.args) === undefined
      const expected = unnamed ? expectedUnnamedScope(facts) : []
      for (const result of judgeGenerateCall({ call, outcome, expected, sent: facts.sent })) {
        // 红的时候顺带写明：那一镜是不是被更早的点名重新摆上卡的（只给协调归因，不改判红与否）。
        const spentAt = journey.turns.findIndex((entry) => entry.spend)
        const by = !result.ok && result.leaked ? namedAgainBy(spentAt < 0 ? [] : journey.turns.slice(spentAt + 1), result.leaked) : []
        const attribution = by.length ? `；这一镜在送出之后被点名重新摆上过卡：${by.join('、')}` : ''
        check(turnId, result.id, result.ok, `${call.id}（${unnamed ? '不点名' : `点名 ${namedShotIds(call.args).join(', ')}`}）：${result.detail}${attribution}`)
      }
    }
  }

  async function playTurn(turn) {
    const record = { turn: turn.id, ask: turn.ask, startedAt: new Date().toISOString(), harnessError: null, settle: null }
    const before = snapshotKnown()
    let cardRead = null
    try {
      record.sendAttempts = await sendAccepted(turn.ask)
      let outcome = await observeTurn(turn.id, before)
      record.settle = outcome.kind
      if (outcome.kind === 'error' || outcome.kind === 'intervention') record.harnessError = `${outcome.kind}：${outcome.text}`
      if (outcome.kind === 'card') {
        cardRead = await readVisibleCard(outcome.fresh.at(-1))
        if (turn.id === 'T1') await afterFirstCard(record, cardRead)
        record.screenshot = relativeToRepo(await walk.snap(`${turn.id.toLowerCase()}-card`).catch(() => null))
        if (record.screenshot && await card.isVisible().catch(() => false)) {
          await card.screenshot({ path: path.join(REPO_ROOT, record.screenshot.replace(/\.png$/, '-card.png')) }).catch(() => undefined)
        }
        if (turn.id === 'T4') {
          const pressed = await spendOnlyOne(record, cardRead)
          record.spend = pressed.spend
          outcome = await observeTurn(`${turn.id}（按了生成之后）`, pressed.baseline)
          record.settleAfterPress = outcome.kind
          await waitHandOverSettled(record, cardRead.operationId)
        }
      }
    } catch (error) {
      record.harnessError = String(error?.message ?? error).split('\n')[0].slice(0, 400)
      if (error?.stopJourney) record.stopJourney = record.harnessError
    }

    // ── 这一回合新出现的工具调用、新摆出的卡 ─────────────────────────────────────
    const after = snapshotKnown()
    const facts = transcriptFacts(readLaneTranscripts(projectRoot))
    const freshCalls = facts.calls.filter((call) => !before.callIds.has(call.id))
    const freshOffers = freshPresentations(before.presentationIds)
    record.calls = freshCalls.map(callEvidence)
    record.card = cardRead && {
      operationId: cardRead.operationId, presentationId: cardRead.presentationId, ledgerShotIds: cardRead.ledgerShotIds,
      projectionShotIds: cardRead.projectionShotIds, pointerShotIds: cardRead.pointerShotIds, pointerNodeIds: cardRead.pointerNodeIds, storeNodeIds: cardRead.storeNodeIds, title: cardRead.title, confirm: cardRead.confirm,
    }
    record.offers = freshOffers.map((entry) => ({ operationId: entry.run.runId, presentationId: entry.id, shotIds: entry.presentation.shotIds }))
    // 这一回合模型自己说的话（回合没达标时，看得出它在问什么、在拒绝里说了什么）。
    record.assistantSaid = facts.texts.slice(before.textCount).map((text) => text.slice(0, 400))

    // ── 硬断言：宿主摆什么 ───────────────────────────────────────────────────────
    judgeCalls(turn.id, record, before, freshCalls, freshOffers, cardRead)
    record.hard = journey.hard.filter((entry) => entry.turn === turn.id)

    // ── 打分：模型写得对不对 ─────────────────────────────────────────────────────
    if (primary) {
      const prompts = await canvasPrompts().catch(() => ({}))
      const newShots = [...after.shotKeys].filter((key) => !before.shotKeys.has(key)).map((key) => ({ operationId: key.slice(0, key.indexOf('/')), shotId: key.slice(key.indexOf('/') + 1) }))
      record.score = scoreTurn(turn.id, { calls: freshCalls, card: cardRead && { operationId: cardRead.operationId, shotIds: cardRead.pointerShotIds }, primary, prompts, newShots })
      if (turn.id === 'T7') record.prompts = prompts
      if (turn.id === 'T8') record.newShots = newShots
    }
    return record
  }

  const describe = (record) => {
    const calls = (record.calls ?? []).map((call) => {
      const named = call.name === GENERATE ? namedShotIds(call.args) : undefined
      return `${call.name}${call.name === GENERATE ? (named ? `[${named.join(',')}]` : '[不点名]') : ''}${call.isError ? '✗' : ''}`
    }).join(' → ') || '无'
    const score = record.score
    return `[shot-scope] ${record.turn} · ${record.settle}${record.settleAfterPress ? `→${record.settleAfterPress}` : ''} · 调用 ${calls}`
      + ` · 卡 ${record.card ? `${record.card.operationId.slice(-6)}/${(record.card.pointerShotIds ?? []).join(',')}` : '无'}`
      + `${score ? ` · 写对=${score.toolWriteCorrect} 成功=${score.turnSuccess}${score.route ? ` 路线=${score.route}` : ''}` : ''}`
      + ` · 硬断言 ${(record.hard ?? []).filter((entry) => entry.ok).length}/${(record.hard ?? []).length}${record.harnessError ? ` · 量具错=${record.harnessError}` : ''}`
  }

  try {
    // ═══════════════ 8 个回合 ═══════════════
    for (const turn of TURNS) {
      const record = await playTurn(turn)
      journey.turns.push(record)
      console.log(describe(record))
      if (record.stopJourney) throw new Error(record.stopJourney)
      if (turn.id === 'T1' && (record.harnessError || !record.card)) throw new Error(`T1 没走通，后面的回合没有意义（一分钱没花）：${record.harnessError ?? '没有出卡'}`)
    }

    // ═══════════════ T8 之后：收场、等出图、再等一段，三方对账 ═══════════════
    if (journey.turns.at(-1)?.settle === 'card') {
      const proof = await proveProbe(card, '收场：T8 的卡还在')
      const closing = snapshotKnown()
      await closeSpendCard(card, '收场：取消 T8 的卡（不花钱）')
      await expectAbsent(card, { provenBy: proof, message: '收场：T8 的卡退出介入槽' }, stationTimeout({ operations: 2 }))
      await observeTurn('收场', closing)
    }
    const landed = () => runsOnDisk().flatMap((run) => run.jobs ?? []).filter((job) => job.status === 'ready' || job.status === 'adopted').length
    await expect.poll(landed, { message: 'T4 那一张真的出图', timeout: stationTimeout({ operations: 20 }) }).toBe(1).catch((error) => {
      journey.notes.push(`T4 那一张在等待上限内没有落地：${String(error?.message ?? error).split('\n')[0]}`)
    })
    const hold = { seconds: holdSeconds, vendor: [], receipt: [] }
    for (let second = 1; second <= holdSeconds; second += 1) {
      await win.waitForTimeout(1_000)
      const sample = spendReceipt(projectRoot)
      hold.vendor.push(vendorTaskCount({ wireCreates: vendorTasks().creates, providerTaskIds: [...new Set(sample.media.map((entry) => entry.taskId).filter(Boolean))] }))
      hold.receipt.push(sample.media.length)
    }
    const receipt = spendReceipt(projectRoot)
    const wire = vendorTasks()
    const providerTaskIds = [...new Set(receipt.media.map((entry) => entry.taskId).filter(Boolean))]
    const approved = draftRuns().flatMap((run) => run.generationPlan.presentations.flatMap((presentation) => presentation.handOvers ?? []))
      .filter((entry) => entry.settled?.outcome !== 'withdrawn').length
    // 「供应商几个任务」= 网络闸 / 夹具里记到的图片创建请求数 与 供应商给的任务号数 里取大的：记录器漏记时任务号兜底，不会少数。
    const vendorCount = vendorTaskCount({ wireCreates: wire.creates, providerTaskIds })
    journey.spend = {
      cardApproved: approved, receiptMedia: receipt.media.length, vendorTasks: vendorCount,
      vendorTasksFrom: { wireCreates: wire.creates, wireRecorderSawAnyRequest: wire.recorderAlive, providerTaskIds: providerTaskIds.length, rule: '取大的' },
      providerTaskIds,
      receiptEntries: receipt.media.map(({ source, engine, vendor, model, status, taskId }) => ({ source, engine, vendor, model, status, taskId })),
      hold: { seconds: hold.seconds, samples: hold.vendor.length, vendorSeen: [...new Set(hold.vendor)], receiptSeen: [...new Set(hold.receipt)] },
    }
    for (const result of judgeSpend({ approved, receiptMedia: receipt.media.length, vendorTasks: vendorCount, providerTaskIds, hold })) {
      check('spend', result.id, result.ok, result.detail)
    }
  } finally {
    journey.numbers = summarizeTurns(journey.turns)
    let models = []
    try { models = transcriptFacts(readLaneTranscripts(projectRoot)).models } catch { /* 转录读不出来就不查模型，上面的量具错会说明 */ }
    journey.gaugeProblems = gaugeProblems(journey.turns, { models, expectedModelKey })
    journey.hardFailures = journey.hard.filter((entry) => !entry.ok).map((entry) => `${entry.turn} · ${entry.id}：${entry.detail}`)
    await stopTurn().catch(() => undefined)
  }
  return journey
}
