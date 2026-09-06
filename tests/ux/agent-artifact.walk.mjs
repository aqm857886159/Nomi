#!/usr/bin/env node
// R13/R16 · agent-artifact（AI 手艺产物节点）真实用户走查（零额度，不触发生成）。
//
// 人物设定：林秋的片子进入分镜阶段。她让 Nomi 的 Agent 交付了两件"不调模型"的手艺产物：
//   ① 一张构图线稿（SVG）——用来当分镜的站位参考；
//   ② 一张会动的开场节奏讲解卡（HTML）——放在画布上随时能看、能交互。
// 本走查打开一个**已含这两件产物**的项目（种子方式，资产真实落盘 nomi-local://），
// 走真实用户路径验证节点能力：
//   01 项目打开 → 两个 agent-artifact 节点上画布（按 data-kind 断言）
//   02 SVG 产物渲染为可看图（<img> 载入 nomi-local 资产）
//   03 HTML 产物在沙箱 iframe 中渲染（断言 sandbox=allow-scripts 且无 same-origin）
//   04 点选节点 → 选中浮条出现（FloatingToolbarShell：下载 + 复制）
//   05 截图证据 → tests/ux/shots/agent-artifact/
//
// 为什么用种子而不是 Agent 对话：deliver_craft 落盘工具（LLM 工具面 + 审批闸）是 P1
// （docs/plan §10），尚未实现；本走查先钉住"用户打开含产物项目后看到的节点能力"——
// 渲染 / 沙箱 / 动作浮条。Agent 端到端对话走查待 deliver 落地后补第二幕（见文末 TODO）。
//
// Run: pnpm run build && node tests/ux/agent-artifact.walk.mjs
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { expect, expectCount, expectVisible, clickOrFail, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/agent-artifact')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-agent-artifact-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'agent-artifact-walk'
const projectRoot = path.join(projectsDir, `artifact-${projectId}`)
fs.mkdirSync(path.join(projectRoot, 'assets', 'generated'), { recursive: true })
const svgPath = path.join(projectRoot, 'assets', 'generated', 'composition-guide.svg')
const htmlPath = path.join(projectRoot, 'assets', 'generated', 'opening-beats.html')
// 资产真实落盘（SVG + 会动的 HTML——用户明确"HTML 要动、不是静态的"）。
fs.writeFileSync(svgPath, [
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">',
  '  <rect width="480" height="270" fill="#f4f1ea"/>',
  '  <rect x="40" y="30" width="150" height="200" fill="none" stroke="#185fa5" stroke-width="2"/>',
  '  <circle cx="110" cy="90" r="18" fill="none" stroke="#185fa5" stroke-width="2"/>',
  '  <path d="M110 108 v80 m-20 20 20-20 20 20" fill="none" stroke="#185fa5" stroke-width="2"/>',
  '  <rect x="260" y="60" width="180" height="120" fill="none" stroke="#d85a30" stroke-width="2" stroke-dasharray="6 4"/>',
  '  <path d="M200 40 250 90" stroke="#888" stroke-dasharray="3 3"/>',
  '</svg>',
].join(''))
fs.writeFileSync(htmlPath, [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  'body{font-family:system-ui;margin:24px;background:#fdf8f0;color:#2b2b2b}',
  '.bar{height:14px;border-radius:7px;background:#185fa5;animation:grow 1.2s ease-in-out infinite alternate;transform-origin:left}',
  '@keyframes grow{from{transform:scaleX(.35)}to{transform:scaleX(1)}}',
  '</style></head><body>',
  '<h3>第一幕 · 情绪爬升</h3>',
  '<div class="bar" style="width:96%"></div><div class="bar" style="width:78%;background:#d85a30"></div>',
  '<p>旁白先入 · 第三拍给特写 · 转场用声音扛</p>',
  '</body></html>',
].join(''))

const nodes = [
  {
    id: 'artifact-svg-1',
    kind: 'agent-artifact',
    title: '构图线稿 · 站位参考',
    categoryId: 'shots',
    position: { x: 160, y: 120 },
    meta: { artifact: { fileType: 'svg', url: `nomi-local://asset/${projectId}/assets/generated/composition-guide.svg` } },
  },
  {
    id: 'artifact-html-1',
    kind: 'agent-artifact',
    title: '开场节奏讲解',
    categoryId: 'shots',
    position: { x: 640, y: 120 },
    meta: { artifact: { fileType: 'html', url: `nomi-local://asset/${projectId}/assets/generated/opening-beats.html` } },
  },
]
const project = {
  id: projectId, name: 'Agent 手艺产物走查', version: 1, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: { version: 1, title: 'Agent 手艺产物走查', updatedAt: 1, contentJson: { type: 'doc', content: [] } },
    timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))

let app
let win
let passed = 0
let failed = 0
const checks = []
function check(label, ok) {
  checks.push({ label, ok })
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.error(`  ✗ ${label}`) }
}
async function shot(name) {
  await screenshotSettled(win, { path: path.join(shotsDir, name) })
  console.log(`  📷 ${name}`)
}
async function dismissFirstRun() {
  for (let i = 0; i < 8; i += 1) {
    const action = win.locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后|关闭/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 600 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(180)
  }
}
async function openProjectCard(name) {
  await dismissFirstRun()
  const card = win.getByText(name, { exact: false }).first()
  await card.waitFor({ timeout: 25000 })
  await card.hover()
  await clickOrFail(win.getByRole('button', { name: /继续创作|打开|开始创作/ }).first(), `打开项目「${name}」`)
  await dismissFirstRun()
}

