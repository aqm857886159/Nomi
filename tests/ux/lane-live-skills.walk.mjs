#!/usr/bin/env node
// R16 真实用户任务走查：**「会话开着的时候我导入了一个技能，Agent 现在就该知道它存在」**。
//
// 与 `skill-import-real-use.walk.mjs` 的分工（别把两条看成同一条）：那条证的是「**我点了它**
// 之后，这份方法论进没进模型」——走的是 composer 的技能 chip 通路，正文由渲染层随这一条消息带上，
// 和技能索引是两条不同的线。这条证的是另一半，也是 2026-09-11 评审点名的那个缺口：
//
//   **模型的技能索引（系统提示词里的 `<available_skills>`）是不是活的。**
//
// 它决定的是「用户不点菜单，只说一句『用刚导入的那个分镜技能』时，模型知不知道有这么个东西」。
// 修之前那份索引是开 lane 那一刻的快照：新导入的技能要关掉项目再打开才出现在里面，
// 而技能库面板与 composer 的菜单**都已经看得见它了**——于是现象是「明明在列表里，Agent 却说没有」。
//
// 判定（硬证据，不靠截图也成立，且两端都可证伪）：
//   ① 导入**之前**那一轮的 system 里有 `<available_skills>`（内置技能在里面 = 这一段是活的），
//      但**没有**这个技能的名字——阳性对照，证明后面那条断言不是恒真。
//   ② **不重开项目、不重开对话**，导入之后的下一轮 system 里出现它的名字、描述与安装路径。
//   ③ 用户视角那一半：composer 的技能菜单里选得到它，选中后 composer 上出现技能 chip。
//
// 零额度：文本模型走 `agent-runtime-fixture` 的 loopback，不打任何真供应商。
// 用法：pnpm run build && node tests/ux/lane-live-skills.walk.mjs [--packaged /abs/Nomi.app/Contents/MacOS/Nomi]
import fs from 'node:fs'
import path from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { clickOrFail, expect, proveProbe, screenshotSettled } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL } from './agent-runtime-fixture.mjs'
import {
  CANVAS_PANEL, COMPOSER_CHIP, COMPOSER_SKILL, SKILL_POPOVER,
  chooseAssistantModel, createRuntimeWalk, openCanvas, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const SKILL_DIR = 'walk-live-index'
const SKILL_NAME = 'walk-live-index'
const SKILL_DESC = '走查·会话中途导入的技能索引'
const SKILL_BODY = ['---', `name: ${SKILL_NAME}`, `description: ${SKILL_DESC}`, '---', '', '正文：先定调子再定镜头。'].join('\n')
const REPLY_BEFORE = 'WALK_LIVE_BEFORE：好的。'
const REPLY_AFTER = 'WALK_LIVE_AFTER：我看到那个技能了。'

function systemTextOf(body) {
  return (Array.isArray(body?.messages) ? body.messages : [])
    .filter((message) => message?.role === 'system')
    .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
    .join('\n')
}

const walk = await createRuntimeWalk('lane-live-skills')
const shotDir = process.env.NOMI_WALK_SHOT_DIR || walk.report.outputDir
fs.mkdirSync(shotDir, { recursive: true })

const zipPath = path.join(walk.report.tempRoot, `${SKILL_DIR}.zip`)
fs.writeFileSync(zipPath, Buffer.from(zipSync({ [`${SKILL_DIR}/SKILL.md`]: strToU8(SKILL_BODY) })))
const userSkillsRoot = path.join(walk.report.tempRoot, 'settings', 'skills')

/** 等的是盘上的真实结果，不是私有墙钟（R18）。 */
async function waitForSkillOnDisk(win, dirName) {
  const deadline = Date.now() + 15_000
  for (;;) {
    if (fs.existsSync(path.join(userSkillsRoot, dirName, 'SKILL.md'))) return path.join(userSkillsRoot, dirName, 'SKILL.md')
    if (Date.now() > deadline) throw new Error(`等满 15s，${userSkillsRoot} 里没出现 ${dirName}`)
    await win.waitForTimeout(200)
  }
}

async function shot(win, name) {
  const file = path.join(shotDir, `${name}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`SHOT: ${file}`)
  return file
}

let failure
try {
  const { win } = await walk.start({ first: true })
  await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
  await shot(win, '01-agent-open')

  // ── ① 阳性对照：这一刻索引是活的（内置技能在里面），但还没有这个技能 ──────────
  const before = walk.fixture.expectText({
    label: '导入之前的第一轮',
    match: () => true,
    reply: { type: 'text', text: REPLY_BEFORE },
  })
  await sendCanvas(win, '我们先聊一下这个项目。')
  const beforeWire = await recorded(before.received, '导入前的模型请求')
  const beforeSystem = systemTextOf(beforeWire.body)
  expect(beforeSystem, '送往模型的消息里根本没有 system 段——比预期更糟，整层都没送').not.toBe('')
  expect(
    beforeSystem.includes('<available_skills>'),
    '第一轮的 system 里就没有技能索引段——这一屏不是活的索引，下面「导入后出现了」的断言不作数',
  ).toBe(true)
  expect(
    beforeSystem.includes(SKILL_NAME),
    '还没导入就已经出现在索引里——断言认错了人（换一个更独特的技能名）',
  ).toBe(false)
  console.log(`  ✅ 阳性对照：system 长度 ${beforeSystem.length}，<available_skills> 在、${SKILL_NAME} 不在`)

  // ── ② 用户在会话开着的时候导入一个技能（走真实入口：技能库面板的导入） ──────────
  await clickOrFail(win.getByRole('button', { name: '技能库', exact: true }).first(), '侧栏「技能库」')
  const panel = win.locator('[data-skill-drop-zone]')
  await expect(panel, '技能库面板没渲染').toBeVisible()
  // input 必须钉在技能库面板内部：这一屏上画布工具栏与 composer 各自还有一个 file input。
  const fileInput = panel.locator('input[type="file"]').first()
  await fileInput.waitFor({ state: 'attached' })
  await fileInput.setInputFiles(zipPath)
  const skillFilePath = await waitForSkillOnDisk(win, SKILL_DIR)
  await expect(panel.getByText(SKILL_DESC, { exact: false }).first(), '导进来了但技能库面板里看不见').toBeVisible()
  await shot(win, '02-skill-imported-mid-session')

  // ── ③ 用户视角那一半：不重开任何东西，composer 的技能菜单里就该选得到 ──────────
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_SKILL}`), 'Agent composer 的「技能」钮')
  const popover = win.locator(`${CANVAS_PANEL} ${SKILL_POPOVER}`)
  await expect(popover).toBeVisible()
  await proveProbe(
    popover.locator('[data-v4-command^="skill:"]'),
    '技能菜单里连内置技能都没有——这一屏不是活的，下面的断言不作数',
  )
  await expect(
    popover.getByText(SKILL_DESC, { exact: false }).first(),
    '刚导入的技能没有出现在 Agent 的技能菜单里',
  ).toBeVisible()
  await shot(win, '03-skill-in-composer-menu')

  // ── ④ 本条走查的正主：**同一条 lane、不重开**，下一轮的索引里必须有它 ──────────
  // 这里刻意**不选**那个技能：选了就是 composer 的 chip 通路（正文随消息走），
  // 证不到索引。要证的恰恰是「用户没点它，模型也知道有这么个东西」。
  await win.keyboard.press('Escape')
  const after = walk.fixture.expectText({
    label: '导入之后的下一轮',
    match: () => true,
    reply: { type: 'text', text: REPLY_AFTER },
  })
  await sendCanvas(win, '你现在都有哪些技能可用？')
  const afterWire = await recorded(after.received, '导入后的模型请求')
  const afterSystem = systemTextOf(afterWire.body)
  expect(
    afterSystem.includes(SKILL_NAME),
    `同一条 lane 的下一轮里，技能索引仍然没有「${SKILL_NAME}」——索引还是开 lane 那一刻的快照，`
    + `用户只能关掉项目重开。system 里的索引段：${afterSystem.slice(afterSystem.indexOf('<available_skills>'), afterSystem.indexOf('<available_skills>') + 600)}`,
  ).toBe(true)
  expect(afterSystem, '索引里有名字却没有描述——模型没法据此判断什么时候该用它').toContain(SKILL_DESC)
  expect(
    afterSystem.includes(skillFilePath),
    `索引里没有这条技能的安装路径（${skillFilePath}）——模型拿不到「去哪读正文」，看得见也读不到`,
  ).toBe(true)
  console.log(`  ✅ 不重开会话：索引里已经有 ${SKILL_NAME}（名字 + 描述 + 安装路径都在）`)
  await shot(win, '04-index-live-next-turn')

  // ── ⑤ 收口：选中它，chip 画得出来（用户真的用得上，不只是模型看得见） ──────────
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_SKILL}`), 'Agent composer 的「技能」钮')
  await clickOrFail(popover.getByText(SKILL_DESC, { exact: false }).first(), '菜单里刚导入的技能')
  await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER_CHIP}`), '选中技能后 composer 上没有出现技能 chip').toBeVisible()
  await shot(win, '05-skill-chip-attached')

  console.log('\n✅ 会话中途导入的技能：技能库看得见、composer 选得到、同一条 lane 的下一轮索引里也有它。')
} catch (error) {
  failure = error
} finally {
  await walk.finish(failure)
}
