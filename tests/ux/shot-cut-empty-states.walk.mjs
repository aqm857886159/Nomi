// 真实用户任务：拿三段不同结构的视频点「按镜头拆」，每一段都要走到「下一步」，不许出现死路。
//
// 为什么专门为空态建一条走查：这个面板最常见的结局就是「什么都没检出」——画布上绝大多数视频节点是
// AI 生成的单镜头片段（实测最强画面变化 0.003–0.041，切点门槛 0.1），结构上永远是 0 个切点。
// 而三种「看起来都是 0」的情况，正确反应完全不同，单测看不出差别，只有真机能看出来：
//   ① 真·一镜到底（全集 0）  → 换一条路：均匀抽帧，别把用户堵死
//   ② 切点偏弱（全集非 0，默认灵敏度筛没了）→ 今天会是一片空白，连解释都没有 ← 就是这条的主目标
//   ③ 正常硬切 → 行为一个字都不能变
//
// 零额度：三段素材本地 ffmpeg 现造，检测走真实 Electron/ffmpeg 链路，不碰任何模型。
// 用法：pnpm run build && node tests/ux/shot-cut-empty-states.walk.mjs
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectCount, expectText, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shot-cut-walk-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'shot-cut-empty-states'
const projectRoot = path.join(projectsDir, `shot-cut-${projectId}`)
const assetsDir = path.join(projectRoot, 'assets', 'generated')
const shot = (name) => path.join(os.tmpdir(), `nomi-shot-cut-${name}.png`)

fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(assetsDir, { recursive: true })

// 三段素材的 scene_score 是实测标定过的（探针见本文件同名分支的记录）：
//   oneshot 最强 0.026（<0.1 门槛，检不出任何切点）
//   weak    切点 0.246（>0.1 进全集，但 <0.3 默认灵敏度 → 正是「今天一片空白」那条）
//   strong  切点 0.679（默认灵敏度直接可见）
const encodeOneShot = (output) => execFileSync(ffmpegPath, [
  '-v', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=6',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
])
const encodeWithCut = (output, brightness) => execFileSync(ffmpegPath, [
  '-v', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3',
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3',
  '-filter_complex', `[1:v]eq=brightness=${brightness}[x];[0:v][x]concat=n=2:v=1:a=0[v]`,
  '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
])
encodeOneShot(path.join(assetsDir, 'oneshot.mp4'))
encodeWithCut(path.join(assetsDir, 'weak.mp4'), 0.10)
encodeWithCut(path.join(assetsDir, 'strong.mp4'), 0.30)

const videoNode = (id, file, title, y) => ({
  id, kind: 'video', categoryId: 'shots', title,
  position: { x: 80, y }, exactPosition: true, size: { width: 260, height: 200 }, status: 'success',
  result: {
    id: `${id}-result`, type: 'video', createdAt: 1,
    url: `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/${file}`,
  },
})
const generationCanvas = {
  nodes: [
    // 竖着排开 520px：选中的节点会展开出模式条，靠太近会盖住下一个节点的点击点。
    videoNode('node-oneshot', 'oneshot.mp4', '一镜到底', 80),
    videoNode('node-weak', 'weak.mp4', '弱切点', 600),
    videoNode('node-strong', 'strong.mp4', '硬切', 1120),
  ],
  edges: [], selectedNodeIds: [], groups: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 },
}
const payload = { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId, name: '按镜头拆空态走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot, ...payload, payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const { app, win } = await launchNomiApp({
  name: 'shot-cut-empty-states', userDataDir: settingsDir, settingsDir, projectsDir, settleMs: 1200,
})

const panel = win.locator('[role="dialog"][aria-label="按镜头拆"]')
const subtitle = panel.locator('.text-body-sm').first()
const tiles = panel.locator('[data-shot-cut]')
const selectAll = panel.getByRole('button', { name: /全选|全不选/ })
const primary = panel.locator('[data-shot-cut-commit="true"]')

async function openCanvas() {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.keyboard.press('Escape').catch(() => {})
  await win.reload()
  await win.waitForTimeout(1200)
  const card = win.locator('[data-project-card]', { hasText: '按镜头拆空态走查' }).first()
  if (await card.isVisible().catch(() => false)) {
    await card.hover()
    const go = card.getByText('继续创作', { exact: false }).first()
    if ((await go.count()) > 0) await go.click()
    else await card.dblclick()
  }
  await win.getByRole('button', { name: '生成', exact: true }).first().click().catch(() => {})
  await win.locator('[data-node-id="node-oneshot"]').waitFor({ state: 'visible', timeout: 15_000 })
}

