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
import { assertMockupContract, clickOrFail, expect, expectAbsent, expectVisible, proveProbe } from './_assert.mjs'
import artifactIntentContract from '../../docs/design/mockups/contracts/2026-09-06-agent-artifact-node.intent.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
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

  // 诊断探针：产物帧被拦住时，浏览器只会安静地画一块白板——不抛错、不进 console.error。
  // 唯一会说话的是 securitypolicyviolation 事件，所以提前挂上，失败时把它原样报出来，
  // 免得下一个人又要重新猜「到底是哪条策略拦的」。
  const consoleLines = []
  win.on('request', (request) => {
    if (request.url().startsWith('nomi-local:')) consoleLines.push(`REQ ${request.resourceType()} ${request.url().slice(-40)}`)
  })
  win.on('requestfailed', (request) => {
    if (request.url().startsWith('nomi-local:')) consoleLines.push(`FAIL ${request.url().slice(-40)} → ${request.failure()?.errorText}`)
  })
  win.on('framenavigated', (frame) => consoleLines.push(`FRAME ${frame.url().slice(0, 60)}`))
  win.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`.slice(0, 200)))
  win.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`.slice(0, 200)))
  await win.evaluate(() => {
    window.__nomiCspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__nomiCspViolations.push(`${event.violatedDirective} ← ${event.blockedURI}`)
    })
  })

  // ── 幕一 · Agent 对话交付 SVG 线稿 ──────────────────────────────────────
  // 第一轮：Agent 决定调 create_canvas_nodes，交付出产物内容（带 artifact.content）。
  const deliverRequest = walk.fixture.expectText({
    label: 'agent delivers the SVG artifact through make_artifact',
    match: (body) => flattenRequestText(body).includes('构图线稿') && !hasToolResult(body, DELIVER_CALL),
    reply: {
      type: 'tool', id: DELIVER_CALL,
      name: 'make_artifact',
      // 20 动词：手艺产物一个动词一件；契约 operation（create_canvas_nodes + agent-artifact 节点）由声明上的翻译表派生。
      args: { fileType: 'svg', title: NODE_TITLE, content: SVG_BODY },
    },
  })
  // 第二轮：宿主把 deliver 执行结果（真实落盘后的回执）还给模型。
  const deliverFollowup = walk.fixture.expectText({
    label: 'lane returns the deliver receipt',
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
  // 身份必须在卡面上：没有类型角标，手绘线稿和生图在画布上长得一模一样；没有标题，一批产物
  // 落下来只能靠内容认。样张 §「画布上的手艺产物」的 n-head 就是这两样。
  await expectVisible(artifactNode.locator('[data-artifact-file-type="svg"]').first(), 'SVG 产物壳（带类型标记）')
  await expect(artifactNode, '产物卡显示类型角标 SVG').toContainText('SVG')
  await expect(artifactNode, '产物卡显示 Agent 给的标题').toContainText(NODE_TITLE)
  // 形态契约（R8）：样张的 n-head 关系逐条对账。
  // 先清掉选中——刚交付的节点会被聚焦选中，而契约里「浮条默认不可见」断的是**没选中**那一刻
  // （§1.5：动作是 L2 情境层）。不清就等于拿选中态去断默认态，量的不是同一件事。
  // 先证明「浮条」这个探针测得到东西——刚交付的节点是选中态，浮条此刻就在。
  // 没有这一步，下面那句「浮条不见了」和「选择器写错了、根本没测到」在观测上一模一样。
  const toolbar = win.locator('[data-node-floating-toolbar="true"]')
  const toolbarProof = await proveProbe(toolbar, '选中态下产物浮条确实浮出来')
  // 点一下 React Flow 的空白 pane（生产代码里真正派发「取消选中」的那一层；Escape 不管这件事）。
  const blank = await findCanvasBlankPoint(win)
  await win.mouse.click(blank.x, blank.y)
  await expectAbsent(toolbar, { provenBy: toolbarProof, message: '清空选中后浮条应全部收起' })
  await assertMockupContract(win, artifactIntentContract)
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
  // 纯 CSS 的动效卡——这正是手艺产物的真实形态（Agent 手写的讲解卡靠 @keyframes 动，不靠 JS）。
  // ⚠️ 刻意不放 <script>：产物文档走 srcdoc 继承宿主 CSP，而宿主的 script-src 不含 'unsafe-inline'，
  // 产物里的内联 JS 在打包版一律被拦（详见 artifactSandboxDocument.ts 头注与方案文档的「已知缺口」）。
  // 断言因此不靠帧内脚本，而靠**从帧里量到的排版事实**（Playwright 经 CDP 求值，不受 CSP 约束）。
  const HTML_BODY = [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'body{font-family:system-ui;margin:24px;background:#fdf8f0;color:#2b2b2b}',
    '.bar{height:14px;border-radius:7px;background:rgb(24,95,165);',
    'animation:grow 1.2s ease-in-out infinite alternate;transform-origin:left}',
    '@keyframes grow{from{transform:scaleX(.35)}to{transform:scaleX(1)}}',
    '</style></head><body><h3>第一幕 · 情绪爬升</h3>',
    '<div class="bar" style="width:96%"></div>',
    '<div class="bar" style="width:78%;background:rgb(216,90,48)"></div>',
    '<p>旁白先入 · 第三拍给特写 · 转场用声音扛</p>',
    '</body></html>',
  ].join('')
  const htmlRequest = walk.fixture.expectText({
    label: 'agent delivers the HTML artifact through create_canvas_nodes',
    match: (body) => flattenRequestText(body).includes('讲解卡') && !hasToolResult(body, HTML_CALL),
    reply: {
      type: 'tool', id: HTML_CALL, name: 'make_artifact',
      args: { fileType: 'html', title: HTML_TITLE, content: HTML_BODY,
      },
    },
  })
  const htmlFollowup = walk.fixture.expectText({
    label: 'lane returns the html deliver receipt',
    match: (body) => hasToolResult(body, HTML_CALL),
    reply: { type: 'text', text: '开场节奏讲解卡已放到画布上。' },
  })
  await sendCanvas(win, HTML_ASK)
  await recorded(htmlRequest.received, 'html deliver request')
  await recorded(htmlFollowup.received, 'html deliver receipt')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: canvas.locator(TOOL_RECEIPT).last() })

  // ⚠️ 这里原先断的是 sandbox 属性字符串 + contentWindow.origin === 'null'。
  // 那两条**对一个被 CSP 拦成空框的 iframe 一样成立**（属性是我们自己写的、opaque origin 是
  // 拦截后的默认值），所以 HTML 产物白板了三条断言全绿。真正要证的是「里面真的画出来了」，
  // 而那只能从**帧内量到的排版事实**看——被拦住的帧压根不存在，量都没得量。
  const htmlIframe = win.locator('.generation-canvas-v2-node[data-kind="agent-artifact"] iframe').first()
  await htmlIframe.waitFor({ timeout: 15_000 })
  const sandbox = await htmlIframe.evaluate((el) => el.getAttribute('sandbox'))
  expect(sandbox, 'HTML iframe sandbox=allow-scripts（无 allow-same-origin → opaque origin）').toBe('allow-scripts')

  // 帧内取证。产物是 srcdoc 文档，opaque origin，宿主脚本读不到它；Playwright 的 frameLocator
  // 直接在帧上下文里求值（走 CDP，不受同源与 CSP 约束），所以能拿到真实排版。
  const artifactFrame = win.frameLocator('.generation-canvas-v2-node[data-kind="agent-artifact"] iframe')
  const bar = artifactFrame.locator('.bar').first()
  await bar.waitFor({ timeout: 15_000 })
  const facts = await bar.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      heading: (el.ownerDocument.querySelector('h3') || {}).textContent || '',
      bodyBg: getComputedStyle(el.ownerDocument.body).backgroundColor,
      barBg: style.backgroundColor,
      animation: style.animationName,
      barWidth: Math.round(box.width),
      barHeight: Math.round(box.height),
      origin: String(el.ownerDocument.defaultView.origin),
    }
  })
  // ① 交付的 DOM 在里面；② 产物自己的 CSS 生效（背景/颜色都不是浏览器默认）；
  // ③ 动画真的挂上了；④ 排版真的发生了（宽高不为 0）。少任何一条，卡面就还是白板。
  expect(facts.heading, '产物 DOM 是我们交付的那份').toContain('情绪爬升')
  expect(facts.bodyBg, '产物自己的 body 背景生效（不是默认透明）').toBe('rgb(253, 248, 240)')
  expect(facts.barBg, '产物自己的元素样式生效').toBe('rgb(24, 95, 165)')
  expect(facts.animation, 'CSS 动画真的挂在元素上（会动）').toBe('grow')
  expect(facts.barWidth > 0 && facts.barHeight > 0, `产物内部完成排版（进度条量到 ${facts.barWidth}x${facts.barHeight}）`).toBe(true)
  // 隔离仍成立：产物文档是 opaque origin，读不到宿主 DOM/storage/cookie。
  expect(facts.origin, '沙箱隔离：产物文档 origin 是 opaque(null)').toBe('null')

  // ── 诚实标注（2026-09-07 用户拍板：按现状合并，界面上明标「暂不支持交互」）──────
  // 上面刚证完「它真的在动」——而这正是问题所在：会动的卡面等于在邀请用户去点，
  // 可内联 JS 被宿主 CSP 拦着（方案 §6.5，srcdoc 继承宿主策略，规范决定的）。
  // 所以 HTML 卡必须自己说出这条限制，且**只有** HTML 卡说——别的类型本来就不是活内容。
  const htmlNode = win.locator('.generation-canvas-v2-node[data-kind="agent-artifact"]:has([data-artifact-file-type="html"])').first()
  const noteProbe = htmlNode.locator('[data-artifact-interaction-note]')
  const noteProof = await proveProbe(noteProbe, 'HTML 产物卡上确实带交互限制标注')
  await expect(htmlNode, 'HTML 卡把限制说在用户眼前（不是让他点一下才发现）').toContainText('暂不支持点击交互')
  // 反面：SVG 卡不该带这句。用同一个探针（已被上面证明测得到东西）换个作用域量，
  // 「没看到」才不是空洞的通过。
  const svgNoteNode = win.locator('.generation-canvas-v2-node[data-kind="agent-artifact"]:has([data-artifact-file-type="svg"])').first()
  await expectAbsent(svgNoteNode.locator('[data-artifact-interaction-note]'), {
    provenBy: noteProof,
    message: 'SVG 产物卡不该带交互限制标注（它不是活内容，标了是噪音）',
  })
  await walk.snap('03-delivered-html-sandbox')

  // ── 幕三 · Markdown 与表格产物（一次 create_canvas_nodes 交付两件）────────────
  const DOC_ASK = '再给我两件：一份导演备注的 Markdown，和一张第一幕的分镜草表。'
  const DOC_CALL = 'artifact-deliver-docs'
