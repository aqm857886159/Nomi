#!/usr/bin/env node
// 走查：创作文档里选中一句，浮条每颗钮只做它自己那件事（2026-11-08 用户反馈），
// 「拆成镜头」用分镜图标、排在「AI 编辑」右边（样张 B，用户 2026-11-12 拍板，清单 SelectionStoryboard）。
//
// 用户原话：「我在文本区域点击了，滑中句子，点击视频icon，然后为什么发送了文字」。
// 照用户那条路走：点正文 → 鼠标拖选一句 → 点浮条上的图标。零额度：模型是 loopback 夹具，每次调用都要预先声明。
//   ① 没选中（只点一下正文）：浮条不出。
//   ② 拆成镜头：交给 Agent——这句恰好发出去 1 次、留在创作面；气泡上的技能小签和回复头上的凭据
//      印技能库里的名字，不印 key（分镜启动器发的是点号 key）。先走这颗，后面「没多出气泡」才有活探针。
//   ③ 生成图片：画布多一个图片节点、提示词就是这句；回到创作面，对话里没多出气泡、没发文本请求。
//   ④ 生成视频（用户点的那颗相机）：画布多一个视频节点；同样不发文字。
//   ⑤ 回到创作面再选一次：真窗里浮条的位置（「拆成镜头」在「AI 编辑」右边、「生成」只剩图片和视频）
//      和对话里的「分镜规划」同框拍一张，中英各一张，拿去和样张逐项对账。
//
// 清单断言：board:SelectionStoryboard/chat.skill-chip、board:SelectionStoryboard/chat.skill-loaded
// （浮条本身的格在设计实验室走查 design-lab-creation-ai-rewrite.walk.mjs 里核；这里在真窗再核一次顺序）。
//
// 用法：NOMI_WALK_LOCALE=zh-CN|en node tests/ux/creation-selection-actions.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  ASSISTANT_MESSAGE,
  CREATION_PANEL,
  USER_BUBBLE,
  createRuntimeWalk,
  expandResidentPanel,
  recorded,
  waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const locale = process.env.NOMI_WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const SENTENCE = locale === 'en'
  ? 'A girl walks through the rain-soaked night market holding a red umbrella.'
  : '雨夜的街头，女孩撑着红伞穿过霓虹闪烁的夜市。'
const REPLY = locale === 'en' ? 'SELECTION_WALK_ACK planned.' : 'SELECTION_WALK_ACK：已拆好。'
const DOC = '[data-creation-editor="true"] .tiptap[contenteditable="true"]'
const POPOVER = '.workbench-selection-popover'
const WORKSPACE = '[data-workspace-mode]'
const SKILL_CHIP = '[data-v4-chip="skill"]'
const SKILL_RECEIPT = '[data-v4-skill-used]'
const BESIDE_AI_EDIT = '[data-selection-cluster="beside-ai-edit"]'
const GENERATE_CLUSTER = '[data-selection-cluster="generate"]'
const node = (kind) => `.generation-canvas-v2-node[data-kind="${kind}"]`

// 名字与 key 都从真源头读，不手抄：技能库名字在 SKILL.md 的 library.title，key 是分镜启动器真发的那个。
const skillSource = fs.readFileSync(path.join(repoRoot, 'skills/workbench-storyboard-planner/SKILL.md'), 'utf8')
const titleMatch = /\n\s+title:\s*\n\s+zh-CN:\s*(.+)\n\s+en:\s*(.+)\n/.exec(skillSource)
if (!titleMatch) throw new Error('读不到分镜规划技能的 library.title（SKILL.md 改了格式，走查要跟着改）')
const SKILL_TITLE = (locale === 'en' ? titleMatch[2] : titleMatch[1]).trim()
const launcherSource = fs.readFileSync(path.join(repoRoot, 'src/workbench/generationCanvas/agent/storyboardLauncher.ts'), 'utf8')
const keyMatch = /STORYBOARD_PLANNER_SKILL = \{\s*key: '([^']+)'/.exec(launcherSource)
if (!keyMatch) throw new Error('读不到分镜启动器的技能 key（storyboardLauncher.ts 改了，走查要跟着改）')
const SKILL_KEY = keyMatch[1]

