// Shared, isolated Electron setup for the pi cutover's real user-task walks.
// Business actions stay in the walks: this file only launches, observes and records.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled } from './_assert.mjs'
import { createAgentRuntimeFixture, FIXTURE_APIMART_API_KEY, FIXTURE_NON_APIMART_VENDOR, FIXTURE_TEXT_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import { require as tsxRequire } from 'tsx/cjs/api'

const { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG } = tsxRequire('../../electron/agentLane/laneToolCatalog.ts', import.meta.url)
const { LANE_CODING_TOOL_NAMES } = tsxRequire('../../electron/agentLane/laneCodingTools.mts', import.meta.url)

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
/**
 * 对话列表里「一条对话」那一行。菜单的直接子 `div` 不全是对话：第一格是表头（「对话 · 新对话」），
 * 414bf19a9（2026-09-10）起末尾还多一格「查看轨迹」——数 `> div` 会把它也数进去。
 * 认行的判据是这一行自己带的那颗「删除对话」钮。
 */
export const THREAD_ROW = `${THREAD_MENU} > div:has(> button[aria-label="删除对话"])`

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
/**
 * 过程行：一段工作（工具调用 + 思考）折成的那一块 `<details>`，**默认收起**
 * （33b30b851，2026-09-09「One process per work stretch」——单个工具调用也折）。
 * 收据（`TOOL_RECEIPT`）和它行尾那颗「撤销」都住在里面：收起时它们在 DOM 里却不可见，
 * 于是 `toBeVisible` 等满超时、`getByRole` 找不到按钮，而「看不到撤销钮」那类断言恒真（假绿）。
 * 要看收据，先像用户那样点开它（`openProcess`）。
 */
export const PROCESS = '[data-v4-block="process"]'
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
/**
 * 卡上那颗否定动作（×）。2026-09-22 换壳后它由 `V4SlotShell` 统一摆在**右上**，
 * 锚点随之从 `reject` 改成 `slot-dismiss`——它不再是页脚里的一颗钮，而是外壳的零件。
 * 常量在这里改一次，全部走查跟着走（这就是它当初被抽成常量的理由）。
 */
export const INTERVENTION_REJECT = '[data-v4-control="slot-dismiss"]'
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

/** The real desktop assembly publishes domain and native schemas from the first request. */
export function residentToolNames() {
  return [...LANE_MODEL_TOOL_CATALOG, ...LANE_DEFERRED_TOOL_CATALOG].map(tool => tool.name)
    .concat([...LANE_CODING_TOOL_NAMES, 'list_models', 'nomi_request_tools']).sort()
}

export function toolNames(body) {
  return (body.tools ?? []).map((tool) => tool.function.name).sort()
}

export function hasToolResult(body, id) {
  return (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === id)
}

/**
 * 像人一样把一张待决的报价卡关掉：点 ×，卡要是先问一句「改的内容会一起丢」就再点确认。
 *
 * 2026-09-22 裁决 A 之后 `generate` 的回合**挂在这张卡上等用户**；一条走查要是看完卡就走，
 * 那个回合永远不结束，夹具里那条「回合收尾」的期望也就永远没人消费。看完就该答——真人也是。
 */
export async function closeSpendCard(card, label = '关掉这张报价卡') {
  const confirm = card.locator(INTERVENTION_CONFIRM_REJECT)
  if (!(await confirm.isVisible().catch(() => false))) await clickOrFail(card.locator(INTERVENTION_REJECT), label)
  if (await confirm.isVisible().catch(() => false)) await clickOrFail(confirm, `${label}（确认）`)
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

export function readProjectAgentProposalReceipt(projectRoot) {
  const receiptFile = path.join(projectRoot, '.nomi', 'project-agent-proposal-receipt.json')
  if (!fs.existsSync(receiptFile)) return null
  return JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
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
 * 选模型。弹层是**每类一行**（对话 / 图片默认 / 视频默认），每行行尾一个 `NomiSelect`——
 * 所以路径是「开弹层 → 开对话那一行的下拉 → 按名字挑」，不是直接点一行。
 * 夹具的名字由 `FIXTURE_TEXT_MODEL_LABEL` 单点持有，别在走查里手写。
 *
 * （2026-09-06 之前这里点的是「一个模型一行」的 button——那一版把整个文本模型目录
 * 摊成 17 行、行首标签全写「对话」，既不是拍板的形状也没有下拉。）
 */
export async function chooseAssistantModel(win, modelLabel, panel = CREATION_PANEL) {
  await clickOrFail(win.locator(`${panel} ${COMPOSER_MODEL}`), '当前 Agent 模型选择器')
  const popover = win.locator(`${panel} ${MODEL_POPOVER}`)
  await expect(popover).toBeVisible()
  const chatRow = popover.locator('[data-v4-model-row]').first()
  await clickOrFail(chatRow.locator('button').first(), '对话那一行的模型下拉')
  const option = win.locator('[data-nomi-select-dropdown] [data-nomi-select-option-label]')
    .filter({ hasText: new RegExp(escapeForRegExp(modelLabel)) })
    .first()
  await clickOrFail(option, `当前 Agent 文本模型 ${modelLabel}`)
}

/** Playwright 的 name 正则要吃字面量文本，模型名里可能有 `.` `(` 之类。 */
export function escapeForRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 点开一块收起的过程行（见 `PROCESS`）。已经开着就不动它——再点一下是把它合上。 */
export async function openProcess(process, label = '展开运行过程') {
  await expect(process, '这一轮没有留下过程行').toBeVisible()
  if (await process.getAttribute('open') === null) await clickOrFail(process.locator(':scope > summary'), label)
  await expect(process, `${label}：点了没展开`).toHaveAttribute('open', '')
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

/** Select the actual rendered lane row when its title is intentionally empty. */
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

/**
 * @param {string} name
 * @param {{generationProvider?: 'loopback'|'apimart'|'higgsfield', videoResultPath?: string, env?: Record<string, string>}} [options]
 *   `generationProvider: 'apimart'` = 这条走查要走**真实那条生成供应商路径**：目录里装内置 apimart
 *   档案与 curated mapping，供应商地址由 `NOMI_E2E_PRODUCTION_FIXTURE` 那个只认 loopback 的口子
 *   指到本机这台夹具。不传 = 老样子（自造 loopback 供应商，只跑 SDK/画布那半边，按付费确认键会被
 *   宿主在供应商就绪那一步诚实拒绝）。
 *   `videoResultPath` 透传给夹具（出片地址的路径段）；`env` 追加到被测 App 的进程环境（如把公网出口指到一个
 *   只记账不放行的本地代理，证明走查碰不到真供应商）。都不传 = 老样子。
 */
export async function createRuntimeWalk(name, { generationProvider = 'loopback', videoResultPath, env: extraEnv = {} } = {}) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--packaged' || !path.isAbsolute(args[1]))) {
    throw new Error('Usage: node <walk.mjs> [--packaged /absolute/Nomi.app/Contents/MacOS/Nomi]')
  }
  const executablePath = args[1]
  const mode = executablePath ? 'packaged' : 'development'
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-pi-${name}-`))
  const settingsDir = path.join(tempRoot, 'settings')
  // 显式给出、并原样交给启动器：付费走查要在起 App 之前往这里放凭据钥匙（Windows 的 Local State，
  // 见 _realProfile.mjs），它必须和 App 真正用的 userData 是同一个目录，不能靠两边各自猜默认值。
  const userDataDir = path.join(tempRoot, 'user-data')
  const outputDir = path.join(repoRoot, '.tmp', `pi-${name}-${mode}-${Date.now()}`)
  fs.mkdirSync(outputDir, { recursive: true })
  // safeStorage 的加密身份 = app 名。开发态跑的是仓库目录（package.json 的 `nomi`），
  // `--packaged` 跑的是打包后的 `Nomi`。给错只会解出 `locked`，模型照样显示为不可用。
  const fixture = await createAgentRuntimeFixture({
    rootDir: repoRoot, settingsDir, generationProvider,
    ...(videoResultPath ? { videoResultPath } : {}),
    ...(generationProvider === 'apimart' || generationProvider === 'higgsfield'
      ? { userDataDir, appName: executablePath ? 'Nomi' : 'nomi' }
      : {}),
  })
  const launches = []
  const screenshots = []
  const report = { name, mode, tempRoot, outputDir, launches, screenshots, paidCalls: 0 }
  let current

  async function start({ first = false } = {}) {
    // 受限 shell/CI 注入额外 chromium 参数用（如 --no-sandbox --disable-gpu-sandbox）：
    // 逗号分隔，默认空 → 正常桌面/CI 行为不变；仅在需要关 sandbox/gpu 的环境显式设置。
    const extraArgs = (process.env.NOMI_E2E_CHROMIUM_ARGS || '')
      .split(',')
      .map((arg) => arg.trim())
      .filter(Boolean)
    current = await launchNomiApp({
      name: `pi-${name}`, tempRoot, settingsDir, userDataDir, settleMs: 0,
      ...(executablePath ? { executablePath } : {}),
      ...(name === 'golden-path' ? {
        initialLocalStorage: {
          'nomi:locale:v1': 'zh-CN',
          'nomi.assistantModel': JSON.stringify({ vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_TEXT_MODEL }),
        },
      } : {}),
      env: {
        ...extraEnv,
        NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_DISABLE_AUTO_UPDATE: '1',
        // 这三个是同一个口子的三把钥匙（`safeFixtureBaseUrl` 只接受 http(s) 的 127.0.0.1/localhost/::1）：
        // 少一把就装不出可提交的生成供应商。默认仍是 '0'，老走查一个字都不变。
        ...(generationProvider === 'apimart' || generationProvider === 'higgsfield'
          ? {
            NOMI_E2E_PRODUCTION_FIXTURE: '1',
            NOMI_E2E_FIXTURE_BASE_URL: fixture.baseURL,
            NOMI_E2E_FIXTURE_API_KEY: FIXTURE_APIMART_API_KEY,
            // 夹具只认一家；不点名就是 apimart（老走查一个字不变）。
            ...(generationProvider === 'higgsfield' ? { NOMI_E2E_FIXTURE_VENDOR: FIXTURE_NON_APIMART_VENDOR } : {}),
          }
          : { NOMI_E2E_PRODUCTION_FIXTURE: '0' }),
      },
      args: ['--no-proxy-server', ...extraArgs],
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

  /**
   * 把内容区调成指定尺寸，返回调之前那份内容区尺寸（调回去用）。
   *
   * 有些事只有在**真实的小窗**里才发生：最小窗 1100×720（`electron/main.ts` 的 minWidth/minHeight）
   * 下面板只剩 476 高，对话流这才真的溢出——「展开回来还停在原处」那条断言也才有信号可言。
   * 在默认大窗里流根本装得下，滚动位置恒 0，前后相等是个恒真式。
   *
   * 原生窗口与 Playwright 视口**两层一起改**：`_launchApp` 从 7f9436c23（2026-09-09）起用视口仿真把内容区
   * 钉在验收尺寸，此后只 `setBounds` 的话窗口是缩了，`innerWidth` 却纹丝不动——渲染层看到的还是 1280 宽，
   * 面板宽度上限按 1280 算（Windows 真机实测：窗口 1100×721，innerWidth 1280）。调完当场核对，没变成就报红。
   */
  async function resizeWindow(width, height) {
    const { app, win } = current
    const previous = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const browserWindow = await app.browserWindow(win)
    await browserWindow.evaluate((windowRef, size) => {
      windowRef.setContentSize(size.width, size.height)
      windowRef.center()
    }, { width, height })
    await win.setViewportSize({ width, height })
    const actual = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    if (actual.width !== width || actual.height !== height) {
      throw new Error(`resizeWindow：内容区没变成 ${width}×${height}，实际 ${actual.width}×${actual.height}`)
    }
    return previous
  }

  async function stopApp() {
    if (!current) return
    const closed = current
    current = undefined
    await stopRuntimeApp(closed.app)
  }

  /**
   * `collect`：App 关掉之后再取的证据（付费走查的收据、原库指纹）；抛错 = 这一场判红。
   * `unscriptedFixture`：这一场根本没给夹具写剧本（付费走查的大脑和供应商都是真的）。那么夹具收到的
   * 只可能是 App 自己发起的后台调用——例如出图后的镜级自评落到目录里第一个文本模型上——
   * 如实记进报告（路径 + 请求里第一句话），不判红：它们不是这条走查在测的东西，也不花钱。
   */
  async function finish(error, { collect, unscriptedFixture = false } = {}) {
    if (error && current) {
      try { await current.win.screenshot({ path: path.join(outputDir, 'FAIL.png') }) }
      catch (captureError) { console.error('Failure screenshot unavailable:', captureError.message) }
    }
    await finalizeRuntimeWalk(report, {
      error, cleanup: [stopApp, () => fixture.close()],
      collect: async () => {
        if (unscriptedFixture) {
          report.backgroundFixtureCalls = fixture.unexpected.map((record) => ({
            path: record.path,
            firstUserLine: flattenRequestText({ messages: (record.body?.messages ?? []).filter((message) => message?.role === 'user').slice(-1) })
              .trim().split('\n')[0].slice(0, 80),
          }))
        } else {
          Object.assign(report, { textRequests: fixture.requests.length, imageRequests: fixture.images.length, unexpected: fixture.unexpected })
          fixture.assertClean() // Includes requests received during app teardown, after the body checkpoint.
        }
        return collect?.()
      },
    })
  }

  return { fixture, report, outputDir, settingsDir, userDataDir, start, newProject, snap, resizeWindow, stopApp, finish }
}
