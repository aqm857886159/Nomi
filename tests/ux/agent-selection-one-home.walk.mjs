#!/usr/bin/env node
import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 「我选中了什么」在预览面发给助手时只算一遍：芯片显示的、发送带的目标、助手这一轮收到的快照是同一批。
// 真窗口、本机 loopback 假模型、隔离资料目录；零额度。
//
// 三个情形（每个情形：真点选 → 看芯片 → 真点发送 → 读假模型收到的那一轮请求）：
//   1 只选一段字幕（没选素材）——修前：芯片亮着、助手收不到这段文字；修后：收得到。
//   2 只选一段素材——前后都收得到。
//   4 停止后改选再发：草稿带回旧选区，改选另一段后发送，请求里是新选的
//   5 拖动片段：芯片不带「已变更」，发送带它拖动后的新位置
//   3 媒体后改选字幕（含 Shift）——只保留字幕，维持既有互斥选择规则。
// 运行：pnpm run build && NOMI_WALK_LOCALE=zh-CN|en NOMI_WALK_OUT=<目录> node tests/ux/agent-selection-one-home.walk.mjs
// 结果写进 <目录>/result.json（每个情形：芯片文字、请求里有没有字幕正文 / 素材名），截图 <目录>/*.png。
// 拍板图断言：board:AgentSelectionChip/chip.selection（芯片显示什么助手就收到什么）
// 这条走查不对「修前」的行为下断言（修前版本就是拿它量出 D1 的）：断言只在 NOMI_WALK_EXPECT=after 时开。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { createAgentRuntimeFixture, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { COLLAPSED_DOCK, COMPOSER, COMPOSER_INPUT, COMPOSER_SEND, PREVIEW_PANEL, QUEUE_ROW, chooseAssistantModel, expectComposerText, recorded, waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'

const locale = process.env.NOMI_WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const out = process.env.NOMI_WALK_OUT ?? path.join(repoRoot, 'tests/ux/shots/agent-selection-one-home', locale)
const expectAfter = process.env.NOMI_WALK_EXPECT === 'after'
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
process.chdir(out)

const root = makeTempDir('nomi-agent-selection-one-home-')
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'agent-selection-one-home-walk'
const projectName = 'Selection one home'
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })

const CLIP_LABEL = 'Door push'
const CAPTION_TEXT = 'Soup arrives first'
const makeClip = (id, label, startFrame, endFrame) => ({
  id, type: 'video', sourceNodeId: `node-${id}`, label, startFrame, endFrame, frameCount: endFrame - startFrame, offsetStartFrame: 0, offsetEndFrame: 0,
})
const timeline = {
  version: 1, fps: 30, scale: 1.5, playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: 'image', clips: [] },
    { id: 'videoTrack', type: 'video', label: 'video', clips: [makeClip('clip-a', CLIP_LABEL, 0, 120), makeClip('clip-b', 'Reaction', 120, 240), makeClip('clip-c', CLIP_LABEL, 240, 360)] },
    { id: 'audioTrack', type: 'audio', label: 'audio', clips: [] },
  ],
  textClips: [{ id: 'caption-1', text: CAPTION_TEXT, style: 'caption', startFrame: 0, endFrame: 90 }],
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

const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
const launched = await launchNomiApp({
  name: 'agent-selection-one-home', userDataDir, settingsDir, projectsDir, capabilityDir, timeout: 300_000,
  env: { NOMI_TEST_NETWORK_GUARD: '1', NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
  args: ['--no-proxy-server'],
})
const { app } = launched
let win = launched.win
win.setDefaultTimeout(stationTimeout())

async function resize(width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => { windowRef.setBounds({ x: 0, y: 0, ...bounds }); windowRef.center() }, { width, height })
  await win.waitForTimeout(300)
}

