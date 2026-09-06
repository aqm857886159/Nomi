// Shared, isolated Electron setup for the pi cutover's real user-task walks.
// Business actions stay in the walks: this file only launches, observes and records.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled } from './_assert.mjs'
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'

// ── 面板选择器：v4 契约的**唯一**一份 ────────────────────────────────────────
//
// 2026-09-06 常驻面板换成 v4 积木（`src/workbench/ai/v4/`）之后，面板内部一律 `data-v4-*`；
// 只有外壳那几个 `data-agent-*` 留着（它们标的是「哪一面的常驻面板」，不是长相）。
// 走查里**禁止再手抄这些串**——2026-09-05 那次「面板没渲染」其实是选择器过期
// （docs/lessons/dead-selector-lies-both-ways.md），一处失效同时造假红和假绿。

/** 外壳：仍然由 ProjectAgentResidentShell 自己发的三个身份属性。 */
export const AGENT_PANEL = '[data-agent-resident="true"][data-agent-panel="true"]'
export const CREATION_PANEL = `${AGENT_PANEL}[data-agent-surface="creation"]`
export const CANVAS_PANEL = `${AGENT_PANEL}[data-agent-surface="generation"]`
export const PREVIEW_PANEL = `${AGENT_PANEL}[data-agent-surface="preview"]`
export const STORYBOARD_PANEL = `${AGENT_PANEL}[data-agent-surface="storyboard"]`
/** 收起态：外壳仍在（`data-agent-resident`），但没有 `data-agent-panel`，只剩画面下沿那一坞。 */
export const COLLAPSED_SHELL = '[data-agent-resident="true"][data-agent-collapsed="true"]'
/**
 * 收起角标 = **顶栏**右簇「浏览器」与「设置」之间那一格（09-01 定稿 §11.2）。
 *
 * 注意它**不在** `COLLAPSED_SHELL` 里面：顶栏在整个工作区外面。从收起外壳里找它永远找不到——
 * 那正是这一版返工要修的事（此前它画在面板自己的地盘上，切面就换落点）。
 */
export const COLLAPSED_DOCK = '[data-agent-topbar-badge="true"]'
export const COLLAPSED_DOCK_OPEN = '[data-v4-control="dock-open"]'
/** 角标上那一格：`data-agent-dock-badge` = dot（蓝点 8px）/ count（数字徽标）。 */
export const COLLAPSED_DOCK_BADGE = '[data-agent-dock-badge]'
/** 「刚变过」那 420ms 里才挂的属性（单次 settle 脉冲）。 */
export const COLLAPSED_DOCK_SETTLE = '[data-agent-dock-settle="true"]'
/** hover 才冒的 tooltip。它落在 portal 里，**从窗口根找**，不要从角标的子树里找。 */
export const COLLAPSED_DOCK_HINT = '[data-agent-dock-hint="true"]'
/** 顶栏右簇（判角标落位用）。 */
export const APP_BAR_RIGHT = '.nomi-appbar__right'
/** 面板级错误带（外壳渲染，不在 v4 积木里）。 */
export const PANEL_ERROR = '[data-agent-error="true"]'
export const THREAD_MENU = '[data-agent-thread-menu="true"]'

export const DOCUMENT = '[aria-label="创作文档编辑区"] .tiptap[contenteditable="true"]'

/** v4 面板本体与对话流。 */
export const V4_PANEL = '[data-v4-panel="true"]'
export const V4_FLOW = '[data-v4-flow="true"]'

/** 对话流里的 8 个积木（`data-v4-block`）。 */
export const USER_BUBBLE = '[data-v4-block="user"]'
export const ASSISTANT_MESSAGE = '[data-v4-block="assistant"]'
export const THINKING_LINE = '[data-v4-block="thinking"]'
export const SUGGESTION = '[data-v4-block="suggestion"]'
export const TOOL_RECEIPT = '[data-v4-block="tool"]'
export const TASK_CARD = '[data-v4-block="task"]'
export const ERROR_BAR = '[data-v4-block="errorbar"]'
export const QUEUE = '[data-v4-block="queue"]'
export const QUEUE_ROW = `${QUEUE} > div[data-status]`
export const CONTEXT_RING = '[data-v4-block="context"]'
/** 空态：只在对话流为空时存在；`data-v4-starter` 是它那三颗起手 chip。 */
export const EMPTY_STATE = '[data-v4-block="empty"]'
export const EMPTY_STARTER = '[data-v4-starter]'

