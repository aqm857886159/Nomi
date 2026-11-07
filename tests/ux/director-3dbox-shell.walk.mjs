// 导演视图（3D-BOX）外壳 · Electron 真机取证（3a 第六轮，2026-10-04）。
//
// 用法（主进程 dist-electron + 渲染端构建产物 dist；要先 `pnpm run build`）：
//   node tests/ux/director-3dbox-shell.walk.mjs [--en]      （--en：英文界面；2026-10-29 起中英都要过，导演台收进生成页那一刀的验收清单第 11 条）
//   想看本仓源码的渲染端（vite dev）：NOMI_WALK_RENDERER_URL=http://127.0.0.1:<P>/ node tests/ux/director-3dbox-shell.walk.mjs
// 工程要由**现役编译器**把 S1 oracle 计划 courtyard-standoff 编出来，与设计实验室 director-3dbox 屏、
// 评测吃的是同一份（不手抄 JSON，不另造夹具）。编译器是 TS 源码：经 tsx/cjs/api 的 require 加载
// （夜跑用裸 `node` 跑走查，静态 import .ts 会在 Node 自带的类型剥离里栽在无扩展名的相对 import 上，2026-10-24 夜跑红过）。
//
// 走的路径全是真实用户入口：项目库「新建空白项目」→ 生成页 → 画布上的导演台节点 →「进入导演台」→
// 点第 2 张镜头卡 → 点「精修」。工程是经 E2E 画布桥（__nomiE2E 才挂）写进节点 meta 的——
// 3b 的 stage_shot 接上之前，没有别的入口能把一份计划变成节点上的工程。
// 3D-BOX 是唯一的导演台（2026-10-16）：截导演视图 + 精修两张。
// 截图落 tests/ux/shots/director-3dbox-shell/，人眼核对后再拷进 docs/evidence/。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { createBlankProject } from '../../evals/lib/isoApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { require as tsxRequire } from 'tsx/cjs/api'
import { newProjectEntry, switchWorkspace } from './_shell.mjs'
import { enterRefine } from './_directorLab.mjs'
import { uiTextWith } from './full-walk/invariants.mjs'

const { S1_ORACLE_PLANS } = tsxRequire('../../evals/director/s1OraclePlans.ts', import.meta.url)
const { compileDirectorPlan } = tsxRequire('../../src/workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler.ts', import.meta.url)

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const locale = process.argv.includes('--en') ? 'en' : 'zh-CN'
const localeTag = locale === 'en' ? 'en' : 'zh'
// 不给就用构建产物（launchNomiApp 默认）；给了就走本仓 vite dev
const rendererUrl = process.env.NOMI_WALK_RENDERER_URL
const shotsDir = path.join(repoRoot, 'tests/ux/shots/director-3dbox-shell')
fs.mkdirSync(shotsDir, { recursive: true })

const compiled = compileDirectorPlan(S1_ORACLE_PLANS['courtyard-standoff'])
if (!compiled.ok) throw new Error(`courtyard-standoff 编译失败：${compiled.errors.join('; ')}`)
const project = compiled.project
const characterIds = project.scenes[0].objects.filter((object) => object.type === 'character').map((object) => object.id)
const actionPoses = [...new Set(project.scenes[0].objects.flatMap((object) => (object.actionClips ?? []).map((clip) => clip.actionPose).filter(Boolean)))]

const { app, win, projectsDir } = await launchNomiApp({
  name: 'director-3dbox-shell',
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
    state.updateNode(node.id, { title: '古装庭院对峙', meta: { ...node.meta, directorProject } })
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
  await win.locator('[data-testid="director-shot-2"]').click()
  await waitSettled()
  await settleFrames()
  const title = await win.getByTestId('director-view-title').innerText()
  const pip = await win.getByTestId('director-pip-now-playing').innerText()
  console.log(`  · 顶栏标题：${title}｜小窗：${pip.replace(/\s+/g, ' ')}`)
  // 第 2 镜的字样按词典取（中文「镜头 2」/ 英文「Shot 2」），不在走查里抄一份
  const shotTwoTitle = uiTextWith(locale, 'director.view.titleWithShot', { title: '古装庭院对峙', index: 2 })
  const shotTwoLabel = shotTwoTitle.slice(shotTwoTitle.indexOf('·') + 1).trim()
  if (!title.includes(shotTwoLabel) || !pip.includes(shotTwoLabel)) throw new Error(`点第 2 镜后标题 / 小窗没有落到「${shotTwoLabel}」（标题：${title}｜小窗：${pip}）`)
  await win.screenshot({ path: path.join(shotsDir, `real-${localeTag}-courtyard-director.png`) })
  // 切精修：和其它导演台走查同一个点法（_directorLab 的 enterRefine，按词典文字找「精修」，精修顶栏出来才算到）
  await enterRefine(win)
  await waitSettled()
  await settleFrames()
  await win.screenshot({ path: path.join(shotsDir, `real-${localeTag}-courtyard-refine.png`) })
  if (errors.length) throw new Error(`渲染端抛错：\n${errors.slice(0, 5).join('\n')}`)
  console.log(`  ✓ director-3dbox-shell 截图落在 ${path.relative(repoRoot, shotsDir)}`)
} catch (error) {
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app.close().catch(() => {})
}
