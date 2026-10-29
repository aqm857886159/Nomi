#!/usr/bin/env node
// 真实用户任务走查（R16）：**让 Agent 从零做一条 20 秒短片**。
//
// 不是功能探索，是一个人带着一个目标走完全程：写脚本 → 改文稿 → 去画布生成 → 中途改主意
// 停下来 → 关掉重开发现东西还在 → 重开后再让它改一下，服务商这回整条回错，收起面板后小球必须亮出「出错」。
// v4 接线之后每一步都由宿主数据驱动，所以这条走查同时
// 是接线的行为证据：设计实验室的基线证明「同样的 view model 长同样的样子」，
// 单测证明「同样的宿主真相产出同样的 view model」，这里证明「人按下去真的发生了事情」。
//
// 零额度：供应商是 loopback（`agent-runtime-fixture.mjs`），每一次模型调用都要预先声明，
// 没声明的请求会被 400 并在收尾时报出来。不碰任何真实生成 API。
//
// 用法：node tests/ux/agent-v4-short-film.walk.mjs
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { uiText } from './full-walk/invariants.mjs'
import {
  APPROVAL_CARD,
  ASSISTANT_MESSAGE,
  CANVAS_PANEL,
  COLLAPSED_DOCK,
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
  ERROR_BAR,
  PERMISSION_POPOVER,
  TOOL_RECEIPT,
  USER_BUBBLE,
  V4_FLOW,
  V4_PANEL,
  chooseAssistantModel,
  createRuntimeWalk,
  escapeForRegExp,
  expandResidentPanel,
  hasToolResult,
  openCanvas,
  permissionTier,
  recorded,
  requireCurrentPersistedWorkbenchDocument,
  readProject,
  sendCanvas,
  sendCreation,
  waitForV4TurnIdle, expectComposerText, expectComposerPlaceholder } from './agent-runtime-walk-support.mjs'

// 空态第一条起手（创作面 = 写脚本）。它的字住 i18n（`agentPanelV4.starterWriteScriptPrompt`），
// 这里抄一份是为了断言「chip 填进去的就是这句」；两边漂了这条走查会当场红。
const STARTER_FIRST = '把我的想法写成一版脚本'
const BRIEF = '我要做一条 20 秒的短片：咖啡馆推门那段。先把脚本写出来。'
const SCRIPT = '清晨，她推开咖啡馆的门。红色杯子落在白色桌面上，侧光打在杯沿。她坐下，按下录制键。'
const TIGHTEN = '把结尾收紧一点，别拖。'
const TIGHTEN_APPLIED = 'ENDING_TIGHTENED：她按下录制键，画面定格。'
const TIGHTEN_TOOL = 'v4-doc-tighten-1'
const REFERENCE = '给这 4 镜生成参考图。'
const REFERENCE_TOOL = 'v4-canvas-plan-1'
const SLOW = '再想想整体节奏。'
const FAIL = '再把结尾润一遍。'
// 收起/展开要验「他读到哪儿了」，就得有一条**真的翻得动**的对话。收据的展开是 DOM 上的
// `<details open>`，收起时随子树一起没了，撑不起溢出；只有落进流里的消息才留得下来。
//
// 这份清单一镜一段、每镜写全（景别 / 声音 / 秒数）——一份要打印贴墙的清单本来就该这样。段与段之间必须是
// 空行：markdown 里单个换行是软换行，用 `\n` 连起来五镜会糊成**一段**，对话流在最小窗里只溢出 35px
// （Mac 实测；前提要 ≥ 80，Linux 夜跑上够、Mac 上不够）。前提的量靠内容撑，所以内容要有余量，不靠降阈值。
const RECAP = '把这 4 镜按顺序完整列一遍，我要打印出来贴墙上。'
const RECAP_TEXT = [
  '《咖啡馆推门》20 秒 · 4 镜，按顺序如下，可直接打印。',
  '镜 1｜清晨的街，门牌与霓虹熄灭的余温；全景，手持，轻微呼吸感；街声由远及近；4 秒。',
  '镜 2｜她推门，铜铃响；中景，门缝里的光切进室内，侧光贴着侧脸；铜铃声压过街声；5 秒。',
  '镜 3｜红色杯子落在白桌面上，热气斜着走；微距，焦点从杯沿滑到指节；杯底轻磕桌面；6 秒。',
  '镜 4｜她坐下，按下录制键；近景，机身红点亮起；环境声压低，只剩一声提示音；定格 5 秒。',
  '整段 20 秒，节奏是「街—门—杯—人」，前两镜给环境，后两镜收到她身上。',
  '声音线：街声 → 铜铃 → 杯底轻磕 → 一声提示音；全片不加配乐，留给环境声。',
].join('\n\n')