/**
 * 待批准的操作卡 = 介入槽。v4 里它**只有一个**（`primaryPending`），永远在 composer 正上方；
 * 「还有 N 条」写在槽头，不再是一叠卡。`data-kind` 分档：
 * `approval-reversible` / `approval-irreversible` / `spend` / `question` / `plan` / `credential`。
 */
export const APPROVAL_CARD = '[data-v4-block="intervention"]'
export const INTERVENTION_SLOT = APPROVAL_CARD
export const INTERVENTION_CONFIRM = '[data-v4-control="confirm"]'
export const INTERVENTION_REJECT = '[data-v4-control="reject"]'
export const INTERVENTION_CONFIRM_REJECT = '[data-v4-control="confirm-reject"]'
export const INTERVENTION_CANCEL_REJECT = '[data-v4-control="cancel-reject"]'
export const INTERVENTION_ESCALATE = '[data-v4-control="escalate"]'
export const INTERVENTION_ALTERNATE = '[data-v4-control="alternate"]'
export const INTERVENTION_REJECT_REASON = '[data-v4-control="reject-reason"]'

/** composer 与它底栏的五个控件。发送与停止是**同一颗钮**（`send`），由 aria-label 区分。 */
export const COMPOSER = '[data-v4-block="composer"]'
export const COMPOSER_INPUT = '[data-v4-control="input"]'
export const COMPOSER_SEND = '[data-v4-control="send"]'
/** 运行中那颗钮就是 `send`：`data-mode="running"` 时它是停止。别再找第二个 `stop` 挂点。 */
export const COMPOSER_STOP = `${COMPOSER}[data-mode="running"] ${COMPOSER_SEND}`
export const COMPOSER_ADD_FILE = '[data-v4-control="add-file"]'
export const COMPOSER_MODEL = '[data-v4-control="model"]'
export const COMPOSER_SKILL = '[data-v4-control="skill"]'
export const COMPOSER_PERMISSION = '[data-v4-control="permission"]'
export const COMPOSER_CHIP = '[data-v4-chip]'

/** 弹层：一次只开一个。权限档在 `permission` 弹层里，`[data-tier][data-active]`。 */
export const MODEL_POPOVER = '[data-v4-popover="model"]'
export const SKILL_POPOVER = '[data-v4-popover="skill"]'
export const SKILL_SEARCH = '[data-v4-control="skill-search"]'
export const PERMISSION_POPOVER = '[data-v4-popover="permission"]'
export const permissionTier = (tier) => `${PERMISSION_POPOVER} [data-tier="${tier}"]`
export const ACTIVE_PERMISSION_TIER = `${PERMISSION_POPOVER} [data-tier][data-active="true"]`

/** 头部两个图标钮。 */
export const HISTORY_BUTTON = '[data-v4-control="history"]'
export const COLLAPSE_BUTTON = '[data-v4-control="collapse"]'

export function toolNames(body) {
  return (body.tools ?? []).map((tool) => tool.function.name).sort()
}

export function hasToolResult(body, id) {
  return (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === id)
}

