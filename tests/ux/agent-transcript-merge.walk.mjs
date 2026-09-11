#!/usr/bin/env node
// R13 走查：一回合一个气泡 · 技能用没用上要有物证（2026-09-10 用户反馈 #7 / #6）。
//
// 走的是真人会走的那条路：选模型 → 打字 → 点发送 → 看屏幕。不灌状态、不喂夹具输入。
// 零额度：供应商是 loopback（`agent-runtime-fixture.mjs`），每一次模型调用都要预先声明。
//
// 两条断言各自对着一条反馈：
//   ① 一回合「文本 → 工具 → 文本 → 工具 → 文本」= **1 个**助手气泡，两条工具行按序在过程里。
//   ② 挂了技能发一条：用户气泡尾部有技能 chip，这一轮回复头上有「已使用技能」凭据；
//      没挂技能的那一轮整行不出（阳性对照挡「探针本来就找不到」那种假绿）。
//
// 用法：node tests/ux/agent-transcript-merge.walk.mjs
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  ASSISTANT_MESSAGE,
  COMPOSER,
  COMPOSER_SKILL,
  CREATION_PANEL,
  DOCUMENT,
  SKILL_POPOVER,
  SKILL_SEARCH,
  USER_BUBBLE,
  chooseAssistantModel,
  createRuntimeWalk,
  hasToolResult,
  recorded,
  sendCreation,
  waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

/** 一轮回复被工具切开的三段话。它们是同一个人说的同一段，屏幕上就该是一块。 */
const SEGMENTS = [
  '好，我先看看文稿写到哪儿了。',
  '好的，画布是空的，我按文稿里那场戏来。',
  '已经提交生成了，等结果回来我再说。',
]
const MERGE_ASK = '读一下文稿，再看看画布，然后告诉我下一步。'
const SKILL_ASK = '按这套方法帮我把开场拆一版。'
// 技能的身份就是它目录里 frontmatter 的 `name`（`skills/workbench-storyboard-planner/SKILL.md`），
// 菜单行的挂点是 `skill:<name>`。别写成点分的那版——那是一个找不到的死选择器。
const SKILL_ID = 'workbench-storyboard-planner'
const PROCESS = '[data-v4-block="process"]'
const PROCESS_ROWS = '[data-process-folded] > [data-v4-block]'
const SKILL_CHIP = '[data-v4-chip="skill"]'
const SKILL_RECEIPT = '[data-v4-skill-used]'

