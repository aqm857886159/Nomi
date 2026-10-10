#!/usr/bin/env node
// #1136 评审阻断 1 的真实回归：Agent 在 停靠 → 小球 → 浮窗 → 停靠 走一圈，面板**不卸载重挂**。
//
// 现场：外壳早先把同一个 Agent 面板按形态 portal 到三个不同容器，切一次形态 React 就把整棵面板卸掉重挂——
// 待确认计划卡的勾选与折叠（useAgentPanelV4Data 的 planState 是组件本地 state）、滚动、历史分页、线程菜单都回默认。
// 修法：react-reverse-portal，面板只渲染一次（InPortal），形态只决定那个 DOM 节点挂在哪（OutPortal）。
//
// 本走查造一张多行待确认计划卡（loopback 模型提 edit_timeline，三条操作）、取消一行、折叠卡片、输入框留一句草稿，
// 已有一轮对话和一条工具回执；然后 停靠 → 小球 → 浮窗 → 停靠，断言勾选、折叠、草稿、对话、回执、当前线程都还在。
// 零额度：文本模型是本机 loopback fixture，不生成；真 Electron、窗口在屏外、隔离 profile。
// Run: pnpm run build && node tests/ux/agent-form-switch-state.walk.mjs
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { dirOfMetaUrl } from '../../scripts/lib/repoPaths.mjs'
import { createAgentRuntimeFixture, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, COLLAPSED_DOCK, COMPOSER_INPUT, COMPOSER_SEND, PREVIEW_PANEL, TOOL_RECEIPT, USER_BUBBLE,
  ASSISTANT_MESSAGE, chooseAssistantModel, hasToolResult, recorded,
} from './agent-runtime-walk-support.mjs'

const here = dirOfMetaUrl(import.meta.url)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/agent-form-switch-state')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const root = makeTempDir('nomi-agent-form-switch-')
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'agent-form-switch-walk'
const projectName = 'Agent 三形态切换不丢状态'
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
const makeClip = (id, label, startFrame, endFrame) => ({ id, type: 'video', sourceNodeId: `node-${id}`, label, startFrame, endFrame, frameCount: endFrame - startFrame, offsetStartFrame: 0, offsetEndFrame: 0 })
const timeline = {
  version: 1, fps: 30, scale: 1.5, playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
    { id: 'videoTrack', type: 'video', label: '视频轨', clips: [makeClip('clip-a', '开场远景', 0, 120), makeClip('clip-b', '推门近景', 120, 240), makeClip('clip-c', '眼神反应', 240, 360)] },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [{ id: 'caption-2', text: '旧字幕', style: 'caption', startFrame: 120, endFrame: 180 }],
  transitions: [],
}
const workbenchDocument = { version: 1, title: projectName, updatedAt: 1, contentJson: { type: 'doc', content: [] } }
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const payload = { workbenchDocument, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: projectName, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, workbenchDocument, timeline, generationCanvas, payload }
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const GREETING = '先打个招呼：我们在剪一条雨夜短片'
const GREETING_REPLY = 'WALK_HELLO：好，我在。'
const PROMPT = '加叠化、改第 2 镜字幕、把镜头 2 音量降一点'
const DRAFT = '这句草稿还没发，切形态不许丢'

function revisionFromToolResult(body, toolCallId) {
  const message = (body.messages ?? []).find((entry) => entry.role === 'tool' && entry.tool_call_id === toolCallId)
  const text = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '')
  const match = /"revision"\s*:\s*"([^"]+)"/.exec(text)
  if (!match) throw new Error(`read_timeline result carried no revision: ${text.slice(0, 300)}`)
  return match[1]
}

const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
const launched = await launchNomiApp({
  name: 'agent-form-switch-state', userDataDir, settingsDir, projectsDir, capabilityDir, timeout: 300_000,
  viewportSize: { width: 1440, height: 900 },
  mainRequire: [path.join(here, '_offscreenWindows.cjs')],
  env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
  args: ['--no-proxy-server'],
  initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
})
const { app } = launched
let win = launched.win
let failure
let rowsProof
const snap = (name) => screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })

/** 断言这一刻面板里该在的都在（每切一次形态读一遍）。 */
async function expectPanelStateKept(where) {
  const panel = win.locator(PREVIEW_PANEL)
  await expect(panel, `${where}：面板不在`).toBeVisible({ timeout: stationTimeout() })
  await expect(panel.locator(COMPOSER_INPUT), `${where}：草稿丢了`).toHaveValue(DRAFT)
  await expect(panel.locator(USER_BUBBLE).filter({ hasText: GREETING }), `${where}：已有对话丢了`).toHaveCount(1)
  await expect(panel.locator(ASSISTANT_MESSAGE).filter({ hasText: 'WALK_HELLO' }), `${where}：助手回复丢了`).toHaveCount(1)
  expect(await panel.locator(TOOL_RECEIPT).count(), `${where}：工具回执丢了`).toBeGreaterThan(0)
  const card = panel.locator(APPROVAL_CARD).first()
  await expect(card, `${where}：待确认卡不在`).toBeVisible()
  // 折叠态保留：计划行仍然收着、钮仍写「展开」。
  await expectAbsent(card.locator('[data-v4-block="plan-rows"]'), { provenBy: rowsProof, message: `${where}：折叠被重置成展开` })
  expect(await win.evaluate(() => Boolean(document.querySelector('#project-agent-resident')?.getAttribute('data-agent-session-marker'))), `${where}：面板被重挂（挂载标记丢了）`).toBe(true)
}

