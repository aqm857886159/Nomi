/**
 * R13/R16 走查 · PR #720 走查文档「后续」补齐项：会话中途切换语言（zh-CN ↔ en）。
 *
 * 来源：docs/research/2026-09-10-ux-feedback-fixes/walkthrough-pr720.md 的「顺带记下的两条观察」
 * 之②记录了 2026-09-11 的修法——`openLane` 的 `systemPrompt` 从字符串快照放宽成
 * `string | (() => string)`，`laneHost` 每回合重新求值，已开着的 lane 下一回合就改口。
 * 那份文档本身只验了「两次界面语言各起一次 App」（冷启动），没有验「同一次会话中途切」。
 * 本脚本补这一条，**只做结构验证，不比文案逐字**：
 *   ① 切换后 Agent 面板 / 画布节点 / 设置里已渲染的 UI 全部换语言；
 *   ② 没有残留另一语言的硬编码（EN-DOM 的 CJK 网 + 两语言的 RAW-KEY 网）；
 *   ③ lane 历史消息不丢（切换前后消息条数与最后一条内容不变——历史不该被重新翻译）；
 *   ④ 输入框草稿不丢（composer 里没发送的文字，切完语言还在）。
 *
 * 真人动作：新建空白项目 → 进「生成」→ 左缘加一个文字节点（本地免费，不调模型）→ 选一个真实
 * 文本模型对话一轮（唯一花费：一次真实文本模型请求）→ composer 里再打一段不发送的草稿 →
 * 点顶栏「设置」→「通用」→ 语言分段控件切 English → 关闭设置 → 核对面板/节点/历史/草稿 →
 * 再点回「设置」→「通用」→ 切回简体中文 → 关闭设置 → 再核对一遍（验证双向）。
 *
 * 用法：node tests/ux/pr720-language-switch-mid-session.walk.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { prepareIsolation } from '../../evals/lib/isoApp.mjs'
import {
  screenshotSettled,
  clickOrFail,
  expectVisible,
  scopedText,
  waitForVisualQuiescence,
  expectNoCjkInEnglishDom,
  expectNoRawI18nKeysInDom,
} from './_assert.mjs'
import {
  CANVAS_PANEL, ASSISTANT_MESSAGE, USER_BUBBLE, COMPOSER_INPUT,
  THINKING_LINE, SUGGESTION, TOOL_RECEIPT, TASK_CARD, ERROR_BAR,
  openCanvas, sendCanvas, chooseAssistantModel, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const shots = path.join(repoRoot, 'tests/ux/shots/pr720-language-switch-mid-session')
fs.mkdirSync(shots, { recursive: true })

/** 走查用的真实文本模型：真实 catalog 里已启用的那家中转的 deepseek（便宜档），与 pr720-prompt-language 同一支。 */
const TEXT_MODEL = process.env.PR720_TEXT_MODEL || 'DeepSeek V3.2'
/** composer 里打了但不发送的草稿——切语言前后都该原样还在。刻意用中文：切到 en 之后它变成
 *  「用户自己写的内容」，靠 CJK 网的豁免（本脚本不对 composer 输入本身跑 CJK 网，理由见下）来区分。 */
const DRAFT_TEXT = '（先别发）再想一个更有氛围感的镜头描述，晚点回来发'

