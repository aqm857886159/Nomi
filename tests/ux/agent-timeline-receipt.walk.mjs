#!/usr/bin/env node
// 真实用户任务（R13）：**「让 Nomi 把这段素材劈成两半」——它说的和我看到的是不是同一件事？**
//
// 2026-09-12 用户实录：模型回「已生成剪辑预览，请在确认卡中批准后写入时间线」，
// 而介入槽里一张卡都没有。用户先以为在加载，再以为 Nomi 坏了（T-ED-02 的那张截图）。
//
// 挖到底不是「卡没渲染」，是**回执照着一张静态表说话**：`laneExtendedTools.ts` 的 `nextActionFor`
// 对 `edit_timeline` 无条件回 `user_sees_review_card`。而审批闸跑在 `before_tool`——
// 回执写出来的那一刻，卡要么早被用户答完（`step`/`safe-auto`）、要么这一档压根没出过（`project`）。
// 两种情况下「现在有一张卡在问你」都是假的，而模型只能照着它说话。
//
// 这条走查钉的就是「回执与卡一致」这一句，全程像真人一样点：
//   ① 用户在剪辑面里说「把这段劈成两半」→ 介入槽里出现**一张**卡（真人看得见的那一张）
//   ② 用户点「确认」→ 改动真的落到时间轴上（磁盘为准，不是界面为准）
//   ③ 模型收到的那一行 `User sees: …` 说的是**已经应用**，且不许再说「一张复审卡在问用户」
//   ④ 答完之后槽里不再有卡——回执说的「没有卡在等你」是真的
//
// 零额度：文本模型是本机 loopback fixture，无生成、无解码、隔离 profile。
// Run: pnpm run build && node tests/ux/agent-timeline-receipt.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { createAgentRuntimeFixture, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, COMPOSER_INPUT, COMPOSER_SEND, INTERVENTION_CONFIRM, PREVIEW_PANEL,
  chooseAssistantModel, hasToolResult, recorded,
} from './agent-runtime-walk-support.mjs'

const shotsDir = path.join(repoRoot, 'tests/ux/shots/agent-timeline-receipt')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-agent-timeline-receipt-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'agent-timeline-receipt-walk'
const projectName = 'Agent 剪辑回执与卡一致'
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })

const SPLIT_CLIP = 'clip-long'
const timeline = {
  version: 1, fps: 30, scale: 1.5, playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
    {
      id: 'videoTrack', type: 'video', label: '视频轨',
      clips: [{ id: SPLIT_CLIP, type: 'video', sourceNodeId: 'node-long', label: '一整条长镜头', startFrame: 0, endFrame: 240, frameCount: 240, offsetStartFrame: 0, offsetEndFrame: 0 }],
    },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [],
  transitions: [],
}

const workbenchDocument = { version: 1, title: projectName, updatedAt: 1, contentJson: { type: 'doc', content: [] } }
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const payload = { workbenchDocument, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId, name: projectName, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot, workbenchDocument, timeline, generationCanvas, payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

function toolResultText(body, toolCallId) {
  const message = (body.messages ?? []).find((entry) => entry.role === 'tool' && entry.tool_call_id === toolCallId)
  return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '')
}

/** 计划的 compare-and-swap 要的是宿主刚报的那个 revision，不是猜一个。 */
function revisionFromToolResult(body, toolCallId) {
  const text = toolResultText(body, toolCallId)
  const match = /"revision"\s*:\s*"([^"]+)"/.exec(text)
  if (!match) throw new Error(`read_timeline result carried no revision: ${text.slice(0, 400)}`)
  return match[1]
}

async function persistedVideoClips() {
  const record = await win.evaluate((id) => window.nomiDesktop.projects.readAsync(id), projectId)
  const state = record?.payload?.timeline ?? record?.timeline ?? { tracks: [] }
  return (state.tracks ?? []).flatMap((track) => track.clips ?? []).filter((clip) => clip.type === 'video')
}