/** One I/O safety bound, not a polling/sleep-based completion signal. */
export async function recorded(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 60_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function stopRuntimeApp(app) {
  const child = app.process()
  const exited = () => child.exitCode !== null || child.signalCode !== null
  try {
    await recorded(app.close(), 'the actual Electron process to close')
    expect(exited(), 'Cold restoration requires a terminated process, not a page reload').toBe(true)
  } catch (error) {
    if (!exited()) {
      // Only the child this walk launched. Never kill by name or touch another Nomi instance.
      const exit = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
      void exit.catch(() => {}) // Observe cancellation even if kill itself throws.
      try {
        if (!child.kill('SIGKILL')) throw new Error('Could not terminate the owned Electron process', { cause: error })
        await exit
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Electron close and owned-process cleanup failed', { cause: cleanupError })
      }
    }
    throw error
  }
}

export async function finalizeRuntimeWalk(report, { error, cleanup = [], collect } = {}) {
  const failures = error ? [error] : []
  for (const action of cleanup) {
    try { await action() } catch (cleanupError) { failures.push(cleanupError) }
  }
  try { Object.assign(report, await collect?.()) } catch (evidenceError) { failures.push(evidenceError) }
  report.result = failures.length ? 'failed' : 'passed'
  report.error = failures.length ? failures.map((failure) => failure instanceof Error ? failure.stack : String(failure)).join('\n\n') : undefined
  if (failures.length) process.exitCode = 1
  fs.writeFileSync(path.join(report.outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  return report
}

export async function readProject(win, projectId) {
  return win.evaluate((id) => window.nomiDesktop.projects.readAsync(id), projectId)
}

/**
 * Read back the active document without hiding the persisted schema version.
 * The legacy field remains readable for old projects, but current journeys must
 * prove that the writer emits the multi-document shape.
 */
export function readPersistedWorkbenchDocument(record) {
  const payload = record && typeof record === 'object' && record.payload && typeof record.payload === 'object'
    ? record.payload
    : null
  if (payload && Array.isArray(payload.workbenchDocuments)) {
    const activeDocumentId = typeof payload.activeDocumentId === 'string' ? payload.activeDocumentId : ''
    const document = payload.workbenchDocuments.find((item) => item && item.id === activeDocumentId)
    return document ? { schema: 'multi', document } : { schema: 'missing', document: null }
  }
  if (payload && payload.workbenchDocument && typeof payload.workbenchDocument === 'object') {
    return { schema: 'legacy', document: payload.workbenchDocument }
  }
  return { schema: 'missing', document: null }
}

export function requireCurrentPersistedWorkbenchDocument(record) {
  const readback = readPersistedWorkbenchDocument(record)
  if (readback.schema !== 'multi') {
    const detail = readback.schema === 'legacy'
      ? 'legacy workbenchDocument was readable but is not an acceptable current-writer result'
      : 'no supported persisted workbench document was readable'
    throw new Error(`Current multi-document persistence evidence missing: ${detail}`)
  }
  return readback.document
}

function conversationsFromProjectAgentSnapshot(snapshot) {
  const threads = (snapshot?.threads || []).map((thread) => ({
    id: thread.threadId,
    title: thread.title || '',
    createdAt: thread.createdAt || 0,
    updatedAt: thread.updatedAt || 0,
    messages: (snapshot?.items || [])
      .filter((item) => item.threadId === thread.threadId && (item.kind === 'user' || item.kind === 'assistant'))
      .map((item) => ({ id: item.itemId, role: item.kind, content: item.text || '' })),
  }))
  return { creation: { activeId: snapshot?.activeThreadId || null, threads }, generation: { activeId: null, threads: [] } }
}

export async function readConversations(win, projectId, durableRoots) {
  // The old conversations IPC was retired by the Project Agent cutover. When
  // a walk already owns the isolated profile, read the persisted Host snapshot
  // directly. Calling projectAgent.open() here would release the resident
  // renderer subscription on the same WebContents, making the next user turn
  // fail with project_agent_subscription_invalid.
  if (durableRoots?.settingsRoot && durableRoots?.projectRoot) {
    return conversationsFromProjectAgentSnapshot(readCurrentProjectAgentHostSnapshot(durableRoots.settingsRoot, durableRoots.projectRoot))
  }
  const snapshot = await win.evaluate(async (id) => {
    const record = await window.nomiDesktop.projects.readAsync(id)
    const opened = await window.nomiDesktop.projectAgent.open({
      projectId: id,
      immutableProjectUuid: record?.immutableProjectUuid,
      projectGeneration: record?.projectGeneration,
    })
    if (!opened?.ok) throw new Error('projectAgent.open failed')
    return opened.value.snapshot
  }, projectId)
  return conversationsFromProjectAgentSnapshot(snapshot)
}

export function readNativeContexts(projectRoot, settingsRoot) {
  if (!settingsRoot) return null
  const state = readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot)
  if (!state) return null
  const byThread = new Map()
  for (const item of state.items || []) {
    const threadId = item.threadId
    if (typeof threadId !== 'string' || !threadId) continue
    const entries = byThread.get(threadId) || []
    if (item.kind === 'tool' && typeof item.toolCallId === 'string') {
      entries.push({ type: 'message', message: {
        role: 'toolResult',
        toolCallId: item.toolCallId,
        content: item.resultRef || '',
      } })
    } else if (item.kind === 'user' || item.kind === 'assistant') {
      entries.push({ type: 'message', message: { role: item.kind, content: item.text || '' } })
    }
    byThread.set(threadId, entries)
  }
  const projectId = state.binding?.projectId
  return [...byThread.entries()].map(([threadId, entries]) => ({
    sessionKey: typeof projectId === 'string' ? `nomi:workbench:${projectId}:creation` : undefined,
    threadId,
    snapshot: JSON.stringify({
      format: 'nomi.pi-work-context',
      piVersion: '0.84.3',
      data: { entries },
    }),
  }))
}

export function snapshotMessages(record) {
  const envelope = JSON.parse(record.snapshot)
  expect(envelope.format).toBe('nomi.pi-work-context')
  expect(envelope.piVersion).toBe('0.84.3')
  return envelope.data.entries.filter((entry) => entry.type === 'message').map((entry) => entry.message)
}

/**
 * Current ProjectAgentHost persistence is a settings-owned, binding-partitioned
 * snapshot. Keep the legacy Pi reader above for the old support journeys, but
 * let current-host journeys prove the durable state that production actually
 * writes today.
 */
export function readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot) {
  const projectFile = path.join(projectRoot, '.nomi', 'project.json')
  if (!fs.existsSync(projectFile)) return null
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  const { immutableProjectUuid, projectGeneration, id: projectId } = project
  if (typeof immutableProjectUuid !== 'string' || typeof projectGeneration !== 'number' || typeof projectId !== 'string') {
    return null
  }
  const partition = `project-agent.${encodeURIComponent(immutableProjectUuid)}.g${projectGeneration}`
  const snapshotFile = path.join(settingsRoot, 'project-agent-host', partition, 'snapshot-v1.json')
  if (!fs.existsSync(snapshotFile)) return null
  const envelope = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
  expect(envelope.schemaVersion, 'Current ProjectAgentHost snapshot schema').toBe(1)
  expect(envelope.binding, 'Current ProjectAgentHost snapshot binding').toEqual({
    immutableProjectUuid,
    projectGeneration,
    projectId,
  })
  return envelope.state
}

/**
 * The durable per-thread conversation context production actually writes today:
 * one project-scoped container keyed by the Host's canonical context binding.
 * Unlike readNativeContexts above, nothing here is reconstructed from Host items.
 */
export function readDurableThreadContexts(projectRoot) {
  const file = path.join(projectRoot, '.nomi', 'agent-thread-context-v1.json')
  if (!fs.existsSync(file)) return null
  const container = JSON.parse(fs.readFileSync(file, 'utf8'))
  expect(container.version, 'Durable Agent context container schema').toBe(4)
  return Object.values(container.records ?? {})
}

export function readProjectAgentProposalReceipt(projectRoot) {
  const receiptFile = path.join(projectRoot, '.nomi', 'project-agent-proposal-receipt.json')
  if (!fs.existsSync(receiptFile)) return null
  return JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
}

/**
 * Locate a current tool result by its persisted capability and its matching
 * proposal approval. The test never invents or assumes the provider's call id.
 */
export function readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, capabilityId) {
  const state = readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot)
  if (!state) return null
  const tool = state.items.find((item) => item.kind === 'tool' && item.capability?.id === capabilityId)
  const proposal = tool
    ? state.items.find((item) => item.kind === 'proposal' && item.approval?.toolCallId === tool.toolCallId)
    : undefined
  const receipt = readProjectAgentProposalReceipt(projectRoot)
  return { state, tool, proposal, receipt }
}

