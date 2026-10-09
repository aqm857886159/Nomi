#!/usr/bin/env node
// R13/R16 · 设计合同 §2.6：剪辑面里「让 Nomi 改时间轴」的完整闭环，走真实 loopback Agent 链——
// 选中片段 → Agent 提计划 → 时间轴高亮（尚未落盘）→ 介入槽审批卡「应用这次」→ 收据 toast → 撤销。
//
// 2026-09-18（T-ED-02）：模型可见动词早就收敛成 20 个（`edit_timeline` / `undo`），而这条走查还在
// 断言 `propose_edit_plan` / `apply_edit_plan` 那套**传输层方法名**——于是它一直红在第一步，
// 「剪辑面的 Agent 能不能改时间轴」实际上没人在看。锚点跟着真实工具面走，并顺手钉住那条回执：
// 卡答完、改动落盘之后，模型收到的 `User sees: …` 必须说「已经应用」，不许再说「一张复审卡在问用户」
// ——后者正是 2026-09-12 用户撞到的那句（「它说要确认卡、卡没出现、也没劈」）。
// 三类新 op（transition / text / audio）在第二轮同一条 propose→apply→undo 链上一起验。
// 零额度：文本模型是本机 loopback fixture，无生成、无解码、隔离 profile。
// Run: pnpm run build && node tests/ux/agent-timeline-ops.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { createAgentRuntimeFixture, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, COLLAPSED_DOCK, COLLAPSED_SHELL, COLLAPSE_BUTTON, COMPOSER, COMPOSER_INPUT,
  COMPOSER_SEND, INTERVENTION_CONFIRM, INTERVENTION_ESCALATE, PREVIEW_PANEL,
  chooseAssistantModel, hasToolResult, recorded,
} from './agent-runtime-walk-support.mjs'
const shotsDir = path.join(repoRoot, 'tests/ux/shots/agent-timeline-ops')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-agent-timeline-ops-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'agent-timeline-ops-walk'
const projectName = 'Agent 剪辑轴三类操作验收'
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })

const makeClip = (id, label, startFrame, endFrame, sourceFrames, offsetStartFrame = 0, offsetEndFrame = 0) => ({
  id, type: 'video', sourceNodeId: `node-${id}`, label, startFrame, endFrame,
  frameCount: sourceFrames, offsetStartFrame, offsetEndFrame,
})

const timeline = {
  version: 1,
  fps: 30,
  scale: 1.5,
  playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
    {
      id: 'videoTrack',
      type: 'video',
      label: '视频轨',
      clips: [
        makeClip('clip-a', '开场远景', 0, 120, 180, 20, 40),
        makeClip('clip-b', '推门近景', 120, 240, 120),
        makeClip('clip-c', '眼神反应', 240, 360, 150, 15, 15),
      ],
    },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [{ id: 'caption-2', text: '旧字幕', style: 'caption', startFrame: 120, endFrame: 180 }],
  transitions: [{ fromClipId: 'clip-a', toClipId: 'clip-b', type: 'dissolve', durationFrames: 12 }],
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

/** The plan's compare-and-swap guard needs the revision the Host just reported, not a guess. */
function revisionFromToolResult(body, toolCallId) {
  const text = toolResultText(body, toolCallId)
  const match = /"revision"\s*:\s*"([^"]+)"/.exec(text)
  if (!match) throw new Error(`read_timeline result carried no revision: ${text.slice(0, 400)}`)
  return match[1]
}

/** Read back what the app actually persisted, through its own project IPC. */
async function persistedTimeline() {
  const record = await win.evaluate((id) => window.nomiDesktop.projects.readAsync(id), projectId)
  return record?.payload?.timeline ?? record?.timeline ?? { tracks: [], textClips: [], transitions: [] }
}

const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
const launched = await launchNomiApp({
  name: 'agent-timeline-ops', userDataDir, settingsDir, projectsDir, capabilityDir, timeout: 300_000,
  env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
  args: ['--no-proxy-server'],
})
const { app } = launched
let win = launched.win
win.setDefaultTimeout(30_000)
win.on('console', (message) => { if (message.type() === 'error') console.log(`[renderer:error] ${message.text()}`) })
win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))

async function resize(width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => { windowRef.setBounds({ x: 0, y: 0, ...bounds }); windowRef.center() }, { width, height })
  await win.waitForTimeout(300)
}