const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
const launched = await launchNomiApp({
  name: 'agent-timeline-receipt', userDataDir, settingsDir, projectsDir, capabilityDir, timeout: 300_000,
  env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
  args: ['--no-proxy-server'],
})
const { app } = launched
let win = launched.win
// 不设 `setDefaultTimeout`：Playwright 的默认动作超时本来就是 30s，写一遍只是多一个私有墙钟常量
// （`check:test-waits` 的 station-fixed-timeout 正是在数它）。所有等待都带自己的判据与超时。
win.on('console', (message) => { if (message.type() === 'error') console.log(`[renderer:error] ${message.text()}`) })
win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))

async function resize(width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => { windowRef.setBounds({ x: 0, y: 0, ...bounds }); windowRef.center() }, { width, height })
  await win.waitForTimeout(300)
}

const PROMPT = '把这条长镜头从中间劈成两半'
const READ_ID = 'receipt-read-1'
const EDIT_ID = 'receipt-edit-1'
const DONE = 'WALK_SPLIT_DONE：已经按你说的劈开了。'

let failure
try {
  await win.evaluate(() => {
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload({ waitUntil: 'domcontentloaded' })
  await resize(1440, 920)

  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: projectName }).first()
  await expect(projectCard, '固化的验收项目卡未出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }).first(), `打开${projectName}`)
  await expect.poll(() => app.windows().some((candidate) => /[?&]projectId=/.test(candidate.url())),
    { message: '项目窗口未打开', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  win = app.windows().find((candidate) => /[?&]projectId=/.test(candidate.url())) ?? win
  await win.waitForLoadState('domcontentloaded')
  await resize(1440, 920)
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]').first(), '进入预览')

  const timelinePanel = win.locator('.workbench-preview .workbench-timeline').first()
  await expect(timelinePanel, '预览时间轴未出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const agent = win.locator(PREVIEW_PANEL)
  // 收起态叫回 Nomi 的唯一入口是顶栏角标（09-01 定稿 §11.2）。
  const topbarBadge = win.locator('[data-agent-topbar-badge="true"]')
  if (await topbarBadge.count()) await clickOrFail(topbarBadge.first(), '从顶栏角标展开 Nomi')
  await expect(agent, '剪辑面常驻 Agent 未挂载').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, PREVIEW_PANEL)

  const clip = timelinePanel.locator('[data-testid="timeline-clip"]').filter({ hasText: '一整条长镜头' }).first()
  await expect(clip, '要被劈开的那一条没渲染出来').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await clip.click()

  // 模型这一轮：先读时间轴，再按刚读到的 revision 发一次 `edit_timeline` 分割。
  const readCall = fixture.expectText({
    label: 'the agent reads the live timeline first',
    match: (body) => flattenRequestText(body).includes(PROMPT) && !hasToolResult(body, READ_ID),
    reply: { type: 'tool', id: READ_ID, name: 'read_timeline', args: {} },
  })
  const editCall = fixture.expectText({
    label: 'the agent asks to split the clip, guarded by that revision',
    match: (body) => hasToolResult(body, READ_ID) && !hasToolResult(body, EDIT_ID),
    reply: { type: 'hold' },
  })
  const settled = fixture.expectText({
    label: 'the applied result returns to the model',
    match: (body) => hasToolResult(body, EDIT_ID),
    reply: { type: 'text', text: DONE },
  })

  const input = agent.locator(COMPOSER_INPUT)
  await expect(input).toBeVisible()
  await input.fill(PROMPT)
  await clickOrFail(agent.locator(COMPOSER_SEND), `发送剪辑指令：${PROMPT}`)
  const readWire = await recorded(readCall.received, 'read_timeline request')
  // 模型面是 20 个动词：改时间轴叫 `edit_timeline`（`apply_edit_plan` 是传输层方法名，模型看不到）。
  expect((readWire.body.tools ?? []).map((tool) => tool.function.name), '剪辑面必须把时间轴读写这一对投影给模型')
    .toEqual(expect.arrayContaining(['read_timeline', 'edit_timeline', 'undo']))
  const editWire = await recorded(editCall.received, 'edit_timeline request')
  editCall.release({
    type: 'tool', id: EDIT_ID, name: 'edit_timeline',
    args: {
      baseRevision: revisionFromToolResult(editWire.body, READ_ID),
      summary: '把长镜头从中间劈成两半',
      operations: [{ kind: 'split', clipId: SPLIT_CLIP, atFrame: 120 }],
    },
  })

  // ① 真人看得见的那一张卡：`safe-auto` 是默认档，时间轴编辑带 requiresPlanReview，所以它必须出现。
  //    这同时是 ③ 的阳性对照——一个长不出卡的现场里，「回执没说有卡在等你」毫无意义。
  const approval = agent.locator(APPROVAL_CARD).first()
  const approvalProof = await proveProbe(approval, '时间轴编辑的介入槽必须可见')
  await expect(approval, '可撤销的本地改动不该被判成不可逆').not.toHaveAttribute('data-kind', 'approval-irreversible')
  expect(await agent.locator(APPROVAL_CARD).count(), '同一时刻只该有一张卡在问用户').toBe(1)
  // 卡还没答，改动就不许落盘。
  expect((await persistedVideoClips()).length, '待批准的计划绝不许先落盘').toBe(1)
  await screenshotSettled(win, { path: path.join(shotsDir, '01-one-card-waiting.png') })

  // ② 用户点确认 → 改动真的落到磁盘上。
  await clickOrFail(approval.locator(INTERVENTION_CONFIRM), '确认这次时间轴改动', { noWaitAfter: true })
  const settledWire = await recorded(settled.received, '应用结果回到模型')
  await expect.poll(async () => (await persistedVideoClips()).length,
    { message: '确认之后这一刀必须真的落盘', timeout: DEFAULT_TIMEOUT_MS }).toBe(2)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-split-applied.png') })

  // ③ 回执与卡一致（T-ED-02 的整条不变量）。
  const receipt = toolResultText(settledWire.body, EDIT_ID)
  expect(receipt, '批准后的 edit_timeline 必须真的应用，而不是报错被模型的措辞盖过去').toContain('"applied":true')
  expect(receipt, '回执要说清「用户批了、已经应用」——这才是他此刻看到的').toContain('User sees:')
  expect(receipt, '用户确实答过那张复审卡，回执要照实说').toMatch(/approved the review card/)
  expect(receipt, '改动已经落下去了，回执必须说「已经应用」').toMatch(/now applied/)
  // 2026-09-12 那句原话：回执告诉模型「一张复审卡正在问用户要不要应用」，而卡早已答完。
  expect(receipt, '回执不许再说「有一张复审卡正在问用户」——那正是用户撞到的那句假话')
    .not.toMatch(/review card asks the user/)

  // ④ 答完之后槽里不再有卡：回执里那句「没有卡在等你」是真的。
  await expect(win.locator(PREVIEW_PANEL)).toContainText('WALK_SPLIT_DONE')
  await expectAbsent(approval, { provenBy: approvalProof, message: '已答完的审批卡不该还留在槽里' })
  await screenshotSettled(win, { path: path.join(shotsDir, '03-no-card-left.png') })

  console.log(`agent timeline receipt walkthrough passed; screenshots: ${shotsDir}`)
} catch (error) {
  failure = error
  try { await win.screenshot({ path: path.join(shotsDir, 'FAIL.png') }) } catch { /* window already gone */ }
} finally {
  await app.close().catch(() => undefined)
  await fixture.close()
  if (!failure) fixture.assertClean()
}
if (failure) { console.error(failure); process.exit(1) }
