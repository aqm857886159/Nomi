// 付费确认（D2 第③步；2026-11-15 拆开，板 spend-ask-split）真 App 走查共用的那几件：让夹具里的 Agent 起草几镜、`generate` 把它们摆出来；
// 读确认条和对话里那一组（此刻摆着的一切）、读宿主账本（这一次出价、交接、画布那几镜的单镜 Run）、读画布节点。
//
// 拆开之后两处：对话里那一组 = 这一次要确认的镜头一行一个（超过 4 行折起「还有 N 个镜头」，行尾悬停露「不生成 ×」，去掉的常驻「恢复」）；
// 输入框上方的确认条 = 一行共同参数 +「取消」「生成 N 段」（没有标题问话、没有指向元素）。条上没有可改的东西——要改就点那一行、去节点的生成框里改。
// 走查里的 `card` 仍是确认条；要找行，用 `offerRows(card)`（同一个窗口里对话那一组）。
// 点「生成」把这几镜交给画布：每一镜走画布单节点提交（和节点 ↑ 同一条路）。宿主在这一次出价上记交接（`handOvers`），
// 画布那一镜的单镜 Run 号记在交接上（`canvasRunId`），派发结论写回同一笔（`settled.outcome`）；制作 Run 自己不派作业。
// 期望的字一律从词典按键取（`say`），不在走查里另抄一份文案。
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
//
// 用它的走查：agent-spend-card / -generate-remaining / -stop-midway / -confirm-then-close / -confirm-executes / -per-shot /
// -priced-card / -unknown-price / -full-auto / -video-landing，以及 _agentSpendScopeJourney、_spendStopRounds、_agentVideoLandingSteps。
import fs from 'node:fs'
import path from 'node:path'

import { clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import { APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM, INTERVENTION_REJECT, recorded, sendCanvas } from './agent-runtime-walk-support.mjs'
import { uiTextWith } from './full-walk/invariants.mjs'

export const SPEND_CARD = `${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`
export const CARD_TITLE = '[data-v4-block="slot-title"]'
export const CARD_BADGE = '[data-v4-block="slot-badge"]'
export const CARD_PRIMARY = INTERVENTION_CONFIRM
export const CARD_CANCEL = INTERVENTION_REJECT
export const CARD_BODY = '[data-v4-block="spend-body"]'
/** 确认条上那一行共同参数（每一镜都一样的才写在这；有差别的那一项回到那一行的第二行）。 */
export const CARD_PARAMS = '[data-v4-block="spend-params"]'
export const CARD_PROGRESS = '[data-v4-block="slot-progress"]'
export const CARD_NOTICE = '[data-v4-block="spend-notice"]'
export const CARD_PER_SHOT = '[data-v4-block="price-per-item"]'
export const POINTER = '[data-node-pointer]'
export const pointerOf = (nodeId) => `[data-node-pointer-id="${nodeId}"]`
/** 对话里那一组：这一次出价开着时要确认的那一批（`data-offer-open`），关了之后是交出去的那几段（Q4 收据，同一个位置）。 */
export const OFFER_ROWS = `${CANVAS_PANEL} [data-v4-block="generation-receipt-pointers"][data-offer-open="true"]`
/** 一行（整行是一颗按钮：点了定位节点）；行尾小动作是它的兄弟，包在 `[data-node-pointer-row]` 里。 */
export const ROW = '[data-node-pointer-row]'
/** 确认条在哪个窗口，对话那一组就在哪个窗口：从条（或窗口）找到那一组。 */
export const offerRows = (scope) => ('page' in scope && typeof scope.page === 'function' ? scope.page() : scope).locator(OFFER_ROWS)
/** 像人那样指着这一镜那一行（整行是按钮）。`scope` 可以是条、窗口或那一组。 */
export const pointerFace = (scope, nodeId) => offerRows(scope).locator(pointerOf(nodeId)).first()
export const EXCLUDE = '[data-spend-exclusion="exclude"]'
export const RESTORE = '[data-spend-exclusion="restore"]'
/** 「取消」之后那一句（卡这时已经关了）：`useAgentPanelSpendCard` 推它时的原因。 */
export const STOP_NOTICE = '[data-notification-reason="spend-batch-stopped"]'
/** 卡关了之后对话流里交出去的那几镜（Q4 收据）。 */
export const RECEIPT_POINTERS = '[data-v4-block="generation-receipt-pointers"]'
export const canvasNode = (nodeId) => `[data-node-id="${nodeId}"]`
export const NODE_COMPOSER = '[data-composer-host="canvas"]'
/** 节点生成框底栏的 ↑（在节点上生成这一镜）。 */
export const NODE_GENERATE = `${NODE_COMPOSER} [data-bar-segment="generate"]`
/** 卡上不许出现的编辑器零件（生成框、参数 chip、摘要 pill、参数面板）与输入框（设计系统 §1.0：改参数的家只有节点）。 */
export const CARD_EDITORS = 'textarea, input, select, [contenteditable="true"], [data-composer-host], [data-node-composer-footer], [data-parameter-chip], [data-parameter-summary], [data-agent-parameter-panel]'
/** 动作行上不出钱（10-08「界面不谈钱」）。 */
export const MONEY = /[¥￥$€£]|\d+\.\d{2}/

/** 界面上写的那一句（词典按键取 + 填占位，带 count 走复数）。`locale`：'zh-CN' | 'en'。 */
export const say = (locale, key, values = {}) => uiTextWith(locale, key, values)

/** 主按钮那一句：单段「生成」，多段「生成 N 段 / 张」，节点上点过 ↑ 之后同样按剩下的数说。 */
export function primaryLabel(locale, { count, kind, remaining = false, single = false }) {
  if (single || count === 0) return say(locale, 'agentPanelV4.spendCard.generate')
  if (remaining) return say(locale, kind === 'video' ? 'agentPanelV4.spendConfirmRemainingVideo' : 'agentPanelV4.spendConfirmRemainingImage', { count })
  return say(locale, kind === 'video' ? 'agentPanelV4.spendCard.generateAll' : 'agentPanelV4.spendCard.generateAllImage', { count })
}
/** 「取消」之后那一句（发出 K 段、剩下 M 段没发；全交出去了就说「已经发出去了」；一段都没交出去就说「没有发出去」）。 */
export function stoppedLine(locale, { sent, notSent, kind }) {
  const video = kind === 'video'
  if (sent === 0 && notSent > 0) return say(locale, video ? 'agentPanelV4.spendBatchNoneSentVideo' : 'agentPanelV4.spendBatchNoneSentImage', { count: notSent })
  return notSent > 0
    ? say(locale, video ? 'agentPanelV4.spendBatchStoppedVideo' : 'agentPanelV4.spendBatchStoppedImage', { sent, count: notSent, total: sent + notSent })
    : say(locale, video ? 'agentPanelV4.spendBatchAllSentVideo' : 'agentPanelV4.spendBatchAllSentImage', { sent, count: sent })
}

/** 走查里 Agent 的那一句话（用户输入，不是界面文案）。 */
function askText(tag, count, kind, locale) {
  if (locale === 'en') return `${tag}: ${kind === 'video' ? `make ${count} video shots` : `draw ${count} images`} and let me confirm.`
  return `${tag}：${kind === 'video' ? `做 ${count} 段视频` : `画 ${count} 张图`}，起草好给我确认。`
}

/**
 * 每条走查一个起草器（`prefix` 区分走查）：Agent 起草 `shots`、再 `generate` 把它们摆上卡（`generate` 等用户答完卡才返回）。
 * `shots(tag)` 给出这一轮 draft_shots 的镜头（标题、提示词、taskKind、candidate、参数）；`shotIds` 只摆其中几镜（默认全摆）。
 * 返回卡、operationId、「这一轮说完了」的等待、Agent 收到的回执原文，以及回执回到模型的那一次请求全文（卡开着时打的字跟着它回去）。
 */
export function createPresenter(prefix) {
  let round = 0
  return async function present(walk, win, { shots, locale = 'zh-CN', kind = 'image', presentShotIds, waitForCard = true }) {
    round += 1
    const tag = `${prefix}_${round}`
    const planCall = `${prefix.toLowerCase().replace(/_/g, '-')}-${round}`
    const generateCall = `${planCall}-generate`
    const drafted = shots(tag)
    const planner = walk.fixture.expectText({
      label: `the agent drafts ${drafted.length} ${kind} shots (${tag})`,
      match: (body) => flattenRequestText(body).includes(tag),
      reply: { type: 'tool', id: planCall, name: 'draft_shots', args: { shots: drafted } },
    })
    let operationId
    const draftResult = walk.fixture.expectText({
      label: `the draft result carries the host-generated operationId (${tag})`,
      match: (body) => {
        const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === planCall)
        if (!result) return false
        operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
        return true
      },
      reply: { type: 'hold' },
    })
    let receipt = ''
    let request = ''
    const turnDone = walk.fixture.expectText({
      label: `generate returns once the card is answered (${tag})`,
      match: (body) => {
        const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === generateCall)
        if (!result) return false
        receipt = String(result.content)
        request = flattenRequestText(body)
        return true
      },
      reply: { type: 'text', text: `${tag}_DONE` },
    })
    await sendCanvas(win, askText(tag, drafted.length, kind, locale))
    await recorded(planner.received, `${tag} draft request`)
    // 草稿要落 N 个节点：按工作量给安全网。
    await recorded(draftResult.received, `${tag} draft result`, stationTimeout({ operations: Math.max(4, drafted.length) }))
    // 点名摆哪几镜要用宿主给的 shotId：先读回这一份计划。
    const projectId = walk.report.projectId
    let shotIds
    if (presentShotIds) {
      const plan = await planShots(win, projectId, operationId)
      shotIds = presentShotIds(plan)
    }
    draftResult.release({ type: 'tool', id: generateCall, name: 'generate', args: { operationId, ...(shotIds ? { shotIds } : {}) } })
    const card = win.locator(SPEND_CARD)
    const count = shotIds?.length ?? drafted.length
    if (waitForCard) {
      // 确认条不画标题问话：按钮说了做什么、几段（板 ask.title）。对话里那一组同时出现。
      await expect(card.locator(CARD_PRIMARY), `${tag}：确认条上的按钮说的是这 ${count} 镜`).toContainText(primaryLabel(locale, { count, kind, single: count === 1 }),
        { timeout: stationTimeout({ operations: Math.max(4, Math.ceil(count / 4)) }) })
      await expect(offerRows(card), `${tag}：对话里出现这一次要确认的那一组`).toHaveCount(1, { timeout: stationTimeout() })
    }
    return { card, operationId, turnDone, tag, receipt: () => receipt, request: () => request }
  }
}

