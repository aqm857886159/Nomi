// 创作区双工作面回归：原稿与分镜方案不是互相覆盖，用户可见入口必须能往返，重载后两份数据仍在。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-creation-surfaces-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'creation-surfaces-e2e'
const projectRoot = path.join(projectsDir, `creation-surfaces-${projectId}`)
const outDir = path.join(repoRoot, 'tests/ux/shots/creation-work-surfaces')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

const ORIGINAL = 'ORIGINAL_SENTINEL：原稿仍然完整保留。'
const PLAN_PROMPT = 'PLAN_SENTINEL：分镜方案仍然完整保留。'
const payload = {
  workbenchDocument: {
    version: 1,
    title: '原稿 sentinel',
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: ORIGINAL }] }] },
    updatedAt: 1,
  },
  timeline: null,
  generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
  storyboardPlan: {
    title: '分镜 sentinel',
    anchors: [],
    shots: [{ index: 1, shotKind: 'video', durationSec: 5, anchorIds: [], prompt: PLAN_PROMPT }],
  },
  storyboardPlanCommitted: false,
}
const project = {
  id: projectId,
  name: '创作工作面回归',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const { app, win: _launchedWin } = await launchNomiApp({
  name: 'creation-work-surfaces',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  settleMs: 1200,
})

async function closeApp() {
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function openFixtureCreationSurface(win) {
  for (let i = 0; i < 5; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if ((await skip.count()) > 0) await skip.click({ timeout: 1000 }).catch(() => {})
  }

  const tablist = win.getByRole('tablist', { name: '创作工作面' })
  if (await tablist.isVisible().catch(() => false)) return

  const creationButton = win.getByRole('button', { name: '创作', exact: true })
  if (await creationButton.isVisible().catch(() => false)) {
    await creationButton.click()
    if (await tablist.isVisible().catch(() => false)) return
  }

  const projectCard = win.locator('[data-project-card]', { hasText: '创作工作面回归' }).first()
  await projectCard.waitFor({ state: 'visible', timeout: 5000 })
  await projectCard.hover()
  const continueButton = projectCard.getByText('继续创作', { exact: false }).first()
  if ((await continueButton.count()) > 0) await continueButton.click()
  else await projectCard.dblclick()
  await win.waitForTimeout(1800)

  if (await creationButton.isVisible().catch(() => false)) await creationButton.click()
  await tablist.waitFor({ state: 'visible', timeout: 5000 })
}

try {
  const win = _launchedWin
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1200)
  await openFixtureCreationSurface(win)

  const tablist = win.getByRole('tablist', { name: '创作工作面' })
  await tablist.waitFor({ state: 'visible', timeout: 5000 })
  const originalTab = win.getByRole('tab', { name: '原稿' })
  const planTab = win.getByRole('tab', { name: '分镜方案' })
  const originalBefore = await win.getByText(ORIGINAL, { exact: false }).isVisible()
  await planTab.click()
  const planVisible = await win.getByText(PLAN_PROMPT, { exact: false }).isVisible()
  const originalHiddenWhilePlanOpen = !(await win.getByText(ORIGINAL, { exact: false }).isVisible().catch(() => false))
  await originalTab.click()
  const originalAfter = await win.getByText(ORIGINAL, { exact: false }).isVisible()
  await planTab.click()
  const planAfter = await win.getByText(PLAN_PROMPT, { exact: false }).isVisible()
  await win.screenshot({ path: path.join(outDir, 'creation-work-surfaces.png') })

  await win.reload()
  await win.waitForTimeout(1300)
  await openFixtureCreationSurface(win)
  const originalAfterReload = await win.getByText(ORIGINAL, { exact: false }).isVisible()
  const tabsAfterReload = await win.getByRole('tablist', { name: '创作工作面' }).isVisible()
  await win.getByRole('tab', { name: '分镜方案' }).click()
  const planAfterReload = await win.getByText(PLAN_PROMPT, { exact: false }).isVisible()

  const result = { originalBefore, planVisible, originalHiddenWhilePlanOpen, originalAfter, planAfter, originalAfterReload, tabsAfterReload, planAfterReload }
  console.log(JSON.stringify(result))
  const ok = Object.values(result).every(Boolean)
  await closeApp()
  process.exit(ok ? 0 : 1)
} catch (error) {
  console.error(error)
  console.error('Creation surface failure:', await _launchedWin.evaluate(() => ({
    url: location.href,
    creation: document.querySelector('[aria-label="AI 创作区"]')?.textContent?.slice(0, 3000) ?? null,
  })).catch(() => null))
  await _launchedWin.screenshot({ path: path.join(outDir, 'creation-work-surfaces-error.png') }).catch(() => {})
  await closeApp()
  process.exit(1)
}
