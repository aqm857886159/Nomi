// 图层分离走查（板 docs/design/boards/2026-11-26-layer-split · 设计卡 docs/plan/2026-11-26-layer-split.md ★9）。
// 假 APIMart 下真界面走一遍创作者的路：改图 ▾ → 图层分离（只派生、不发请求）→ 生成框「图层分离 · 30 层 · 自动」+ 发送键约价
// → 打开识别文字 → 发送一次 → 节点下「N 层」→ 画板里看层、拖角等比缩放、删一层后画笔落成新的一层 → 完成出新版；
// 最后断开 APIMart：「图层分离」不灰、第二行点名去接、点了打开 APIMart 的接入页。
// 无真实账号或素材依赖（底图 + 2 层的替身回话见 tests/ux/_mcpL2Fixture.mjs）。
// node tests/ux/layer-split.walk.mjs --out /仓库外目录 [--locale en] [--theme dark]
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { parseDriverArgs } from './uiDriverOptions.mjs'
import { stationTimeout } from './_station-budget.mjs'

const options = parseDriverArgs(['--vendor', 'fake-apimart', ...process.argv.slice(2)])
const out = options.out
const client = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.mjs')
const env = { ...process.env, NOMI_TEST_NETWORK_GUARD: '1', NOMI_UI_DIR: path.join(makeTempDir('nomi-layer-split-walk-'), 'ipc') }
const en = options.locale === 'en'
const L = en
  ? { generate: 'Generate asset', split: 'Split layers', cell: 'Split layers · 30 · Auto', readText: 'Read text', whiteboard: 'Whiteboard', base: 'Base image', del: 'Delete selected element', brushPath: 'Brush path', status: 'Layers 3 · incl. base', guide: 'connect APIMart', disconnect: 'Disconnect' }
  : { generate: '生成素材', split: '图层分离', cell: '图层分离 · 30 层 · 自动', readText: '识别文字', whiteboard: '画板', base: '底图', del: '删除选中元素', brushPath: '画笔路径', status: '3 层', guide: '接入 APIMart', disconnect: '断开' }
fs.mkdirSync(out, { recursive: true })

function ui(...args) {
  const result = spawnSync(process.execPath, [client, ...args], { env, encoding: 'utf8', timeout: 300_000 })
  const text = `${result.stdout || ''}${result.stderr || ''}`.trim()
  fs.appendFileSync(path.join(out, 'client.log'), `${args.join(' ')}\n${text}\n`)
  assert.equal(result.status, 0, `${args.join(' ')}: ${text}`)
  const start = text.indexOf('{')
  return start < 0 ? text : JSON.parse(text.slice(start))
}
const read = (expression) => ui('read', expression).value
const shot = (name) => ui('shot', name)
const visible = (selector) => `!![...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getBoundingClientRect().width > 0 && !e.disabled)`
async function until(expression, label, operations = 2) {
  await expect.poll(() => {
    if (read(visible('[data-spend-confirm-action="confirm"]'))) ui('click', 'css:[data-spend-confirm-action="confirm"]')
    return read(expression)
  }, { message: label, timeout: stationTimeout({ operations }) }).toBe(true)
  console.log(`✓ ${label}`)
}
/** 供应商替身收到的请求（driver 在 doctor 时落盘）。 */
function vendorHits() {
  ui('doctor')
  return JSON.parse(fs.readFileSync(path.join(out, 'vendor-requests.json'), 'utf8'))
}
const nonGet = (hits) => hits.filter((hit) => hit.method !== 'GET')
const projectExpr = 'decodeURIComponent(location.href.match(/projectId=([^&#]+)/)?.[1] || "")'
function readProject() {
  const projectId = read(projectExpr)
  assert.ok(projectId, 'opened project has an identity')
  return read(`window.nomiDesktop.projects.readAsync(${JSON.stringify(projectId)})`)
}
const nodesOf = (project) => project.payload.generationCanvas.nodes
function clickNodeCenter(nodeId) {
  const rect = read(`(() => { const r = document.querySelector('.generation-canvas-v2-node[data-node-id=${JSON.stringify(nodeId)}]')?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : null })()`)
  assert.ok(rect, `node ${nodeId} is on screen`)
  ui('click', `xy:${Math.round(rect[0])},${Math.round(rect[1])}`)
}
const layerRowsExpr = '[...document.querySelectorAll(\'[data-whiteboard-panel="layers"] > div > div\')].map(row => row.querySelector("button")?.textContent?.trim() || "")'
const summaryExpr = '[...document.querySelectorAll("[data-parameter-summary]")].map(e => e.getAttribute("data-parameter-summary"))'

