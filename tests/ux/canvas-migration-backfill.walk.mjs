// React Flow 迁移回填②的真机验收：一个窗口、界面动作、量真实几何。
// 用法：pnpm run build && node tests/ux/canvas-migration-backfill.walk.mjs
//
// 三件事各证一条（2026-09-11 迁移等价审计 §③ 行 2 / 行 4 / 行 7）：
//
// ① 缩放值单一真相（行 2，真 bug）：把画布缩到 ~50%，在剪辑节点的内嵌时间轴上把片段
//    往右拖 N 个**屏幕**像素。片段应当跟着手指走——也就是落点的帧数 = 屏幕位移 ÷
//    「每帧占多少屏幕像素」。迁移后卡内读的是 store 里那个没人写的 `canvasZoom`（恒 1），
//    于是同样的手势只走一半的帧：断言写成「实走帧数 / 应走帧数 ≥ 0.75」，
//    bug 态是 ~0.5，正好被这条判死。
//
// ② 灯箱收起画布 chrome（行 4）：双击图片放大后，工具条 / 导航栈 / 节点浮条应当不可见；
//    关掉之后原样回来。用 `visibility` 收起 ⇒ 元素还在 DOM 里，所以断言查的是
//    `getComputedStyle().visibility`，不是「在不在」——查「在不在」会永远绿。
//
// ③ 边标签恒定屏幕尺寸（行 7）：同一条边的模式胶囊，在 ~30% 与 ~300% 两档缩放下
//    量它的屏幕高度，应当只差 ≤1px。修复前它随视口一起缩放，两档相差 10 倍。
//
// 现场取得方式：项目文件按「用户已经有这么一个项目」预置在磁盘上，其余全是真手势
// （滚轮缩放、按住拖、双击、点选）。缩放不走任何注入，靠滚轮滚到位后从
// `.react-flow__viewport` 的 transform 里**读**出来实际值，再按实际值算期望。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidenceDir = path.join(repoRoot, 'docs/plan/2026-09-11-triage-board-evidence')
fs.mkdirSync(evidenceDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-migration-backfill-b-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'migration-backfill-b'
const projectRoot = path.join(projectsDir, `migration-backfill-${projectId}`)
const generatedAssetsDir = path.join(projectRoot, 'assets', 'generated')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(generatedAssetsDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })
fs.copyFileSync(path.join(repoRoot, 'tests/ux/fixtures/test-upload.png'), path.join(generatedAssetsDir, 'fixture.png'))

