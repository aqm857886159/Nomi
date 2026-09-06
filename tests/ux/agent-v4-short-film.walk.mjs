#!/usr/bin/env node
// 真实用户任务走查（R16）：**让 Agent 从零做一条 20 秒短片**。
//
// 不是功能探索，是一个人带着一个目标走完全程：写脚本 → 改文稿 → 去画布生成 → 中途改主意
// 停下来 → 关掉重开发现东西还在。v4 接线之后每一步都由宿主数据驱动，所以这条走查同时
// 是接线的行为证据：设计实验室的基线证明「同样的 view model 长同样的样子」，
// 单测证明「同样的宿主真相产出同样的 view model」，这里证明「人按下去真的发生了事情」。
//
// 零额度：供应商是 loopback（`agent-runtime-fixture.mjs`），每一次模型调用都要预先声明，
// 没声明的请求会被 400 并在收尾时报出来。不碰任何真实生成 API。
//
// 用法：node tests/ux/agent-v4-short-film.walk.mjs
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD,
  ASSISTANT_MESSAGE,
  CANVAS_PANEL,
  APP_BAR_RIGHT,
  COLLAPSED_DOCK,
  COLLAPSED_DOCK_BADGE,
  COLLAPSED_DOCK_HINT,
  COLLAPSED_DOCK_OPEN,
  COLLAPSED_DOCK_SETTLE,
  COLLAPSED_SHELL,
  COMPOSER,
  COMPOSER_INPUT,
  COMPOSER_PERMISSION,
  COMPOSER_SEND,
  CONTEXT_RING,
  CREATION_PANEL,
  COLLAPSE_BUTTON,
  DOCUMENT,
  EMPTY_STARTER,
  EMPTY_STATE,
  PERMISSION_POPOVER,
  TOOL_RECEIPT,
  USER_BUBBLE,
  V4_FLOW,
  V4_PANEL,
  approvePendingIntervention,
  chooseAssistantModel,
  createRuntimeWalk,
  expandResidentPanel,
  hasToolResult,
  openCanvas,
  permissionTier,
  recorded,
  rejectPendingIntervention,
  requireCurrentPersistedWorkbenchDocument,
  readProject,
  sendCanvas,
  sendCreation,
  waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

// 空态第一条起手（创作面 = 写脚本）。它的字住 i18n（`agentPanelV4.starterWriteScriptPrompt`），
// 这里抄一份是为了断言「chip 填进去的就是这句」；两边漂了这条走查会当场红。
const STARTER_FIRST = '把我的想法写成一版脚本'
const BRIEF = '我要做一条 20 秒的短片：咖啡馆推门那段。先把脚本写出来。'
const SCRIPT = '清晨，她推开咖啡馆的门。红色杯子落在白色桌面上，侧光打在杯沿。她坐下，按下录制键。'
const TIGHTEN = '把结尾收紧一点，别拖。'
const TIGHTEN_APPLIED = 'ENDING_TIGHTENED：她按下录制键，画面定格。'
const TIGHTEN_TOOL = 'v4-doc-tighten-1'
const REFUSED = '再把开头也删掉。'
const REFUSED_TOOL = 'v4-doc-delete-1'
const REFUSED_TEXT = 'HEAD_DELETED：不该出现在文稿里'
const REFERENCE = '给这 4 镜生成参考图。'
const REFERENCE_TOOL = 'v4-canvas-plan-1'
const SLOW = '再想想整体节奏。'
// 收起/展开要验「他读到哪儿了」，就得有一条**真的翻得动**的对话。收据的展开是 DOM 上的
// `<details open>`，收起时随子树一起没了，撑不起溢出；只有落进流里的消息才留得下来。
const RECAP = '把这 4 镜按顺序完整列一遍，我要打印出来贴墙上。'
const RECAP_TEXT = [
  '镜 1｜清晨的街，门牌与霓虹熄灭的余温；手持，轻微呼吸感；3 秒。',
  '镜 2｜她推门，铜铃响；门缝里的光切进室内；侧光贴着侧脸；4 秒。',
  '镜 3｜红色杯子落在白桌面上，热气斜着走；微距，焦点从杯沿滑到指节；5 秒。',
  '镜 4｜她坐下，按下录制键；机身红点亮起，环境声压低；定格 3 秒。',
  '整段 20 秒，节奏是「街—门—杯—人」，前两镜给环境，后两镜收到她身上。',
].join('\n')