/**
 * 「这一轮说完了」的判定源（v4）。
 *
 * ⚠️ `_assert.mjs` 的 `waitForTurnIdle` 找的是 aria-label 为「停止生成」的钮——那是**旧面板**
 * 的字；v4 那颗钮叫「停止」（`agentPanelV4.stop`），两者对不上。所以这里不按可见文字判，
 * 按 composer 的 `data-mode` 判：`running` 出现（起飞）→ 消失（落地）。文案改了判定源不该失效。
 *
 * 别再用「气泡文本连续几次不变」——pending 态的助手块本来就没有文字，
 * 模型还没吐第一个字判据就满足了（2026-08-18 那次栽的坑）。
 */
export async function waitForV4TurnIdle(win, { panel = AGENT_PANEL, startTimeout = 20_000, doneTimeout = 240_000, settledBy } = {}) {
  const running = win.locator(`${panel} ${COMPOSER}[data-mode="running"]`).first()
  if (settledBy) {
    // 起飞已经由**别的**判据证明过了（通常是「出站请求到了 loopback」），这里只等落地。
    //
    // 为什么要这条分支：loopback 回得比一次断言轮询还快，回合可能在 Playwright 采到
    // 第一帧之前就已经结束——那时 `data-mode="running"` 从头到尾没被观测到，
    // 「没起飞」这条报红说的是仪器没跟上，不是产品没跑。
    // 而这时**不能**只 `toBeHidden`：它本来就是 hidden，会立刻通过（`expectAbsent` 那类假绿）。
    // 所以落地必须由调用方给一个**阳性**信号：这一轮真正产出的那个东西。
    await expect(settledBy, '这一轮没落地：产出迟迟没出现').toBeVisible({ timeout: doneTimeout })
    await expect(running, '这一轮没落地：composer 迟迟不退出运行态').toBeHidden({ timeout: doneTimeout })
    return
  }
  await expect(running, '这一轮没起飞：点了发送但 composer 始终没进入运行态').toBeVisible({ timeout: startTimeout })
  await expect(running, '这一轮没落地：composer 迟迟不退出运行态').toBeHidden({ timeout: doneTimeout })
}

