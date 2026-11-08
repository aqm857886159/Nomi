#!/usr/bin/env node
// Agent 对话「跟到底」真实 Electron 走查（零花费：只有远端模型是本机 loopback 假模型，隔离资料目录）。
//
// 用户原话（2026-11-08 反馈）：
//   ①「每次切换agent都放到最上面了，我还得波动鼠标弄到最下面，太麻烦了」
//   ②「agent发送的时候……他不会自动滑动，而是卡在我的位置上，导致我还得自己滑右侧的滚轮才能看到下面」
// 协调 2026-11-09 定的行为：切换对话总落到底；收起 / 展开还原到原位；人往上翻着时不被拽；发送就回到底；
// 往上翻着时出现「回到最新」按钮，点了回到底并继续跟。
//
// 每条检查都记下来、不在第一条红上停：修之前在 main 上跑，要看清哪几条红（证明复现了用户说的），
// 修之后同一条走查全绿。和用户那次的差别：用户用的是真模型，这里是本机假模型按固定节奏吐字。
//
// 拍板图断言：board:ConversationJumpToLatest/button（按钮出现 / 隐藏、文案、点了回到底并继续跟）。
import fs from 'node:fs'
import path from 'node:path'
import { clickOrFail, expect, screenshotSettled } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  ASSISTANT_MESSAGE, COLLAPSE_BUTTON, COLLAPSED_DOCK, COMPOSER, CREATION_PANEL, HISTORY_BUTTON, THREAD_MENU, USER_BUBBLE, V4_FLOW,
  chooseAssistantModel, createRuntimeWalk, expandResidentPanel, newConversation, sendCreation, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { uiText } from './full-walk/invariants.mjs'

const FLOW = `${CREATION_PANEL} ${V4_FLOW}`
const JUMP = `${CREATION_PANEL} [data-v4-control="jump-latest"]`
const RUNNING = `${CREATION_PANEL} ${COMPOSER}[data-mode="running"]`
const AT_BOTTOM_PX = 24
const FOLLOW_SLACK_PX = 70
const TURNS_PER_THREAD = 5
const PARAGRAPH = '雨夜的街道上霓虹倒映在积水里，主角撑伞穿过人群，镜头从背后跟上，脚步声和雨声叠在一起，远处的电车灯一闪而过。'
const STREAM_CHUNK_CHARS = 12
const STREAM_INTERVAL_MS = 40

/** 每一轮回答：带上这一轮的标记，八段长正文（够在最小窗里撑出好几屏）。 */
function longReply(marker) {
  return Array.from({ length: 8 }, (_, index) => `${marker} 第 ${index + 1} 段：${PARAGRAPH}`).join('\n\n')
}
/** 流式那一轮：约 3000 字，12 字一帧、40ms 一帧（约 10 秒）。 */
function streamReply(marker) {
  return `${marker} ` + Array.from({ length: 50 }, (_, index) => `${index + 1}. ${PARAGRAPH}`).join('\n\n')
}