const DOC_CALL_2 = `${DOC_CALL}-2`
  const MD_TITLE = '导演备注 · 开场'
  const TABLE_TITLE = '分镜草表 · 第一幕'
  const MD_BODY = ['# 导演备注 · 开场', '', '- 旁白先入，画面留白两拍', '- 第三拍给特写', '- 转场用声音扛'].join('\n')
  const TABLE_BODY = [
    '<tr><th>镜号</th><th>景别</th><th>时长</th><th>要点</th></tr>',
    '<tr><td>1</td><td>大远景</td><td>3s</td><td>空镜留白，旁白先入</td></tr>',
    '<tr><td>2</td><td>中景</td><td>2s</td><td>人物入画，情绪起</td></tr>',
    '<tr><td>3</td><td>特写</td><td>2s</td><td>眼神落点，切转场</td></tr>',
  ].join('')
  const docsRequest = walk.fixture.expectText({
    label: 'agent delivers the markdown artifact (one artifact per make_artifact call)',
    match: (body) => flattenRequestText(body).includes('分镜草表') && !hasToolResult(body, DOC_CALL),
    reply: { type: 'tool', id: DOC_CALL, name: 'make_artifact', args: { fileType: 'markdown', title: MD_TITLE, content: MD_BODY } },
  })
  const docsSecond = walk.fixture.expectText({
    label: 'agent delivers the table artifact in the same turn',
    match: (body) => hasToolResult(body, DOC_CALL) && !hasToolResult(body, DOC_CALL_2),
    reply: { type: 'tool', id: DOC_CALL_2, name: 'make_artifact', args: { fileType: 'table', title: TABLE_TITLE, content: TABLE_BODY } },
  })
  const docsFollowup = walk.fixture.expectText({
    label: 'lane returns the docs deliver receipt',
    match: (body) => hasToolResult(body, DOC_CALL_2),
    reply: { type: 'text', text: '备注和草表都放上去了。' },
  })
  await sendCanvas(win, DOC_ASK)
  await recorded(docsRequest.received, 'docs deliver request')
  await recorded(docsSecond.received, 'table deliver request')
  await recorded(docsFollowup.received, 'docs deliver receipt')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: canvas.locator(TOOL_RECEIPT).last() })

  // Markdown 产物：正文真的读到了文件内容（不是空壳）。
  const mdNode = win.locator('.generation-canvas-v2-node[data-kind="agent-artifact"]:has([data-artifact-file-type="markdown"])').first()
  await mdNode.waitFor({ timeout: 15_000 })
  await expect(mdNode, 'Markdown 产物渲染出交付的正文').toContainText('旁白先入')
  // 渲染，不是贴源码：标题变成真的 <h1>，列表变成真的 <li>，记号不该还留在屏幕上。
  await expectVisible(mdNode.locator('h1').first(), 'Markdown 标题被渲染成标题（不是 "# " 开头的一行字）')
  expect((await mdNode.locator('li').count()) >= 3, 'Markdown 列表被渲染成列表项').toBe(true)
  expect(await mdNode.innerText(), 'Markdown 源码记号不出现在屏幕上').not.toContain('# 导演备注')
  await expectVisible(mdNode.getByText(MD_TITLE, { exact: false }).first(), 'Markdown 产物标题')
  await walk.snap('04-delivered-markdown')

  // 表格产物：表头与单元格都在（走的是安全的结构化渲染，不是 innerHTML）。
  const tableNode = win.locator('.generation-canvas-v2-node[data-kind="agent-artifact"]:has([data-artifact-file-type="table"])').first()
  await tableNode.waitFor({ timeout: 15_000 })
  await expect(tableNode, '表格产物渲染出表头').toContainText('景别')
  await expect(tableNode, '表格产物渲染出行内容').toContainText('眼神落点')
  await expectVisible(tableNode.getByText(TABLE_TITLE, { exact: false }).first(), '表格产物标题')
  await walk.snap('05-delivered-table')

  // ── 幕四 · SVG 固化为参考图：真实点击浮条按钮 → canvas 栅格化 → PNG 落盘 → asset 节点 ──
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
  // 文件名要解码回中文：nomi-local URL 逐段 encodeURIComponent，取名不 decode 就会把
  // %E5%BC%80%E5%9C%BA… 当成参考图的名字显在画布上（用户看到一串乱码）。
  const assetTitle = await assetRefNode.innerText()
  expect(assetTitle.includes('%E'), `固化参考图标题不带百分号转义（实际："${assetTitle.replace(/\n/g, ' ').slice(0, 80)}"）`).toBe(false)
  expect(assetTitle, '固化参考图沿用产物标题').toContain(NODE_TITLE)
  // 落点：固化出的参考图必须生在**源产物卡右边**，而不是退回画布缺省落点。
  // 上一版就是退回缺省的 (120,360)：参考图落到画布最左侧、压在左侧工具簇底下——
  // 功能全对（文件在、节点在、能连线），但用户点完按钮，东西不在他刚才看的地方。
  // 这条断言量的正是"在不在他眼前"：两个盒子的真实屏幕坐标。
  const svgBox = await svgRefNode.boundingBox()
  const assetBox = await assetRefNode.boundingBox()
  expect(Boolean(svgBox && assetBox), '两张卡都量得到屏幕位置').toBe(true)
  expect(
    assetBox.x > svgBox.x,
    `参考图生在源产物卡右边（源 x=${Math.round(svgBox.x)}，参考图 x=${Math.round(assetBox.x)}）`,
  ).toBe(true)
  // 并且没被左侧工具簇吃掉——工具簇是画布左沿的常驻层，落到它下面就等于看不见。
  // 量法：拿工具簇里的「更多」钮（`data-canvas-add-more`，簇内现成的稳定锚点）的右沿当簇右沿。
  // 它是簇内最宽的元素之一，误差是几 px 的内边距——而上一版的偏差是**整整一个画布宽**，
  // 这点误差不影响判定。
  const railRight = await win.evaluate(() => {
    const anchor = document.querySelector('[data-canvas-add-more]')
    return anchor ? anchor.getBoundingClientRect().right : 0
  })
  expect(railRight > 0, '量到了左侧工具簇的位置（探针没写死）').toBe(true)
  expect(assetBox.x >= railRight, `参考图没有落在左侧工具簇底下（簇右沿=${Math.round(railRight)}，参考图 x=${Math.round(assetBox.x)}）`).toBe(true)
  await walk.snap('06-rasterized-reference-asset')
  // 磁盘证据：栅格化出的 PNG 文件真实落在项目 assets/imported 下（存在 = canvas 真的画了并落盘）。
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const diskPngs = fs.readdirSync(pathMod.join(projectRoot, 'assets', 'imported')).flatMap((day) =>
    fs.readdirSync(pathMod.join(projectRoot, 'assets', 'imported', day)).filter((name) => name.endsWith('.png')))
  expect(diskPngs.length >= 1, '栅格化 PNG 真实落盘到项目 assets/imported').toBe(true)

  // The actual SDK transcript must contain the same three writes that created these assets.
  const sessions = readLaneTranscripts(projectRoot)
  expect(sessions, '三次交付属于同一条 lane').toHaveLength(1)
  const messages = laneMessages(sessions[0])
  const delivered = messages.filter(message => message.role === 'toolResult'
    && [DELIVER_CALL, HTML_CALL, DOC_CALL].includes(message.toolCallId))
  expect(delivered.map(message => [message.toolCallId, message.toolName, message.isError]))
    .toEqual([DELIVER_CALL, HTML_CALL, DOC_CALL].map(id => [id, 'nomi_canvas_write', false]))
  const calls = messages.filter(message => message.role === 'assistant').flatMap(message => message.content)
    .filter(part => part.type === 'toolCall' && [DELIVER_CALL, HTML_CALL, DOC_CALL].includes(part.id))
  expect(calls.flatMap(call => call.arguments.nodes.map(node => node.artifact.content)))
    .toEqual([SVG_BODY, HTML_BODY, MD_BODY, TABLE_BODY])

  // 面板有对话流痕迹（用户真的在对话里交付，不是旁路注入）。
  await expect(canvas.locator(USER_BUBBLE).last(), '交付指令出现在对话流').toContainText('分镜草表')
  console.log(`\nagent-artifact 走查通过（project=${projectId}）✓✓✓`)
} catch (error) {
  failure = error
  console.error('agent-artifact 走查失败:', error instanceof Error ? error.message : String(error))
} finally {
  await walk.finish(failure)
  if (failure) process.exit(1)
}
