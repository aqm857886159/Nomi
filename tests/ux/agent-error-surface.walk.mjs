#!/usr/bin/env node
// 报障现场的真机复现（2026-09-11）：用户在 Agent 面板里刚动完一下（换模型 / 切对话）就接着
// 打字或点按钮，面板顶部糊出一行**红色英文原文**
// 「The agent is opening a conversation. Try again after it opens.」。
//
// 这条走查按真人的手法走：一个窗口、只点界面、模型从下拉里选。它要证两件事——
//   ① 那一下「刚切完就动手」不再把用户顶回来（他那句话该落进对话，不是变成一条红字）；
//   ② 万一真出了错，横幅上印的是**本地化的话**，不是主进程的原文。
//
// ② 的断言写成「横幅里不许出现拉丁散句」，不是「不许出现那一句」：这一族不是某一句忘了翻译，
// 是「主进程的任意字符串能不能成为界面文字」。只盯那一句，换一句照样漏。
import { clickOrFail, expect } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CREATION_PANEL, COMPOSER_INPUT, COMPOSER_SEND, DOCUMENT, chooseAssistantModel,
  createRuntimeWalk, newConversation, recorded, sendCreation, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

const ERROR_BANNER = `${CREATION_PANEL} [data-agent-error="true"]`
const FIRST = 'ERRSURF_FIRST：先读一遍文稿，说一句话就行。'
const RACED = 'ERRSURF_RACED：我刚切完对话就立刻打了这句。'

/**
 * 一句「拉丁散句」= 至少两个由空格隔开的拉丁词。机器码（`agent_lane_opening`）、模型名
 * （`Fixture 文本`）都过不了这一关，而任何一句没翻译的英文提示都会被它抓住。
 */
function latinProse(text) {
  return /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(String(text || ''))
}

const walk = await createRuntimeWalk('error-surface')
let failure
const observed = []
try {
  const { win } = await walk.start({ first: true })
  const { projectRoot } = await walk.newProject()
  await win.locator(DOCUMENT).fill('雨夜的车站，一封没有寄出的信。')
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)

  // 先走通一轮，证明这条对话本来是好的——没有这一轮，后面「没有红字」就可能只是因为
  // 整个面板压根没在工作（假绿）。
  const first = walk.fixture.expectText({ label: 'the first turn works before we race anything',
    match: (body) => flattenRequestText(body).includes(FIRST), reply: { type: 'text', text: '读到了那封没寄出的信。' } })
  await sendCreation(win, FIRST)
  await recorded(first.received, 'first turn request')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL,
    settledBy: win.locator(CREATION_PANEL).getByText('读到了那封没寄出的信。', { exact: true }) })
  await expect(win.locator(ERROR_BANNER)).toHaveCount(0)

  // ── 报障现场 ──────────────────────────────────────────────────────────────────
  // 「新建对话」在主进程那边是一次真正的结构性替换：关掉 pi 会话、开一条新的、读盘。
  // 用户不会等它——他点完就接着打字。这里就这么做：不等任何 settle，填完直接发。
  // 横幅出不出现都合法（取决于这一下到底落在替换的哪一侧）。**不合法的只有一件事**：
  // 它印出主进程的原文。所以先在页面里挂一个观察者，把此后出现过的每一次横幅文案都记下来
  // ——轮询采样会漏掉一闪而过的那次，而一闪而过的原文照样是原文。
  await win.evaluate((selector) => {
    const seen = new Set()
    const scan = () => { for (const node of document.querySelectorAll(selector)) {
      const text = (node.textContent || '').trim(); if (text) seen.add(text)
    } }
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true })
    scan()
    Object.defineProperty(window, '__nomiAgentErrorTexts', { value: () => [...seen], configurable: true })
  }, ERROR_BANNER)

  const raced = walk.fixture.expectText({ label: 'the raced message still reaches the model',
    match: (body) => flattenRequestText(body).includes(RACED), reply: { type: 'text', text: '收到了你抢着打的那句。' } })
  await newConversation(win, CREATION_PANEL)
  const input = win.locator(`${CREATION_PANEL} ${COMPOSER_INPUT}`)
  await input.fill(RACED)
  await clickOrFail(win.locator(`${CREATION_PANEL} ${COMPOSER_SEND}`), '刚切完对话就立刻发送')

  // 竞态本身：那句话要么真的发出去了，要么以**一句本地化的**提示收尾。两者都没有 = 用户
  // 白打了一句话还什么都没看到，那才是坏的。判据用框架的轮询，不用私有墙钟（R18）；
  // 这一等也顺带给了观察者足够的时间，让一闪而过的横幅也留下记录。
  const landed = await expect
    .poll(() => walk.fixture.requests.some((request) => flattenRequestText(request.body).includes(RACED)))
    .toBe(true)
    .then(() => true, () => false)
  observed.push(...await win.evaluate(() => window.__nomiAgentErrorTexts()))
  for (const text of observed) {
    expect(latinProse(text), `Agent 面板横幅印出了主进程原文：「${text}」`).toBe(false)
  }
  expect(landed || observed.length > 0,
    '刚切完对话就发的那句话，既没落进对话也没给出任何解释').toBe(true)
  await walk.snap('after-racing-a-send-right-after-switching-conversation')

  // 这一下落在替换的哪一侧不是我们能挑的（真机真时序）。两侧都得走完：
  //   · 落在替换之后 → 那句话直接进了新对话；
  //   · 落在替换当中 → 横幅说「重新发一次」，那就**照它说的做**，并且他不该重打一遍
  //     ——那句话必须还在输入框里。一句让用户白干的提示比没有提示还糟。
  if (!landed) {
    await expect(input).toHaveValue(RACED)
    await clickOrFail(win.locator(`${CREATION_PANEL} ${COMPOSER_SEND}`), '照横幅说的重新发一次')
    await recorded(raced.received, 'resent message after the localized stale notice')
  }
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL,
    settledBy: win.locator(CREATION_PANEL).getByText('收到了你抢着打的那句。', { exact: true }) })
  await expect(win.locator(ERROR_BANNER)).toHaveCount(0)
  await walk.snap('raced-message-landed-in-the-new-conversation')

  walk.fixture.assertClean()
  walk.report.observedBannerText = observed
  walk.report.racedMessageLandedFirstTry = landed
  walk.report.projectRoot = projectRoot
  walk.report.verified = [
    'first-turn-is-healthy-before-the-race',
    'no-main-process-prose-in-the-agent-error-banner',
    landed ? 'raced-send-lands-instead-of-being-refused'
      : 'raced-send-explains-itself-in-the-user-language-and-keeps-his-draft',
  ]
} catch (error) { failure = error; process.exitCode = 1 }
finally { await walk.finish(failure) }