const results = []
function record(id, name, ok, detail) {
  results.push({ id, name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} [${id}] ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 顶栏「设置」钮：名字随当前界面语言在「设置」/「Settings」间切换，两态都要认得。 */
async function openSettings(win) {
  await clickOrFail(win.getByRole('button', { name: /^(设置|Settings)$/ }).first(), '顶栏「设置」按钮')
}

/** 关闭对话框走真实的关闭钮（`data-settings-close`），不是键盘快捷键——更像真人点一下。 */
async function closeSettings(win) {
  await clickOrFail(win.locator('[data-settings-close]'), '设置对话框「关闭」按钮')
  await waitForVisualQuiescence(win)
}

/** lane 历史（消息条数 + 最后一条正文）与 composer 草稿的一份快照，供切换前后比对。 */
async function snapshotState(win) {
  const assistantLocator = win.locator(`${CANVAS_PANEL} ${ASSISTANT_MESSAGE}`)
  const userLocator = win.locator(`${CANVAS_PANEL} ${USER_BUBBLE}`)
  const draft = await win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`).inputValue()
  return {
    assistantCount: await assistantLocator.count(),
    userCount: await userLocator.count(),
    lastAssistantText: await scopedText(assistantLocator.last()),
    draft,
  }
}

function sameHistory(a, b) {
  return a.assistantCount === b.assistantCount && a.userCount === b.userCount && a.lastAssistantText === b.lastAssistantText
}

/**
 * en 界面上合法出现中文的地方，CJK 网都要豁免（本脚本首跑实测撞过前两类；第三类是同一原理
 * 的推论，一次性补全，省得再烧一轮真模型 token 才发现）：
 *   · 对话流积木（user / assistant / tool 等）：切换前那一轮的内容——问句、回复、工具回执里的
 *     画布状态摘要——都是**历史**，是那一回合结束时就定型的产出，不会因为界面语言变了而重新生成，
 *     不该被回译。和 message bubble 同一性质，一并豁免（对话流的 8 个积木见
 *     agent-runtime-walk-support.mjs 的 `对话流里的 8 个积木` 注释）。
 *   · composer 输入框：没发送的草稿是**用户自己在打的字**，和上面同一性质；
 *   · [data-settings-locale]：语言分段控件按钮用「母语名」直读（简体中文/English），这是刻意的
 *     国际惯例写法（endonym），不是漏译——同 tests/ux/i18n-sweep.walk.mjs 的 USER_CONTENT_ALLOW。
 */
const USER_CONTENT_ALLOW = [
  `${CANVAS_PANEL} ${USER_BUBBLE}`,
  `${CANVAS_PANEL} ${ASSISTANT_MESSAGE}`,
  `${CANVAS_PANEL} ${THINKING_LINE}`,
  `${CANVAS_PANEL} ${SUGGESTION}`,
  `${CANVAS_PANEL} ${TOOL_RECEIPT}`,
  `${CANVAS_PANEL} ${TASK_CARD}`,
  `${CANVAS_PANEL} ${ERROR_BAR}`,
  `${CANVAS_PANEL} ${COMPOSER_INPUT}`,
  '[data-settings-locale]',
]

async function assertNoResidualChineseInEnglish(win, surface) {
  try {
    await expectNoCjkInEnglishDom(win, { message: `[en] ${surface}：不该有残留中文硬编码`, allowSelectors: USER_CONTENT_ALLOW })
    record('CJK', `[en] ${surface} 无残留中文硬编码`, true)
  } catch (error) {
    record('CJK', `[en] ${surface} 无残留中文硬编码`, false, String(error).split('\n').slice(0, 6).join(' / '))
  }
}

async function assertNoRawKeys(win, locale, surface) {
  try {
    await expectNoRawI18nKeysInDom(win, { message: `[${locale}] ${surface}：不该有未解析的 i18n 键` })
    record('RAWKEY', `[${locale}] ${surface} 无未解析 i18n 键`, true)
  } catch (error) {
    record('RAWKEY', `[${locale}] ${surface} 无未解析 i18n 键`, false, String(error).split('\n').slice(0, 6).join(' / '))
  }
}

const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-lang-switch-mid-session-'))
const iso = prepareIsolation(isoDir, { requireCatalog: true })

const { app, win } = await launchNomiApp({
  name: 'pr720-language-switch-mid-session',
  userDataDir: iso.chromiumDir, settingsDir: iso.settingsDir,
  projectsDir: iso.projectsDir, capabilityDir: iso.capabilityDir,
  args: ['--disable-gpu'], settleMs: 0,
})

try {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) { w.setSize(1680, 1050); w.center() } }).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload(); await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2500)

  await clickOrFail(win.getByText('新建空白项目', { exact: false }), '新建空白项目')
  await win.waitForTimeout(2500)
  await openCanvas(win)
  await screenshotSettled(win, { path: path.join(shots, '00-canvas-zh.png') })

  // ── 画布节点：本地免费的文字节点，用它的头部 aria-label 当「节点 UI 语言」的探针 ──
  const rail = win.locator('.generation-canvas-v2-toolbar').first()
  await expectVisible(rail, '左缘生成画布工具条')
  await clickOrFail(rail.locator('button[aria-label="添加文字节点"]'), '左缘「添加文字节点」')
  await expectVisible(win.locator('header[aria-label="拖动文本节点"]').first(), '文字节点头部（中文 aria-label）')
  record('NODE-ZH', '画布节点：中文界面下节点头已渲染中文 aria-label', true)
  await screenshotSettled(win, { path: path.join(shots, '01-text-node-zh.png') })

  // ── 真实文本模型对话一轮，攒出 lane 历史（唯一的模型花费） ──
  await chooseAssistantModel(win, TEXT_MODEL, CANVAS_PANEL)
  await sendCanvas(win, '给「深夜便利店」这个镜头，用一句话描述画面内容。')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, startTimeout: 30_000, doneTimeout: 240_000 })

  const baseline = await snapshotState(win)
  record('HISTORY-BASELINE', `lane 历史已攒好：assistant=${baseline.assistantCount} user=${baseline.userCount}`,
    baseline.assistantCount >= 1 && baseline.userCount >= 1, `末条回复前 60 字=${baseline.lastAssistantText.slice(0, 60)}`)

  // composer 里打一段不发送的草稿
  const composerInput = win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`)
  await composerInput.click()
  await composerInput.fill(DRAFT_TEXT)
  const draftFilled = await composerInput.inputValue()
  record('DRAFT-BASELINE', '切换前 composer 草稿已填入且未发送', draftFilled === DRAFT_TEXT, `draft=${draftFilled}`)
  await screenshotSettled(win, { path: path.join(shots, '02-history-and-draft-zh.png') })

  await assertNoRawKeys(win, 'zh-CN', '生成画布(切换前)')

  // ═══════════ 第一段：设置 → 通用 → zh-CN → English ═══════════
  await openSettings(win)
  // 外层才带 role="dialog"（SettingsDialog.tsx:251）；`data-settings-dialog` 在里面那层没有
  // role，两个属性不在同一个元素上——合并成一个选择器会永远匹配不到（本脚本首跑就撞过这个）。
  const dialog = win.locator('[role="dialog"]').first()
  await expectVisible(dialog, '设置对话框')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), '设置导航「通用」标签')
  await expectVisible(win.locator('[data-settings-locale="zh-CN"][aria-pressed="true"]'), '语言分段控件当前选中简体中文')
  await expectVisible(dialog.getByText('通用', { exact: true }).first(), '设置内容区标题「通用」')
  record('SETTINGS-ZH', '设置·通用：切换前语言分段控件选中简体中文、内容标题为中文', true)
  await screenshotSettled(dialog, { path: path.join(shots, '03-settings-general-zh.png') })

  await clickOrFail(win.locator('[data-settings-locale="en"]'), '语言分段控件「English」')
  await waitForVisualQuiescence(win)

  await expectVisible(win.locator('[data-settings-locale="en"][aria-pressed="true"]'), '语言分段控件切到 English 后自身状态更新')
  await expectVisible(dialog.getByText('General', { exact: true }).first(), '设置内容区标题已变 General')
  await expectVisible(dialog.getByText('Settings', { exact: true }).first(), '设置对话框标题已变 Settings')
  record('SETTINGS-EN', '设置：中途切到 English 后，分段控件状态与两处标题都已换语言', true)
  await screenshotSettled(dialog, { path: path.join(shots, '04-settings-general-en.png') })
  await assertNoResidualChineseInEnglish(win, '设置对话框(通用 tab)')

  await closeSettings(win)

  // Agent 面板：发送钮 aria-label 随语言变
  await expectVisible(win.locator(`${CANVAS_PANEL} [data-v4-control="send"][aria-label="Send"]`), '画布 Agent 面板发送钮已变 Send')
  record('COMPOSER-EN', 'Agent 面板：composer 发送钮切到英文 aria-label', true)

  // 画布节点：头部 aria-label 随语言变
  await expectVisible(win.locator('header[aria-label="Drag text node"]').first(), '文字节点头部已变英文 aria-label')
  record('NODE-EN', '画布节点：中途切到 English 后节点头已换英文 aria-label', true)
  await screenshotSettled(win, { path: path.join(shots, '05-canvas-en.png') })

  await assertNoResidualChineseInEnglish(win, '生成画布 + Agent 面板')
  await assertNoRawKeys(win, 'en', '生成画布(切到 en 后)')

  const afterEn = await snapshotState(win)
  record('HISTORY-EN', 'zh→en 切换后 lane 历史未丢（条数与末条正文都不变）', sameHistory(baseline, afterEn),
    `assistant ${baseline.assistantCount}→${afterEn.assistantCount} · user ${baseline.userCount}→${afterEn.userCount}`)
  record('DRAFT-EN', 'zh→en 切换后 composer 草稿未丢', afterEn.draft === DRAFT_TEXT, `draft=${afterEn.draft}`)

  // ═══════════ 第二段：设置 → 通用 → English → 简体中文（验证反向，且不是单向只读一次） ═══════════
  await openSettings(win)
  await expectVisible(dialog, '设置对话框（第二次打开）')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), '设置导航「General」标签')
  await expectVisible(win.locator('[data-settings-locale="en"][aria-pressed="true"]'), '重开设置后语言分段控件仍记着 English（偏好持久化）')
  await screenshotSettled(dialog, { path: path.join(shots, '06-settings-general-en-reopen.png') })

  await clickOrFail(win.locator('[data-settings-locale="zh-CN"]'), '语言分段控件「简体中文」')
  await waitForVisualQuiescence(win)

  await expectVisible(win.locator('[data-settings-locale="zh-CN"][aria-pressed="true"]'), '语言分段控件切回简体中文后自身状态更新')
  await expectVisible(dialog.getByText('通用', { exact: true }).first(), '设置内容区标题切回「通用」')
  await expectVisible(dialog.getByText('设置', { exact: true }).first(), '设置对话框标题切回「设置」')
  record('SETTINGS-ZH2', '设置：再切回简体中文后，分段控件状态与两处标题都换回中文', true)
  await screenshotSettled(dialog, { path: path.join(shots, '07-settings-general-zh-again.png') })

  await closeSettings(win)

  await expectVisible(win.locator(`${CANVAS_PANEL} [data-v4-control="send"][aria-label="发送"]`), '画布 Agent 面板发送钮切回中文')
  record('COMPOSER-ZH2', 'Agent 面板：composer 发送钮切回中文 aria-label', true)

  await expectVisible(win.locator('header[aria-label="拖动文本节点"]').first(), '文字节点头部切回中文 aria-label')
  record('NODE-ZH2', '画布节点：切回简体中文后节点头已换回中文 aria-label', true)
  await screenshotSettled(win, { path: path.join(shots, '08-canvas-zh-again.png') })

  await assertNoRawKeys(win, 'zh-CN', '生成画布(切回 zh-CN 后)')

  const afterRoundTrip = await snapshotState(win)
  record('HISTORY-ROUNDTRIP', '两次切换（zh→en→zh）之后 lane 历史仍未丢', sameHistory(baseline, afterRoundTrip),
    `assistant ${baseline.assistantCount}→${afterRoundTrip.assistantCount} · user ${baseline.userCount}→${afterRoundTrip.userCount}`)
  record('DRAFT-ROUNDTRIP', '两次切换之后 composer 草稿仍未丢（且与原文完全一致）', afterRoundTrip.draft === DRAFT_TEXT,
    `draft=${afterRoundTrip.draft}`)

  fs.writeFileSync(path.join(shots, 'language-switch-mid-session-results.json'), JSON.stringify(results, null, 2))
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length ? `✖ ${failed.length}/${results.length} 条红` : `✅ ${results.length} 条全绿`}；详情见 language-switch-mid-session-results.json`)
  process.exitCode = failed.length ? 1 : 0
} catch (err) {
  console.log(`\n✖ 走查中断：${err?.stack || err?.message || err}`)
  fs.writeFileSync(path.join(shots, 'language-switch-mid-session-results.json'), JSON.stringify(results, null, 2))
  await win.screenshot({ path: path.join(shots, 'FAIL.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