/**
 * 展开常驻面板。收起态是**真实的两态偏好**（持久化），不是加载中间态：
 * 收起时工作区里只剩画面下沿那一坞（`COLLAPSED_SHELL`），叫回面板的钮在**顶栏**那一格
 * （`COLLAPSED_DOCK`，09-01 定稿 §11.2）——所以点的是它，不是从收起外壳里找。
 */
export async function expandResidentPanel(win) {
  const collapsed = win.locator(COLLAPSED_SHELL)
  if (await collapsed.isVisible().catch(() => false)) {
    await clickOrFail(win.locator(COLLAPSED_DOCK_OPEN).first(), '展开常驻 Agent 面板')
  }
  await expect(win.locator(`${AGENT_PANEL} ${COMPOSER}`).first()).toBeVisible()
}

/**
 * 选模型。v4 的模型弹层每行只有**可见文字**（`labelZh || modelKey`）——没有 per-row 挂点，
 * 所以按名字选，而不是按 `vendorKey/modelKey` 身份串。夹具的名字由
 * `FIXTURE_TEXT_MODEL_LABEL` 单点持有，别在走查里手写。
 */
export async function chooseAssistantModel(win, modelLabel, panel = CREATION_PANEL) {
  await clickOrFail(win.locator(`${panel} ${COMPOSER_MODEL}`), '当前 Agent 模型选择器')
  const popover = win.locator(`${panel} ${MODEL_POPOVER}`)
  await expect(popover).toBeVisible()
  await clickOrFail(popover.getByRole('button', { name: new RegExp(escapeForRegExp(modelLabel)) }).first(), `当前 Agent 文本模型 ${modelLabel}`)
}

