// Real isolated Electron director labels; run both locales before and after the ruler fix.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { createBlankProject } from '../../evals/lib/isoApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { require as tsxRequire } from 'tsx/cjs/api'
import { newProjectEntry, switchWorkspace } from './_shell.mjs'
import { uiTextWith } from './full-walk/invariants.mjs'

const { PREVIZ_RULER_PLAN } = tsxRequire('../../evals/director/previzRulerFixture.ts', import.meta.url)
const { normalizeDirectorPlan, parseDirectorPlan } = tsxRequire('../../electron/shared/director/directorPlanSchema.ts', import.meta.url)
const { compileDirectorPlan } = tsxRequire('../../src/workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler.ts', import.meta.url)
const { summarizeDirectorShots } = tsxRequire('../../src/workbench/generationCanvas/nodes/director/model/directorShotSummaries.ts', import.meta.url)
const { makeShotLabels } = tsxRequire('../../src/workbench/generationCanvas/nodes/director/panels/shotStrip/shotLabels.ts', import.meta.url)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const locale = process.argv.includes('--en') ? 'en' : 'zh-CN'
const localeTag = locale === 'en' ? 'en' : 'zh'
// 不给就用构建产物（launchNomiApp 默认）；给了就走本仓 vite dev
const rendererUrl = process.env.NOMI_WALK_RENDERER_URL
const shotsDir = process.env.NOMI_RULER_EVIDENCE_DIR ?? path.join(repoRoot, 'tests/ux/shots/director-previz-ruler')
const phase = process.env.NOMI_RULER_PHASE ?? 'after'
fs.mkdirSync(shotsDir, { recursive: true })

const plan = parseDirectorPlan(normalizeDirectorPlan(PREVIZ_RULER_PLAN))
if (!plan.success) throw plan.error
const compiled = compileDirectorPlan(plan.data)
if (!compiled.ok) throw new Error(`street 编译失败：${compiled.errors.join('; ')}`)
const project = compiled.project
const characterIds = project.scenes[0].objects.filter((object) => object.type === 'character').map((object) => object.id)
const actionPoses = [...new Set(project.scenes[0].objects.flatMap((object) => (object.actionClips ?? []).map((clip) => clip.actionPose).filter(Boolean)))]

const { app, win, projectsDir } = await launchNomiApp({
  name: 'director-previz-ruler',
  ...(process.env.NOMI_RULER_TEMP_ROOT ? { tempRoot: path.join(process.env.NOMI_RULER_TEMP_ROOT, `${phase}-${localeTag}`) } : {}),
  ...(rendererUrl ? { env: { VITE_DEV_SERVER_URL: rendererUrl } } : {}),
})
const errors = []
win.on('pageerror', (error) => errors.push(String(error)))
try {
  await win.evaluate((appLocale) => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(key, 'seen')
    window.localStorage.setItem('__nomiE2E', '1')
    window.localStorage.setItem('nomi:locale:v1', appLocale)
  }, locale)
  await win.reload()
  await newProjectEntry(win).waitFor({ timeout: stationTimeout({ operations: 4 }) })
  await createBlankProject(win, projectsDir)
  await switchWorkspace(win, 'generation')
  // 空项目没有「画面」：先走真入口建一个，导演台节点才有地方落（与 director-electron.walk 同一做法）
  // 2026-10-08：空画布的「+ 新建画面」换成一排任务卡（拍板 ③），建图片卡点「图片」那张。
  await win.locator('[data-empty-canvas-tasks] [data-add-intent="image"]').first().click({ timeout: stationTimeout({ operations: 2 }) })
  await addCanvasNodeFromRail(win, 'director', { timeout: stationTimeout({ operations: 2 }) })
  // 新节点落在视口外时画布给一枚「新节点在右侧 →」：点它把视口带过去（用户也是这么找到它的）
  const offscreenHint = win.locator('[data-canvas-arrival-hint]').first()
  if (await offscreenHint.count()) await offscreenHint.click()
  await win.locator('[data-testid="director-node"]').first().waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })
  await win.evaluate((directorProject) => {
    const state = window.__nomiCanvasStore.getState()
    const node = state.nodes.find((item) => item.kind === 'director')
    state.updateNode(node.id, { title: '三人街头预演', meta: { ...node.meta, directorProject } })
  }, project)
  await win.keyboard.press('Escape').catch(() => {})
  await win.locator('[data-testid="director-node-open"]').first().click({ timeout: stationTimeout({ operations: 2 }) })
  await win.locator('[data-testid="director-editor"]').waitFor({ timeout: stationTimeout({ operations: 4 }) })
  const settled = ({ ids, poses }) => {
    const bridge = window.__nomiDirectorE2E
    if (!bridge) return false
    return ids.every((id) => bridge.findAll('characterMount', id).length > 0) && poses.every((pose) => bridge.poseClipStatus(pose) !== 'loading')
  }
  const waitSettled = () => win.waitForFunction(settled, { ids: characterIds, poses: actionPoses }, { timeout: stationTimeout({ operations: 4 }) })
  // 落定后再等 30 帧：角色姿态、阴影、画中画剪裁都是逐帧收敛的
  const settleFrames = () => win.evaluate(() => new Promise((resolve) => { let left = 30; const step = () => (--left <= 0 ? resolve(true) : requestAnimationFrame(step)); requestAnimationFrame(step) }))

  await win.locator('[data-testid="director-3dbox-view"]').waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await win.locator('[data-testid="director-shot-1"]').click()
  await waitSettled()
  await settleFrames()
  const title = await win.getByTestId('director-view-title').innerText()
  const pip = await win.getByTestId('director-pip-now-playing').innerText()
  console.log(`  · 顶栏标题：${title}｜小窗：${pip.replace(/\s+/g, ' ')}`)
  const shotTitle = uiTextWith(locale, 'director.view.titleWithShot', { title: '三人街头预演', index: 1 })
  const shotLabel = shotTitle.slice(shotTitle.indexOf('·') + 1).trim()
  if (!title.includes(shotLabel) || !pip.includes(shotLabel)) throw new Error(`首镜未选中：${title} / ${pip}`)
  const label = await win.getByTestId('director-shot-1').innerText()
  const measured = summarizeDirectorShots(project)[0]
  if (phase === 'after' && measured.shotSize !== '远景') throw new Error(`首镜主体实测应为远景：${measured.shotSize}`)
  const labels = makeShotLabels((key, options) => uiTextWith(locale, key, options), locale === 'en')
  if (!label.includes(labels.headline(measured)) || !pip.includes(labels.pip(measured, 0))) throw new Error(`镜头条 / 小窗没有显示共用实测：${label} / ${pip}`)
  console.log(`  · 首镜标签：${label.replace(/\s+/g, ' ')}`)
  await win.screenshot({ path: path.join(shotsDir, `${phase}-${localeTag}-street-director.png`) })
  if (errors.length) throw new Error(`渲染端抛错：\n${errors.slice(0, 5).join('\n')}`)
  console.log(`  ✓ director-previz-ruler 截图落在 ${path.relative(repoRoot, shotsDir)}`)
} catch (error) {
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app.close().catch(() => {})
}