/** One Agent round: prompt → read_timeline → plan → approval card → applied. */
async function proposePlan({ prompt, readToolId, planToolId, plan, doneText }) {
  const readCall = fixture.expectText({
    label: `${planToolId}: the Agent reads the live timeline first`,
    match: (body) => flattenRequestText(body).includes(prompt) && !hasToolResult(body, readToolId),
    reply: { type: 'tool', id: readToolId, name: 'read_timeline', args: {} },
  })
  const planCall = fixture.expectText({
    label: `${planToolId}: the Agent proposes a revision-guarded plan`,
    match: (body) => hasToolResult(body, readToolId) && !hasToolResult(body, planToolId),
    reply: { type: 'hold' },
  })
  const settled = fixture.expectText({
    label: `${planToolId}: the applied result returns to the model`,
    match: (body) => hasToolResult(body, planToolId),
    reply: { type: 'text', text: doneText },
  })
  const input = win.locator(`${PREVIEW_PANEL} ${COMPOSER_INPUT}`)
  await expect(input).toBeVisible()
  await input.fill(prompt)
  await clickOrFail(win.locator(`${PREVIEW_PANEL} ${COMPOSER_SEND}`), `发送剪辑指令：${prompt}`)
  const readWire = await recorded(readCall.received, `${planToolId} read_timeline request`)
  // 模型面是 20 个动词：改时间轴叫 `edit_timeline`，撤回叫 `undo`。
  // `propose_edit_plan` / `apply_edit_plan` / `undo_timeline_edit` 是**传输层**的方法词表，模型看不到它们。
  expect((readWire.body.tools ?? []).map((tool) => tool.function.name), 'The preview surface must advertise the timeline write chain')
    .toEqual(expect.arrayContaining(['read_timeline', 'edit_timeline', 'undo']))
  const planWire = await recorded(planCall.received, `${planToolId} plan request`)
  planCall.release({
    type: 'tool', id: planToolId, name: 'edit_timeline',
    args: { summary: plan.summary, operations: plan.operations, baseRevision: revisionFromToolResult(planWire.body, readToolId) },
  })
  return settled
}

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
  win.setDefaultTimeout(30_000)
  await win.waitForLoadState('domcontentloaded')
  await resize(1440, 920)
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]').first(), '进入预览')

  const timelinePanel = win.locator('.workbench-preview .workbench-timeline').first()
  await expect(timelinePanel, '预览时间轴未出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const agent = win.locator(PREVIEW_PANEL)
  // 收起态叫回 Nomi 的唯一入口是内容区右下的小球（10-08 外壳重设计）。
  const ball = win.locator(COLLAPSED_DOCK)
  if (await ball.count()) await clickOrFail(ball.first(), '点小球展开 Nomi')
  await expect(agent, '剪辑面常驻 Agent 未挂载').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, PREVIEW_PANEL)

  // ① 选中镜头 2 → 输入框出现可见 chip（v4：composer 自己的 [data-v4-chip="clip"]）
  const clipB = timelinePanel.locator('[data-testid="timeline-clip"]').filter({ hasText: '推门近景' }).first()
  await expect(clipB, '镜头 2 未渲染').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await clipB.click()
  const chip = agent.locator(`${COMPOSER} [data-v4-chip="clip"]`).first()
  await expect(chip, '选中片段必须在输入框上出现可见 chip').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  // v4 的 chip 上只有人话名字（clipId / trackId / revision 三个工程串已不再挂在 DOM 上）。
  // 判据换成「它指的就是这一段」：名字对得上，且没有把内部 id 印给用户看。
  await expect(chip, 'chip 必须写片段名，不是 clipId').toContainText('推门近景')
  await expect(chip, 'chip 上不该出现内部 id').not.toContainText('clip-b')
  await screenshotSettled(win, { path: path.join(shotsDir, '01-selection-chip.png') })

  // ② 第一轮：修剪 —— 计划高亮 + 介入槽审批卡，两者同时可见且尚未落盘
  const trimmed = await proposePlan({
    prompt: '把这段结尾收紧一点',
    readToolId: 'walk-read-1',
    planToolId: 'walk-trim-1',
    plan: { summary: '把「推门近景」的结尾收紧 1 秒', operations: [{ kind: 'trim', clipId: 'clip-b', edge: 'right', deltaFrame: -30 }] },
    doneText: 'WALK_TRIM_DONE：已按计划把结尾收紧。',
  })
  const approval = agent.locator(APPROVAL_CARD).first()
  const approvalProof = await proveProbe(approval, '剪辑计划的介入槽必须可见')
  // ⚠️ 2026-09-18 实测：这条断言现在真的红，而且**是产品问题，不是锚点过期**。
  //
  // 把上面那三个早已退役的传输层方法名（`propose_edit_plan` / `apply_edit_plan` / `undo_timeline_edit`）
  // 换成模型面真正有的 `edit_timeline` 之后，这条走查第一次走到了这里——卡确实出现了，
  // 但它是**通用的能力审批卡**（「调整时间线 / 把调整写入当前时间线」），既没有逐条人话摘要、
  // 时间轴上也没有 `[data-timeline-plan-preview]` 高亮带。也就是说：走 20 动词那条路的时间轴编辑，
  // 用户看到的卡说不出「它到底要改什么」。
  //
  // 这是另一条根因（卡的内容/计划预览没跟着动词面迁移），不属于 T-ED-02（回执派生）那条，
  // 而且改卡长什么样要先出样张（P5/R8）。它在这里保持**红**，不许靠删断言清账——
  // 删掉它，这条走查就会退回「什么都没在看」的状态，而这正是它刚从里面爬出来的坑。
  await expect(approval, '介入槽必须逐条给出人话摘要，而不是一串 operation JSON').toContainText('收紧')
  // v4：可逆 / 不可逆写在槽的 data-kind 上（时间轴计划带 planLines 时 kind 是 plan，
  // 否则可逆改动是 approval-reversible）。两者都必须**不是** irreversible。
  await expect(approval, '可逆的本地改动不该被判成不可逆').not.toHaveAttribute('data-kind', 'approval-irreversible')
  // 授权范围在 v4 里只剩两档：「确认」（仅这一次）与「不再问 →」（这一个能力以后不再问，
  // = 旧的 approvalScope 'always'）。旧的「本会话」那一档随 2026-09-06 收口一起删了，
  // 所以这里不再断言它存在——那会变成一条钉住已删控件的死断言。
  await expect(approval.locator(INTERVENTION_ESCALATE), '可撤销的改动才给到「不再问 →」').toBeVisible()
  const previewBands = win.locator('[data-timeline-plan-preview="true"] [data-plan-preview-band]')
  await expect(previewBands.first(), '待批准的计划必须先在时间轴上高亮').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const bandsProof = await proveProbe(previewBands.first(), '待批准的计划会在时间轴上画出高亮带')
  expect(await win.locator('[data-plan-preview-band="removed"]').count(), '被裁掉的那一段要画成 removed 带').toBeGreaterThan(0)
  expect((await persistedTimeline()).tracks[1].clips.find((clip) => clip.id === 'clip-b').endFrame, '计划预览绝不许落盘').toBe(240)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-plan-highlight-and-approval.png') })

  // ③ 应用这次 → 收据 toast（含撤销）
  await clickOrFail(approval.locator(INTERVENTION_CONFIRM), '应用这次', { noWaitAfter: true })
  const trimWire = await recorded(trimmed.received, '已应用的剪辑结果回到模型')
  expect(toolResultText(trimWire.body, 'walk-trim-1'), '批准后的 apply_edit_plan 必须真的应用，而不是报错后被模型的措辞盖过去').toContain('"applied":true')
  await expect(win.locator(PREVIEW_PANEL)).toContainText('WALK_TRIM_DONE')
  const receipt = win.locator('.mantine-Notifications-root').filter({ hasText: '已按计划' }).first()
  await expect(receipt, '应用后必须出现「AI 拼片」同形态的收据 toast').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect.poll(async () => (await persistedTimeline()).tracks[1].clips.find((clip) => clip.id === 'clip-b').endFrame,
    { message: '批准后的修剪必须真的落到磁盘', timeout: DEFAULT_TIMEOUT_MS }).toBe(210)
  await expectAbsent(previewBands.first(), { provenBy: bandsProof, message: '已应用的计划不该继续高亮' })
  await screenshotSettled(win, { path: path.join(shotsDir, '03-receipt-toast.png') })

  // ④ 收据上的撤销 = 同一个 ⌘Z 栈
  await clickOrFail(receipt.getByRole('button', { name: '撤销' }).first(), '收据上的撤销')
  await expect.poll(async () => (await persistedTimeline()).tracks[1].clips.find((clip) => clip.id === 'clip-b').endFrame,
    { message: '撤销必须把时间轴还原', timeout: DEFAULT_TIMEOUT_MS }).toBe(240)
  await screenshotSettled(win, { path: path.join(shotsDir, '04-undone.png') })
  await expectAbsent(approval, { provenBy: approvalProof, message: '已处理的审批卡不该还能再点' })

  // ⑤ 第二轮：三类新 op 同走一条链（转场 / 字幕 / 音频）
  const authored = await proposePlan({
    prompt: '在镜头 2 和 3 之间加叠化，把第 2 镜字幕改成「他终于推开了门」，并把镜头 2 音量降 6dB、淡出半秒',
    readToolId: 'walk-read-2',
    planToolId: 'walk-ops-2',
    plan: {
      summary: '加叠化 · 改字幕 · 降音量并淡出',
      operations: [
        { kind: 'transition', action: 'set', fromClipId: 'clip-b', toClipId: 'clip-c', type: 'dissolve', durationFrames: 15 },
        { kind: 'text', action: 'edit', clipId: 'caption-2', text: '他终于推开了门' },
        { kind: 'clip-audio', clipId: 'clip-b', audio: { gainDb: -6, fadeOutFrames: 15 } },
      ],
    },
    doneText: 'WALK_OPS_DONE：转场、字幕、音量都按计划改好了。',
  })
  const opsApproval = agent.locator(APPROVAL_CARD).first()
  await expect(opsApproval, '三类 op 走同一个介入槽').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  for (const sentence of ['加叠化', '改成', '音量']) {
    await expect(opsApproval, `介入槽必须逐条列出三类 op：缺了「${sentence}」`).toContainText(sentence)
  }
  await screenshotSettled(win, { path: path.join(shotsDir, '05-three-ops-approval.png') })
  await clickOrFail(opsApproval.locator(INTERVENTION_CONFIRM), '应用三类 op', { noWaitAfter: true })
  const opsWire = await recorded(authored.received, '三类 op 的结果回到模型')
  expect(toolResultText(opsWire.body, 'walk-ops-2'), '三类 op 必须真的应用').toContain('"applied":true')
  await expect.poll(async () => {
    const state = await persistedTimeline()
    const clip = state.tracks[1].clips.find((item) => item.id === 'clip-b')
    return JSON.stringify({
      transitions: state.transitions.filter((item) => item.fromClipId === 'clip-b' && item.toClipId === 'clip-c').length,
      caption: state.textClips.find((item) => item.id === 'caption-2')?.text,
      gainDb: clip?.audio?.gainDb ?? null,
      fadeOutFrames: clip?.audio?.fadeOutFrames ?? null,
    })
  }, { message: '转场 / 字幕 / 音频三类改动必须一起落盘', timeout: DEFAULT_TIMEOUT_MS })
    .toBe(JSON.stringify({ transitions: 1, caption: '他终于推开了门', gainDb: -6, fadeOutFrames: 15 }))
  await expect(timelinePanel.locator('[data-timeline-transition]'), '新转场必须落到接缝上').toHaveCount(2)
  await expect(timelinePanel.locator('.workbench-timeline-text-clip').first()).toContainText('他终于推开了门')
  await screenshotSettled(win, { path: path.join(shotsDir, '06-three-ops-applied.png') })

  // ⑥ Nomi 收起 = 结果全屏：面板让出位置，叫回入口只剩右下那颗小球（10-08 外壳重设计；原「输入框落到预览下沿」那条坞已删）。
  await clickOrFail(agent.locator(COLLAPSE_BUTTON), '收起 Nomi（头部形态切到小球）')
  await expect(win.locator(COLLAPSED_SHELL), '收起后常驻 Agent 仍挂着（不卸载）').toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
  const dock = win.locator(COLLAPSED_DOCK)
  await expect(dock, '收起后右下必须有小球').toBeVisible()
  await expect(dock, '小球要带运行状态').toHaveAttribute('data-agent-dock-status', /.+/)
  // 计数断言：多一个入口就红（写成「旧入口不存在」只会恒真）。
  const recallEntries = await win.evaluate(() => [...document.querySelectorAll('[data-agent-ball]')]
    .filter((node) => node.getBoundingClientRect().width > 0).length)
  expect(recallEntries, '收起态「叫回 Nomi」的入口必须只有一个（小球）').toBe(1)
  // 结果全屏：小球不许压住播放控件。
  const geometry = await dock.evaluate((node) => {
    const transport = document.querySelector('.workbench-preview-player__control-bar')
    const ballRect = node.getBoundingClientRect()
    const t = transport ? transport.getBoundingClientRect() : null
    const overlaps = Boolean(t) && ballRect.left < t.right && ballRect.right > t.left && ballRect.top < t.bottom && ballRect.bottom > t.top
    return { overlaps }
  })
  expect(geometry.overlaps, '小球不许压住播放控件——结果全屏正是为了把它们还给用户').toBe(false)
  await screenshotSettled(win, { path: path.join(shotsDir, '07-collapsed-ball.png') })

  console.log(`agent timeline ops walkthrough passed; screenshots: ${shotsDir}`)
} catch (error) {
  failure = error
  try { await win.screenshot({ path: path.join(shotsDir, 'FAIL.png') }) } catch { /* window already gone */ }
} finally {
  await app.close().catch(() => undefined)
  await fixture.close()
  if (!failure) fixture.assertClean()
}
if (failure) { console.error(failure); process.exit(1) }