const results = []
const targetResults = []
let failure
let viewport
try {
  await win.evaluate((value) => {
    localStorage.setItem('nomi:locale:v1', value)
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  }, locale)
  await win.reload({ waitUntil: 'domcontentloaded' })
  await resize(1440, 920)

  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: projectName }).first()
  await expect(projectCard, 'project card').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作|Continue/ }).first(), 'open project')
  await expect.poll(() => app.windows().some((candidate) => /[?&]projectId=/.test(candidate.url())),
    { message: 'project window', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  win = app.windows().find((candidate) => /[?&]projectId=/.test(candidate.url())) ?? win
  win.setDefaultTimeout(stationTimeout())
  await win.waitForLoadState('domcontentloaded')
  await resize(1440, 920)
  viewport = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]').first(), 'enter preview')

  const timelinePanel = win.locator('.workbench-preview .workbench-timeline').first()
  await expect(timelinePanel, 'timeline').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const agent = win.locator(PREVIEW_PANEL)
  const ball = win.locator(COLLAPSED_DOCK)
  if (await ball.count()) await clickOrFail(ball.first(), 'open assistant')
  await expect(agent, 'assistant panel').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, PREVIEW_PANEL)

  const clipA = timelinePanel.locator('[data-testid="timeline-clip"]').first()
  const caption = timelinePanel.locator('[data-text-clip-id="caption-1"]').first()
  await expect(clipA, 'media clip rendered').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(caption, 'caption clip rendered').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const chips = agent.locator(`${COMPOSER} [data-v4-chip="clip"]`)

  function lastUserText(wire) {
    const lastUser = [...(wire.body.messages ?? [])].reverse().find((message) => message.role === 'user')
    return flattenRequestText({ ...wire.body, messages: lastUser ? [lastUser] : [], tools: undefined })
  }
  const startMsOf = (text) => [...text.matchAll(/"startMs":\s*(\d+)/g)].map((match) => Number(match[1]))
  async function sendAndRecord(name, prompt) {
    const call = fixture.expectText({
      label: `${name}: the model round`,
      match: (body) => flattenRequestText(body).includes(prompt),
      reply: { type: 'text', text: `WALK_${name}_DONE` },
    })
    const input = win.locator(`${PREVIEW_PANEL} ${COMPOSER_INPUT}`)
    await input.fill(prompt)
    await screenshotSettled(win, { path: path.join(out, `${name}-1-chip-before-send.png`) })
    await clickOrFail(win.locator(`${PREVIEW_PANEL} ${COMPOSER_SEND}`), `send: ${prompt}`)
    const wire = await recorded(call.received, `${name} request`)
    const text = lastUserText(wire)
    await win.waitForTimeout(600)
    await screenshotSettled(win, { path: path.join(out, `${name}-2-after-send.png`) })
    return text
  }
  async function chipTexts() {
    return (await chips.allTextContents()).map((value) => value.trim())
  }

  // board:AgentSelectionChip/chip.selection — 真点选、真 ×、真发送；只比较最后新输入的 timelineClip。
  const clipBTarget = timelinePanel.locator('[data-clip-id="clip-b"]')
  const clipC = timelinePanel.locator('[data-clip-id="clip-c"]')
  const readChips = () => chips.evaluateAll(elements => elements.map(el => ({
    id: el.getAttribute('data-v4-chip-id'),
    title: el.querySelector(':scope > span:last-of-type')?.textContent ?? '',
  })))
  const readSelection = async () => ({
    media: await timelinePanel.locator('[data-clip-id][data-selected="true"]').evaluateAll(elements => elements.map(el => el.getAttribute('data-clip-id'))),
    text: await caption.evaluate(el => el.className.includes('shadow-[0_0_0_1px')),
  })
  const requestMembers = text => {
    const json = text.split('[Nomi current selection — read-only ContextSnapshot v1]\n')[1]?.split('\n')[0]
    return (json ? JSON.parse(json).handles : []).filter(handle => handle.kind === 'timelineClip')
      .map(handle => ({ id: handle.targetId, title: handle.display.title, startMs: handle.locator.startMs }))
  }
  await clipA.click()
  const chipProbe = await proveProbe(chips, '选中视频后，当前芯片探针确实能找到芯片')
  for (const [name, select, removeIndex, remaining] of [
    ['two-videos', async () => { await clipA.click(); await clipBTarget.click({ modifiers: ['Shift'] }) }, 0, [{ id: 'clip-b', title: 'Reaction', startMs: 4000 }]],
    ['same-name', async () => { await clipA.click(); await clipC.click({ modifiers: ['Shift'] }) }, 0, [{ id: 'clip-c', title: CLIP_LABEL, startMs: 8000 }]],
    ['single-caption', async () => { await caption.click() }, 0, []],
    ['blank-clear', async () => { await clipA.click(); await clipBTarget.click({ modifiers: ['Shift'] }) }, null, []],
  ]) {
    await timelinePanel.locator('[data-track-type="image"] .workbench-timeline-track__clips').click({ position: { x: 350, y: 15 } })
    await expectAbsent(chips, { provenBy: chipProbe, message: `${name}: start from a visibly empty selection` })
    await select()
    const before = await readChips()
    await screenshotSettled(win, { path: path.join(out, `${name}-before-x.png`) })
    const beforeRequest = requestMembers(await sendAndRecord(`${name}-before`, `Target ${name} before`))
    // 发出不会取消工作台选中；× 的身份由正在显示的那颗决定，同名也不按文字找。
    let buttonPresent = true
    if (removeIndex === null) {
      await timelinePanel.locator('[data-track-type="image"] .workbench-timeline-track__clips').click({ position: { x: 350, y: 15 } })
    } else {
      const button = chips.nth(removeIndex).getByRole('button')
      buttonPresent = await button.first().waitFor({ state: 'visible' }).then(() => true, () => false)
      if (buttonPresent) await clickOrFail(button, `${name}: remove one selected object`)
    }
    const after = await readChips()
    const selection = await readSelection()
    const members = requestMembers(await sendAndRecord(`${name}-after`, `Target ${name} after`))
    const sourceClipIds = await timelinePanel.locator('[data-clip-id]').evaluateAll(elements => elements.map(el => el.getAttribute('data-clip-id')))
    const captionExists = await expect(caption).toHaveCount(1).then(() => true, () => false)
    const row = { name, before, beforeRequest, buttonPresent, after, selection, members, remaining, sourceClipIds, captionExists }
    targetResults.push(row)
    fs.writeFileSync(path.join(out, 'target-results.json'), JSON.stringify(targetResults, null, 2))
  }
  if (process.env.NOMI_WALK_TARGET_ONLY !== '1') {
  // 情形 1：只选字幕
  await caption.click()
  await expect(chips.first(), 'chip for the selected caption').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const textOnly = await sendAndRecord('case1-text-only', 'Case one: tidy this up')
  results.push({ case: 'text-only', chips: await chipTexts(), requestHasCaption: textOnly.includes(CAPTION_TEXT), requestHasClip: textOnly.includes(CLIP_LABEL) })

  // 情形 2：只选素材
  await clipA.click()
  await expect(chips.first(), 'chip for the selected clip').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const mediaOnly = await sendAndRecord('case2-media-only', 'Case two: shorten this')
  results.push({ case: 'media-only', chips: await chipTexts(), requestHasCaption: mediaOnly.includes(CAPTION_TEXT), requestHasClip: mediaOnly.includes(CLIP_LABEL) })

  // 情形 3：媒体后 Shift 改选字幕——仍只选字幕，维持既有规则，不造混选。
  await clipA.click()
  await caption.click({ modifiers: ['Shift'] })
  await win.waitForTimeout(300)
  const both = await sendAndRecord('case3-media-then-caption', 'Case three: what is selected')
  results.push({ case: 'media-then-caption', chips: await chipTexts(), requestHasCaption: both.includes(CAPTION_TEXT), requestHasClip: both.includes(CLIP_LABEL) })

  // 情形 4：停止后改选再发——先发一句让这一轮卡住，再排一条带「Door push」选区的指令，取消它（草稿带回），改选「Reaction」后发送。
  await clipA.click()
  await expect(chips.first(), 'chip for the clip before the held turn').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const input = win.locator(`${PREVIEW_PANEL} ${COMPOSER_INPUT}`)
  const hold = fixture.expectText({ label: 'case four: held turn', match: (body) => flattenRequestText(body).includes('Case four hold'),
    reply: { type: 'hold', text: 'Working on it.' } })
  await input.fill('Case four hold')
  await clickOrFail(win.locator(`${PREVIEW_PANEL} ${COMPOSER_SEND}`), 'send the held turn')
  await recorded(hold.received, 'case four held request')
  const reselectPrompt = 'Case four: send after reselect'
  await input.fill(reselectPrompt)
  await input.press('Enter')
  const queued = agent.locator(QUEUE_ROW).filter({ hasText: reselectPrompt })
  await expect(queued, 'queued instruction').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(queued.getByRole('button', { name: /取消这条指令|Cancel this instruction/ }), 'cancel the queued instruction')
  await expectComposerText(input, reselectPrompt, 'draft restored into the composer')
  const clipB = timelinePanel.locator('[data-testid="timeline-clip"]').nth(1)
  await clipB.click()
  await expect.poll(async () => (await chipTexts()).join('|'), { message: 'chip follows the new selection', timeout: DEFAULT_TIMEOUT_MS }).toContain('Reaction')
  const answer = fixture.expectText({ label: 'case four: send after reselect', match: (body) => flattenRequestText(body).includes(reselectPrompt),
    reply: { type: 'text', text: 'WALK_case4_DONE' } })
  await screenshotSettled(win, { path: path.join(out, 'case4-reselect-1-restored-draft-new-chip.png') })
  hold.release({ type: 'text', text: 'WALK_case4_HOLD_DONE' })
  await waitForV4TurnIdle(win, { panel: PREVIEW_PANEL, settledBy: agent.getByText(/WALK_case4_HOLD_DONE/).first() })
  await input.press('Enter')
  const case4Wire = await recorded(answer.received, 'case four request')
  const case4Text = lastUserText(case4Wire)
  await win.waitForTimeout(600)
  await screenshotSettled(win, { path: path.join(out, 'case4-reselect-2-after-send.png') })
  results.push({ case: 'stop-reselect-send', chips: await chipTexts(), requestHasNewSelection: case4Text.includes('Reaction'), requestHasOldSelection: case4Text.includes(CLIP_LABEL) })

  // 情形 5：拖动末段（前面新增了同名第三段，末段右侧才有可移动的空白）——芯片照常显示（没有「已变更」），发送带它拖动后的新位置。
  await win.waitForTimeout(800)
  await clipC.click()
  await expect(chips.first(), 'chip for the clip before dragging').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const beforeDrag = await sendAndRecord('case5-before-drag', 'Case five: before dragging the last clip')
  const startBefore = startMsOf(beforeDrag)[0]
  const box = await clipC.boundingBox()
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 6 })
  await win.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(500)
  // 松手后时间轴会清空选区（既有行为）；重新点选这段，芯片和发送都应带它拖动后的位置。
  await clipC.click()
  await expect(chips.first(), 'chip for the clip after dragging').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const draggedChips = await chipTexts()
  const dragged = await sendAndRecord('case5-dragged', 'Case five: where is it now')
  const startAfter = startMsOf(dragged)[0]
  results.push({ case: 'dragged-clip', chips: draggedChips, chipHasChangedMark: draggedChips.some((value) => /已变更|changed/i.test(value)),
    requestHasClip: dragged.includes(CLIP_LABEL), requestClipIds: requestMembers(dragged).map(item => item.id), startMsBefore: startBefore, startMsAfter: startAfter, startMsMoved: startAfter > startBefore })

  }
  if (expectAfter) for (const row of targetResults) {
    expect(row.members, `${row.name}: × removes only this item, keeps original titles/order/position`).toEqual(row.remaining)
    expect(row.selection.media, `${row.name}: timeline matches remaining media`).toEqual(row.remaining.filter(item => item.id.startsWith('clip-')).map(item => item.id))
    expect(row.selection.text, `${row.name}: caption deselected`).toBe(false)
    expect(row.buttonPresent, `${row.name}: selection keeps its remove action`).toBe(true)
    expect(row.before, `${row.name}: DOM equals last new input before removal`).toEqual(row.beforeRequest.map(({ id, title }) => ({ id, title })))
    expect(row.after, `${row.name}: DOM equals last new input after removal`).toEqual(row.members.map(({ id, title }) => ({ id, title })))
    expect(row.sourceClipIds, `${row.name}: source clips are not deleted`).toEqual(['clip-a', 'clip-b', 'clip-c'])
    expect(row.captionExists, `${row.name}: source caption is not deleted`).toBe(true)
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ locale, targetResults, commit: process.env.NOMI_WALK_COMMIT ?? '', results }, null, 2))
  console.log(JSON.stringify(results, null, 2))
  if (expectAfter && process.env.NOMI_WALK_TARGET_ONLY !== '1') {
    expect(results[0].requestHasCaption, '只选字幕时，助手这一轮收得到字幕正文').toBe(true)
    expect(results[0].chips.length, '只选字幕时芯片 1 枚').toBe(1)
    expect(results[1].requestHasClip, '只选素材时，助手收得到素材名').toBe(true)
    expect(results[2].requestHasCaption && !results[2].requestHasClip, '视频和字幕仍互斥，只发送当前字幕').toBe(true)
    expect(results[3].requestHasNewSelection && !results[3].requestHasOldSelection, '停止后改选再发，发出去的是新选的').toBe(true)
    expect(results[4].chipHasChangedMark, '拖动后芯片不带「已变更」').toBe(false)
    expect(results[4].requestHasClip && results[4].startMsBefore !== undefined && results[4].startMsMoved, '拖动后发送带这段片段的新位置').toBe(true)
    expect(results[4].requestClipIds, '同名也按末段身份发送').toEqual(['clip-c'])
  }
} catch (error) {
  failure = error
}
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ locale, viewport, targetResults, commit: process.env.NOMI_WALK_COMMIT ?? '', results, failure: failure ? String(failure.stack ?? failure) : undefined }, null, 2))
fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify({ requests: fixture.requests, unexpected: fixture.unexpected }, null, 2))
await app.close().catch(() => undefined)
await fixture.close?.().catch(() => undefined)
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
