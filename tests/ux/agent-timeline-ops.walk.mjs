// R13/R16: a creator reviews a rough cut and can tell what was trimmed,
// which authored transitions render, and which ones need revision.
// Zero-spend fixture: persisted timeline metadata only, no generation or media decoding.
// Run: pnpm run build && node tests/ux/agent-timeline-ops.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/agent-timeline-ops')
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-timeline-feedback-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'agent-timeline-ops-walk'
const projectRoot = path.join(projectsDir, projectId)
const projectManifestDir = path.join(projectRoot, '.nomi')
fs.mkdirSync(projectManifestDir, { recursive: true })

const makeClip = (id, label, startFrame, endFrame, sourceFrames, offsetStartFrame = 0, offsetEndFrame = 0) => ({
  id,
  type: 'video',
  sourceNodeId: `node-${id}`,
  label,
  startFrame,
  endFrame,
  frameCount: sourceFrames,
  offsetStartFrame,
  offsetEndFrame,
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
        makeClip('clip-d', '走入夜色', 390, 510, 120),
        makeClip('clip-e', '尾声', 510, 522, 30, 5, 5),
      ],
    },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [{ id: 'caption-2', text: '旧字幕', style: 'caption', startFrame: 120, endFrame: 180 }],
  transitions: [
    { fromClipId: 'clip-a', toClipId: 'clip-b', type: 'dissolve', durationFrames: 12 },
    { fromClipId: 'clip-a', toClipId: 'clip-b', type: 'fade', durationFrames: 6 },
    { fromClipId: 'clip-b', toClipId: 'clip-c', type: 'match_cut', durationFrames: 8 },
    { fromClipId: 'clip-c', toClipId: 'clip-d', type: 'fade', durationFrames: 10 },
  ],
}

const workbenchDocument = {
  version: 1,
  title: 'Agent 剪辑轴三类操作验收',
  updatedAt: 1,
  contentJson: { type: 'doc', content: [] },
}
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const payload = {
  workbenchDocument,
  timeline,
  generationCanvas,
  storyboardPlan: null,
  storyboardPlanCommitted: false,
}
const project = {
  id: projectId,
  name: 'Agent 剪辑轴三类操作验收',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  workbenchDocument,
  timeline,
  generationCanvas,
  payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectManifestDir, 'project.json'), JSON.stringify(project, null, 2))

const launched = await launchNomiApp({
  name: 'agent-timeline-ops',
  userDataDir,
  settingsDir,
  projectsDir,
  capabilityDir,
  timeout: 300_000,
})
const { app } = launched
let win = launched.win
win.on('console', (message) => {
  if (message.type() === 'error') console.log(`[renderer:error] ${message.text()}`)
})
win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))

async function resize(width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate(
    (windowRef, bounds) => {
      windowRef.setBounds({ x: 0, y: 0, ...bounds })
      windowRef.center()
    },
    { width, height },
  )
  await win.waitForTimeout(300)
}

async function assertNoMetadataOverlap(label) {
  const collisions = await win.locator('.workbench-preview [data-track-type="video"]').evaluate((track) => {
    const rectangles = (selector) =>
      Array.from(track.querySelectorAll(selector)).map((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      })
    const intersects = (left, right) =>
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top
    const markers = rectangles('[data-timeline-transition]')
    const labels = rectangles('.workbench-timeline-clip__label')
    const sourceWindows = rectangles('[data-timeline-source-window]')
    return {
      markerMarker: markers.flatMap((marker, markerIndex) =>
        markers
          .slice(markerIndex + 1)
          .map((otherMarker, offset) =>
            intersects(marker, otherMarker) ? [markerIndex, markerIndex + offset + 1] : null,
          )
          .filter(Boolean),
      ),
      markerLabel: markers.flatMap((marker, markerIndex) =>
        labels
          .map((clipLabel, labelIndex) => (intersects(marker, clipLabel) ? [markerIndex, labelIndex] : null))
          .filter(Boolean),
      ),
      sourceLabel: sourceWindows.flatMap((sourceWindow, sourceIndex) =>
        labels
          .map((clipLabel, labelIndex) => (intersects(sourceWindow, clipLabel) ? [sourceIndex, labelIndex] : null))
          .filter(Boolean),
      ),
    }
  })
  expect(collisions.markerMarker, `${label}: transition markers overlap each other`).toEqual([])
  expect(collisions.markerLabel, `${label}: transition markers cover clip labels`).toEqual([])
  expect(collisions.sourceLabel, `${label}: source-window strips cover clip labels`).toEqual([])
}