try {
  console.log(ui('up', '--vendor', 'fake-apimart', '--out', out, '--locale', options.locale, '--theme', options.theme, '--size', options.sizeName))
  assert.equal(ui('doctor').doctor.ok, true)

  // ① 先有一张图：图片节点生成一次（替身回一张图）。
  ui('goto', 'canvas-node', 'image')
  ui('fill', 'css:[data-prompt-box] .ProseMirror', '雨后天台，一个人站在栏杆边')
  ui('click', `aria:${L.generate}`)
  await until('!![...document.querySelectorAll(".generation-canvas-v2-node[data-kind=\\"image\\"] .generation-canvas-v2-node__preview img")].find(e => e.complete && e.naturalWidth > 0)', 'source image decodes on node', 4)
  const sourceId = nodesOf(readProject()).find((node) => node.result?.type === 'image')?.id
  assert.ok(sourceId, 'source image node persisted')

  // ② 改图 ▾ → 图层分离：只建好连着原图的新节点，0 个请求。
  const before = { hits: nonGet(vendorHits()).length, nodes: nodesOf(readProject()).length, edges: readProject().payload.generationCanvas.edges.length }
  clickNodeCenter(sourceId)
  ui('click', 'css:[data-toolbar-action-menu="refine"]')
  shot('LS01-refine-menu')
  const entry = read(`(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.includes(${JSON.stringify(L.split)})); return item ? { disabled: item.getAttribute('aria-disabled') === 'true' || item.disabled === true, text: item.textContent } : null })()`)
  assert.ok(entry && !entry.disabled, `「${L.split}」is in the refine menu and enabled: ${JSON.stringify(entry)}`)
  ui('click', `role:menuitem=${L.split}`)
  await until(`document.querySelectorAll('.generation-canvas-v2-node').length === ${before.nodes + 1}`, 'derive adds exactly one node')
  const derivedProject = readProject()
  const derived = nodesOf(derivedProject).find((node) => node.id !== sourceId && !node.result)
  assert.ok(derived, 'derived node persisted without a result')
  assert.equal(derivedProject.payload.generationCanvas.edges.length, before.edges + 1, 'derive adds exactly one edge')
  assert.ok(derivedProject.payload.generationCanvas.edges.some((edge) => edge.source === sourceId && edge.target === derived.id), 'edge links source → derived')
  assert.equal(nonGet(vendorHits()).length, before.hits, 'deriving sends zero non-GET requests (no spend)')
  console.log('✓ derive: 1 node + 1 edge, 0 requests')

  // ③ 生成框：一格「图层分离 · 30 层 · 自动」、发送键带约价。
  clickNodeCenter(derived.id)
  await until(`${summaryExpr}.includes(${JSON.stringify(L.cell)})`, `composer cell reads「${L.cell}」`)
  const sendText = read(`document.querySelector('[aria-label=${JSON.stringify(L.generate)}]')?.closest('[data-composer-host]')?.innerText || ''`)
  assert.match(sendText, /8\.46/, `send key prints the estimate (30 layers × high tier + input image): ${sendText}`)
  shot('LS02-derived-composer')

  // ④ 参数面板：识别文字默认关，打开它。
  ui('click', `css:[data-parameter-summary=${JSON.stringify(L.cell)}]`)
  await until(visible(`[aria-label="${L.readText}"]`), 'params panel shows the read-text switch')
  assert.equal(read(`document.querySelector('[aria-label="${L.readText}"]')?.getAttribute('aria-checked') ?? String(document.querySelector('[aria-label="${L.readText}"]')?.checked)`), 'false', 'read text defaults to off')
  shot('LS03-params-panel')
  ui('click', `css:.mantine-Switch-root:has([aria-label="${L.readText}"]) .mantine-Switch-track`)
  await until(`document.querySelector('[aria-label="${L.readText}"]')?.checked === true`, 'read text switched on')
  ui('press', 'Escape')

  // ⑤ 发送一次：唯一一个拆图 POST，带 max_images 30 与 text_recognition true；节点下出现「3 层」。
  ui('click', `aria:${L.generate}`)
  await until('!!document.querySelector("[data-node-layer-split-status=\\"3\\"]")', `node shows「${L.status}」`, 4)
  const splitPosts = nonGet(vendorHits()).filter((hit) => /"layer_decomposition"\s*:\s*true/.test(hit.body || ''))
  assert.equal(splitPosts.length, 1, 'exactly one layer-split create request')
  const sent = JSON.parse(splitPosts[0].body)
  assert.equal(sent.layer_decomposition_options?.max_images, 30, 'max_images follows the default 30')
  assert.equal(sent.layer_decomposition_options?.text_recognition, true, 'text_recognition follows the switch')
  fs.writeFileSync(path.join(out, 'layer-split-request.json'), JSON.stringify({ method: splitPosts[0].method, url: splitPosts[0].url, body: sent }, null, 2))
  shot('LS04-split-landed')

  // ⑥ 画板：图层面板列出底图与两层；拖「人物」右下角，等比放大。
  const landed = nodesOf(readProject()).find((node) => node.id === derived.id)
  const resultUrl = landed?.result?.url
  const board = landed?.result?.raw?.whiteboardState
  assert.ok(resultUrl && board, 'split result carries its own whiteboard state')
  const person = board.canvasAssets.find((asset) => board.layers.find((layer) => layer.id === asset.layerId)?.name === '人物')
  assert.ok(person, 'the「人物」layer is on the board')
  clickNodeCenter(derived.id)
  ui('click', 'css:[data-toolbar-action="whiteboard-open"]')
  await until(visible('[data-whiteboard-stage]'), 'whiteboard opens', 3)
  ui('click', 'css:[data-toolbar-action="whiteboard-layers"]')
  await until(`${layerRowsExpr}.includes(${JSON.stringify(L.base)})`, `layers panel lists「${L.base}」`)
  const rows = read(layerRowsExpr)
  for (const name of ['人物', '标题文字', L.base]) assert.ok(rows.includes(name), `layers panel lists ${name}: ${rows.join(' / ')}`)
  shot('LS05-board-layers')
  const toScreen = read(`(() => { const r = document.querySelector('[data-whiteboard-stage]').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } })()`)
  const scale = Math.min(toScreen.width / board.canvasDimensions.width, toScreen.height / board.canvasDimensions.height)
  const offX = toScreen.left + (toScreen.width - board.canvasDimensions.width * scale) / 2
  const offY = toScreen.top + (toScreen.height - board.canvasDimensions.height * scale) / 2
  const at = (x, y) => [Math.round(offX + x * scale), Math.round(offY + y * scale)]
  const [cx, cy] = at(person.x + person.width / 2, person.y + person.height / 2)
  ui('click', 'css:[data-toolbar-action="whiteboard-select"]')
  ui('click', `xy:${cx},${cy}`)
  const [bx, by] = at(person.x + person.width, person.y + person.height)
  ui('drag', String(bx), String(by), String(bx + 48), String(by + 20))
  shot('LS06-corner-scaled')

  // ⑦ 删一层（标题文字）后画笔画一笔：必须落成新的一层（e1986afba 修的那一处）。
  ui('click', 'css:[data-toolbar-action="whiteboard-layers"]')
  await until(`${layerRowsExpr}.includes("标题文字")`, 'layers panel open again')
  const rowCount = read(`${layerRowsExpr}.length`)
  const brushRowsExpr = `${layerRowsExpr}.filter(name => name.startsWith(${JSON.stringify(L.brushPath)})).length`
  const brushRows = read(brushRowsExpr)
  ui('click', `css:[data-whiteboard-panel="layers"] > div > div:has(button:text-is("标题文字")) [aria-label="${L.del}"]`)
  await until(`!${layerRowsExpr}.includes("标题文字") && ${layerRowsExpr}.length === ${rowCount - 1}`, 'deleting a layer removes its row')
  ui('click', 'css:[data-toolbar-action="whiteboard-brush"]')
  const [sx, sy] = at(board.canvasDimensions.width * 0.55, board.canvasDimensions.height * 0.2)
  const [ex, ey] = at(board.canvasDimensions.width * 0.8, board.canvasDimensions.height * 0.45)
  ui('drag', String(sx), String(sy), String(ex), String(ey))
  ui('click', 'css:[data-toolbar-action="whiteboard-layers"]')
  await until(`${brushRowsExpr} === ${brushRows + 1} && ${layerRowsExpr}.length === ${rowCount}`, 'a brush stroke after deleting a layer becomes a new layer')
  shot('LS07-delete-then-brush')

  // ⑧ 完成：本节点多一版新图；画板里人物是等比放大后的尺寸，画笔层在。
  ui('press', 'Escape')
  ui('click', 'css:[data-toolbar-action="whiteboard-done"]')
  await until('!document.querySelector("[data-whiteboard-stage]")', 'done closes the whiteboard', 3)
  let saved
  await expect.poll(() => {
    saved = nodesOf(readProject()).find((node) => node.id === derived.id)
    return Boolean(saved?.result?.url && saved.result.url !== resultUrl && saved.meta?.whiteboardState)
  }, { message: 'done lands a new version on the node', timeout: stationTimeout({ operations: 3 }) }).toBe(true)
  const state = saved.meta.whiteboardState
  // 拖角后的尺寸存在场景变换里（sceneTransforms.assetTransforms，画板自己的持久化形状），没有变换才是原尺寸。
  assert.ok(state.canvasAssets.some((asset) => asset.id === person.id), 'the「人物」asset survives')
  const scaled = state.sceneTransforms?.assetTransforms?.[person.id] ?? state.canvasAssets.find((asset) => asset.id === person.id)
  assert.ok(scaled.width > person.width * 1.1, `corner drag enlarged「人物」: ${person.width}×${person.height} → ${scaled.width}×${scaled.height}`)
  assert.ok(Math.abs(scaled.width / scaled.height - person.width / person.height) < 0.03, `corner drag keeps the ratio: ${person.width}×${person.height} → ${scaled.width}×${scaled.height}`)
  assert.ok(!state.layers.some((layer) => layer.name === '标题文字'), 'the deleted layer stays deleted')
  assert.ok(state.layers.some((layer) => layer.name.startsWith(L.brushPath)), 'the brush layer is saved')
  fs.writeFileSync(path.join(out, 'board-after-done.json'), JSON.stringify({ before: person, after: scaled, layers: state.layers.map((layer) => layer.name) }, null, 2))
  console.log(`✓ ratio-locked corner scale ${person.width}×${person.height} → ${scaled.width}×${scaled.height}`)
  shot('LS08-done-new-version')

  // ⑨ 没有能拆图层的模型：断开 APIMart 后，「图层分离」不灰、第二行点名去接，点了打开 APIMart 的接入页。
  ui('goto', 'model-settings')
  ui('click', 'css:[data-model-home-connection="apimart"]')
  ui('click', `css:button:text-is("${L.disconnect}")`)
  await until(visible('[data-confirm-dialog-confirm]'), 'disconnect asks first')
  ui('click', 'css:[data-confirm-dialog-confirm]')
  await until(visible('[data-model-connection-field="apiKey"]'), 'APIMart is disconnected (key field is back)')
  // 设置里按 Esc 先退回模型首页、再关弹窗：按到弹窗没了为止（最多三下）。
  for (let i = 0; i < 3 && read(visible('[role="dialog"]')); i += 1) ui('press', 'Escape')
  await until(`!${visible('[role="dialog"]')}`, 'settings closed')
  clickNodeCenter(sourceId)
  ui('click', 'css:[data-toolbar-action-menu="refine"]')
  await until(`[...document.querySelectorAll('[role="menuitem"]')].some(e => e.textContent.includes(${JSON.stringify(L.guide)}))`, `「${L.split}」second line names the vendor to connect`)
  const guided = read(`(() => { const item = [...document.querySelectorAll('[role="menuitem"]')].find(e => e.textContent.includes(${JSON.stringify(L.split)})); return { disabled: item.getAttribute('aria-disabled') === 'true' || item.disabled === true, text: item.textContent } })()`)
  assert.equal(guided.disabled, false, `「${L.split}」is not greyed without a model: ${guided.text}`)
  shot('LS09-no-model-guide')
  const nodesBeforeGuide = nodesOf(readProject()).length
  ui('click', `role:menuitem=${L.split}`)
  await until(visible('[data-key-only-vendor="apimart"]'), 'the guide opens the APIMart connect page')
  assert.equal(nodesOf(readProject()).length, nodesBeforeGuide, 'the guide derives nothing')
  shot('LS10-guide-opens-apimart')
  assert.equal(ui('doctor').doctor.ok, true)
} finally {
  ui('down')
}
const hits = JSON.parse(fs.readFileSync(path.join(out, 'vendor-requests.json'), 'utf8'))
assert.equal(hits.filter((hit) => hit.method !== 'GET' && /"layer_decomposition"\s*:\s*true/.test(hit.body || '')).length, 1, 'whole walk: one layer-split spend')
const network = fs.readFileSync(path.join(out, 'network.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
assert.equal(network.filter((entry) => entry.kind === 'allowed-request' && !['127.0.0.1', 'localhost', '::1'].includes(new URL(entry.url).hostname)).length, 0, 'zero allowed external requests')
console.log(`✓ layer split: derive → one spend → layers → ratio scale → delete then brush → done → no-model guide; evidence: ${out}`)