// ── 宿主账本（只读：渲染层同一个只读桥 `nomiDesktop.productionRuns.read`）────────────────────────────────

/** 读一份 Run（制作 Run，或画布那一镜的单镜 Run）。 */
export function readRun(win, projectId, runId) {
  return win.evaluate(async ({ pid, rid }) => {
    const read = await window.nomiDesktop.productionRuns.read(pid, rid)
    return read?.run ?? read ?? null
  }, { pid: projectId, rid: runId })
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function readJsonLinesFile(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
}

/**
 * 这一次出价每一镜的画布单镜 Run 上，批准用的那张收据：谁决定的（`decidedBy`）、哪个窗口哪个 frame 点的（`humanActor`）。
 * 设计卡 §四 第 3 条：卡上「生成」和节点 ↑ 走同一个签发口（`nomi:tasks:canvas-submit` 按发送方铸手势），同一个窗口、
 * 同一个 frame——两边收据的 `humanActor` 应逐字相同，这一条要在真 App 里对照，不靠读码。
 * 认领记录（`shots[].claim`：`via` 是节点上点的还是卡交出去的、`canvasRunId` 是哪一份画布单镜 Run）走只读桥；
 * 收据只读盘：项目 `.nomi/runs/<canvasRunId>/approvals.ndjson` 的 receiptId → 能力核收据库 `<capabilityDir>/approval-receipts.json`。
 */
export async function shotGestureReceipts(win, { projectId, projectRoot, capabilityDir, operationId }) {
  const run = await readRun(win, projectId, operationId)
  const store = readJsonFile(path.join(capabilityDir, 'approval-receipts.json'))
  const receipts = new Map(Object.entries(store?.receipts ?? {}).map(([key, record]) => [record?.receipt?.receiptId ?? key, record?.receipt ?? null]))
  return (run?.generationPlan?.shots ?? []).map((shot) => {
    const canvasRunId = shot.claim?.canvasRunId ?? null
    const approvals = canvasRunId ? readJsonLinesFile(path.join(projectRoot, '.nomi', 'runs', canvasRunId, 'approvals.ndjson')) : []
    return {
      shotId: shot.shotId, via: shot.claim?.via ?? null, canvasRunId,
      receipts: approvals.filter((approval) => approval.receiptId).map((approval) => {
        const receipt = receipts.get(approval.receiptId)
        return { decidedBy: receipt?.decidedBy ?? 'unknown', humanActor: receipt?.humanActor ?? null }
      }),
    }
  })
}

/** 这一份计划的镜头（宿主的 shotId、标题、提示词，按计划顺序）。 */
export async function planShots(win, projectId, operationId) {
  const run = await readRun(win, projectId, operationId)
  return (run?.generationPlan?.shots ?? []).map((shot) => ({ shotId: shot.shotId, title: shot.title, prompt: shot.candidate?.prompt ?? '' }))
}

/**
 * 这一次出价此刻的样子：开着没有、谁关的、交接（哪几镜、谁决定的、画布那一镜的单镜 Run、落定没有）、
 * 以及制作 Run 自己有没有派过作业（一台发动机：卡交出去的镜，作业住在画布那一镜的单镜 Run 里）。
 */
export async function offerFacts(win, projectId, operationId) {
  const run = await readRun(win, projectId, operationId)
  const presentation = run?.generationPlan?.presentations?.at(-1)
  return {
    open: Boolean(presentation && !presentation.closed),
    closedBy: presentation?.closed?.by ?? null,
    shotIds: [...(presentation?.shotIds ?? [])],
    removed: (presentation?.removed ?? []).map((entry) => entry.shotId),
    handOvers: (presentation?.handOvers ?? []).map((entry) => ({
      shotId: entry.shotId, by: entry.by, canvasRunId: entry.canvasRunId ?? null, outcome: entry.settled?.outcome ?? null,
    })),
    productionJobs: (run?.jobs ?? []).length,
    planState: run?.generationPlan?.state ?? null,
  }
}

/** 交出去的那几镜在画布那一侧的单镜 Run：每一份的作业与产物（证「花钱走的是画布那一台发动机」）。 */
export async function canvasRunsOf(win, projectId, operationId) {
  const facts = await offerFacts(win, projectId, operationId)
  const runs = []
  for (const entry of facts.handOvers) {
    if (!entry.canvasRunId) continue
    const run = await readRun(win, projectId, entry.canvasRunId)
    runs.push({
      shotId: entry.shotId, runId: entry.canvasRunId, outcome: entry.outcome,
      kind: run?.kind ?? null,
      jobs: (run?.jobs ?? []).map((job) => ({ status: job.status, stageId: job.stageId })),
      artifacts: (run?.artifacts ?? []).filter((artifact) => artifact.status !== 'rejected').map((artifact) => ({ kind: artifact.kind, path: artifact.projectRelativePath })),
    })
  }
  return runs
}

// ── 画布节点 ────────────────────────────────────────────────────────────────────────────────

/** 这一份计划落在画布上的节点（按计划顺序）：节点 id + 它此刻的 meta / 提示词 / 状态。 */
export async function shotNodes(win, projectId, operationId) {
  const plan = await planShots(win, projectId, operationId)
  const nodes = await win.evaluate(() => (window.__nomiCanvasStore?.getState().nodes ?? []).map((node) => ({
    id: node.id, kind: node.kind, status: node.status, prompt: node.prompt ?? '', meta: node.meta ?? {},
  })))
  return plan.map((shot) => {
    const node = nodes.find((candidate) => candidate.meta.productionRunId === operationId && candidate.meta.productionShotId === shot.shotId)
    return { ...shot, nodeId: node?.id ?? null, node: node ?? null }
  })
}

/**
 * 画布 store / 落地 store 的只读 E2E 桥只在 `localStorage.__nomiE2E === '1'` 时挂（`ProductionCanvasLandingHost`，挂载那一刻读）：
 * 起 App 之后先打开这个开关再重载一次，后面 `shotNodes` / `nodeMeta` 才读得到画布此刻的节点。
 */
export async function armCanvasBridges(win) {
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
}

/**
 * 记下画布节点外壳上出现过的每一次外部高亮（`data-external-highlight`：hover = 指向元素悬停时同亮，flash = 定位 / 完成时闪一下）。
 * 闪一下只有 1.4 秒，轮询容易错过：点之前先挂观察者，之后读 `seenHighlights`。
 */
export async function watchCanvasHighlights(win) {
  await win.evaluate(() => {
    window.__spendHighlightObserver?.disconnect()
    window.__spendHighlights = []
    const record = (shell) => {
      const value = shell.getAttribute('data-external-highlight')
      const nodeId = shell.querySelector('[data-node-id]')?.getAttribute('data-node-id')
      if (value && nodeId) window.__spendHighlights.push({ nodeId, value, at: Date.now() })
    }
    window.__spendHighlightObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof Element) record(mutation.target)
        // 节点外壳整个重建时（React Flow 重挂那一张卡），高亮是随新元素一起来的：不是属性变化，是新加进来的元素。
        if (mutation.type === 'childList') {
          for (const added of mutation.addedNodes) {
            if (!(added instanceof Element)) continue
            if (added.hasAttribute('data-external-highlight')) record(added)
            added.querySelectorAll('[data-external-highlight]').forEach(record)
          }
        }
      }
    })
    window.__spendHighlightObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-external-highlight'] })
  })
}