/** 打开某个视频节点的「按镜头拆」，等到检测结束（面板不再显示「正在找画面切点」）。 */
async function openShotCutPanel(nodeId) {
  // 先取消上一个节点的选中：选中态会展开出模式条，盖住别的节点的点击点。
  await win.keyboard.press('Escape').catch(() => {})
  await win.locator('.workbench-generation__canvas').click({ position: { x: 12, y: 12 } }).catch(() => {})
  const node = win.locator(`[data-node-id="${nodeId}"]`)
  await node.scrollIntoViewIfNeeded().catch(() => {})
  await node.click({ position: { x: 30, y: 30 } })
  await clickOrFail(node.locator('button', { hasText: '按镜头拆' }).first(), `${nodeId} 的「按镜头拆」`)
  await expectVisible(panel, `${nodeId}：按镜头拆面板没打开`)
  await expectText(subtitle, /^(?!正在找画面切点)/, `${nodeId}：检测迟迟不结束`, 60_000)
}

async function closePanel() {
  await clickOrFail(panel.getByRole('button', { name: '关闭' }), '关闭按钮')
  await panel.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
}

await openCanvas()

// ③ 先跑正常硬切——它同时是后面 expectAbsent 的基线：证明「全选」在有切点时确实存在、探得到。
await openShotCutPanel('node-strong')
await screenshotSettled(win, { path: shot('3-strong') })
await expectText(subtitle, /检测到 1 个镜头$/, '硬切：应当就是 1 个镜头，且不该说「已自动放宽」（默认灵敏度本来就够）')
await expectVisible(tiles.first(), '硬切：切点格子没出来')
const selectAllProof = await proveProbe(selectAll, '有切点时「全选」会出现在底栏')

// ③b 把灵敏度拉到顶 → 今天是一片空白；改后必须给出「为什么空 + 一键回去」。
await panel.locator('#shot-cut-sensitivity').fill('0.7')
await screenshotSettled(win, { path: shot('3b-strong-overfiltered') })
await expectVisible(panel.getByText('当前灵敏度太高'), '灵敏度拉满后没解释为什么空')
await clickOrFail(panel.locator('[data-shot-cut-relax="true"]'), '「放宽到能看到」')
await expectVisible(tiles.first(), '点了放宽仍然看不到切点')
await closePanel()

// ② 弱切点：今天这条会是「检测到 0 个镜头」+ 滑杆 + 一片空白 + 一句解释都没有。
await openShotCutPanel('node-weak')
await screenshotSettled(win, { path: shot('2-weak-autorelaxed') })
await expectText(subtitle, /检测到 1 个镜头 · 已自动放宽灵敏度/, '弱切点：没有自动放宽，面板又是打开即空')
await expectVisible(tiles.first(), '弱切点：自动放宽后仍然没有格子')
await closePanel()

// ① 真·一镜到底：不是失败，换一条路——而且不许再摆一个永远点不了的「全选」。
await openShotCutPanel('node-oneshot')
await screenshotSettled(win, { path: shot('1-oneshot') })
await expectText(subtitle, /这段是一镜到底/, '一镜到底：标题没说清这是什么情况')
await expectVisible(panel.getByText('要从它身上取画面'), '一镜到底：没告诉用户下一步能干什么')
await expectAbsent(selectAll, { provenBy: selectAllProof, message: '一镜到底时没东西可选，不该还摆着「全选」' })
await expectText(primary, /均匀抽 3 帧/, '一镜到底：主操作没换成均匀抽帧（6 秒 → 3 帧）')

// 走到底：真的抽出来、真的落到画布上，这条路才算通——只验文案等于没验。
await clickOrFail(primary, '「均匀抽 3 帧」')
await panel.waitFor({ state: 'detached', timeout: 120_000 })
await win.waitForTimeout(1500)
await screenshotSettled(win, { path: shot('1b-oneshot-frames-on-canvas') })
// 抽出来的节点标题是「{源标题}·{时间戳}」，那个「·」把它和源节点自己区分开。
const produced = win.locator('[data-node-id]', { hasText: '一镜到底·' })
await expectCount(produced, 3, '均匀抽帧点了，但画布上没落下 3 个帧节点')

console.log('[walk] 三条路径都走到了下一步，截图见 /tmp/nomi-shot-cut-*.png')
await closeNomiApp(app)
