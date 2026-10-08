import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13 走查（零额度）：点 nomi:// 深链，App 到底跳不跳。
//
// 修的真实故障：渲染层订阅深链的那段写着 `if (!projectId || !runId) return`——于是
// **工程级 `nomi://project/{id}`（MCP 每条生成结果都在给用户的那个链接）和节点级链接点了毫无反应**，
// 连窗口都不亮一下。用户以为链接是坏的。
//
// 这条走查从「停在项目库」的真实起点出发，走两跳：
//   ① 只带 projectId 的工程级链接 → 应该真打开那个工程（旧代码：停在库里不动）
//   ② 带 nodeId 的节点级链接 → 应该切到该节点所在的**分类页签**并选中它
//
// 为什么把目标节点种在**非默认分类**（characters，默认页签是 shots）：探针实测确认画布
// **只渲染当前分类的节点**，于是「char 卡出现 + shot 卡消失」这组正反信号能一起证明页签真切了；
// 若只断言「char 卡出现」，在「所有节点都渲染、只是看不见」的世界里也会报绿——那是假绿。
// 断言全部走结构化 DOM（data-node-id / data-selected），不看全页文本；等待全部靠 locator 自动等，
// 不拿 sleep 当完成信号（深链是异步的：hydrate → 节点入 store → 派聚焦事件）。
//
// 零额度：不生成、不连模型。每步 screenshot 供人眼复核（眼见链）。
// 用法：pnpm run build && node tests/ux/deep-link-navigate.walk.mjs
import { expectAbsent, expectVisible, proveProbe } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/deep-link-navigate')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const base = makeTempDir('nomi-deeplink-')
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const swatch = (c) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="${c}"/></svg>`)

const TARGET_NODE_ID = 'char-anchor-1'
const SHOTS_NODE_ID = 'shot-1'
const nodes = [
  { id: SHOTS_NODE_ID, kind: 'image', title: '镜头 1', position: { x: 40, y: 80 }, categoryId: 'shots', shotIndex: 1,
    result: { id: 'shot-1-r', type: 'image', url: swatch('#4a7fe0') } },
  { id: 'shot-2', kind: 'image', title: '镜头 2', position: { x: 280, y: 80 }, categoryId: 'shots', shotIndex: 2,
    result: { id: 'shot-2-r', type: 'image', url: swatch('#00a886') } },
  { id: TARGET_NODE_ID, kind: 'image', title: '定妆卡·小周', position: { x: 40, y: 80 }, categoryId: 'characters',
    result: { id: 'char-r', type: 'image', url: swatch('#c56b3c') } },
]

const projectId = 'deeplink-0001'
const projDir = path.join(projectsDir, `deeplink-${projectId}`)
fs.mkdirSync(projDir, { recursive: true })
fs.writeFileSync(
  path.join(projDir, 'project.json'),
  JSON.stringify(
    {
      id: projectId, name: '深链导航走查', version: 1,
      createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
      payload: {
        workbenchDocument: { version: 1, title: '深链导航走查', updatedAt: 1, contentJson: { type: 'doc', content: [] } },
        timeline: null,
        generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
        storyboardPlan: null, storyboardPlanCommitted: false,
      },
    },
    null,
    2,
  ),
)

let n = 0
const snap = async (win, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) }).catch((e) => console.log(`  (snap ${tag} failed: ${e.message})`))
  console.log(`  · shot ${tag}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { app, win } = await launchNomiApp({
  name: 'deep-link-navigate',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--disable-gpu', '--disable-software-rasterizer'],
  env: { NOMI_CAPABILITY_DIR: path.join(settingsDir, 'capability-core') },
  timeout: 300000,
})

/** 从主进程发深链——和真实 `nomi://` 到达时走的是同一条 IPC 通道。 */
const sendDeepLink = (payload) =>
  app.evaluate(({ BrowserWindow }, p) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.webContents.send('nomi:production-deep-link', p)
  }, payload)

const nodeEl = (id) => win.locator(`[data-node-id="${id}"]`)
const anyNode = () => win.locator('[data-node-id]')

let exitCode = 0
try {
  win.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)))
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
  })
  await win.reload() // 仅在「还没开工程」时刷新以吃掉引导态；开工程后再刷会丢 activeProjectId
  await sleep(1500)
  for (let i = 0; i < 6; i++) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1000 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await sleep(300)
  }
  await snap(win, 'library-before')
  console.log('  起点画布节点数：', await anyNode().count(), '（应为 0：还停在项目库，画布没挂载）')

  // ① 工程级深链：只有 projectId。旧代码要求必须有 runId，这一跳会原地不动。
  console.log(`\n① 发工程级深链 nomi://project/${projectId}（无 runId、无 nodeId）`)
  await sendDeepLink({ projectId })
  await expectVisible(nodeEl(SHOTS_NODE_ID), '工程级深链应真打开那个工程并渲出画布（旧代码：停在项目库不动）', 30_000)
  await snap(win, 'after-project-link')

  // 建立基线：此刻 shots 页签上「镜头 1」确实测得到，且 characters 分类的卡**不在**页上。
  // 这条基线让第②跳的「shot 卡消失」有意义——否则「没看到」和「探针失效」无法区分。
  const shotProof = await proveProbe(nodeEl(SHOTS_NODE_ID), 'shots 页签上的「镜头 1」节点')
  console.log('  当前页节点数：', await anyNode().count(), '（画布只渲当前分类 → 定妆卡此刻不该在）')
  await expectAbsent(nodeEl(TARGET_NODE_ID), {
    provenBy: shotProof,
    message: '默认停在 shots 页签时，characters 分类的定妆卡不该已经在页上（否则第②跳的对照失效）',
  })

  // ② 节点级深链：目标在 characters 分类，必须切页签才算真到位。
  console.log(`\n② 发节点级深链 → node=${TARGET_NODE_ID}（种在 characters 分类，当前页签是 shots）`)
  await sendDeepLink({ projectId, nodeId: TARGET_NODE_ID })
  await expectVisible(nodeEl(TARGET_NODE_ID), '节点级深链应把定妆卡带到眼前（切到它所在的分类页签）', 30_000)
  await snap(win, 'after-node-link')

  // 正反两面一起证：目标出现 + 原页签的卡消失 = 页签真切了，不是「所有节点都恰好在 DOM 里」。
  await expectAbsent(nodeEl(SHOTS_NODE_ID), {
    provenBy: shotProof,
    message: '切到 characters 页签后 shots 的卡应当离场——它还在说明页签根本没切，只是碰巧两张都渲染着',
  })
  await expectVisible(
    win.locator(`[data-node-id="${TARGET_NODE_ID}"][data-selected="true"]`),
    '定妆卡应处于选中态（深链是「指着这一镜看」，光切页签不算到位）',
  )
  console.log('\n✅ 工程级 / 节点级两种深链形状都真跳了')
} catch (error) {
  exitCode = 1
  console.error('\n❌ 走查失败：', error.message)
  await snap(win, 'failure').catch(() => {})
} finally {
  await app.close().catch(() => {})
  console.log(`\n截图：${shotsDir}`)
  process.exit(exitCode)
}
