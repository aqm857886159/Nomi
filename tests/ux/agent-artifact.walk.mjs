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
  const { projectId } = project

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

  // 面板有对话流痕迹（用户真的在对话里交付，不是旁路注入）。
  await expect(canvas.locator(USER_BUBBLE).last(), '交付指令出现在对话流').toContainText('构图线稿')
  console.log(`\nagent-artifact 走查通过（project=${projectId}）✓✓✓`)
} catch (error) {
  failure = error
  console.error('agent-artifact 走查失败:', error instanceof Error ? error.message : String(error))
} finally {
  await walk.finish(failure)
  if (failure) process.exit(1)
}