try {
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await resize(1440, 920)

  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: 'Agent 剪辑轴三类操作验收' }).first()
  await expect(projectCard, 'Fixture project card did not appear').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }).first(), '打开Agent 剪辑轴三类操作验收')
  await expect
    .poll(() => app.windows().some((candidate) => /[?&]projectId=/.test(candidate.url())), {
      message: 'Project window did not open',
      timeout: DEFAULT_TIMEOUT_MS,
    })
    .toBe(true)
  win = app.windows().find((candidate) => /[?&]projectId=/.test(candidate.url())) ?? win
  await win.waitForLoadState('domcontentloaded')
  await resize(1440, 920)
  const previewTab = win.locator('nav.nomi-stepper [data-mode="preview"]').first()
  await clickOrFail(previewTab, '进入预览')

  const timelinePanel = win.locator('.workbench-preview .workbench-timeline').first()
  await expect(timelinePanel, 'Preview timeline did not become visible').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })

  const selectedClip = timelinePanel.locator('[data-testid="timeline-clip"]').filter({ hasText: '推门近景' }).first()
  await expect(selectedClip, 'Timeline clip 2 did not render').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await selectedClip.click()
  const agent = win.locator('[data-agent-resident="true"]').first()
  await expect(agent, 'Resident Agent did not mount on preview surface').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const selectionChip = agent.locator('[data-agent-timeline-selection="true"]').first()
  await expect(selectionChip, 'Selecting a clip must expose a visible Agent selection chip').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(selectionChip).toHaveAttribute('data-clip-id', 'clip-b')
  await expect(selectionChip).toHaveAttribute('data-track-id', 'videoTrack')
  await expect(selectionChip).toHaveAttribute('data-revision', /.+/)
  await screenshotSettled(win, { path: path.join(shotsDir, '03-agent-selection-chip.png') })

  const selectedCaption = timelinePanel.locator('.workbench-timeline-text-clip').filter({ hasText: '旧字幕' }).first()
  await expect(selectedCaption, 'Timeline subtitle 2 did not render').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await selectedCaption.click()
  const captionChip = agent.locator('[data-agent-timeline-selection="true"]').first()
  await expect(captionChip, 'Selecting a subtitle must expose the same Agent chip').toHaveAttribute('data-clip-id', 'caption-2')
  await expect(captionChip).toHaveAttribute('data-track-id', 'textTrack')
  await screenshotSettled(win, { path: path.join(shotsDir, '03b-agent-subtitle-chip.png') })
  const collapsed = agent.locator('[data-agent-collapse="true"]').first()
  if (await collapsed.count()) {
    await collapsed.click()
    await expect(agent.locator('[data-agent-resident-collapsed="true"]')).toBeVisible()
    await screenshotSettled(win, { path: path.join(shotsDir, '04-agent-collapsed-preview.png') })
  }

  const sourceWindows = timelinePanel.locator('[data-timeline-source-window]')
  await expect(sourceWindows, 'Trimmed source windows were not rendered').toHaveCount(3, {
    timeout: DEFAULT_TIMEOUT_MS,
  })
  await expect(sourceWindows.first(), 'Source-window start is not derived from clip metadata').toHaveAttribute(
    'data-source-start-frame',
    '20',
  )
  await expect(sourceWindows.first(), 'Source-window end is not derived from clip metadata').toHaveAttribute(
    'data-source-end-frame',
    '140',
  )
  await expect(
    timelinePanel.locator('[data-timeline-source-window-icon]'),
    'Crop icons should be omitted when a clip is too narrow',
  ).toHaveCount(2)

  const transitions = timelinePanel.locator('[data-timeline-transition]')
  await expect(transitions, 'Authored transition markers were not rendered').toHaveCount(4, {
    timeout: DEFAULT_TIMEOUT_MS,
  })
  const dissolve = timelinePanel.locator('[data-timeline-transition][data-transition-type="dissolve"]').first()
  const matchCut = timelinePanel.locator('[data-timeline-transition][data-transition-type="match_cut"]').first()
  const gappedFade = timelinePanel.locator(
    '[data-timeline-transition][data-transition-type="fade"][data-connected="false"]',
  )
  await expect(dissolve, 'Dissolve marker should be connected').toHaveAttribute('data-connected', 'true')
  await expect(dissolve, 'Dissolve should reflect export support').toHaveAttribute('data-export-supported', 'true')
  await expect(dissolve, 'Dissolve should reflect live-preview support').toHaveAttribute(
    'data-preview-supported',
    'true',
  )
  await expect(dissolve, 'Dissolve accessibility copy should explain preview/export parity').toHaveAttribute(
    'aria-label',
    /预览与导出一致/,
  )
  await expect(matchCut, 'Match cut should remain visibly unsupported').toHaveAttribute(
    'data-export-supported',
    'false',
  )
  await expect(matchCut, 'Match cut copy should not imply renderer support').toHaveAttribute(
    'aria-label',
    /预览与导出暂不支持/,
  )
  const duplicateFade = timelinePanel.locator(
    '[data-timeline-transition][data-transition-type="fade"][data-connected="true"]',
  )
  await expect(duplicateFade, 'Duplicate transitions should remain visible for correction').toHaveAttribute(
    'data-export-supported',
    'false',
  )
  await expect(gappedFade, 'A transition across a timeline gap must not appear connected').toHaveAttribute(
    'data-connected',
    'false',
  )
  await expect(gappedFade, 'A disconnected fade must not claim renderer support').toHaveAttribute(
    'data-supported',
    'false',
  )

  await screenshotSettled(win, { path: path.join(shotsDir, '01-desktop.png') })
  await assertNoMetadataOverlap('desktop')

  await resize(900, 760)
  await expect(timelinePanel, 'Timeline disappeared at narrow desktop width').toBeVisible({
    timeout: DEFAULT_TIMEOUT_MS,
  })
  await expect(sourceWindows, 'Source-window feedback disappeared at narrow width').toHaveCount(3)
  await expect(transitions, 'Transition feedback disappeared at narrow width').toHaveCount(4)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-narrow.png') })
  await assertNoMetadataOverlap('narrow')

  console.log(`timeline visual feedback walkthrough passed; screenshots: ${shotsDir}`)
} finally {
  await app.close().catch(() => undefined)
}
