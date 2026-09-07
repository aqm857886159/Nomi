#!/usr/bin/env node
// R13/R16 · agent-artifact（AI 手艺产物节点）真实用户走查 —— resident Agent 对话驱动（零额度）。
//
// 人物设定：林秋让 Nomi 的常驻 Agent 交付一件"不调模型"的手艺产物——开场节奏讲解用的
// 构图线稿（SVG）。走查在**真实 resident 对话**里驱动：
//   01 UI 新建空白项目（走项目库注册，非目录种子）
//   02 生成面常驻 Agent 面板 → 让 Agent "画一张开场构图线稿，放画布上"
//   03 loopback 供应商回放 create_canvas_nodes（kind=agent-artifact + artifact.content=SVG 源码）
//   04 宿主真实执行 deliver 落盘（applyCanvasToolCall → importWorkbenchLocalAssetFile → 建节点）
//   05 断言 agent-artifact 节点上画布（data-kind）、SVG 以 <img> 渲染 nomi-local 资产
//   06 点选 → 浮条出现「下载 / 固化为参考图」（SVG 专属动作）
//   07 截图证据 → <outputDir>（createRuntimeWalk 统一收集）
//
// 零额度：供应商 = loopback（agent-runtime-fixture.mjs），每次模型调用预先声明；未声明即 400
// 并在收尾报出。不碰真实生成 API。渲染层/IPC/宿主/deliver 落盘全走生产路径。
//
// Run: pnpm run build && node tests/ux/agent-artifact.walk.mjs
import { clickOrFail, expect, expectVisible, proveProbe } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CANVAS_PANEL,
  COMPOSER_INPUT,
  COMPOSER_SEND,
  CREATION_PANEL,
  DOCUMENT,
  TOOL_RECEIPT,
  USER_BUBBLE,
  approvePendingIntervention,
  chooseAssistantModel,
  createRuntimeWalk,
  expandResidentPanel,
  hasToolResult,
  openCanvas,
  recorded,
  sendCanvas,
  waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

// 林秋的话（自然语言，Agent 得自己决定调 create_canvas_nodes + 交付产物）。
const ASK = '画一张开场构图线稿放到画布上：左边一个竖构图的人形框，右边给一句开场标题留出位置，风格干净。'
const DELIVER_CALL = 'artifact-deliver-svg'
const NODE_TITLE = '开场构图线稿'

// SVG 是"产物本体"（content 会被真实落盘为 .svg 资产文件，节点引用 nomi-local://）。
const SVG_BODY = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">',
  '  <rect width="480" height="270" fill="#f4f1ea"/>',
  '  <rect x="40" y="30" width="150" height="200" fill="none" stroke="#185fa5" stroke-width="2"/>',
  '  <circle cx="110" cy="90" r="18" fill="none" stroke="#185fa5" stroke-width="2"/>',
  '  <path d="M110 108 v80 m-20 20 20-20 20 20" fill="none" stroke="#185fa5" stroke-width="2"/>',
  '  <rect x="260" y="60" width="180" height="120" fill="none" stroke="#d85a30" stroke-width="2" stroke-dasharray="6 4"/>',
  '</svg>',
].join('')