/** `watchCanvasHighlights` 之后出现过的高亮（[{ nodeId, value }]）。 */
export function seenHighlights(win) {
  return win.evaluate(() => (window.__spendHighlights ?? []).map(({ nodeId, value }) => ({ nodeId, value })))
}

/** 画布上这个节点外壳此刻的外部高亮（没有 = null）。 */
export function canvasHighlightOf(win, nodeId) {
  return win.evaluate((id) => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
    ?.closest('.generation-canvas-react-flow__node-shell')?.getAttribute('data-external-highlight') ?? null, nodeId)
}

/** 比例住在哪个键上随模型而变（`aspect_ratio` / `size` / `ratio` / `image_size`）：取第一个读得出「W:H」的（同 `nodeAspectRatioValue` 的找法）。 */
const ASPECT_KEYS = ['aspect_ratio', 'size', 'ratio', 'image_size']
export function aspectOf(record) {
  for (const key of ASPECT_KEYS) {
    const value = record?.[key]
    if (typeof value === 'string' && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value.trim())) return value.trim()
  }
  return null
}

/** 时长印法（界面上的「5s」「1:05」）：走查的对照，按界面的写法算。 */
export function secondsText(seconds) {
  const whole = Math.round(seconds)
  return whole >= 60 ? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}` : `${whole}s`
}

/** 一镜节点上那三样（比例 / 时长 / 清晰度），读不到就是 null。 */
export function nodeParams(meta) {
  return {
    aspect: aspectOf(meta),
    duration: typeof meta?.duration === 'number' && meta.duration > 0 ? meta.duration : null,
    resolution: typeof meta?.resolution === 'string' ? meta.resolution : null,
  }
}

/** 一笔请求体里那三样（线上的键名由模型映射翻译：seedance 的比例叫 size）。 */
export function wireParams(body) {
  const duration = body?.duration ?? body?.seconds ?? null
  return {
    aspect: aspectOf(body),
    duration: duration == null || duration === '' ? null : Number(duration),
    resolution: typeof body?.resolution === 'string' ? body.resolution : null,
    prompt: String(body?.prompt ?? ''),
  }
}

/** 一个节点此刻的 meta（画布 store 现读）。 */
export function nodeMeta(win, nodeId) {
  return win.evaluate((id) => window.__nomiCanvasStore?.getState().nodes.find((node) => node.id === id)?.meta ?? null, nodeId)
}

/**
 * 在节点的生成框里改一个参数（真人那样：点摘要 pill 打开参数面板，拖滑杆 / 点另一个选项，Esc 收起）。
 * `key`：参数键（`duration` / `aspect_ratio` / `resolution`…）；`pick`：选项面板里要点的那一个的可读名（不给 = 第一个没选中的）。
 * 返回改之前 / 之后的值（节点 meta 现读）。
 */
export async function editNodeParameter(win, nodeId, key, { pick } = {}) {
  const composer = win.locator(NODE_COMPOSER)
  await expect(composer, `节点 ${nodeId} 的生成框开着`).toBeVisible({ timeout: stationTimeout() })
  const before = (await nodeMeta(win, nodeId))?.[key]
  await clickOrFail(composer.locator('[data-parameter-summary]'), '生成框的参数摘要')
  const panel = win.locator('[data-agent-parameter-panel="true"]')
  await expect(panel, '参数面板').toBeVisible()
  const control = panel.locator(`[data-agent-parameter-control="${key}"]`)
  await expect(control, `参数面板里有「${key}」`).toBeVisible()
  const slider = control.locator('[role="slider"]')
  if (await slider.count()) {
    await slider.first().focus()
    await win.keyboard.press('ArrowRight')
  } else {
    const option = pick
      ? control.locator('[role="radio"]', { hasText: pick }).first()
      : control.locator('[role="radio"][aria-checked="false"]:not([disabled])').first()
    await clickOrFail(option, `参数「${key}」的另一个选项`)
  }
  await win.keyboard.press('Escape')
  await expect.poll(async () => (await nodeMeta(win, nodeId))?.[key], { message: `节点上的「${key}」真的改了`, timeout: stationTimeout() }).not.toEqual(before)
  return { before, after: (await nodeMeta(win, nodeId))?.[key] }
}

// ── 卡（此刻摆着的一切，一次读完，断言在 Node 这边比）────────────────────────────────────────────

export function cardFacts(win) {
  return win.evaluate(({ cardSelector, rowsSelector, editors }) => {
    const card = document.querySelector(cardSelector)
    if (!card) return null
    // 行住在对话里那一组（出价开着时），不在条上。
    const rows = document.querySelector(rowsSelector)
    const text = (selector) => card.querySelector(selector)?.textContent?.trim() ?? null
    const confirm = card.querySelector('[data-v4-control="confirm"]')
    const dismiss = card.querySelector('[data-v4-control="slot-dismiss"]')
    const body = card.querySelector('[data-v4-block="spend-body"]')
    const title = (() => {
      const heading = card.querySelector('[data-v4-block="slot-title"]')
      if (!heading) return null
      const clone = heading.cloneNode(true)
      clone.querySelectorAll('[data-v4-block="slot-badge"], [data-v4-block="slot-title-icon"]').forEach((node) => node.remove())
      return clone.textContent?.trim() ?? ''
    })()
    return {
      tone: card.getAttribute('data-tone'),
      title,
      badge: text('[data-v4-block="slot-badge"]'),
      progress: text('[data-v4-block="slot-progress"]'),
      confirm: confirm ? { text: (confirm.textContent ?? '').replace('⏎', '').trim(), disabled: confirm.disabled } : null,
      dismiss: dismiss ? { text: dismiss.textContent?.trim() ?? '', disabled: dismiss.disabled } : null,
      pointers: rows ? [...rows.querySelectorAll('[data-node-pointer]')].filter((el) => el.hasAttribute('data-node-pointer-id')).map((el) => ({
        id: el.getAttribute('data-node-pointer-id'), face: el.getAttribute('data-node-pointer-face'), text: el.textContent ?? '',
      })) : [],
      // 条上不许再有指向元素（板 ask.pointers）：一镜也不画。
      pointersOnBar: card.querySelectorAll('[data-node-pointer]').length,
      toggles: rows ? [...rows.querySelectorAll('[data-spend-exclusion]')].map((el) => ({
        kind: el.getAttribute('data-spend-exclusion'),
        row: el.closest('[data-node-pointer-row]')?.querySelector('[data-node-pointer]')?.getAttribute('data-node-pointer-id') ?? null,
      })) : [],
      more: rows?.querySelector('[data-node-pointer-more]')?.textContent?.trim() ?? null,
      notices: [...card.querySelectorAll('[data-v4-block="spend-notice"]')].map((el) => ({ tone: el.getAttribute('data-tone'), text: el.textContent?.trim() ?? '' })),
      // 没成的原因只写在那一镜那一行第二行（2026-11-16 起条上不重复），读失败行的那一句。
      rowFailures: rows ? [...rows.querySelectorAll('[data-node-pointer][data-node-pointer-face="failed"] [data-node-pointer-detail]')].map((el) => el.textContent?.trim() ?? '') : [],
      params: body?.querySelector('[data-v4-block="spend-params"]')?.textContent?.trim() ?? null,
      editors: card.querySelectorAll(editors).length,
      cardText: card.textContent ?? '',
      rowsText: rows?.textContent ?? '',
    }
  }, { cardSelector: SPEND_CARD, rowsSelector: OFFER_ROWS, editors: CARD_EDITORS })
}

/** 把鼠标挪开（行尾的「不生成 ×」收回去、画布上那一镜不再同亮）。 */
export async function pointerAway(win) {
  await win.mouse.move(2, 2)
}

/** 对话里那一组里这一镜那一行此刻的字（标题 + 有话要说时的第二行：和别的镜不一样的参数 / 状态）。 */
export async function rowTextOf(win, nodeId) {
  await unfoldPointers(win, `读 ${nodeId} 那一行`)
  return (await pointerFace(win, nodeId).innerText()).trim()
}

/**
 * 去节点上点 ↑：点对话里那一镜那一行 → 生成框为它打开 → 点生成框底栏的 ↑（和画布上直接在节点上生成同一条路）。
 * 画布接走这一镜：那一行跟着节点说「生成中」，不再算在主按钮里。
 */
export async function generateOnNode(win, card, nodeId, label) {
  await unfoldPointers(card, label)
  await clickOrFail(pointerFace(card, nodeId), `${label}：点对话里那一镜那一行`)
  // 认这一镜自己的生成框（挂在它的画布节点里）：不认 DOM 里第一张——别的节点的框可能还开着。
  const composer = win.locator(`${canvasNode(nodeId)} ${NODE_COMPOSER}`)
  await expect(composer, `${label}：这一镜的生成框打开了`).toBeVisible({ timeout: stationTimeout() })
  await clickOrFail(composer.locator('[data-bar-segment="generate"]').first(), `${label}：节点底栏的 ↑`, { noWaitAfter: true })
}

/** 点主按钮（「生成」/「全部生成（N）」/「生成剩下 N 段」/「再试一次」）。 */
export async function pressPrimary(card, label) {
  await clickOrFail(card.locator(CARD_PRIMARY), label, { noWaitAfter: true })
}

// ── 任务面板 ────────────────────────────────────────────────────────────────────────────────

/** 任务面板此刻的每一行：id（`production-run:<runId>`，或画布那一行 `<批次>:<节点>`）、分组、节点、字。 */
export async function taskPanelRows(win) {
  return win.locator('[data-task-id]').evaluateAll((elements) => elements.map((element) => ({
    id: element.getAttribute('data-task-id'), group: element.getAttribute('data-task-group'),
    nodeId: element.getAttribute('data-task-node-id'), text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
  })))
}

const STALE_KEY = 'generationCommon.production.status.providerStale'

/**
 * 卡上「生成」交给画布之后、片子落了，任务面板里这件事落定了没有（空清单 = 落定了）：没有哪一行还说「供应商长时间没有返回新状态」，
 * 这次出价（制作 Run）、画布那几镜的单镜 Run、那个节点的那一行都不再挂在「进行中 / 排队 / 要处理」。
 */
export function taskPanelSettledProblems(rows, { offerRunId, canvasRunIds = [], nodeId }) {
  const stale = [say('zh-CN', STALE_KEY), say('en', STALE_KEY)]
  const ids = new Set([offerRunId, ...canvasRunIds].filter(Boolean).map((runId) => `production-run:${runId}`))
  const ours = rows.filter((row) => ids.has(row.id) || (nodeId && row.nodeId === nodeId))
  return [
    ...rows.filter((row) => stale.some((text) => row.text.includes(text))).map((row) => `${row.id} 还在说供应商没有新状态：${row.text}`),
    ...ours.filter((row) => row.group !== 'done').map((row) => `${row.id} 还在「${row.group}」：${row.text}`),
  ]
}

/**
 * 对话里那一组超过 4 行折起：第 4 行下面一颗字按钮「还有 N 个镜头」（板 chat.rows.more），点它是展开、不是定位。
 * 要点 / 要悬停某一镜之前先展开。`scope`：条、窗口或那一组。
 */
export async function unfoldPointers(scope, label) {
  const more = offerRows(scope).locator('[data-node-pointer-more]')
  if (!(await more.count())) return
  await clickOrFail(more.first(), `${label}：那一组「还有 N 个镜头」，先展开`)
  await expect(more, `${label}：展开之后不再折`).toHaveCount(0, { timeout: stationTimeout() })
}

/** 这一镜那一行（含行尾小动作那一槽）。 */
export const rowOf = (scope, nodeId) => offerRows(scope).locator(ROW).filter({ has: offerRows(scope).page().locator(pointerOf(nodeId)) })

/** 那一镜那一行行尾的「不生成 ×」（悬停那一行才露出来）。 */
export async function excludeShot(card, nodeId, label) {
  await unfoldPointers(card, label)
  await pointerFace(card, nodeId).hover()
  await clickOrFail(rowOf(card, nodeId).locator(EXCLUDE), label)
}