try {
  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: projectName }).first()
  await expect(projectCard, '验收项目卡未出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }).first(), `打开${projectName}`)
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]').first(), '进入剪辑页')
  const panel = win.locator(PREVIEW_PANEL)
  const ball = win.locator(COLLAPSED_DOCK)
  if (await ball.isVisible().catch(() => false)) await clickOrFail(ball, '点小球展开 Nomi')
  await expect(panel, '剪辑页 Agent 没停靠展开').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, PREVIEW_PANEL)

  // ① 一轮普通对话（「已有对话」）。
  const hello = fixture.expectText({ label: 'greeting', match: (body) => flattenRequestText(body).includes(GREETING), reply: { type: 'text', text: GREETING_REPLY } })
  await panel.locator(COMPOSER_INPUT).fill(GREETING)
  await clickOrFail(panel.locator(COMPOSER_SEND), '发送招呼')
  await recorded(hello.received, 'greeting request')
  await expect(panel.locator(ASSISTANT_MESSAGE).filter({ hasText: 'WALK_HELLO' }), '招呼没有回复').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })

  // ② 多行待确认计划卡：先 read_timeline（留下一条工具回执），再 edit_timeline 三条操作，卡停在待确认。
  const readCall = fixture.expectText({ label: 'read', match: (body) => flattenRequestText(body).includes(PROMPT) && !hasToolResult(body, 'walk-read'), reply: { type: 'tool', id: 'walk-read', name: 'read_timeline', args: {} } })
  const planCall = fixture.expectText({ label: 'plan', match: (body) => hasToolResult(body, 'walk-read') && !hasToolResult(body, 'walk-plan'), reply: { type: 'hold' } })
  await panel.locator(COMPOSER_INPUT).fill(PROMPT)
  await clickOrFail(panel.locator(COMPOSER_SEND), '发送剪辑指令')
  await recorded(readCall.received, 'read_timeline request')
  const planWire = await recorded(planCall.received, 'plan request')
  planCall.release({
    type: 'tool', id: 'walk-plan', name: 'edit_timeline',
    args: {
      summary: '加叠化 · 改字幕 · 降音量',
      baseRevision: revisionFromToolResult(planWire.body, 'walk-read'),
      operations: [
        { kind: 'transition', action: 'set', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'dissolve', durationFrames: 15 },
        { kind: 'text', action: 'edit', clipId: 'caption-2', text: '他终于推开了门' },
        { kind: 'clip-audio', clipId: 'clip-b', audio: { gainDb: -6 } },
      ],
    },
  })
  const card = panel.locator(APPROVAL_CARD).first()
  await expect(card, '计划卡没出来').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
  const rows = card.locator('[data-v4-block="plan-rows"] input[type="checkbox"]')
  await expect.poll(() => rows.count(), { message: '计划卡不是多行', timeout: stationTimeout() }).toBeGreaterThan(1)
  // 取消第 2 行、折叠卡片、输入框留草稿；再给面板根打一个只活在这棵 DOM 上的挂载标记（重挂就没了）。
  await rows.nth(1).uncheck()
  await expect(rows.nth(1), '第 2 行没取消').not.toBeChecked()
  rowsProof = await proveProbe(card.locator('[data-v4-block="plan-rows"]'), '折叠前计划行确实在（判「折叠后不在」之前先证探针活着）')
  await clickOrFail(card.locator('[data-v4-control="collapse-plan"]'), '折叠计划卡')
  await expectAbsent(card.locator('[data-v4-block="plan-rows"]'), { provenBy: rowsProof, message: '计划卡没折叠' })
  await panel.locator(COMPOSER_INPUT).fill(DRAFT)
  await win.evaluate(() => document.querySelector('#project-agent-resident')?.setAttribute('data-agent-session-marker', 'kept'))
  await expectPanelStateKept('切形态前')
  await snap('01-dock-before')

  // ③ 停靠 → 小球 → 浮窗 → 停靠。
  await clickOrFail(panel.locator('[data-agent-form-to="ball"]'), '停靠 → 小球')
  await expect(ball, '没收成小球').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(ball, '小球没报等你确认').toHaveAttribute('data-agent-ball', 'pending')
  await snap('02-ball')
  await ball.click({ button: 'right' })
  await clickOrFail(win.getByRole('menuitem', { name: /浮窗/ }).first(), '小球右键 → 浮窗')
  await expect(win.locator('[data-agent-float="preview"]'), '没变成浮窗').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expectPanelStateKept('浮窗')
  await snap('03-float')
  await clickOrFail(win.locator('[data-agent-float="preview"] [data-agent-form-to="dock"]'), '浮窗 → 停靠')
  await expect(win.locator('[data-shell-agent-layer][data-agent-form="dock"]'), '没回到停靠').toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
  await expectPanelStateKept('回到停靠')

  // ④ 展开计划卡：第 2 行仍是取消状态（勾选没被悄悄勾回来）。
  await clickOrFail(card.locator('[data-v4-control="collapse-plan"]'), '展开计划卡')
  await expect(rows.nth(1), '走一圈后第 2 行被勾回来了').not.toBeChecked()
  await expect(rows.first(), '第 1 行应仍勾着').toBeChecked()
  await snap('04-dock-after-cycle')
  console.log('✅ 停靠 → 小球 → 浮窗 → 停靠：勾选、折叠、草稿、对话、回执、面板挂载都在。')

  // ⑤ 功能全表 #58：搬家后的面板里，待确认卡的「确认」和「不要（带原因）」照样走得通。
  const applied = fixture.expectText({ label: 'plan applied', match: (body) => hasToolResult(body, 'walk-plan'), reply: { type: 'text', text: 'WALK_APPLIED：按勾选的两条改好了。' } })
  await clickOrFail(card.locator('[data-v4-control="confirm"]'), '#58 确认计划卡')
  const appliedWire = await recorded(applied.received, 'applied plan result')
  // 计划卡的确认 = 按勾选执行：有一行取消着，就是「只保留勾着的几行」回给模型（planConfirmDecision）——
  // 这条回执里必须带着勾着的行、不带取消掉的那行：勾选状态是真的穿过了三形态切换才走到这里的。
  const planResult = JSON.stringify((appliedWire.body.messages ?? []).find((entry) => entry.role === 'tool' && entry.tool_call_id === 'walk-plan')?.content ?? '')
  console.log('  [#58] 计划卡确认回给模型：', planResult.slice(0, 400))
  expect(planResult, '#58 确认回执里没有勾着的那行').toContain('-6')
  expect(planResult, '#58 取消掉的那行不该回给模型').not.toContain('他终于推开了门')
  await expect(panel.locator(ASSISTANT_MESSAGE).filter({ hasText: 'WALK_APPLIED' }), '#58 确认后没有回到模型').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
  const REJECT_PROMPT = '再把开场远景开头剪掉一秒'
  const rejectRead = fixture.expectText({ label: 'reject read', match: (body) => flattenRequestText(body).includes(REJECT_PROMPT) && !hasToolResult(body, 'walk-read-2'), reply: { type: 'tool', id: 'walk-read-2', name: 'read_timeline', args: {} } })
  const rejectPlan = fixture.expectText({ label: 'reject plan', match: (body) => hasToolResult(body, 'walk-read-2') && !hasToolResult(body, 'walk-plan-2'), reply: { type: 'hold' } })
  const rejected = fixture.expectText({ label: 'rejected', match: (body) => hasToolResult(body, 'walk-plan-2'), reply: { type: 'text', text: 'WALK_REJECTED：好，开场保留。' } })
  await panel.locator(COMPOSER_INPUT).fill(REJECT_PROMPT)
  await clickOrFail(panel.locator(COMPOSER_SEND), '发送删开场')
  await recorded(rejectRead.received, 'reject read')
  const rejectWire = await recorded(rejectPlan.received, 'reject plan request')
  rejectPlan.release({ type: 'tool', id: 'walk-plan-2', name: 'edit_timeline', args: { summary: '删开场远景', baseRevision: revisionFromToolResult(rejectWire.body, 'walk-read-2'), operations: [{ kind: 'trim', clipId: 'clip-a', edge: 'left', deltaFrame: 30 }] } })
  const rejectCard = panel.locator(APPROVAL_CARD).first()
  await expect(rejectCard, '#58 第二张卡没出来').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
  await clickOrFail(rejectCard.locator('[data-v4-control="slot-dismiss"]'), '#58 不要')
  const reason = rejectCard.locator('[data-v4-control="reject-reason"]')
  await expect(reason, '#58 不要之后没出原因输入').toBeVisible()
  await reason.fill('开场是全片的锚')
  await clickOrFail(rejectCard.locator('[data-v4-control="confirm-reject"]'), '#58 确认不要')
  await recorded(rejected.received, 'rejected result')
  await expect(panel.locator(ASSISTANT_MESSAGE).filter({ hasText: 'WALK_REJECTED' }), '#58 拒绝后没有回到模型').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
  await snap('05-confirm-and-reject')
  console.log('✅ #58 搬家后的面板里确认 / 带原因拒绝都走得通。')
} catch (error) {
  failure = error
  try { await win.screenshot({ path: path.join(shotsDir, 'FAIL.png') }) } catch { /* window gone */ }
} finally {
  await app.close().catch(() => undefined)
  await fixture.close()
}
if (failure) { console.error(failure); process.exit(1) }