async function main() {
  const launched = await launchNomiApp({
    name: 'agent-artifact-walk',
    userDataDir,
    settingsDir,
    projectsDir,
    capabilityDir,
    syntheticCredentialStorage: true,
    // 本机受限 shell 环境需关 Chromium 沙箱/GPU 才能拉起 Electron（CI/桌面正常环境可去掉）；
    // 探针实证：缺 --no-sandbox/--disable-gpu 时 GPU/network 子进程 sandbox init 失败直接崩。
    args: ['--no-proxy-server', '--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
  })
  app = launched.app
  win = launched.win
  win.setDefaultTimeout(15000)

  // 打开项目（点击项目库里的卡片；库页可能需略等首帧）
  await openProjectCard('Agent 手艺产物走查')

  // 01 两个 agent-artifact 节点上画布
  try {
    await expectCount(win.locator('.generation-canvas-v2-node[data-kind="agent-artifact"]'), 2, '两个 agent-artifact 节点上画布')
    check('01 两个 agent-artifact 节点上画布', true)
  } catch (error) { check('01 两个 agent-artifact 节点上画布: ' + error.message.split('\n')[0], false) }
  await shot('01-two-artifact-nodes.png')

  // 02 SVG 产物渲染为图（<img> 载入 nomi-local 资产，加载完成）
  const svgImg = win.locator('.generation-canvas-v2-node img[src*="composition-guide.svg"]').first()
  try {
    await svgImg.waitFor({ timeout: 10000 })
    const complete = await svgImg.evaluate((el) => el.complete)
    check('02 SVG 产物以 <img> 渲染且加载完成', complete === true)
  } catch (error) { check('02 SVG 产物渲染: ' + error.message.split('\n')[0], false) }

  // 03 HTML 产物在沙箱 iframe 中渲染（sandbox=allow-scripts，无 allow-same-origin）
  const htmlIframe = win.locator('.generation-canvas-v2-node iframe[src*="opening-beats.html"]').first()
  try {
    await htmlIframe.waitFor({ timeout: 10000 })
    const sandbox = await htmlIframe.evaluate((el) => el.getAttribute('sandbox'))
    check('03 HTML 沙箱 sandbox="allow-scripts"（实际=' + sandbox + '）', sandbox === 'allow-scripts')
    // 宿主应读不到 iframe 内容（非同源隔离生效）；能读到 = 沙箱没隔离（坏）。
    const srcdoc = await htmlIframe.evaluate((el) => {
      try { return (el.contentDocument?.body?.innerText || '').slice(0, 20) } catch { return '<unreadable>' }
    })
    check('04 HTML 内容对宿主跨域不可读（沙箱隔离生效）', srcdoc === '<unreadable>')
  } catch (error) { check('03 HTML 沙箱渲染: ' + error.message.split('\n')[0], false) }
  await shot('02-html-sandbox.png')

  // 05 点选 HTML 节点 → 选中浮条（下载 + 复制）
  try {
    await win.locator('.generation-canvas-v2-node[data-node-id="artifact-html-1"]').first().click({ timeout: 8000 })
    await expectVisible(
      win.locator('[data-node-floating-toolbar="true"] button', { hasText: '下载' }).first(),
      '浮条出现「下载」',
    )
    check('05 选中 HTML 节点 → 浮条出现「下载」', true)
    await expectVisible(
      win.locator('[data-node-floating-toolbar="true"] button', { hasText: '复制' }).first(),
      '浮条出现「复制」',
    )
    check('06 HTML 节点浮条有「复制」（文本类可复制）', true)
  } catch (error) { check('05 选中浮条: ' + error.message.split('\n')[0], false) }
  await shot('03-html-selected-toolbar.png')

  // 07 选中 SVG 节点 → 浮条有下载、无复制（SVG 不可复制为文本）
  try {
    await win.locator('.generation-canvas-v2-node[data-node-id="artifact-svg-1"]').first().click({ timeout: 8000 })
    await expectVisible(
      win.locator('[data-node-floating-toolbar="true"] button', { hasText: '下载' }).first(),
      'SVG 节点浮条「下载」',
    )
    check('07 选中 SVG 节点 → 浮条有「下载」', true)
    const copyCount = await win.locator('[data-node-floating-toolbar="true"] button', { hasText: '复制' }).count()
    check('08 SVG 节点浮条无「复制」（仅 text/md/html 可复制）', copyCount === 0)
  } catch (error) { check('07 SVG 浮条: ' + error.message.split('\n')[0], false) }
  await shot('04-svg-selected-toolbar.png')

  await closeNomiApp(app)
  console.log(`\nagent-artifact 走查：${passed} 过 / ${failed} 败`)
  if (failed > 0) process.exit(1)
  console.log('PASS ✓✓✓')
}

// TODO（P1 · deliver_craft 落地后补第二幕）：
//   Agent 对话 → 交付 SVG/HTML → 资产落盘 → create_nodes(kind:agent-artifact, meta.artifact)
//   → 节点自动落位 → 全链路真实对话走查。闸门参考 agent-real-user-conversation.walk.mjs。
main().catch((error) => {
  console.error('agent-artifact 走查崩溃:', error)
  process.exit(1)
})