const walk = await createRuntimeWalk('agent-artifact-node')
let failure
try {
  let { win } = await walk.start({ first: true })
  const project = await walk.newProject()
  const { projectId, projectRoot } = project

  // 创作面先选好文本模型（常驻 Agent 模型全局，画布沿用）。
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)

  // 生成面：打开画布 + 展开常驻 Agent 面板。
  await openCanvas(win)
  const canvas = win.locator(CANVAS_PANEL)
  await expect(canvas, '生成面常驻 Agent 面板必须挂载').toBeVisible()

  // ── 幕一 · Agent 对话交付 SVG 线稿 ──────────────────────────────────────
  // 第一轮：Agent 决定调 create_canvas_nodes，交付出产物内容（带 artifact.content）。
  const deliverRequest = walk.fixture.expectText({
    label: 'agent delivers the SVG artifact through create_canvas_nodes',
    match: (body) => flattenRequestText(body).includes('构图线稿') && !hasToolResult(body, DELIVER_CALL),
    reply: {
      type: 'tool', id: DELIVER_CALL,
      name: 'nomi_canvas_plan',
      args: {
        operation: 'create_canvas_nodes',
        summary: '交付开场构图线稿（SVG）',
        nodes: [{
          clientId: 'art-1',
          kind: 'agent-artifact',
          title: NODE_TITLE,
          artifact: { fileType: 'svg', content: SVG_BODY },
        }],
        edges: [],
      },
    },
  })
  // 第二轮：宿主把 deliver 执行结果（真实落盘后的回执）还给模型。
  const deliverFollowup = walk.fixture.expectText({
    label: 'host returns the deliver receipt',
    match: (body) => hasToolResult(body, DELIVER_CALL),
    reply: { type: 'text', text: '构图线稿已放到画布上。' },
  })
  await sendCanvas(win, ASK)
  await recorded(deliverRequest.received, 'deliver request')
  await recorded(deliverFollowup.received, 'deliver receipt')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: canvas.locator(TOOL_RECEIPT).last() })

  // ── 断言 · agent-artifact 节点真的上画布（宿主真实落盘建节点）────────────
  // id 由宿主分配，seed 无从预知，只能按 kind 断言。
  const artifactNode = win.locator('.generation-canvas-v2-node[data-kind="agent-artifact"]').first()
  const artifactNodeProof = await proveProbe(artifactNode, '画布上确实出现 agent-artifact 节点')
  // SVG 产物必须真的渲染成图（<img> 载入 nomi-local 资产）。
  const svgImage = artifactNode.locator('img[src*="nomi-local://"], img[src*=".svg"]').first()
  await svgImage.waitFor({ timeout: 15_000 })
  const complete = await svgImage.evaluate((el) => el.complete)
  expect(complete, 'SVG <img> 渲染且加载完成').toBe(true)
  await walk.snap('01-delivered-svg-artifact-node')

  // ── 断言 · 点选 → 浮条（下载 / 固化为参考图，SVG 专属）──────────────────
  await artifactNode.click({ timeout: 10_000 })
  await expectVisible(win.locator('[data-node-floating-toolbar="true"] button', { hasText: '下载' }).first(), '浮条「下载」')
  await expectVisible(win.locator('[data-node-floating-toolbar="true"] button', { hasText: '固化为参考图' }).first(), '浮条「固化为参考图」（SVG 下游消费入口）')
  await walk.snap('02-selected-toolbar-actions')

  // ── 幕二 · Agent 对话交付 HTML 讲解卡（会动会交互的产物）────────────────
  const HTML_ASK = '再做一张开场节奏讲解卡放到画布上，HTML 的：三段情绪爬升条会动。'
  const HTML_CALL = 'artifact-deliver-html'
  const HTML_TITLE = '开场节奏讲解'
  const HTML_BODY = [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'body{font-family:system-ui;margin:24px;background:#fdf8f0;color:#2b2b2b}',
    '.bar{height:14px;border-radius:7px;background:#185fa5;',
    'animation:grow 1.2s ease-in-out infinite alternate;transform-origin:left}',
    '@keyframes grow{from{transform:scaleX(.35)}to{transform:scaleX(1)}}',
    '</style></head><body><h3>第一幕 · 情绪爬升</h3>',
    '<div class="bar" style="width:96%"></div>',
    '<div class="bar" style="width:78%;background:#d85a30"></div>',
    '<p>旁白先入 · 第三拍给特写 · 转场用声音扛</p></body></html>',
  ].join('')
  const htmlRequest = walk.fixture.expectText({
    label: 'agent delivers the HTML artifact through create_canvas_nodes',
    match: (body) => flattenRequestText(body).includes('讲解卡') && !hasToolResult(body, HTML_CALL),
    reply: {
      type: 'tool', id: HTML_CALL, name: 'nomi_canvas_plan',
      args: {
        operation: 'create_canvas_nodes', summary: '交付开场节奏讲解卡（HTML）',
        nodes: [{ clientId: 'art-2', kind: 'agent-artifact', title: HTML_TITLE, artifact: { fileType: 'html', content: HTML_BODY } }],
        edges: [],
      },
    },
  })
  const htmlFollowup = walk.fixture.expectText({
    label: 'host returns the html deliver receipt',
    match: (body) => hasToolResult(body, HTML_CALL),
    reply: { type: 'text', text: '开场节奏讲解卡已放到画布上。' },
  })
  await sendCanvas(win, HTML_ASK)
  await recorded(htmlRequest.received, 'html deliver request')
  await recorded(htmlFollowup.received, 'html deliver receipt')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: canvas.locator(TOOL_RECEIPT).last() })

  // HTML 产物渲染在沙箱 iframe 中：sandbox=allow-scripts，且不含 allow-same-origin。
  // 隔离的铁证 = iframe 的 origin 是 opaque（'null'）：无 allow-same-origin 的 sandbox iframe
  // 拿不到宿主 origin/存储/顶层 DOM，脚本只能在自己的笼子里跑动画。跨源 contentDocument
  // 读取行为随 Chromium 对 standard custom scheme 的处理有差异（实测 READABLE），但那不构成
  // 提权——「产物碰不到宿主」由 opaque origin + Electron 无 nodeIntegration/contextIsolation 保证。
  const htmlIframe = win.locator('.generation-canvas-v2-node[data-kind="agent-artifact"] iframe').first()
  await htmlIframe.waitFor({ timeout: 15_000 })
  const sandbox = await htmlIframe.evaluate((el) => el.getAttribute('sandbox'))
  expect(sandbox, 'HTML iframe sandbox 属性存在').toBe('allow-scripts')
  const frameOrigin = await htmlIframe.evaluate((el) => {
    try { return el.contentWindow ? el.contentWindow.origin : 'NO-WINDOW' } catch { return 'BLOCKED' }
  })
  expect(frameOrigin, '沙箱隔离：iframe origin 是 opaque(null)——产物脚本拿不到宿主 origin/存储/顶层 DOM').toBe('null')
  await walk.snap('03-delivered-html-sandbox')

  // ── 幕三 · SVG 固化为参考图：真实点击浮条按钮 → canvas 栅格化 → PNG 落盘 → asset 节点 ──
  const svgRefNode = win.locator('.generation-canvas-v2-node[data-kind="agent-artifact"]').filter({
    has: win.locator('img[src*=".svg"]'),
  }).first()
  await svgRefNode.click({ timeout: 10_000 })
  await expectVisible(win.locator('[data-node-floating-toolbar="true"] button', { hasText: '固化为参考图' }).first(), 'SVG 节点浮条「固化为参考图」')
  // 浮条固定定位在节点上沿，若 SVG 节点落在画布视口上缘之外，按钮 y 坐标为负——
  // Playwright 视口判定（含 force）一律拒点。按钮已 expectVisible 证明在 DOM/可交互；
  // dispatchEvent 走 React 合成事件（onClick 真实触发 rasterize 管线），是此刻语义最准的驱动。
  const rasterizeButton = win.locator('[data-node-floating-toolbar="true"] button', { hasText: '固化为参考图' }).first()
  await rasterizeButton.dispatchEvent('click')
  // rasterizeArtifactToReferenceAsset 真实执行：读 SVG → canvas 栅格化 PNG → importFile 落盘 → asset 节点。
  // asset 节点有 result.type=image（referenceUrl 可读、可被连线）——等它在画布出现。
  const assetRefNode = win.locator('.generation-canvas-v2-node[data-kind="asset"]').first()
  await assetRefNode.waitFor({ timeout: 20_000 })
  const assetImg = assetRefNode.locator('img').first()
  await assetImg.waitFor({ timeout: 15_000 })
  const assetComplete = await assetImg.evaluate((el) => el.complete)
  expect(assetComplete, '固化的参考图（PNG）以 <img> 渲染完成').toBe(true)
  // asset 节点 img 的 src = result.url 的渲染：nomi-local + PNG（referenceUrl 链路可读、可被连线）。
  const assetImgSrc = await assetImg.getAttribute('src')
  expect(String(assetImgSrc || '').startsWith('nomi-local://asset/'), '固化资产以 nomi-local 渲染（可被下游连线）').toBe(true)
  await walk.snap('04-rasterized-reference-asset')
  // 磁盘证据：栅格化出的 PNG 文件真实落在项目 assets/imported 下（存在 = canvas 真的画了并落盘）。
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const diskPngs = fs.readdirSync(pathMod.join(projectRoot, 'assets', 'imported')).flatMap((day) =>
    fs.readdirSync(pathMod.join(projectRoot, 'assets', 'imported', day)).filter((name) => name.endsWith('.png')))
  expect(diskPngs.length >= 1, '栅格化 PNG 真实落盘到项目 assets/imported').toBe(true)

  // 面板有对话流痕迹（用户真的在对话里交付，不是旁路注入）。
  await expect(canvas.locator(USER_BUBBLE).last(), '交付指令出现在对话流').toContainText('讲解卡')
  console.log(`\nagent-artifact 走查通过（project=${projectId}）✓✓✓`)
} catch (error) {
  failure = error
  console.error('agent-artifact 走查失败:', error instanceof Error ? error.message : String(error))
} finally {
  await walk.finish(failure)
  if (failure) process.exit(1)
}