const walk = await createRuntimeWalk(`selection-actions-${locale}`)
let failure
try {
  const { win } = await walk.start({ first: true })
  if (locale === 'en') {
    await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
    await win.reload({ waitUntil: 'domcontentloaded' })
  }
  await walk.newProject()
  await expandResidentPanel(win)
  const doc = win.locator(DOC)
  const popover = win.locator(POPOVER)
  const workspace = win.locator(WORKSPACE)
  const generateButton = (key) => popover.getByRole('button', { name: uiText(locale, key), exact: true })
  await clickOrFail(doc, '创作正文')
  await win.keyboard.type(SENTENCE)

  /** 用户那一下：先在正文里点一下，再从句首拖到句尾。返回浏览器里真选中的字。 */
  const dragSelect = async () => {
    const paragraph = doc.locator('p').first()
    const box = await paragraph.boundingBox()
    await win.mouse.click(box.x + box.width - 4, box.y + box.height / 2)
    const range = await paragraph.evaluate((element) => {
      const selection = document.createRange()
      selection.selectNodeContents(element)
      const rects = selection.getClientRects()
      const first = rects[0]
      const last = rects[rects.length - 1]
      return { x0: first.left + 1, y0: first.top + first.height / 2, x1: last.right - 1, y1: last.top + last.height / 2 }
    })
    await win.mouse.move(range.x0, range.y0)
    await win.mouse.down()
    await win.mouse.move(range.x1, range.y1, { steps: 12 })
    await win.mouse.up()
    await expect(popover, '拖选一句后浮条没出来').toBeVisible()
    expect((await win.evaluate(() => String(window.getSelection() ?? ''))).trim(), '拖选没选中整句').toBe(SENTENCE)
  }
  const sentenceRequests = () => walk.fixture.requests.filter((request) => flattenRequestText(request.body ?? {}).includes(SENTENCE)).length

  // ① 浮条这个探针是活的（刚拖选出来过），「没选中 → 不出」才是测得到的断言。
  await dragSelect()
  const popoverProof = await proveProbe(popover, '拖选一句后的选区浮条')
  await walk.snap(`selected-${locale}`)
  const box = await doc.locator('p').first().boundingBox()
  await win.mouse.click(box.x + box.width - 4, box.y + box.height / 2)
  await expectAbsent(popover, { provenBy: popoverProof, message: '只点了一下正文、没选中文字，浮条却出来了' })

  // ② 拆成镜头：交给 Agent，这句恰好发出去一次、留在创作面；技能名印技能库里的名字。
  const planned = walk.fixture.expectText({
    label: 'storyboard planner from selection',
    match: (body) => flattenRequestText(body).includes(SENTENCE),
    reply: { type: 'text', text: REPLY },
  })
  await dragSelect()
  await clickOrFail(generateButton('creationAi.selection.storyboard'), '浮条「拆成镜头」')
  await recorded(planned.received, '拆成镜头发出的那次请求')
  const panel = win.locator(CREATION_PANEL)
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.getByText(REPLY).first() })
  expect(sentenceRequests(), '选中的那句该恰好发给 Agent 一次').toBe(1)
  await expect(workspace, '「拆成镜头」不该把人带离创作面').toHaveAttribute('data-workspace-mode', 'creation')
  const userBubbles = panel.locator(USER_BUBBLE)
  await expect(userBubbles).toHaveCount(1)
  await expect(userBubbles.first()).toContainText(SENTENCE)
  const chip = userBubbles.first().locator(SKILL_CHIP)
  await expect(chip, '发出去的那句上没有技能小签').toHaveCount(1)
  await expect(chip, '技能小签没印技能库里的名字').toContainText(SKILL_TITLE)
  await expect(chip, '技能小签印出了 key').not.toContainText(SKILL_KEY)
  const receipt = panel.locator(ASSISTANT_MESSAGE).last().locator(SKILL_RECEIPT)
  await expect(receipt, '回复头上的凭据没印技能库里的名字').toContainText(SKILL_TITLE)
  await expect(receipt, '回复头上的凭据印出了 key').not.toContainText(SKILL_KEY)
  walk.report.storyboard = { locale, chip: (await chip.innerText()).trim(), receipt: (await receipt.innerText()).trim() }
  /** 真窗里浮条的分组：「拆成镜头」在「AI 编辑」那一组、带分镜图标；「生成」组只剩图片、视频。 */
  const expectBarOrder = async () => {
    const actionsIn = (cluster) => popover.locator(`${cluster} [data-selection-action]`).evaluateAll(
      (buttons) => buttons.map((button) => button.getAttribute('data-selection-action')),
    )
    expect(await actionsIn(BESIDE_AI_EDIT), '「拆成镜头」不在「AI 编辑」右边那一组').toEqual(['storyboard'])
    expect(await actionsIn(GENERATE_CLUSTER), '「生成」组不是只有图片、视频两颗').toEqual(['image', 'video'])
    const storyboardButton = popover.locator('[data-selection-action="storyboard"]')
    await expect(storyboardButton.locator('svg.tabler-icon-layout-rows'), '「拆成镜头」不是分镜图标').toHaveCount(1)
  }
  await walk.snap(`after-storyboard-${locale}`)
  const bubbleProof = await proveProbe(userBubbles.first(), '「拆成镜头」发出去的那条用户气泡')

  /** 建节点的两颗：切到画布、多一个对应节点、提示词是这句；回到创作面，对话里没有多出任何气泡、这句没再发出去。 */
  const createsNodeOnly = async ({ key, label, kind, counts }) => {
    const before = walk.fixture.requests.length
    await dragSelect()
    await clickOrFail(generateButton(key), `浮条「${label}」`)
    await expect(workspace, `点「${label}」后没切到生成画布`).toHaveAttribute('data-workspace-mode', 'generation')
    for (const [nodeKind, count] of Object.entries(counts)) {
      await expect(win.locator(node(nodeKind)), `点「${label}」后画布上 ${nodeKind} 节点数不对`).toHaveCount(count)
    }
    await expect(win.locator(node(kind)).last(), `${kind} 节点的提示词不是选中的那句`).toContainText(SENTENCE)
    await walk.snap(`after-${kind}-${locale}`)
    await switchWorkspace(win, 'creation')
    await expectAbsent(userBubbles.nth(1), { provenBy: bubbleProof, message: `点「${label}」往对话里发了一条消息` })
    expect(walk.fixture.requests.length - before, `点「${label}」发出了文本请求`).toBe(0)
    expect(sentenceRequests(), `点「${label}」把这句又发给了 Agent`).toBe(1)
  }
  // ③ 生成图片；④ 生成视频（用户点的那颗相机）。节点数是精确的：拆成镜头那一步也没在画布上建东西。
  await createsNodeOnly({ key: 'creationAi.selection.image', label: uiText(locale, 'creationAi.selection.image'), kind: 'image', counts: { image: 1, video: 0 } })
  await createsNodeOnly({ key: 'creationAi.selection.video', label: uiText(locale, 'creationAi.selection.video'), kind: 'video', counts: { image: 1, video: 1 } })

  // ⑤ 再选一次：新位置的浮条和对话里的「分镜规划」同框。这一下不点任何钮，不该发出任何请求。
  const beforeFinal = walk.fixture.requests.length
  await dragSelect()
  await expectBarOrder()
  await expect(chip, '同框时对话里的技能小签不见了').toContainText(SKILL_TITLE)
  await expect(receipt, '同框时「已载入技能」不见了').toContainText(SKILL_TITLE)
  walk.report.barAndChat = await walk.snap(`bar-and-chat-${locale}`)
  expect(walk.fixture.requests.length - beforeFinal, '只是选中文字就发出了请求').toBe(0)
} catch (error) { failure = error }
await walk.finish(failure)
