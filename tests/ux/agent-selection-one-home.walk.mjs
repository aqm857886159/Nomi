#!/usr/bin/env node
import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 「我选中了什么」在预览面发给助手时只算一遍：芯片显示的、发送带的目标、助手这一轮收到的快照是同一批。
// 真窗口、本机 loopback 假模型、隔离资料目录；零额度。
//
// 三个情形（每个情形：真点选 → 看芯片 → 真点发送 → 读假模型收到的那一轮请求）：
//   1 只选一段字幕（没选素材）——修前：芯片亮着、助手收不到这段文字；修后：收得到。
//   2 只选一段素材——前后都收得到。
//   3 素材和字幕同选（按住 Shift 追加）——都收得到。
// 运行：pnpm run build && NOMI_WALK_LOCALE=zh-CN|en NOMI_WALK_OUT=<目录> node tests/ux/agent-selection-one-home.walk.mjs
// 结果写进 <目录>/result.json（每个情形：芯片文字、请求里有没有字幕正文 / 素材名），截图 <目录>/*.png。
// 这条走查不对「修前」的行为下断言（修前版本就是拿它量出 D1 的）：断言只在 NOMI_WALK_EXPECT=after 时开。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { createAgentRuntimeFixture, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { COLLAPSED_DOCK, COMPOSER, COMPOSER_INPUT, COMPOSER_SEND, PREVIEW_PANEL, chooseAssistantModel, recorded } from './agent-runtime-walk-support.mjs'

const locale = process.env.NOMI_WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const out = process.env.NOMI_WALK_OUT ?? path.join(repoRoot, 'tests/ux/shots/agent-selection-one-home', locale)
const expectAfter = process.env.NOMI_WALK_EXPECT === 'after'
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

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
    { id: 'videoTrack', type: 'video', label: 'video', clips: [makeClip('clip-a', CLIP_LABEL, 0, 120), makeClip('clip-b', 'Reaction', 120, 240)] },
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
  env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
  args: ['--no-proxy-server'],
})
const { app } = launched
let win = launched.win
win.setDefaultTimeout(30_000)

async function resize(width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => { windowRef.setBounds({ x: 0, y: 0, ...bounds }); windowRef.center() }, { width, height })
  await win.waitForTimeout(300)
}

const results = []
let failure
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
  win.setDefaultTimeout(30_000)
  await win.waitForLoadState('domcontentloaded')
  await resize(1440, 920)
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
    const lastUser = [...(wire.body.messages ?? [])].reverse().find((message) => message.role === "user")
    const text = flattenRequestText({ ...wire.body, messages: lastUser ? [lastUser] : [], tools: undefined })
    await win.waitForTimeout(600)
    await screenshotSettled(win, { path: path.join(out, `${name}-2-after-send.png`) })
    return text
  }
  async function chipTexts() {
    return (await chips.allTextContents()).map((value) => value.trim())
  }

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

  // 情形 3：素材 + 字幕同选（选中素材后按住 Shift 点字幕：字幕点击会换成只选字幕——这是产品现状，如实记录）
  await clipA.click()
  await caption.click({ modifiers: ['Shift'] })
  await win.waitForTimeout(300)
  const both = await sendAndRecord('case3-media-then-caption', 'Case three: what is selected')
  results.push({ case: 'media-then-caption', chips: await chipTexts(), requestHasCaption: both.includes(CAPTION_TEXT), requestHasClip: both.includes(CLIP_LABEL) })

  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ locale, commit: process.env.NOMI_WALK_COMMIT ?? '', results }, null, 2))
  console.log(JSON.stringify(results, null, 2))
  if (expectAfter) {
    expect(results[0].requestHasCaption, '只选字幕时，助手这一轮收得到字幕正文').toBe(true)
    expect(results[0].chips.length, '只选字幕时芯片 1 枚').toBe(1)
    expect(results[1].requestHasClip, '只选素材时，助手收得到素材名').toBe(true)
  }
} catch (error) {
  failure = error
}
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ locale, commit: process.env.NOMI_WALK_COMMIT ?? '', results, failure: failure ? String(failure.stack ?? failure) : undefined }, null, 2))
await app.close().catch(() => undefined)
await fixture.close?.().catch(() => undefined)
if (failure) { console.error(failure); process.exit(1) }
process.exit(0)