/** Playwright 的 name 正则要吃字面量文本，模型名里可能有 `.` `(` 之类。 */
export function escapeForRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function openCanvas(win) {
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '生成工作区')
  await expect(win.locator('.generation-canvas-v2__stage')).toBeVisible()
  // Host cutover retired the in-canvas assistant panel; the project Agent now lives in the
  // ResidentShell dock, resident by default since 2026-09-05.
  await expandResidentPanel(win)
  await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER}`)).toBeVisible()
}

async function sendThrough(win, panel, text, label) {
  const input = win.locator(`${panel} ${COMPOSER_INPUT}`)
  await expect(input).toBeVisible()
  await input.fill(text)
  // 发送钮空态是真 `disabled`（2026-09-06 拍板）：填完再点，别在空框上点。
  await clickOrFail(win.locator(`${panel} ${COMPOSER_SEND}`), label)
}

export async function sendCreation(win, text) {
  await sendThrough(win, CREATION_PANEL, text, '发送当前 Agent 指令')
}

export async function sendCanvas(win, text) {
  await sendThrough(win, CANVAS_PANEL, text, '发送当前 Agent 画布指令')
}

export async function sendPreview(win, text) {
  await sendThrough(win, PREVIEW_PANEL, text, '发送当前 Agent 剪辑指令')
}

export async function newConversation(win, panel) {
  await clickOrFail(win.locator(`${panel} ${HISTORY_BUTTON}`), '当前 Agent 会话列表')
  await clickOrFail(win.locator(THREAD_MENU).getByRole('button', { name: '新对话', exact: true }), '当前 Agent 新对话')
}

export async function selectConversation(win, panel, title) {
  await clickOrFail(win.locator(`${panel} ${HISTORY_BUTTON}`), '当前 Agent 会话列表')
  await clickOrFail(win.locator(THREAD_MENU).getByRole('button', { name: title, exact: true }), `恢复当前 Agent 会话 ${title}`)
}

/** Current Host threads may intentionally have no title; select by persisted order in that case. */
export async function selectConversationAt(win, panel, index) {
  await clickOrFail(win.locator(`${panel} ${HISTORY_BUTTON}`), '当前 Agent 会话列表')
  // 菜单第一行是「历史会话 / 新对话」那条头，线程行从第二个 div 起。
  const rows = win.locator(`${THREAD_MENU} > div`)
  await clickOrFail(rows.nth(index + 1).getByRole('button').first(), `恢复当前 Agent 第 ${index + 1} 个会话`)
}

/**
 * 介入槽的「不要」是**两下**（渐进披露）：第一下摊开拒绝原因，第二下「确认不要」才回给宿主。
 * 一次点击就否掉一个提案，手滑的成本是整回合重来——所以走查也必须走这两下。
 */
export async function rejectPendingIntervention(win, panel, reason) {
  const slot = win.locator(`${panel} ${APPROVAL_CARD}`)
  await expect(slot).toBeVisible()
  await clickOrFail(slot.locator(INTERVENTION_REJECT), '介入槽「不要」')
  const reasonInput = slot.locator(INTERVENTION_REJECT_REASON)
  await expect(reasonInput).toBeVisible()
  if (reason) await reasonInput.fill(reason)
  await clickOrFail(slot.locator(INTERVENTION_CONFIRM_REJECT), '介入槽「确认不要」')
}

export async function approvePendingIntervention(win, panel) {
  const slot = win.locator(`${panel} ${APPROVAL_CARD}`)
  await expect(slot).toBeVisible()
  await clickOrFail(slot.locator(INTERVENTION_CONFIRM), '介入槽「确认」')
}

export async function createRuntimeWalk(name) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--packaged' || !path.isAbsolute(args[1]))) {
    throw new Error('Usage: node <walk.mjs> [--packaged /absolute/Nomi.app/Contents/MacOS/Nomi]')
  }
  const executablePath = args[1]
  const mode = executablePath ? 'packaged' : 'development'
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-pi-${name}-`))
  const settingsDir = path.join(tempRoot, 'settings')
  const outputDir = path.join(repoRoot, '.tmp', `pi-${name}-${mode}-${Date.now()}`)
  fs.mkdirSync(outputDir, { recursive: true })
  const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
  const launches = []
  const screenshots = []
  const report = { name, mode, tempRoot, outputDir, launches, screenshots, paidCalls: 0 }
  let current

  async function start({ first = false } = {}) {
    current = await launchNomiApp({
      name: `pi-${name}`, tempRoot, settingsDir, settleMs: 0,
      ...(executablePath ? { executablePath } : {}),
      env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
      args: ['--no-proxy-server'],
    })
    const { win, app } = current
    win.setDefaultTimeout(30_000)
    const info = await app.evaluate(({ app: mainApp }) => ({
      packaged: mainApp.isPackaged, appPath: mainApp.getAppPath(), userData: mainApp.getPath('userData'),
      node: process.versions.node, electron: process.versions.electron, pid: process.pid,
    }))
    expect(info.packaged).toBe(Boolean(executablePath))
    expect(info.userData).toBe(current.userDataDir)
    if (executablePath) expect(info.appPath.endsWith('app.asar')).toBe(true)
    launches.push(info)
    if (first) {
      // Onboarding/locale preferences only. No project, tool, task or result is seeded.
      await win.evaluate(() => {
        localStorage.setItem('nomi:locale:v1', 'zh-CN')
        localStorage.setItem('nomi-color-scheme', 'light')
        for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
          localStorage.setItem(key, 'seen')
        }
      })
      await win.reload({ waitUntil: 'domcontentloaded' })
    }
    expect(win.url().startsWith('file:')).toBe(true)
    return current
  }

  async function newProject() {
    const { win } = current
    await clickOrFail(win.getByRole('button', { name: /^新建空白项目/ }), '新建空白项目')
    await expect(win.locator(DOCUMENT)).toBeVisible({ timeout: 30_000 })
    const projectId = await win.evaluate(() => {
      const url = new URL(location.href)
      return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
    })
    expect(projectId).toMatch(/^project-/)
    const summaries = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
    const project = summaries.find((item) => item.id === projectId)
    expect(project?.rootPath, 'The real created project must have a canonical isolated folder').toBeTruthy()
    expect(path.relative(current.projectsDir, project.rootPath).startsWith('..')).toBe(false)
    report.projectId = projectId
    report.projectRoot = project.rootPath
    return { projectId, projectRoot: project.rootPath, name: project.name }
  }

  async function snap(label) {
    const file = path.join(outputDir, `${String(screenshots.length + 1).padStart(2, '0')}-${label}.png`)
    await screenshotSettled(current.win, { path: file })
    screenshots.push(file)
    return file
  }

  async function stopApp() {
    if (!current) return
    const closed = current
    current = undefined
    await stopRuntimeApp(closed.app)
  }

  async function finish(error) {
    if (error && current) {
      try { await current.win.screenshot({ path: path.join(outputDir, 'FAIL.png') }) }
      catch (captureError) { console.error('Failure screenshot unavailable:', captureError.message) }
    }
    await finalizeRuntimeWalk(report, {
      error, cleanup: [stopApp, () => fixture.close()],
      collect: () => {
        Object.assign(report, { textRequests: fixture.requests.length, imageRequests: fixture.images.length, unexpected: fixture.unexpected })
        fixture.assertClean() // Includes requests received during app teardown, after the body checkpoint.
      },
    })
  }

  return { fixture, report, outputDir, start, newProject, snap, stopApp, finish }
}