const imageUrl = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/fixture.png`
const imageNode = (id, title, x, y) => ({
  id, kind: 'image', categoryId: 'shots', title,
  position: { x, y }, exactPosition: true, size: { width: 260, height: 200 }, status: 'success',
  result: { id: `${id}-result`, type: 'image', url: imageUrl, createdAt: 1 },
})
const clipNode = {
  id: 'backfill-clip', kind: 'clip', categoryId: 'shots', title: '画布剪辑',
  position: { x: 80, y: 440 }, exactPosition: true, size: { width: 760, height: 150 }, status: 'idle',
  meta: {
    clip: {
      nodeRole: 'clip',
      sourceNodeIds: ['solo-clip'],
      // 单素材：轴上没有邻居，吸附点只剩轴首与播放头，拖到中段不会被吸走，测得的位移就是手势本身。
      clips: [{ id: 'solo-clip', sourceNodeId: 'backfill-style', type: 'image', label: '独段', url: imageUrl, durationSeconds: 4, trimStart: 0, trimEnd: 4 }],
    },
  },
}
const generationCanvas = {
  nodes: [imageNode('backfill-style', '风格参考', 80, 120), imageNode('backfill-shot', '镜头一', 460, 120), clipNode],
  // 非 reference 的模式才画胶囊（reference 是默认值，画出来等于噪音）。
  edges: [{ id: 'backfill-edge', source: 'backfill-style', target: 'backfill-shot', mode: 'style_ref', order: 0 }],
  selectedNodeIds: [], groups: [],
}
const payload = { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId, name: '迁移回填走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot, ...payload, payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const TOOLBAR = '.generation-canvas-v2-toolbar'
const NAV_STACK = '.generation-canvas-v2__navigation-stack'
const NODE_FLOATING_TOOLBAR = '[data-node-floating-toolbar]'
const EDGE_LABEL = '.generation-canvas-react-flow__edge-label'
const LIGHTBOX = '[role="dialog"][aria-label], .workbench-generation__canvas [role="dialog"]'

const log = (...args) => console.log('  ', ...args)
const findings = []
const record = (line) => { findings.push(line); log(line) }

const { app, win: initialWin } = await launchNomiApp({
  name: 'canvas-migration-backfill',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 1200,
})
let win = initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}
const snap = async (name) => {
  await screenshotSettled(getWin(), { path: path.join(evidenceDir, `backfill-b-${name}.png`) })
  log(`· 截图 backfill-b-${name}.png`)
}

async function dismissFirstRun() {
  for (let i = 0; i < 6; i += 1) {
    const skip = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(160)
  }
}

/** 真正生效的缩放：从 React Flow 视口的 transform 里读，不从任何我们自己的状态里读。 */
async function readZoom() {
  return getWin().evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport')
    const matrix = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform) : null
    return matrix ? matrix.a : null
  })
}

/**
 * 滚轮缩放到目标区间（真手势）。滚不到就抛——测不了的事不许静默通过。
 *
 * `anchorAt` 是每一步把鼠标放哪：React Flow 的滚轮缩放锚光标，所以想让某个东西
 * 一直留在屏幕上（③ 要看的那枚胶囊），就把光标压在它身上滚；不传就随便找块空白。
 */
async function wheelZoomTo(min, max, label, anchorAt) {
  const fallback = await findCanvasBlankPoint(getWin(), { preference: 'bottom', inset: 56 })
  if (!fallback && !anchorAt) throw new Error(`${label}：这一屏找不到画布空白点，滚轮缩放无处下手`)
  for (let step = 0; step < 40; step += 1) {
    const zoom = await readZoom()
    if (zoom != null && zoom >= min && zoom <= max) {
      log(`· ${label}：缩放 = ${zoom.toFixed(3)}（第 ${step} 次滚轮后）`)
      return zoom
    }
    const at = (anchorAt ? await anchorAt() : null) ?? fallback
    await getWin().mouse.move(at.x, at.y)
    await getWin().mouse.wheel(0, zoom != null && zoom > max ? 120 : -120)
    await getWin().waitForTimeout(140)
  }
  const zoom = await readZoom()
  throw new Error(`${label}：滚了 40 次仍停在 ${zoom}，进不了 [${min}, ${max}]`)
}

async function readClip() {
  return getWin().evaluate(() => {
    const el = document.querySelector('[data-testid="clip-node-clip"]')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      startFrame: Number(el.getAttribute('data-persisted-start-frame')),
      endFrame: Number(el.getAttribute('data-persisted-end-frame')),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    }
  })
}

async function visibilityOf(selector) {
  return getWin().evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el).visibility : 'missing'
  }, selector)
}

let failed = false
try {
  await getWin().waitForLoadState('domcontentloaded')
  await dismissFirstRun()
  await clickOrFail(getWin().locator('button, [role="button"]', { hasText: '迁移回填走查' }).first(), '打开预置项目')
  await dismissFirstRun()
  await clickOrFail(getWin().getByRole('button', { name: '生成', exact: true }), '生成（进画布）')
  await expectVisible(getWin().locator(TOOLBAR).first(), '画布工具条应当出现')
  await clickOrFail(getWin().locator('[aria-label="适应视图"]'), '适应视图')
  await getWin().waitForTimeout(400)
  await snap('00-canvas-ready')

  // ── ① 50% 缩放下拖片段：位移必须跟着手指走 ──
  const zoom = await wheelZoomTo(0.42, 0.62, '①「缩到一半」')
  const before = await readClip()
  expect(before, '画布上找不到剪辑片段：①无从测量').not.toBe(null)
  // 每帧占多少**屏幕**像素，由这一刻量到的片段宽度与它的帧长反推——不引用任何内部常量。
  const screenPxPerFrame = before.rect.w / Math.max(1, before.endFrame - before.startFrame)
  const dragPx = Math.round(screenPxPerFrame * 90)
  const grabY = before.rect.y + before.rect.h / 2
  const grabX = before.rect.x + Math.min(40, before.rect.w / 3)
  await getWin().mouse.move(grabX, grabY)
  await getWin().mouse.down()
  await getWin().mouse.move(grabX + dragPx / 2, grabY, { steps: 8 })
  await getWin().mouse.move(grabX + dragPx, grabY, { steps: 8 })
  await getWin().waitForTimeout(120)
  await getWin().mouse.up()
  await getWin().waitForTimeout(320)
  const after = await readClip()
  const movedFrames = after.startFrame - before.startFrame
  const expectedFrames = dragPx / screenPxPerFrame
  const ratio = movedFrames / expectedFrames
  record(`① 缩放 ${zoom.toFixed(3)}：手指走 ${dragPx}px（应 ${expectedFrames.toFixed(1)} 帧），片段实走 ${movedFrames} 帧，比值 ${ratio.toFixed(3)}`)
  await snap('01-clip-drag-at-half-zoom')
  expect(
    ratio,
    `50% 缩放下片段没跟上手指：应走 ${expectedFrames.toFixed(1)} 帧、实走 ${movedFrames} 帧（比值 ${ratio.toFixed(3)}）。`
      + '比值 ≈0.5 正是「卡内读的缩放恒为 1」那个 bug 的指纹。',
  ).toBeGreaterThan(0.75)
  expect(ratio, `片段走过头了（比值 ${ratio.toFixed(3)}）：反向补偿也是错的`).toBeLessThan(1.3)

  // ── ② 灯箱打开时收起画布 chrome ──
  await clickOrFail(getWin().locator('[aria-label="适应视图"]'), '适应视图（回到看得清的一档）')
  await getWin().waitForTimeout(400)
  const shotNode = getWin().locator('.generation-canvas-v2-node[data-node-id="backfill-shot"]').first()
  await shotNode.click()
  await getWin().waitForTimeout(300)
  const floatingBefore = await visibilityOf(NODE_FLOATING_TOOLBAR)
  expect(floatingBefore, '选中卡之后节点浮条应当先出现（没有它，②的「收起」无从证伪）').toBe('visible')
  await snap('02-before-lightbox')
  // 双击落在「媒体区」那个 div 上（图片本身 pointer-events:none，左右边缘是磁吸带的命中区），
  // 所以按量到的矩形取中心点、用真鼠标双击，而不是让 Playwright 自己挑落点。
  const previewBox = await shotNode.locator('.generation-canvas-v2-node__preview').first().boundingBox()
  expect(previewBox, '量不到镜头卡的媒体区：②无从打开灯箱').not.toBe(null)
  await getWin().mouse.dblclick(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2)
  await expectVisible(getWin().locator(LIGHTBOX).first(), '双击图片应当打开灯箱')
  await getWin().waitForTimeout(360)
  const hidden = {
    toolbar: await visibilityOf(TOOLBAR),
    nav: await visibilityOf(NAV_STACK),
    floating: await visibilityOf(NODE_FLOATING_TOOLBAR),
  }
  record(`② 灯箱打开：工具条=${hidden.toolbar} 导航栈=${hidden.nav} 节点浮条=${hidden.floating}`)
  await snap('03-lightbox-open')
  for (const [name, value] of Object.entries(hidden)) {
    expect(value, `灯箱打开时「${name}」仍然可见（visibility=${value}）：40% 黑遮罩挡不住它，看大图时它压在画面上`).toBe('hidden')
  }
  // 用「关闭预览」那颗键关，不按 Esc：Esc 会一路传到画布把选中也清掉，
  // 节点浮条随之卸载，测出来的「没回来」是卸载不是没恢复。
  await clickOrFail(getWin().locator('[aria-label="关闭预览"]').first(), '关闭预览')
  await getWin().waitForTimeout(500)
  const restored = {
    toolbar: await visibilityOf(TOOLBAR),
    nav: await visibilityOf(NAV_STACK),
    floating: await visibilityOf(NODE_FLOATING_TOOLBAR),
  }
  record(`② 灯箱关闭：工具条=${restored.toolbar} 导航栈=${restored.nav} 节点浮条=${restored.floating}`)
  await snap('04-lightbox-closed')
  for (const [name, value] of Object.entries(restored)) {
    expect(value, `灯箱关掉后「${name}」没回来（visibility=${value}）`).toBe('visible')
  }

  // ── ③ 边标签在 30% 与 300% 下屏幕高度一致 ──
  await getWin().locator('.generation-canvas-v2-node[data-node-id="backfill-style"]').first().click()
  await expectVisible(getWin().locator(EDGE_LABEL).first(), '选中边的一端后应当出现边模式胶囊')
  // 缩放锚光标：把光标压在胶囊上滚，它就一直留在屏幕中间——截图才看得见被测的东西。
  const labelCenter = async () => {
    const box = await getWin().locator(EDGE_LABEL).first().boundingBox().catch(() => null)
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
  }
  const labelHeightAt = async (min, max, label, shot) => {
    const z = await wheelZoomTo(min, max, label, labelCenter)
    await getWin().waitForTimeout(240)
    const box = await getWin().locator(EDGE_LABEL).first().boundingBox()
    expect(box, `${label}：量不到边标签的盒子`).not.toBe(null)
    await snap(shot)
    return { zoom: z, height: box.height }
  }
  const small = await labelHeightAt(0.26, 0.36, '③「缩到 30%」', '05-edge-label-zoom-30')
  const large = await labelHeightAt(2.4, 3.0, '③「放到 300%」', '06-edge-label-zoom-300')
  const delta = Math.abs(small.height - large.height)
  record(`③ 边标签高度：${small.zoom.toFixed(2)}× → ${small.height.toFixed(2)}px，${large.zoom.toFixed(2)}× → ${large.height.toFixed(2)}px，差 ${delta.toFixed(2)}px`)
  expect(
    delta,
    `边标签没保持恒定屏幕尺寸：${small.zoom.toFixed(2)}× 时 ${small.height.toFixed(2)}px、`
      + `${large.zoom.toFixed(2)}× 时 ${large.height.toFixed(2)}px（差 ${delta.toFixed(2)}px）`,
  ).toBeLessThanOrEqual(1)

  console.log('\n走查通过：')
  for (const line of findings) console.log('  -', line)
} catch (error) {
  failed = true
  console.error('\n走查失败：', error?.message || error)
  await screenshotSettled(getWin(), { path: path.join(evidenceDir, 'backfill-b-99-failure.png') }).catch(() => {})
  for (const line of findings) console.error('  -', line)
} finally {
  await app.close().catch(() => {})
}
process.exit(failed ? 1 : 0)