const walk = await createRuntimeWalk('transcript-merge')
let failure
try {
  const { win } = await walk.start({ first: true })
  await walk.newProject()
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await win.keyboard.press('Escape')
  await win.locator(DOCUMENT).fill('清晨，她推开咖啡馆的门。红杯落在白桌上。')
  const panel = win.locator(CREATION_PANEL)
  const bubbles = panel.locator(ASSISTANT_MESSAGE)

  // ── ① 一回合：文本 → 工具 → 文本 → 工具 → 文本 ────────────────────────────
  // 两次调用刻意用**不同**的工具：同名相邻会被折成一条 `tool-group`，那样就验不到「两条按序」。
  walk.fixture.expectText({
    label: 'merge step 0', match: body => flattenRequestText(body).includes(MERGE_ASK) && !hasToolResult(body, 'merge-0'),
    reply: { type: 'tool', id: 'merge-0', name: 'read_full_text', args: {}, text: SEGMENTS[0] },
  })
  walk.fixture.expectText({
    label: 'merge step 1', match: body => hasToolResult(body, 'merge-0') && !hasToolResult(body, 'merge-1'),
    reply: { type: 'tool', id: 'merge-1', name: 'nomi_canvas_read', args: {}, text: SEGMENTS[1] },
  })
  const closing = walk.fixture.expectText({
    label: 'merge closing', match: body => hasToolResult(body, 'merge-1'),
    reply: { type: 'text', text: SEGMENTS[2] },
  })
  await sendCreation(win, MERGE_ASK)
  await recorded(closing.received, 'both real tool results')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.getByText(SEGMENTS[2]).first() })

  // 三段话 = 一个气泡。这一条红了就是反馈 #7 复发。
  await expect(bubbles, '一轮回复被摊成了几个气泡').toHaveCount(1)
  for (const segment of SEGMENTS) await expect(bubbles.first()).toContainText(segment)
  // 合并用空行接，所以 Markdown 仍按段渲染——粘成一段的话这里只会有 1 个 <p>。
  await expect(bubbles.first().locator('[data-v4-markdown] p'), '合并后段落被粘成了一段').toHaveCount(3)
  // 露出 Markdown 标记（`**` / `#` / `-` 原文）就是排版破了，`p` 里不该出现它们。
  expect(await bubbles.first().innerText()).not.toMatch(/\*\*|^#{1,6}\s/m)

  const process = panel.locator(PROCESS)
  await expect(process).toHaveCount(1)
  if (await process.getAttribute('open') === null) await clickOrFail(process.locator(':scope > summary'), '展开运行过程')
  const rows = await process.locator(PROCESS_ROWS).evaluateAll(all => all.map(row => ({
    kind: row.getAttribute('data-v4-block'), text: row.innerText.replace(/\s+/g, ' ').trim(),
  })))
  // 工具调用**内联不置顶**（2026-09-06 拍板）：两条收据仍按调用顺序摆着，一条都没被吞。
  expect(rows.map(row => row.kind), '两条工具行没有按序留在过程里').toEqual(['tool', 'tool'])
  expect(rows[0].text === rows[1].text, '两条工具行印成了同一句话，顺序无从判断').toBe(false)
  walk.report.mergedTurn = { bubbles: await bubbles.count(), rows }
  await walk.snap('merged-one-bubble')

  // ── ② 挂技能发一条 ─────────────────────────────────────────────────────
  await clickOrFail(panel.locator(COMPOSER_SKILL), '技能 / 命令菜单')
  const menu = panel.locator(SKILL_POPOVER)
  await expect(menu).toBeVisible()
  // 真人会打字找它。搜完这一行仍可能收在一个折起来的分组里，那就先把分组点开——
  // 直接对着不可见的行点，报的红说的是「没找到」，会把「收起来了」误诊成「没有这个技能」。
  await menu.locator(SKILL_SEARCH).fill(SKILL_ID)
  const skillRow = menu.locator(`[data-v4-command="skill:${SKILL_ID}"]`).first()
  await expect(skillRow, `技能库里没有 ${SKILL_ID}`).toHaveCount(1)
  if (!await skillRow.isVisible()) {
    await clickOrFail(menu.locator('details:has([data-v4-command]) > summary').first(), '展开技能分组')
  }
  await clickOrFail(skillRow, `挂上技能 ${SKILL_ID}`)
  // 菜单里选的那个名字 = composer 上那颗 chip 上的名字。转录里印的必须还是它，
  // 否则用户没法确认自己挂的就是刚才那个（同一语义两份名字）。
  const composerChip = panel.locator(`${COMPOSER} ${SKILL_CHIP}`).first()
  await expect(composerChip).toBeVisible()
  const skillName = (await composerChip.innerText()).trim()
  expect(skillName.length, '技能 chip 上没有名字').toBeGreaterThan(0)
  // 挂着的时候这颗 chip 在 —— 下面「发完就没了」那条断言因此是测得到的，不是恒真的空话。
  const chipProof = await proveProbe(composerChip, '挂上技能后 composer 顶上有那颗 chip')
  // Skill 钮上不再点第二次名（2026-09-10 用户反馈 #2）：钮里只剩图标 + 文字，
  // 那颗 accent 小点是多出来的一个 span，所以这条等式红了就是它复活了。
  expect(
    await panel.locator(COMPOSER_SKILL).evaluate(el => [...el.children].map(child => child.tagName.toLowerCase())),
    'Skill 钮上多了一件东西（那颗小点已删，反馈在 chip 上）',
  ).toEqual(['svg'])

  const answered = walk.fixture.expectText({
    label: 'skill turn', match: body => flattenRequestText(body).includes(SKILL_ASK),
    reply: { type: 'text', text: '收到，按这套方法来。' },
  })
  await sendCreation(win, SKILL_ASK)
  await recorded(answered.received, 'the skill-bearing request')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.getByText('收到，按这套方法来。').first() })

  const userBubbles = panel.locator(USER_BUBBLE)
  await expect(userBubbles).toHaveCount(2)
  // ① 用户气泡尾部那颗 chip：「我挂了它」。
  await expect(userBubbles.nth(1).locator(SKILL_CHIP), '发出去的那句话上没有技能 chip').toHaveCount(1)
  await expect(userBubbles.nth(1).locator(SKILL_CHIP)).toContainText(skillName)
  // ② 回复头上那一行凭据：「它确实进了这一轮」。
  await expect(bubbles).toHaveCount(2)
  await expect(bubbles.nth(1).locator(SKILL_RECEIPT), '回复头上没有「已使用技能」凭据').toContainText(skillName)
  // ③ 那颗 chip 上印的是技能**自己的封面**，不是一个灰方块（2026-09-10 用户反馈 #3：
  //    「是不是缩略图显示不了」）。`workbench-storyboard-planner` 有 assets/cover.png，
  //    所以这里该是一张真加载出来的图——只断言 `<img>` 在不够，src 404 时它也在。
  const chipMedia = userBubbles.nth(1).locator(`${SKILL_CHIP} [data-skill-media]`).first()
  await expect(chipMedia, '气泡里的技能 chip 没有封面（退回了占位方块）').toHaveAttribute('data-skill-media', 'image')
  const coverPainted = await chipMedia.evaluate(img => img.complete && img.naturalWidth > 0)
  expect(coverPainted, '技能封面挂上了但一个像素都没画出来（src 取不到）').toBe(true)
  // ④ 技能是随这条消息发出去的引用：发送成功后 composer 上不该还挂着它
  //    （2026-09-10 用户反馈 #1：「难道让我一直用这个 Skill？」）。
  await expectAbsent(panel.locator(`${COMPOSER} ${SKILL_CHIP}`), {
    provenBy: chipProof, message: '消息发出去了，技能 chip 还赖在 composer 上（用户会以为以后每条都得挂着它）',
  })
  walk.report.skillEvidence = {
    skillName,
    chip: (await userBubbles.nth(1).locator(SKILL_CHIP).innerText()).trim(),
    receipt: (await bubbles.nth(1).locator(SKILL_RECEIPT).innerText()).trim(),
    chipCover: await chipMedia.getAttribute('src'),
    composerCleared: await panel.locator(`${COMPOSER} ${SKILL_CHIP}`).count(),
  }
  await walk.snap('skill-chip-and-receipt')

  // 阳性对照：凭据这个探针在这一屏是活的（刚在第二个气泡上找到过），
  // 所以「第一轮没挂技能 → 整行不出」是一条测得到的断言，不是恒真的空话。
  const proof = await proveProbe(bubbles.nth(1).locator(SKILL_RECEIPT), '挂了技能的那一轮，回复头上有凭据')
  await expectAbsent(bubbles.nth(0).locator(SKILL_RECEIPT), {
    provenBy: proof, message: '没挂技能的那一轮不该印凭据（印了就是在替用户编一个他没做的操作）',
  })
} catch (error) { failure = error }
await walk.finish(failure)