const walk = await createRuntimeWalk('v4-short-film')
let failure
try {
  let { win } = await walk.start({ first: true })
  const project = await walk.newProject()
  const { projectId } = project
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)

  // ── 1. 冷启动：面板是空的，但不该是**沉默**的 ──────────────────────────────
  const panel = win.locator(CREATION_PANEL)
  await expect(panel.locator(COMPOSER)).toBeVisible()
  // 上下文环在还没有任何回合时**不知道**用了多少——它必须写「—」而不是「0%」。
  // 「0%」是一个断言（「你几乎没用上下文」），而我们那一刻连模型多大都不知道。
  await expect(panel.locator(CONTEXT_RING)).toContainText('—')
  await expect(panel.locator(`${CONTEXT_RING}[data-context-known="true"]`)).toHaveCount(0)
  // 空框的发送钮是真 disabled，不是「灰着但能按」。
  await expect(panel.locator(COMPOSER_SEND)).toBeDisabled()
  // 面板主体不能是一片白：一句话说清这里能干什么 + 三条**这个面真做得到**的起手。
  const empty = panel.locator(EMPTY_STATE)
  await expect(empty).toBeVisible()
  await expect(empty).toHaveAttribute('data-v4-empty-surface', 'creation')
  await expect(empty.locator(EMPTY_STARTER)).toHaveCount(3)
  await walk.snap('01-cold-start')

  // 点第一颗起手 = 把那句话交给 composer 并把光标给用户，**不替他发送**。
  await clickOrFail(empty.locator(EMPTY_STARTER).first(), '空态第一条起手')
  await expect(panel.locator(COMPOSER_INPUT)).toHaveValue(STARTER_FIRST)
  await expect(panel.locator(COMPOSER_SEND)).toBeEnabled()
  // 「没发出去」的正面证据：真发了就会多一条用户气泡、空态也就永远消失了。
  // 这里断言空态**还在**，而不是断言气泡不存在——后者本来就是 0，采样恒真（假绿）。
  await expect(empty).toBeVisible()
  await expect(panel.locator(V4_FLOW).locator(USER_BUBBLE)).toHaveCount(0)
  await walk.snap('01b-starter-filled')
  await panel.locator(COMPOSER_INPUT).fill('')

  // 收起角标的**空闲**档（09-01 定稿 §11.2：收起态 = 顶栏右簇「浏览器」与「设置」之间那一格）。
  // 什么都没发生时角标素着：一颗永远亮着的点等于没有状态。
  await clickOrFail(panel.locator(COLLAPSE_BUTTON), '收起面板')
  const coldCollapsed = win.locator(COLLAPSED_SHELL)
  const coldDock = win.locator(COLLAPSED_DOCK)
  await expect(coldDock, '收起后顶栏必须有那一格角标').toBeVisible()
  // **落位**：它必须住顶栏右簇里，不是画在面板自己的地盘上（那样切一个面就换一个落点）。
  await expect(win.locator(`${APP_BAR_RIGHT} ${COLLAPSED_DOCK}`), '角标必须在顶栏右簇').toBeVisible()
  const collapsedShellDockCount = await coldCollapsed.locator(COLLAPSED_DOCK).count()
  if (collapsedShellDockCount !== 0) throw new Error('收起角标不该再画在面板的地盘上（09-01 §11.2：家在顶栏）')
  // 同格只出一颗：互斥角标与收起角标共用这一个组件，全窗口任何时候都只该有一颗。
  const dockCount = await win.locator(COLLAPSED_DOCK).count()
  if (dockCount !== 1) throw new Error(`同格只出一颗角标，实测 ${dockCount} 颗`)
  await expect(coldDock).toHaveAttribute('data-agent-dock-status', 'idle')
  await expect(coldDock).toHaveAttribute('data-agent-dock-badge-kind', 'none')
  const coldDockProof = await proveProbe(coldDock, '空闲态的收起角标确实渲出来了')
  await expectAbsent(coldDock.locator(COLLAPSED_DOCK_BADGE), {
    provenBy: coldDockProof,
    message: '空闲的角标上不该叠任何东西',
  })
  // 收起藏的是对话流，不是对话：同一个 composer 掉到画面下沿。
  await expect(coldCollapsed.locator(COMPOSER)).toBeVisible()
  await walk.snap('01c-collapsed-idle')
  await clickOrFail(coldDock, '点顶栏角标展开面板')
  // 展开回来的面板必须是**有身量的**：收起时面板挂点从文档里摘掉、浏览器报 0×0，
  // 早先那版尺寸 hook 再也没重新量过它，于是展开后是一块 2×2 的空白面板（2026-09-06 实测）。
  // 断言宽度而不是「flow 可见」：flow 在 0 高的面板里照样"可见"。
  await expect(panel.locator(V4_FLOW)).toBeVisible()
  await expect.poll(async () => (await win.locator(`${CREATION_PANEL} ${V4_PANEL}`).boundingBox())?.width ?? 0,
    { message: '展开回来的面板不能是 0 宽——收起把尺寸量成 0 之后没人重新量它', timeout: 30_000 }).toBeGreaterThan(200)

  // ── 2. 写脚本：一条普通对话 ───────────────────────────────────────────────
  const briefTurn = walk.fixture.expectText({
    label: 'agent writes the 20s script',
    match: (body) => flattenRequestText(body).includes(BRIEF),
    reply: { type: 'text', text: SCRIPT },
  })
  await sendCreation(win, BRIEF)
  await recorded(briefTurn.received, 'script request')
  // 出站请求已经到了 loopback——那就是这一轮「起飞」的证据，比等 composer 那一帧可靠：
  // loopback 回得比断言轮询还快，运行态可能整帧都没被采到。落地由**产出**证明。
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).first() })
  await expect(panel.locator(USER_BUBBLE).first()).toContainText('20 秒')
  await expect(panel.locator(ASSISTANT_MESSAGE).first()).toContainText('推开咖啡馆的门')
  // 回合结算后环上必须是**量出来的**数。夹具目录没写 contextWindow，所以仍然是「—」——
  // 这正是「缺字段就不渲染」那条纪律的真机断言：有 token 数不等于知道分母。
  await expect(panel.locator(CONTEXT_RING)).toContainText('—')
  await walk.snap('02-script-written')

  const doc = win.locator(DOCUMENT)
  await doc.fill(SCRIPT)
  await expect(doc).toHaveText(SCRIPT)

  // ── 3. 权限三档：切到「每步问」，验证它没有比它该有的更宽 ────────────────
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), 'composer 权限档')
  const permissionPopover = panel.locator(PERMISSION_POPOVER)
  await expect(permissionPopover).toBeVisible()
  await expect(permissionPopover.locator('[data-tier]')).toHaveCount(3)
  await expect(permissionPopover.locator('[data-tier][data-active="true"]')).toHaveAttribute('data-tier', 'safe-auto')
  await walk.snap('03-permission-popover')
  await clickOrFail(panel.locator(permissionTier('step')), '权限档「每步问」')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'step')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-spend-policy', 'confirm')

  // ── 4. 「每步问」下改文稿：介入槽出现 → 确认 → 收据 ──────────────────────
  const tightenRequest = walk.fixture.expectText({
    label: 'agent proposes tightening the ending',
    match: (body) => flattenRequestText(body).includes(TIGHTEN) && !hasToolResult(body, TIGHTEN_TOOL),
    reply: { type: 'tool', id: TIGHTEN_TOOL, name: 'nomi_document_edit', args: { operation: 'append', content: TIGHTEN_APPLIED } },
  })
  const tightenFollowup = walk.fixture.expectText({
    label: 'tighten result returns to the model',
    match: (body) => hasToolResult(body, TIGHTEN_TOOL),
    reply: { type: 'text', text: '已按你的确认收紧结尾。' },
  })
  await sendCreation(win, TIGHTEN)
  await recorded(tightenRequest.received, 'document edit proposal')
  const slot = panel.locator(APPROVAL_CARD)
  await expect(slot).toBeVisible()
  // 可撤销的改动才有「不再问 →」，而且它只覆盖这一个能力——范围那一行必须说清楚。
  await expect(slot).toHaveAttribute('data-kind', 'approval-reversible')
  await expect(slot).toContainText('只对这一个操作生效')
  await walk.snap('04-intervention-approval')
  // 带着这条待决收起：logo 上的数字角标读的**就是**这批待决，不是一个自己会亮的装饰；
  // 而介入槽跟着 composer 一起留在画面下沿——收起之后照样读得到、批得下。
  await clickOrFail(panel.locator(COLLAPSE_BUTTON), '带着一条待确认收起面板')
  const pendingCollapsed = win.locator(COLLAPSED_SHELL)
  const pendingDock = win.locator(COLLAPSED_DOCK)
  await expect(pendingDock).toHaveAttribute('data-agent-dock-status', 'needs-confirm')
  // 数字徽标 = 未读条数，而这一刻的未读**就是**那条待决——两处对不上，收起态就是在撒谎。
  await expect(pendingDock).toHaveAttribute('data-agent-dock-count', '1')
  await expect(pendingDock.locator(COLLAPSED_DOCK_BADGE)).toHaveAttribute('data-agent-dock-badge', 'count')
  await expect(pendingDock.locator(COLLAPSED_DOCK_BADGE)).toContainText('1')
  // 「刚变过」是一段 420ms 的时间，不是一个常挂的属性：等它自己停，别把常闪当成状态。
  await expect(pendingDock.locator(COLLAPSED_DOCK_SETTLE), 'settle 脉冲必须自己停下来').toHaveCount(0, { timeout: 5_000 })
  // tooltip 用人话点名那条待决（角标本身只有点与数字两种长相，五档靠这句话分）。
  await pendingDock.hover()
  // Radix 的 tooltip 内容里那句话有两份（看得见的一份 + 给读屏的一份），所以判包含不判全等。
  await expect(win.locator(COLLAPSED_DOCK_HINT)).toContainText('等你确认 1 条')
  await expect(pendingDock).toHaveAttribute('aria-label', '展开 Nomi · 等你确认 1 条')
  await expect(pendingCollapsed.locator(APPROVAL_CARD), '收起态也读得到介入槽').toBeVisible()
  await walk.snap('04b-collapsed-needs-confirm')

  // 「有新动静」这件事只有在**收起期间**真的来了东西时才验得到，所以就在收起态里把这条待决批掉：
  // 介入槽本来就跟着 composer 留在下沿，批得下才是「收起没有中断对话」的证据。
  //
  // 脉冲用 MutationObserver 数**开关次数**，不用截图或 sleep 去撞那 420ms：
  // 定稿说的是「settle 420ms **单次**」——要证的是「只闪一次然后停」，
  // 而「某一帧看见它亮着」既证不了单次也证不了会停（`race-repro-needs-positive-control` 那族坑）。
  await win.evaluate(() => {
    const chip = document.querySelector('[data-agent-topbar-badge="true"]')
    if (!chip) throw new Error('顶栏角标不在，装不了脉冲观察器')
    window.__nomiSettlePulses = 0
    const seen = new WeakSet()
    const scan = () => {
      for (const node of chip.querySelectorAll('[data-agent-dock-settle="true"]')) {
        if (seen.has(node)) continue
        seen.add(node)
        window.__nomiSettlePulses += 1
      }
    }
    scan()
    window.__nomiSettleObserver = new MutationObserver(scan)
    window.__nomiSettleObserver.observe(chip, { subtree: true, attributes: true, childList: true })
  })
  await approvePendingIntervention(win, COLLAPSED_SHELL)
  // 待决批掉了 → 角标不再是那条待决；工具跑完 / 新回复落进流里 → 未读接上，角标改口。
  await expect.poll(async () => await pendingDock.getAttribute('data-agent-dock-badge-kind'),
    { message: '收起期间来了新动静，顶栏那格必须接住', timeout: 60_000 }).not.toBe('none')
  await expect(pendingDock).not.toHaveAttribute('data-agent-dock-status', 'needs-confirm')
  await walk.snap('04c-collapsed-new-activity')
  // 脉冲必须自己停：420ms 之后属性不再挂在任何一格上。
  await expect(pendingDock.locator(COLLAPSED_DOCK_SETTLE), 'settle 脉冲必须自己停下来').toHaveCount(0, { timeout: 5_000 })
  const pulses = await win.evaluate(() => {
    window.__nomiSettleObserver?.disconnect()
    return window.__nomiSettlePulses
  })
  if (pulses < 1) throw new Error('收起期间来了新动静，角标一次脉冲都没有')
  if (pulses > 3) throw new Error(`settle 应当是每次变化**单次**脉冲，实测 ${pulses} 次——那是常闪不是落定`)

  await clickOrFail(pendingDock, '点顶栏角标展开面板')
  await expect(panel.locator(V4_FLOW)).toBeVisible()
  await recorded(tightenFollowup.received, 'approved document tool result')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(TOOL_RECEIPT).last() })
  await expect(doc).toContainText(TIGHTEN_APPLIED)
  await expect(panel.locator(TOOL_RECEIPT).last()).toBeVisible()
  await expect.poll(async () => JSON.stringify(requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))),
    { message: '确认过的改动必须真的落进项目，不只是气泡上说做了', timeout: 30_000 }).toContain(TIGHTEN_APPLIED)
  await walk.snap('05-approved-and-applied')

  // ── 5. 改主意：拒绝一次，并且带上原因 ────────────────────────────────────
  const refusedRequest = walk.fixture.expectText({
    label: 'agent proposes deleting the opening',
    match: (body) => flattenRequestText(body).includes(REFUSED) && !hasToolResult(body, REFUSED_TOOL),
    reply: { type: 'tool', id: REFUSED_TOOL, name: 'nomi_document_edit', args: { operation: 'append', content: REFUSED_TEXT } },
  })
  const refusedFollowup = walk.fixture.expectText({
    label: 'rejection returns to the model',
    match: (body) => hasToolResult(body, REFUSED_TOOL),
    reply: { type: 'text', text: '好，开头保留。' },
  })
  await sendCreation(win, REFUSED)
  await recorded(refusedRequest.received, 'delete proposal')
  const rejectProof = await proveProbe(panel.locator(APPROVAL_CARD), '拒绝前介入槽确实浮出来了')
  await walk.snap('06-intervention-before-reject')
  await rejectPendingIntervention(win, CREATION_PANEL, '开头是全片的锚，先留着')
  await recorded(refusedFollowup.received, 'rejected tool result')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).last() })
  await expectAbsent(panel.locator(APPROVAL_CARD), { provenBy: rejectProof, message: '拒绝之后介入槽必须收掉' })
  await expect(doc).not.toContainText(REFUSED_TEXT)
  // 用户点的「不要」必须记成**拒绝**，不是失败：行尾写「已拒绝」而不是「失败」。
  // 少一个 `denied: true` 就会把用户的决定记成系统故障——历史里读起来完全是两件事。
  await expect(panel.locator(`${TOOL_RECEIPT}[data-status="output-denied"]`).last()).toBeVisible()
  await walk.snap('07-rejected')

  // 切回「自动改」：档位是**面板上唯一的授权控件**，切回来必须真的切回来。
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), 'composer 权限档')
  await clickOrFail(panel.locator(permissionTier('safe-auto')), '权限档「自动改」')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'safe-auto')

  // ── 5.5 最小窗 + 收起：藏的是面板，不是「我读到哪儿了」 ────────────────────
  //
  // 09-01 定稿 §11.2 最小窗态说的是 **1100×720**（`electron/main.ts:299-300` 锁死的那个数）：
  // 面板**仍可停靠、不强制收起**，拖宽上限收到 min(600, 1100−760) = 340。所以先把窗口调到那个数，
  // 在真实最小窗里验；顺带这也是唯一能让对话流真的溢出的地方——默认大窗里这几条消息装得下，
  // scrollTop 恒 0，「收起前后相等」会是个恒真式（`race-repro-needs-positive-control`）。
  // 先让这条对话真的长起来：一条镜头清单落进流里，收起再展开也还在。
  const recapTurn = walk.fixture.expectText({
    label: 'agent recaps the four shots',
    match: (body) => flattenRequestText(body).includes(RECAP),
    reply: { type: 'text', text: RECAP_TEXT },
  })
  await sendCreation(win, RECAP)
  await recorded(recapTurn.received, 'recap request')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).last() })
  await expect(panel.locator(ASSISTANT_MESSAGE).last()).toContainText('街—门—杯—人')

  const roomyBounds = await walk.resizeWindow(1100, 720)
  await expect(panel.locator(V4_PANEL), '最小窗下面板仍可停靠，不强制收起').toBeVisible()
  await expect.poll(async () => Math.round((await panel.locator(V4_PANEL).boundingBox())?.width ?? 0),
    { message: '最小窗下面板宽必须收在上限 340 之内（min(600, 1100−760)）', timeout: 30_000 })
    .toBeLessThanOrEqual(340)

  // 收起会把对话流那棵子树整个摘掉。展开时若一律跟到底，翻着历史顺手收起的人再点开
  // 就被弹回最新一条——「收起」于是成了一个会悄悄弄丢阅读位置的动作（定稿 §11.2：原宽**原状态**还原）。
  const creationFlow = win.locator(`${CREATION_PANEL} ${V4_FLOW}`)
  const creationOverflow = await creationFlow.evaluate((node) => node.scrollHeight - node.clientHeight)
  if (creationOverflow < 80) throw new Error(`最小窗下对话流只溢出 ${creationOverflow}px，滚动位置这条断言证不了任何东西`)
  // 停在**半路**（这里取最顶）而不是底：跟到底那条逻辑本来就会把底还原成底，
  // 只有翻在半路才分得出「把位置还回来」与「又跟了一次底」。
  await creationFlow.evaluate((node) => { node.scrollTop = 0 })
  await expect.poll(async () => await creationFlow.evaluate((node) => node.scrollTop),
    { message: '把对话流翻到顶这一步没生效' }).toBe(0)
  await clickOrFail(panel.locator(COLLAPSE_BUTTON), '翻在半路时收起面板')
  await expect(win.locator(COLLAPSED_DOCK), '最小窗收起后顶栏同样是那一格角标').toBeVisible()
  await clickOrFail(win.locator(COLLAPSED_DOCK), '点顶栏角标展开面板')
  await expect(panel.locator(V4_FLOW)).toBeVisible()
  await expect.poll(
    async () => await win.locator(`${CREATION_PANEL} ${V4_FLOW}`).evaluate((node) => node.scrollTop),
    { message: '展开必须停在收起前那个位置，不是把人弹回最新一条', timeout: 30_000 },
  ).toBe(0)
  await walk.snap('07b-min-window-collapse-restore')
  await walk.resizeWindow(roomyBounds.width, roomyBounds.height)

  // ── 6. 去画布：同一条对话跨面继续 ───────────────────────────────────────
  await openCanvas(win)
  const canvas = win.locator(CANVAS_PANEL)
  const referenceRequest = walk.fixture.expectText({
    label: 'agent drafts the reference shots',
    match: (body) => flattenRequestText(body).includes(REFERENCE) && !hasToolResult(body, REFERENCE_TOOL),
    reply: { type: 'tool', id: REFERENCE_TOOL, name: 'nomi_canvas_read', args: {} },
  })
  const referenceFollowup = walk.fixture.expectText({
    label: 'canvas read result returns to the model',
    match: (body) => hasToolResult(body, REFERENCE_TOOL),
    reply: { type: 'text', text: '画布上还没有镜头，我先按脚本排 4 镜。' },
  })
  await sendCanvas(win, REFERENCE)
  await recorded(referenceRequest.received, 'canvas request')
  await recorded(referenceFollowup.received, 'canvas tool result')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: canvas.locator(TOOL_RECEIPT).last() })
  await expect(canvas.locator(TOOL_RECEIPT).last()).toBeVisible()
  await walk.snap('08-canvas-surface')

  // ── 7. 停止三态：空闲 → 运行中 → 停下 ───────────────────────────────────
  const slowTurn = walk.fixture.expectText({
    label: 'a turn the user changes their mind about',
    match: (body) => flattenRequestText(body).includes(SLOW),
    reply: { type: 'hold' },
  })
  await sendCanvas(win, SLOW)
  await recorded(slowTurn.received, 'slow turn request')
  const running = canvas.locator(`${COMPOSER}[data-mode="running"]`)
  await expect(running).toBeVisible()
  // 运行中占位文案换成「可继续输入，将排队发送」——它是这一刻唯一在说话的东西。
  await expect(canvas.locator(COMPOSER_INPUT)).toHaveAttribute('placeholder', /排队/)
  await walk.snap('09-running')
  await clickOrFail(canvas.locator(`${COMPOSER}[data-mode="running"] ${COMPOSER_SEND}`), 'composer 停止')
  slowTurn.release({ type: 'text', text: '好，先停在这里。' })
  await expect(running, '停止之后 composer 必须退出运行态').toBeHidden({ timeout: 60_000 })
  await walk.snap('10-stopped')

  // ── 8. 收起：坏消息不会被收起吞掉 ─────────────────────────────────────────
  //
  // 2026-09-06 用户改：收起态不再是右侧那条满高 32px rail 上的两颗小 icon，
  // 而是 Nomi 一直延续的那枚 logo 钮（血统 `src/ui/app-shell/CollapsedAiChip.tsx`）。
  // 空闲档在 §1 已验、待确认档在 §4 已验（角标数字 = 那一刻真实的待决条数），这里验失败档。
  // 收起前先量一下面板宽：定稿说「点角标 = **原宽**原状态还原」（collapse≠unmount），
  // 所以还原之后这个数必须一模一样，不是「又一个默认 340」。
  const beforeCollapseWidth = Math.round((await win.locator(`${CANVAS_PANEL} ${V4_PANEL}`).boundingBox())?.width ?? 0)
  await clickOrFail(canvas.locator(COLLAPSE_BUTTON), '收起面板')
  const collapsed = win.locator(COLLAPSED_SHELL)
  await expect(collapsed).toBeVisible()
  await expect(collapsed.locator(COMPOSER)).toBeVisible()
  const dock = win.locator(COLLAPSED_DOCK)
  await expect(dock, '收起后顶栏必须有那一格角标').toBeVisible()
  await expect(win.locator(`${APP_BAR_RIGHT} ${COLLAPSED_DOCK}`), '生成面收起，角标还在顶栏同一格').toBeVisible()
  // 刚被停下的那一轮在面板上留了一条错误带。收起藏掉的是**面板**，不是那件事——
  // 角标必须把它接住，否则「收起」就成了一个悄悄吞掉坏消息的动作。
  // 失败不另画第五种图形（8px 里画不出「失败」）：保底一颗蓝点，坏消息由无障碍名/tooltip 说清。
  await expect(dock).toHaveAttribute('data-agent-dock-status', 'failed')
  await expect(dock).toHaveAttribute('data-agent-dock-badge-kind', 'dot')
  await expect(dock.locator(COLLAPSED_DOCK_BADGE)).toHaveAttribute('data-agent-dock-badge', 'dot')
  await expect(dock).toHaveAttribute('aria-label', '展开 Nomi · 有一步没成')
  await walk.snap('11-collapsed-failed')

  // 点顶栏角标展开：整条对话原样还在，收起从来没有中断过它。
  const widthBeforeCollapse = beforeCollapseWidth
  await clickOrFail(dock, '点顶栏角标展开面板')
  await expect(win.locator(`${CANVAS_PANEL} ${V4_FLOW}`)).toBeVisible()
  await expect.poll(async () => Math.round((await win.locator(`${CANVAS_PANEL} ${V4_PANEL}`).boundingBox())?.width ?? 0),
    { message: '点角标必须**原宽**还原，不是重置成默认宽', timeout: 30_000 }).toBe(widthBeforeCollapse)
  await expect(canvas.locator(USER_BUBBLE).last(), '展开后最后一句话还是收起前发的那句').toContainText('整体节奏')

  // ── 9. 关掉重开：昨天的活儿还在 ────────────────────────────────────────
  //
  // 这一段测的是**收据的七态 join 在冷启动之后仍然对**：重启后渲染层的待决登记表是空的，
  // 只剩宿主快照，所以每一条收据的状态必须完全由宿主说了算。判定顺序写反的话，
  // 这里会看到一条早就完成的调用被画成「待确认」。
  const requestsBeforeRestart = walk.fixture.requests.length
  await walk.stopApp()
  ;({ win } = await walk.start())
  await clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: project.name }), '冷重启后打开同一项目')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '创作工作区')
  await expandResidentPanel(win)
  const restored = win.locator(CREATION_PANEL)
  await expect(restored.locator(USER_BUBBLE).first(), '冷重启后对话流必须还在').toContainText('20 秒', { timeout: 60_000 })
  const restoredProof = await proveProbe(restored.locator(TOOL_RECEIPT), '冷重启后收据仍在流里')
  await expectAbsent(restored.locator(APPROVAL_CARD), {
    provenBy: restoredProof,
    message: '冷重启后不该有介入槽——待决登记表是空的，一条早就完成的调用被画成「待确认」就是七态 join 写反了',
  })
  // 重启本身不该产生任何模型调用：恢复读的是落盘的宿主状态，不是重跑一遍。
  expect(walk.fixture.requests).toHaveLength(requestsBeforeRestart)
  await walk.snap('12-cold-restart')

} catch (error) {
  failure = error
}
await walk.finish(failure)
