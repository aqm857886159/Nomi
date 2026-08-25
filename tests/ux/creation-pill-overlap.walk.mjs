// 收起创作助手后，入口 pill 必须在编辑器右侧独立占位，不能覆盖撤销/重做。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-creation-pill-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'creation-pill-overlap'
const projectRoot = path.join(projectsDir, `creation-pill-${projectId}`)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/creation-pill-overlap')

fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const project = {
  id: projectId,
  name: '创作助手布局回归',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: {
      version: 1,
      title: '布局回归',
      contentJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '撤销和重做必须始终可见。' }] }],
      },
      updatedAt: 1,
    },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  },
}

for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

const { app, win } = await launchNomiApp({
  name: 'creation-pill-overlap',
  tempRoot,
  settingsDir,
  projectsDir,
  settleMs: 1200,
})

async function closeApp() {
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function dismissOnboarding() {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForTimeout(1200)
  for (let i = 0; i < 5; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if ((await skip.count()) > 0) await skip.click({ timeout: 1000 }).catch(() => {})
  }
}

async function openCreationWorkspace() {
  const card = win.locator('[data-project-card]', { hasText: project.name }).first()
  await card.waitFor({ state: 'visible', timeout: 5000 })
  await card.hover()
  const continueButton = card.getByText('继续创作', { exact: false }).first()
  if ((await continueButton.count()) > 0) await continueButton.click()
  else await card.dblclick()
  await win.waitForTimeout(1600)

  const creationButton = win.getByRole('button', { name: '创作', exact: true })
  if (await creationButton.isVisible().catch(() => false)) await creationButton.click()
  await win.getByLabel('创作区', { exact: true }).waitFor({ state: 'visible', timeout: 5000 })
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

async function verifyViewport(width, height) {
  await win.setViewportSize({ width, height })
  await win.waitForTimeout(350)

  const pill = win.getByRole('button', { name: '展开创作助手' })
  const undo = win.getByRole('button', { name: '撤销', exact: true })
  const redo = win.getByRole('button', { name: '重做', exact: true })
  const [pillBox, undoBox, redoBox] = await Promise.all([pill.boundingBox(), undo.boundingBox(), redo.boundingBox()])
  if (!pillBox || !undoBox || !redoBox) throw new Error(`缺少布局边界框：${width}x${height}`)

  const result = {
    viewport: `${width}x${height}`,
    pillVsUndo: overlaps(pillBox, undoBox),
    pillVsRedo: overlaps(pillBox, redoBox),
    editorControlsEndBeforePill: Math.max(undoBox.x + undoBox.width, redoBox.x + redoBox.width) <= pillBox.x,
    pillBox,
    undoBox,
    redoBox,
  }
  await screenshotSettled(win, { path: path.join(shotsDir, `creation-pill-${width}x${height}.png`) })
  console.log(JSON.stringify(result))
  if (result.pillVsUndo || result.pillVsRedo || !result.editorControlsEndBeforePill) {
    throw new Error(`创作助手 pill 与编辑器工具栏发生重叠：${width}x${height}`)
  }
}

try {
  await dismissOnboarding()
  await openCreationWorkspace()
  const collapse = win.getByRole('button', { name: '收起创作助手' })
  await collapse.click()
  await win.getByRole('button', { name: '展开创作助手' }).waitFor({ state: 'visible', timeout: 3000 })

  await verifyViewport(1440, 900)
  await verifyViewport(680, 760)
  await closeApp()
} catch (error) {
  console.error(error)
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  await closeApp()
  process.exit(1)
}