const walk = await createRuntimeWalk('agent-conversation-follow')
const checks = []
const record = (round, check, pass, detail) => {
  checks.push({ round, check, pass: Boolean(pass), detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${round}] ${check} ${JSON.stringify(detail)}`)
}
/** 这一轮的标记 = 最后一条用户消息里最后出现的那个（请求里带着整段历史，前几轮的标记也在里面）。 */
function turnMarker(body) {
  const users = (Array.isArray(body?.messages) ? body.messages : []).filter((message) => message?.role === 'user')
  return flattenRequestText({ messages: users.slice(-1) }).match(/CF-[A-Za-z0-9-]+/g)?.at(-1) ?? 'CF-X'
}
let replyMode = 'text'
walk.fixture.respond({
  label: 'conversation follow replies',
  match: () => true,
  reply: (body) => {
    const marker = turnMarker(body)
    walk.report.fixtureTurns ??= []
    walk.report.fixtureTurns.push({ marker, mode: replyMode })
    return replyMode === 'stream'
      ? { type: 'stream', text: streamReply(marker), chunkChars: STREAM_CHUNK_CHARS, intervalMs: STREAM_INTERVAL_MS }
      : { type: 'text', text: longReply(marker) }
  },
})

let failure
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => {
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
    localStorage.setItem('nomi-color-scheme', 'light')
  })
  await win.reload()
  await walk.newProject()
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  // 最小窗：面板只剩四百多像素高，几轮长回答才真的溢出（大窗里装得下，滚动位置恒 0，检查都是恒真式）。
  await walk.resizeWindow(1100, 720)
  walk.report.window = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const panel = win.locator(CREATION_PANEL)
  const flow = win.locator(FLOW)
  const geometry = () => flow.evaluate((node) => ({
    top: Math.round(node.scrollTop), height: node.scrollHeight, client: node.clientHeight,
    gap: Math.round(node.scrollHeight - node.scrollTop - node.clientHeight),
  }))
  const shot = async (label, target = panel) => {
    const file = path.join(walk.outputDir, `${String(walk.report.screenshots.length + 1).padStart(2, '0')}-${label}.png`)
    await screenshotSettled(target, { path: file })
    walk.report.screenshots.push(file)
  }
  /** 像人那样滚：鼠标停在对话流上转滚轮（负数往上）。 */
  const wheel = async (deltaY) => {
    const box = await flow.boundingBox()
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.mouse.wheel(0, deltaY)
    await win.waitForTimeout(250)
  }
  const sendTurn = async (marker) => {
    replyMode = 'text'
    await sendCreation(win, `${marker}：写下一段分镜说明`)
    await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).filter({ hasText: `${marker} 第 8 段` }).last() })
  }
  const threadRows = (locale) => win.locator(`${THREAD_MENU} > div:has(> button[aria-label="${uiText(locale, 'agentResident.removeThread')}"])`)
  /** 切到另一条对话（只有两条：点没高亮的那一行），等它的标记出现在流里。 */
  const switchThread = async (locale, toMarkerPrefix) => {
    await clickOrFail(win.locator(`${CREATION_PANEL} ${HISTORY_BUTTON}`), '打开会话列表')
    const rows = threadRows(locale)
    await expect(rows).toHaveCount(2)
    const classes = await rows.evaluateAll((nodes) => nodes.map((node) => String(node.className)))
    const inactive = classes.findIndex((name) => !name.includes('bg-nomi-accent-soft'))
    if (inactive < 0) throw new Error(`会话列表里两行都高亮着：${JSON.stringify(classes)}`)
    await clickOrFail(rows.nth(inactive).locator('button').first(), `切到 ${toMarkerPrefix} 那条对话`)
    await expect(panel.locator(USER_BUBBLE).filter({ hasText: toMarkerPrefix }).first()).toBeAttached({ timeout: 30_000 })
  }
  /** 切换之后 0 / 250 / 1000ms 三个时刻距底多少。 */
  const landing = async () => {
    const at0 = (await geometry()).gap
    await win.waitForTimeout(250)
    const at250 = (await geometry()).gap
    await win.waitForTimeout(750)
    const after = await geometry()
    return { at0, at250, at1000: after.gap, height: after.height, client: after.client }
  }
  const landedAtBottom = (sample) => sample.at0 <= AT_BOTTOM_PX && sample.at250 <= AT_BOTTOM_PX && sample.at1000 <= AT_BOTTOM_PX
  const jumpVisible = () => win.locator(JUMP).isVisible().catch(() => false)

  // ── 种两条长对话：A、B 各 5 轮 ───────────────────────────────────────────
  for (let turn = 1; turn <= TURNS_PER_THREAD; turn += 1) await sendTurn(`CF-A-${turn}`)
  await wheel(-900)
  walk.report.leftThreadA = await geometry()
  if (walk.report.leftThreadA.gap < 300) throw new Error('离开 A 前没有真的往上翻，切回落点检查缺少阅读位置这个前提')
  await newConversation(win, CREATION_PANEL)
  await expect(panel.locator(USER_BUBBLE)).toHaveCount(0)
  for (let turn = 1; turn <= TURNS_PER_THREAD; turn += 1) await sendTurn(`CF-B-${turn}`)
  const seeded = await geometry()
  walk.report.flowOverflowPx = seeded.height - seeded.client
  if (seeded.height - seeded.client < 1500) throw new Error(`两条对话只溢出 ${seeded.height - seeded.client}px，切换落点的检查证不了任何东西`)

  /** 一轮：切线程落点（A→B→A，离开 B 时人翻在半路）、收起 / 展开还原、往上翻时不被拽 + 回到最新、流式跟随、往上翻着发送回到底。 */
  async function round(locale, label) {
    // ① 切线程落点。当前在 B 的底部。
    await switchThread(locale, 'CF-A-')
    const toA = await landing()
    record(label, 'switch-B-to-A-lands-at-bottom', landedAtBottom(toA), toA)
    await shot(`${label}-switch-to-A`)
    await switchThread(locale, 'CF-B-')
    const toB = await landing()
    record(label, 'switch-A-to-B-lands-at-bottom', landedAtBottom(toB), toB)
    // 离开 B 时人正翻在半路：切回 A 仍要落到底（不把 B 的「我在读」带过去）。
    await wheel(-1200)
    const leftB = await geometry()
    await switchThread(locale, 'CF-A-')
    const backToA = await landing()
    record(label, 'switch-back-to-A-after-reading-B-midway-lands-at-bottom', landedAtBottom(backToA), { leftBGap: leftB.gap, ...backToA })
    await shot(`${label}-switch-back-to-A`)

    // ② 收起 / 展开还原（09-01 §11.2）：翻到中间收起，展开回到原处；在底部收起，展开仍在底部。
    const middle = await geometry()
    await wheel(-Math.round((middle.height - middle.client) / 2))
    const beforeCollapse = await geometry()
    await clickOrFail(panel.locator(COLLAPSE_BUTTON), '翻在中间时收起面板')
    await expect(win.locator(COLLAPSED_DOCK)).toBeVisible()
    await win.waitForTimeout(300)
    await expandResidentPanel(win)
    await win.waitForTimeout(500)
    const afterExpand = await geometry()
    record(label, 'collapse-expand-restores-midway-position', Math.abs(afterExpand.top - beforeCollapse.top) <= AT_BOTTOM_PX,
      { before: beforeCollapse.top, after: afterExpand.top })
    await wheel(100_000)
    await expect.poll(async () => (await geometry()).gap, { message: '滚回底部这一步没生效' }).toBeLessThanOrEqual(AT_BOTTOM_PX)
    await clickOrFail(panel.locator(COLLAPSE_BUTTON), '在底部时收起面板')
    await expect(win.locator(COLLAPSED_DOCK)).toBeVisible()
    await win.waitForTimeout(300)
    await expandResidentPanel(win)
    await win.waitForTimeout(500)
    const bottomExpand = await geometry()
    record(label, 'collapse-expand-at-bottom-stays-at-bottom', bottomExpand.gap <= AT_BOTTOM_PX, bottomExpand)
    // 收起还原的失败不能污染下一项：用真实滚轮重新建立流式跟随的底部前提。
    await wheel(100_000)
    await expect.poll(async () => (await geometry()).gap, { message: '流式检查开始前未回到底部' }).toBeLessThanOrEqual(AT_BOTTOM_PX)
    record(label, 'jump-latest-hidden-at-bottom', !(await jumpVisible()), {})

    // ③ 流式跟随：停在底部，假模型吐约 3000 字；每帧采样距底多少。
    replyMode = 'stream'
    const marker = `CF-A-${label}-stream`
    const assistantBefore = await panel.locator(ASSISTANT_MESSAGE).count()
    await flow.evaluate((node) => {
      const samples = []
      window.__cfFollow = { samples, stop: false }
      const tick = () => {
        samples.push(node.scrollHeight - node.scrollTop - node.clientHeight)
        if (!window.__cfFollow.stop) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await sendCreation(win, `${marker}：把这场戏拆成五十个镜头`)
    await expect(win.locator(RUNNING)).toBeVisible({ timeout: 20_000 })
    const streaming = panel.locator(ASSISTANT_MESSAGE).nth(assistantBefore)
    await expect.poll(async () => (await streaming.textContent().catch(() => ''))?.length ?? 0, { message: '流式正文迟迟没开始吐', timeout: 30_000 }).toBeGreaterThan(400)
    const followSamples = await win.evaluate(() => window.__cfFollow.samples.slice())
    // 吐到一半：人往上翻 600px，接下来的 20 帧不许把他拽走，「回到最新」要出现。
    await wheel(-600)
    const scrolledUp = await geometry()
    const charsAtScroll = (await streaming.textContent())?.length ?? 0
    await win.waitForTimeout(20 * STREAM_INTERVAL_MS)
    const afterChunks = await geometry()
    const charsAfter = (await streaming.textContent())?.length ?? 0
    await win.evaluate(() => { window.__cfFollow.stop = true })
    const maxGap = Math.max(...followSamples)
    record(label, 'streaming-follows-while-at-bottom', followSamples.length > 20 && maxGap <= FOLLOW_SLACK_PX,
      { frames: followSamples.length, maxGap: Math.round(maxGap) })
    record(label, 'scrolled-up-reader-is-not-dragged', charsAfter - charsAtScroll >= 100 && Math.abs(afterChunks.top - scrolledUp.top) <= 1,
      { before: scrolledUp.top, after: afterChunks.top, gapAfterScroll: scrolledUp.gap, streamedChars: charsAfter - charsAtScroll })
    const jumpShown = await jumpVisible()
    let jumpLabelOk = false
    if (jumpShown) {
      try {
        const expected = uiText(locale, 'agentPanelV4.jumpToLatest')
        jumpLabelOk = (await win.locator(JUMP).getAttribute('aria-label')) === expected && (await win.locator(JUMP).getAttribute('title')) === expected
      } catch { jumpLabelOk = false }
    }
    // board:ConversationJumpToLatest/button —— 往上翻着时出现、名字是词典里那句。
    record(label, 'jump-latest-appears-when-scrolled-up', jumpShown && jumpLabelOk, { visible: jumpShown, labelOk: jumpLabelOk })
    await shot(`${label}-scrolled-up-jump-latest`)
    if (jumpShown) {
      await clickOrFail(win.locator(JUMP), '点「回到最新」')
      await win.waitForTimeout(400)
      const afterJump = await geometry()
      await win.waitForTimeout(600)
      const stillFollowing = await geometry()
      record(label, 'jump-latest-returns-to-bottom-and-keeps-following', afterJump.gap <= AT_BOTTOM_PX && stillFollowing.gap <= FOLLOW_SLACK_PX,
        { afterJump: afterJump.gap, after600ms: stillFollowing.gap })
      record(label, 'jump-latest-hides-after-click', !(await jumpVisible()), {})
    } else {
      record(label, 'jump-latest-returns-to-bottom-and-keeps-following', false, { reason: '没有「回到最新」按钮' })
    }
    await expect(win.locator(RUNNING)).toBeHidden({ timeout: 60_000 })
    await win.waitForTimeout(300)
    const streamEnd = await geometry()
    record(label, 'streaming-ends-at-bottom', streamEnd.gap <= AT_BOTTOM_PX, streamEnd)

    // ④ 人正往上翻着时发送：回到底，自己刚发的那句看得见。
    await wheel(-1500)
    const upBeforeSend = await geometry()
    const sendMarker = `CF-A-${label}-send`
    replyMode = 'text'
    await sendCreation(win, `${sendMarker}：再补一段`)
    await expect(panel.locator(USER_BUBBLE).filter({ hasText: sendMarker })).toBeAttached({ timeout: 20_000 })
    await win.waitForTimeout(300)
    const bubbleSeen = await geometry()
    await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).filter({ hasText: `${sendMarker} 第 8 段` }).last() })
    await win.waitForTimeout(300)
    const replySeen = await geometry()
    record(label, 'send-while-scrolled-up-returns-to-bottom', upBeforeSend.gap > 300 && bubbleSeen.gap <= AT_BOTTOM_PX && replySeen.gap <= AT_BOTTOM_PX,
      { gapBeforeSend: upBeforeSend.gap, afterBubble: bubbleSeen.gap, afterReply: replySeen.gap })
  }

  await expect(win.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light')
  await round('zh-CN', 'zh-light')

  // 英文 · 暗色：只重载渲染层，同一个项目、同两条对话。重载 = 面板重新挂载：落点也要在底。
  await win.evaluate(() => {
    localStorage.setItem('nomi:locale:v1', 'en')
    localStorage.setItem('nomi-color-scheme', 'dark')
  })
  await win.reload()
  await clickOrFail(win.getByRole('button', { name: uiText('en', 'workspace.creationTab'), exact: true }), '切回创作区')
  await expandResidentPanel(win)
  await expect(win.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark')
  await expect(panel.locator(USER_BUBBLE).first()).toBeAttached({ timeout: 30_000 })
  const reloaded = await landing()
  record('en-dark', 'reload-lands-at-bottom', landedAtBottom(reloaded), reloaded)
  // 当前是 A；round 先切到 A 要求在 B，先切一次 B。
  await switchThread('en', 'CF-B-')
  await round('en', 'en-dark')

  // 另两种组合只拍按钮：中文暗色、英文亮色。
  for (const [locale, scheme, label] of [['zh-CN', 'dark', 'zh-dark'], ['en', 'light', 'en-light']]) {
    await win.evaluate(({ locale: nextLocale, scheme: nextScheme }) => {
      localStorage.setItem('nomi:locale:v1', nextLocale)
      localStorage.setItem('nomi-color-scheme', nextScheme)
    }, { locale, scheme })
    await win.reload()
    await clickOrFail(win.getByRole('button', { name: uiText(locale, 'workspace.creationTab'), exact: true }), '切回创作区')
    await expandResidentPanel(win)
    await expect(win.locator('html')).toHaveAttribute('data-mantine-color-scheme', scheme)
    await expect(panel.locator(USER_BUBBLE).first()).toBeAttached({ timeout: 30_000 })
    await win.waitForTimeout(500)
    await wheel(-900)
    const shown = await jumpVisible()
    record(label, 'jump-latest-appears-when-scrolled-up', shown, {})
    await shot(`${label}-scrolled-up-jump-latest`)
  }

  walk.report.checks = checks
  const red = checks.filter((entry) => !entry.pass)
  walk.report.red = red.map((entry) => `${entry.round}/${entry.check}`)
  walk.report.verified = checks.filter((entry) => entry.pass).map((entry) => `${entry.round}/${entry.check}`)
  fs.writeFileSync(path.join(walk.outputDir, 'checks.json'), JSON.stringify(checks, null, 1))
  console.log(`checks: ${checks.length - red.length} green / ${red.length} red`)
  if (red.length) throw new Error(`跟到底走查有 ${red.length} 条红：${walk.report.red.join('、')}`)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