const walk = await createRuntimeWalk('v4-short-film')
let failure
try {
  let { win } = await walk.start({ first: true })
  const project = await walk.newProject()
  const { projectId, projectRoot } = project
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
  await expectComposerText(panel.locator(COMPOSER_INPUT), STARTER_FIRST, '起手句交给了输入框')
  await expect(panel.locator(COMPOSER_SEND)).toBeEnabled()
  // 「没发出去」的正面证据：真发了就会多一条用户气泡、空态也就永远消失了。
  // 这里断言空态**还在**，而不是断言气泡不存在——后者本来就是 0，采样恒真（假绿）。
  await expect(empty).toBeVisible()
  await expect(panel.locator(V4_FLOW).locator(USER_BUBBLE)).toHaveCount(0)
  await walk.snap('01b-starter-filled')
  await panel.locator(COMPOSER_INPUT).fill('')

  // 收起 = 小球的**空闲**档（10-08 外壳重设计 Chrome 板）：什么都没发生时小球素着——一颗永远亮着的点等于没有状态。
  await clickOrFail(panel.locator(COLLAPSE_BUTTON), '收起面板（头部形态切到小球）')
  const coldCollapsed = win.locator(COLLAPSED_SHELL)
  const coldDock = win.locator(COLLAPSED_DOCK)
  await expect(coldDock, '收起后内容区右下必须有那颗小球').toBeVisible()
  // 顶栏不再放 Agent 角标（协调裁决第 59 项）：叫回入口只有小球这一个。
  const dockCount = await win.locator(COLLAPSED_DOCK).count()
  if (dockCount !== 1) throw new Error(`叫回 Nomi 的小球全窗口只该有一颗，实测 ${dockCount} 颗`)
  await expect(coldDock).toHaveAttribute('data-agent-dock-status', 'idle')
  await expect(coldDock).toHaveAttribute('data-agent-ball', 'idle')
  // 面板没卸载：收起支路仍挂着（回执 / 计划预览跟着它活），只是不占位、看不见。
  await expect(coldCollapsed).toBeAttached()
  await walk.snap('01c-collapsed-idle')
  await clickOrFail(coldDock, '点小球展开面板')
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

  // ── 3. 权限两档：默认「请求批准」（2026-10-12 用户拍板：两档，每档一行灰字）──────
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), 'composer 权限档')
  const permissionPopover = panel.locator(PERMISSION_POPOVER)
  await expect(permissionPopover).toBeVisible()
  await expect(permissionPopover.locator('[data-tier]')).toHaveCount(2)
  await expect(permissionPopover.locator('[data-tier][data-active="true"]')).toHaveAttribute('data-tier', 'request')
  await walk.snap('03-permission-popover')
  await clickOrFail(panel.locator(permissionTier('request')), '权限档「请求批准」')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'request')

  // ── 4. 「请求批准」下改文稿：能撤销的改动直接做，带收据 ────────────────────
  // 原来这一段在「每步问」下走介入槽 → 确认；那一档 2026-10-12 删了（「相当于没有挡位」），
  // 两档下文稿改动都直接做。证据是因果的：工具结果回到模型（下一次请求带着它）之前没有任何人点过任何东西——
  // 如果有一张卡在等，这次请求永远不会来，`recorded` 会当场超时。
  const tightenRequest = walk.fixture.expectText({
    label: 'agent tightens the ending',
    match: (body) => flattenRequestText(body).includes(TIGHTEN) && !hasToolResult(body, TIGHTEN_TOOL),
    reply: { type: 'tool', id: TIGHTEN_TOOL, name: 'write_script', args: { where: 'end', content: TIGHTEN_APPLIED } },
  })
  const tightenFollowup = walk.fixture.expectText({
    label: 'tighten result returns to the model',
    match: (body) => hasToolResult(body, TIGHTEN_TOOL),
    reply: { type: 'text', text: '已收紧结尾，可以在收据上撤销。' },
  })
  await sendCreation(win, TIGHTEN)
  await recorded(tightenRequest.received, 'document edit request')
  await recorded(tightenFollowup.received, 'document tool result without any approval click')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).filter({ hasText: '已收紧结尾' }).last() })
  await expect(doc).toContainText(TIGHTEN_APPLIED)
  // 直接做的那一步也留了收据（这一轮收尾后过程行可能折起来，所以只要求它在流里，不要求展开可见）。
  await expect(panel.locator(TOOL_RECEIPT).last()).toBeAttached()
  await expect.poll(async () => JSON.stringify(requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))),
    { message: '直接做的改动必须真的落进项目，不只是气泡上说做了', timeout: stationTimeout({ operations: 2 }) }).toContain(TIGHTEN_APPLIED)
  await walk.snap('05-applied-directly')

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
  // 实测溢出记进报告：前提靠内容撑，余量要看得见（只在红的时候才看见 px 数，下一次就是「突然红」）。
  walk.report.minWindowFlowOverflowPx = creationOverflow
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
    reply: { type: 'tool', id: REFERENCE_TOOL, name: 'look_at_canvas', args: {} },
  })
  const referenceFollowup = walk.fixture.expectText({
    label: 'canvas read result returns to the model',
    match: (body) => hasToolResult(body, REFERENCE_TOOL),
    reply: { type: 'text', text: '画布上还没有镜头，我先按脚本排 4 镜。' },
  })
  await sendCanvas(win, REFERENCE)
  await recorded(referenceRequest.received, 'canvas request')
  await recorded(referenceFollowup.received, 'canvas tool result')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: canvas.locator(ASSISTANT_MESSAGE).filter({ hasText: '我先按脚本排 4 镜' }).last() })
  // 一轮收尾后过程行会折起来：收据要在流里，不要求展开可见。
  await expect(canvas.locator(TOOL_RECEIPT).last()).toBeAttached()
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
  // 运行中占位文案换成「可继续输入，将排队发送」——它是这一刻唯一在说话的东西。输入框是 TipTap，占位不是
  // `placeholder` 属性，而是空段落上画出来的字：读的是用户眼睛看到的那一句，文案按键从词典取（不抄字面量）。
  await expectComposerPlaceholder(canvas.locator(COMPOSER_INPUT), uiText('zh-CN', 'agentPanelV4.placeholderRunning'),
    '运行中输入框画出来的占位必须是词典里的排队提示')
  await walk.snap('09-running')
  await clickOrFail(canvas.locator(`${COMPOSER}[data-mode="running"] ${COMPOSER_SEND}`), 'composer 停止')
  slowTurn.release({ type: 'text', text: '好，先停在这里。' })
  await expect(running, '停止之后 composer 必须退出运行态').toBeHidden({ timeout: 60_000 })
  await walk.snap('10-stopped')

  // ── 8. 收起：用户自己点的停止不是坏消息 ──────────────────────────────────────
  //
  // 2026-09-06 用户改：收起态不再是右侧那条满高 32px rail 上的两颗小 icon，
  // 而是 Nomi 一直延续的那枚 logo 钮（血统 `src/ui/app-shell/CollapsedAiChip.tsx`）。
  // 空闲档在 §1 已验（待确认档由 shell-redesign 走查覆盖），这里验**停止之后**那一档；失败档在第 10 步（真失败）。
  // 收起前先量一下面板宽：定稿说「点角标 = **原宽**原状态还原」（collapse≠unmount），
  // 所以还原之后这个数必须一模一样，不是「又一个默认 340」。
  const beforeCollapseWidth = Math.round((await win.locator(`${CANVAS_PANEL} ${V4_PANEL}`).boundingBox())?.width ?? 0)
  await clickOrFail(canvas.locator(COLLAPSE_BUTTON), '收起面板（头部形态切到小球）')
  await expect(win.locator(COLLAPSED_SHELL)).toBeAttached()
  const dock = win.locator(COLLAPSED_DOCK)
  await expect(dock, '收起后画布右下必须有那颗小球').toBeVisible()
  // 刚被停下的那一轮在面板上**没有**错误带：用户自己点的停止留下的是一句中性的灰字「已停止」（09-14 定的回执，
  // `agentPanelV4Blocks.test.ts` 钉着），不是错误。小球的「出错」只认「最后一件事是不是坏的」——面板错误带，或流末尾那条
  // 未化解的 error（`ProjectAgentResidentShell.tsx` 的 `failed`，用户 09-06 改）。所以收起后它先是「刚做完」（`done`，
  // 2.4 秒），随后落回「空闲」（`idle`）；这时报「出错」就是假警报（协调 10-28 判：走查过期，产品是对的）。
  // 「收起不吞**坏**消息」不拿「停止」当失败的替身（替身一过期，真东西就没人量了），由第 10 步那一轮**真失败**去证。
  await expect(dock).toHaveAttribute('data-agent-dock-status', /^(done|idle)$/)
  await expect(dock).toHaveAttribute('data-agent-ball', /^(done|idle)$/)
  await walk.snap('11-collapsed-stopped')

  // 点顶栏角标展开：整条对话原样还在，收起从来没有中断过它。
  const widthBeforeCollapse = beforeCollapseWidth
  await clickOrFail(dock, '点小球展开面板')
  await expect(win.locator(`${CANVAS_PANEL} ${V4_FLOW}`)).toBeVisible()
  await expect.poll(async () => Math.round((await win.locator(`${CANVAS_PANEL} ${V4_PANEL}`).boundingBox())?.width ?? 0),
    { message: '点小球必须**原宽**原状态还原（浮窗记住的那个宽），不是重置成默认宽', timeout: stationTimeout({ operations: 2 }) }).toBe(widthBeforeCollapse)
  await expect(canvas.locator(USER_BUBBLE).last(), '展开后最后一句话还是收起前发的那句').toContainText('整体节奏')
  // 展开**动画结束之后**再截：还原是不是「原宽原状态」这件事，只有停下来的那一帧看得出来
  // （动画中途的任何一帧宽度都不是最终宽，截到它等于给拍板人看一张过程图）。
  // 上面那条 `expect.poll` 已经把宽度轮询到了收起前那个数，所以到这里布局必然已经落定。
  await expect(
    win.locator('[data-agent-ball]'),
    '展开后小球必须让出来——小球和面板不能同时在',
  ).toHaveCount(0)
  await walk.snap('11b-expanded-restored')

  // ── 9. 关掉重开：昨天的活儿还在 ────────────────────────────────────────
  //
  // 这一段测的是**收据的七态 join 在冷启动之后仍然对**：重启后渲染层的待决登记表是空的，
  // 只剩 lane JSONL，所以每一条收据的状态必须由真实消息与审批记录投影。判定顺序写反的话，
  // 这里会看到一条早就完成的调用被画成「待确认」。
  const persistedBeforeRestart = readLaneTranscripts(projectRoot)
  expect(persistedBeforeRestart, '跨创作/画布仍是同一条 lane').toHaveLength(1)
  const laneBeforeRestart = persistedBeforeRestart[0]
  const messagesBeforeRestart = laneMessages(laneBeforeRestart)
  const toolResults = messagesBeforeRestart.filter(message => message.role === 'toolResult')
  expect(toolResults.filter(message => [TIGHTEN_TOOL, REFERENCE_TOOL].includes(message.toolCallId)))
    .toHaveLength(2)
  expect(toolResults.find(message => message.toolCallId === TIGHTEN_TOOL)?.isError).toBe(false)
  const requestsBeforeRestart = walk.fixture.requests.length
  await walk.stopApp()
  ;({ win } = await walk.start())
  await clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: project.name }), '冷重启后打开同一项目')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '创作工作区')
  // 冷重启后外壳要过一会儿才把常驻面板（按落盘的形态：上一步还原成了展开）挂上来；`expandResidentPanel` 经
  // `_shell.mjs` 的 `ensureAgentPanelOpen` 先等「面板或小球」其中一个出现再判，这里不用再自己绕一遍。
  await expandResidentPanel(win)
  const restored = win.locator(CREATION_PANEL)
  await expect(restored.locator(USER_BUBBLE).first(), '冷重启后对话流必须还在').toContainText('20 秒', { timeout: 60_000 })
  const restoredProof = await proveProbe(restored.locator(TOOL_RECEIPT), '冷重启后收据仍在流里')
  await expectAbsent(restored.locator(APPROVAL_CARD), {
    provenBy: restoredProof,
    message: '冷重启后不该有介入槽——待决登记表是空的，一条早就完成的调用被画成「待确认」就是七态 join 写反了',
  })
  // 重启本身不该产生任何模型调用：恢复读的是落盘的 lane JSONL，不是重跑一遍。
  expect(walk.fixture.requests).toHaveLength(requestsBeforeRestart)
  const restoredLane = readLaneTranscripts(projectRoot).find(session => session.sessionId === laneBeforeRestart.sessionId)
  expect(restoredLane, '冷重启必须恢复原来的 SDK session 身份').toBeTruthy()
  expect(laneMessages(restoredLane), '历史消息按原始顺序恢复，不能重放工具').toEqual(messagesBeforeRestart)
  await expect(win.locator(DOCUMENT)).toContainText(TIGHTEN_APPLIED)
  await walk.snap('12-cold-restart')

  // ── 10. 重开之后再发一轮，这回服务商整条回错：收起不吞**坏**消息 ─────────────────────────
  //
  // 第 8 步证了「停止不是坏消息」，这一步证它的反面：真坏消息，收起之后小球必须接住。之前全仓只有 `resolveDockStatus`
  // 的纯函数单测，没有一条走查在真机上量过它（协调 10-28 判）。放在冷重启之后：只多一轮请求、不再多起一个 Electron，
  // 也顺带量到「恢复出来的会话还能再跑一轮、如实报错」。
  // 夹具回 HTTP 400 的整条回错（`pb09` 同形），不回 500：lane 对 500 会重试三次（`LANE_RETRY_POLICY`），一轮变四次请求、
  // 多等约 7 秒，走查还会绑死在重试次数上；这里要证的是「最后一件事是坏的 → 收起后小球报出」，和重试无关。
  const failedTurn = walk.fixture.expectText({
    label: 'the provider answers this turn with a hard error',
    match: (body) => flattenRequestText(body).includes(FAIL),
    reply: { type: 'http-error', status: 400, json: { error: { message: 'Upstream gateway refused the request', type: 'invalid_request_error', code: 'E7731' } } },
  })
  await sendCreation(win, FAIL)
  await recorded(failedTurn.received, 'failing turn request')
  // 阳性对照：失败真的落到了面板上（错误带在、composer 退出运行态）。下面小球不报失败，才是产品的错，而不是夹具没出错。
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: restored.locator(ERROR_BAR).last(), doneTimeout: stationTimeout({ operations: 2 }) })
  await walk.snap('13-failed-turn-panel')
  await clickOrFail(restored.locator(COLLAPSE_BUTTON), '收起面板（头部形态切到小球）')
  const failedDock = win.locator(COLLAPSED_DOCK)
  await expect(failedDock, '收起后创作面右下必须有那颗小球').toBeVisible()
  // 收起藏掉的是**面板**，不是那件事：小球「出错」档 = 右上一粒 danger 点，坏消息由无障碍名 / tooltip 说清（文案取词典）。
  await expect(failedDock).toHaveAttribute('data-agent-dock-status', 'failed')
  await expect(failedDock).toHaveAttribute('data-agent-ball', 'failed')
  await expect(failedDock).toHaveAttribute('aria-label', new RegExp(escapeForRegExp(uiText('zh-CN', 'agentPanelV4.dockFailed'))))
  walk.report.failedDockLabel = await failedDock.getAttribute('aria-label')
  await walk.snap('14-collapsed-failed')

} catch (error) {
  failure = error
}
await walk.finish(failure)
