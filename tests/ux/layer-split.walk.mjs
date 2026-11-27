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
import { uiText, uiTextPattern, uiTextWith } from './full-walk/invariants.mjs'
import { CANVAS_ZOOM_BAR } from './_shell.mjs'

const options = parseDriverArgs(['--vendor', 'fake-apimart', '--vendor-pending', '3', ...process.argv.slice(2)])
const out = options.out
const client = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.mjs')
const env = { ...process.env, NOMI_TEST_NETWORK_GUARD: '1', NOMI_UI_DIR: path.join(makeTempDir('nomi-layer-split-walk-'), 'ipc') }
const en = options.locale === 'en'
const locale = en ? 'en' : 'zh-CN'
// 界面原话一律按键从词典取（check:test-copy-literals）；只有词典外的拼法（格子三段的连接、状态行）在这里拼。
const T = (key, values) => (values ? uiTextWith(locale, key, values) : uiText(locale, key))
const split = T('generationCommon.quickActions.actions.layerSplit')
const L = {
  generate: T('generationCommon.composer.generateAsset'),
  model: T('generationCommon.parameters.model'),
  split,
  cell: `${split} · ${T('generationCommon.layerSplitComposer.cellLayers', { count: 30 })} · ${T('generationCommon.parameters.auto')}`,
  proCell: `${split} · ${T('generationCommon.layerSplitComposer.cellUpTo', { count: 17 })}`,
  proNote: T('generationCommon.layerSplitComposer.fixedModel', { model: 'Seedream 5.0 Pro', layers: 16 }),
  needImage: T('generationCommon.layerSplitComposer.needImage'),
  disconnectRef: T('assetLibrary.refRow.disconnect'),
  retryRetrieval: T('generationCommon.production.runAction.retry-retrieval'),
  readText: en ? 'Read text' : '识别文字',
  whiteboard: en ? 'Whiteboard' : '画板',
  base: T('generationCommon.whiteboard.baseImage'),
  del: T('generationCommon.whiteboard.deleteSelected'),
  brushPath: T('generationCommon.whiteboard.brushPath').split('{{')[0].trim(), // 「画笔路径 {{index}}」的前缀
  status: T('generationCommon.layerSplitComposer.nodeStatus', { count: 3 }),
  placeholder: T('generationCommon.layerSplitComposer.placeholder'),
  guide: en ? 'connect APIMart' : '接入 APIMart',
  disconnect: en ? 'Disconnect' : '断开',
  boardHint: T('generationCommon.imageToolbar.whiteboardHint'),
  layersHint: T('generationCommon.imageToolbar.whiteboardLayersHint'),
  // 发送键悬停：按层数上限估的那一句（口径 upper-bound）。
  upperBound: new RegExp(uiTextPattern(T('generationCommon.composer.sendCost.upperBound'), { anchored: true })),
}
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
/** 画布上一处点下去只碰到空白画布的点（点它 = 取消选择）。 */
function blankCanvasPoint() {
  const point = read(`(() => { const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect(); if (!pane) return null; for (let y = pane.top + 48; y < pane.bottom - 48; y += 32) for (let x = pane.left + 48; x < pane.right - 48; x += 32) { const hit = document.elementFromPoint(x, y); if (hit && hit.classList.contains('react-flow__pane')) return [Math.round(x), Math.round(y)] } return null })()`)
  assert.ok(point, 'the canvas has a blank point to click')
  return point
}
// 左下缩放簇：百分数读 data-canvas-zoom-percent；− / + 是百分数左右两侧那两颗（外壳位置只经 _shell.mjs 的 CANVAS_ZOOM_BAR）。
const ZOOM_PERCENT = `${CANVAS_ZOOM_BAR} [data-canvas-zoom-percent]`
const zoomPercent = () => Number.parseFloat(read(`document.querySelector(${JSON.stringify(ZOOM_PERCENT)})?.textContent || "NaN"`))
const zoomOutButton = `css:${CANVAS_ZOOM_BAR} span:has(+ [data-canvas-zoom-percent]) button`
const zoomInButton = `css:${ZOOM_PERCENT} + span button`
/**
 * 「N 层」此刻的样子（裁定 C-D12：住在节点上方的标签行）：在不在标签行里、看不看得见、屏幕框和生成框相不相交、
 * 角标中心点下去碰到的是不是生成框。
 */
function statusFace(nodeId) {
  return read(`(() => {
    const badge = document.querySelector('.generation-canvas-v2-node[data-node-id=${JSON.stringify(nodeId)}] [data-node-layer-split-status]')
    const composer = document.querySelector('[data-composer-host]')
    const box = (e) => { const r = e?.getBoundingClientRect(); return r && r.width > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null }
    const b = box(badge), c = box(composer)
    const hit = b ? document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2) : null
    return {
      present: !!badge,
      shown: !!b && getComputedStyle(badge).visibility !== 'hidden',
      inLabelRow: !!badge?.closest('[data-node-label-row]'),
      text: badge?.textContent?.trim() ?? '',
      composerOpen: !!c,
      intersectsComposer: !!b && !!c && !(b.right <= c.left || c.right <= b.left || b.bottom <= c.top || c.bottom <= b.top),
      centerHitsComposer: !!hit?.closest('[data-composer-host]'),
      readyBadge: !!document.querySelector('.generation-canvas-v2-node[data-node-id=${JSON.stringify(nodeId)}] [data-derived-ready-badge]'),
    }
  })()`)
}
const layerRowsExpr = '[...document.querySelectorAll(\'[data-whiteboard-panel="layers"] > div > div\')].map(row => row.querySelector("button")?.textContent?.trim() || "")'
const summaryExpr = '[...document.querySelectorAll("[data-parameter-summary]")].map(e => e.getAttribute("data-parameter-summary"))'

try {
  console.log(ui('up', '--vendor', 'fake-apimart', '--vendor-pending', String(options.vendorPending), '--out', out, '--locale', options.locale, '--theme', options.theme, '--size', options.sizeName))
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
  const whiteboardTitle = () => read('document.querySelector(\'[data-toolbar-action="whiteboard-open"]\')?.getAttribute("title") || ""')
  assert.equal(whiteboardTitle(), L.boardHint, 'an image that was never split keeps today\'s whiteboard hint')
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
  // 板 layers.derived-node：新节点建在原图右边、同一行；右边放得下整张卡时整张都在可见区里（不平移画布，D-0925）。
  // 「放得下」按新节点自己量出来的宽判（D-1115），不按窗宽分档。
  const landing = read(`(() => {
    const rect = (sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width } : null }
    const zoom = Number((document.querySelector('.react-flow__viewport')?.style.transform.match(/scale\\(([^)]+)\\)/) || [])[1] || 1)
    return { source: rect('.generation-canvas-v2-node[data-node-id=${JSON.stringify(sourceId)}]'), derived: rect('.generation-canvas-v2-node[data-node-id=${JSON.stringify(derived.id)}]'), stage: rect('.react-flow'), zoom, window: [innerWidth, innerHeight] }
  })()`)
  fs.writeFileSync(path.join(out, 'derived-landing.json'), JSON.stringify(landing, null, 2))
  assert.ok(landing.derived.left >= landing.source.right - 1 && Math.abs(landing.derived.top - landing.source.top) <= 2, `derived node lands right of the source on the same row: ${JSON.stringify(landing)}`)
  const fitsRight = landing.source.right + 64 * landing.zoom + landing.derived.width <= landing.stage.right
  const fullyInView = landing.derived.left >= landing.stage.left && landing.derived.right <= landing.stage.right && landing.derived.top >= landing.stage.top && landing.derived.bottom <= landing.stage.bottom
  assert.ok(!fitsRight || fullyInView, `derived node that fits on the right is fully in view: ${JSON.stringify(landing)}`)
  console.log(`✓ derived node lands right of the source (${landing.window.join('×')}, zoom ${landing.zoom}, ${fullyInView ? 'fully in view' : 'right side wider than the view'})`)
  shot('LS01b-derived-landed')
  if ((landing.derived.left + landing.derived.right) / 2 > landing.stage.right) {
    // 右边装不下、新节点中心落在可见区外：落点规则是不挪画布、在边缘提示（09-25），创作者点提示过去。
    await until(visible('[data-canvas-arrival-hint="right"]'), 'an off-view derived node gets the「new node on the right」edge hint')
    shot('LS01c-arrival-hint')
    ui('click', 'css:[data-canvas-arrival-hint="right"]')
    await until(`(() => { const r = document.querySelector('.generation-canvas-v2-node[data-node-id=${JSON.stringify(derived.id)}]')?.getBoundingClientRect(); const s = document.querySelector('.react-flow').getBoundingClientRect(); return !!r && r.left >= s.left && r.right <= s.right })()`, 'the edge hint brings the derived node into view', 3)
  }

  // ③ 生成框：一格「图层分离 · 30 层 · 自动」、发送键带约价。
  clickNodeCenter(derived.id)
  await until(`${summaryExpr}.includes(${JSON.stringify(L.cell)})`, `composer cell reads「${L.cell}」`)
  const sendText = read(`document.querySelector('[aria-label=${JSON.stringify(L.generate)}]')?.closest('[data-composer-host]')?.innerText || ''`)
  // 板 layers.send-price：硬币 +「≤数」（按层数上限预扣，出完按实际层数结算）；悬停是上限那一句。
  assert.match(sendText, /≤\s*8\.46/, `send key prints the upper-bound estimate (30 layers × high tier + input image): ${sendText}`)
  const sendHover = read(`document.querySelector('[aria-label=${JSON.stringify(L.generate)}]')?.getAttribute('aria-description') || ''`)
  assert.match(sendHover, L.upperBound, `send key hover explains the layer-limit estimate: ${sendHover}`)
  // 板 layers.prompt-placeholder：提示词可空——空框里是图层分离那一句占位，发送键照样亮。
  const promptFace = read(`(() => { const host = document.querySelector('[aria-label=${JSON.stringify(L.generate)}]')?.closest('[data-composer-host]'); const p = host?.querySelector('.ProseMirror p[data-placeholder]'); return { placeholder: p?.getAttribute('data-placeholder') ?? null, empty: !(host?.querySelector('.ProseMirror')?.textContent || '').trim(), sendDisabled: host?.querySelector('[aria-label=${JSON.stringify(L.generate)}]')?.disabled ?? null } })()`)
  assert.equal(promptFace.placeholder, L.placeholder, `prompt box shows the layer-split placeholder: ${JSON.stringify(promptFace)}`)
  assert.ok(promptFace.empty && promptFace.sendDisabled === false, `an empty prompt still lets the send key go: ${JSON.stringify(promptFace)}`)
  console.log(`✓ prompt placeholder「${promptFace.placeholder}」, send enabled with an empty prompt`)
  shot('LS02-derived-composer')

  // ③b 板 layers.no-image-hint：0 张图（参考被拿掉）时发送键禁用、约价照印，悬停先说缺图原因再说上限约价。
  ui('click', `css:[data-composer-host] [aria-label=${JSON.stringify(L.disconnectRef)}]`)
  await until(`document.querySelector('[aria-label=${JSON.stringify(L.generate)}]')?.disabled === true`, '0 images disables send')
  const noImagePrice = read('document.querySelector(\'[data-board="layers.send-price"]\')?.innerText || ""')
  assert.match(noImagePrice, /≤\s*8\.46/, `0 images keeps the upper-bound estimate on the send pill: ${noImagePrice}`)
  ui('hover', 'css:[data-composer-host] [data-send-cost-trigger]')
  await until(visible('[data-board="layers.no-image-hint"]'), '0 images disables send and hover shows the missing-image reason with upper-bound cost')
  const noImageLines = read('(() => { const el = document.querySelector(\'[data-board="layers.no-image-hint"]\'); return el ? [...el.querySelectorAll(\':scope > span:not([role="tooltip"])\')].map(s => (s.textContent || "").trim()).filter(Boolean) : [] })()')
  assert.equal(noImageLines[0], L.needImage, `hover first line states the missing-image reason: ${JSON.stringify(noImageLines)}`)
  assert.match(noImageLines.slice(1).join(en ? ' ' : ''), L.upperBound, `hover second line states the upper-bound cost: ${JSON.stringify(noImageLines)}`)
  shot('LS02b-no-image-hint')
  ui('move', '12', '12')
  ui('click', 'css:[data-composer-host] [data-reference-entry="true"]')
  clickNodeCenter(sourceId)
  clickNodeCenter(derived.id)
  await until(`document.querySelector('[aria-label=${JSON.stringify(L.generate)}]')?.disabled === false`, 'reconnecting the source image re-enables send')

  // ③c 板 layers.pro-fixed：换成 Seedream 5.0 Pro 时渲染「图层分离 · 最多 17 层」静态格，点击不打开参数面板。
  ui('click', `css:[data-composer-host] [aria-label=${JSON.stringify(L.model)}]`)
  ui('click', 'role:option=Seedream 5.0 Pro')
  await until(`document.querySelector('[data-board="layers.pro-fixed"][data-parameter-summary-static="true"]')?.getAttribute('data-parameter-summary') === ${JSON.stringify(L.proCell)}`, 'Seedream 5.0 Pro renders a static up-to-17 cell that does not open the parameter panel')
  const proComposerText = read('document.querySelector("[data-composer-host]")?.innerText || ""')
  assert.ok(proComposerText.includes(L.proNote), `Seedream 5.0 Pro composer note explains fixed layers: ${proComposerText}`)
  ui('click', 'css:[data-board="layers.pro-fixed"]')
  assert.equal(read('!!document.querySelector(\'[data-agent-parameter-panel="true"]\')'), false, 'clicking the Seedream 5.0 Pro static cell does not open the parameter panel')
  shot('LS02c-pro-fixed')
  ui('click', `css:[data-composer-host] [aria-label=${JSON.stringify(L.model)}]`)
  ui('click', 'role:option=Seedream 5.5')
  await until(`${summaryExpr}.includes(${JSON.stringify(L.cell)})`, 'switching back to Seedream 5.5 restores the editable 30-layer cell')

  // ④ 参数面板：识别文字默认关，打开它。
  ui('click', `css:[data-parameter-summary=${JSON.stringify(L.cell)}]`)
  await until(visible(`[aria-label="${L.readText}"]`), 'params panel shows the read-text switch')
  assert.equal(read(`document.querySelector('[aria-label="${L.readText}"]')?.getAttribute('aria-checked') ?? String(document.querySelector('[aria-label="${L.readText}"]')?.checked)`), 'false', 'read text defaults to off')
  shot('LS03-params-panel')
  ui('click', `css:.mantine-Switch-root:has([aria-label="${L.readText}"]) .mantine-Switch-track`)
  await until(`document.querySelector('[aria-label="${L.readText}"]')?.checked === true`, 'read text switched on')
  ui('press', 'Escape')

  // ⑤ 发送一次 → 板 layers.running 等待面（未出「N 层」）→ 关窗冷重启找回：全程唯一一个拆图 POST（重启找回 +0 POST），落成可编辑画板。
  const openedProjectId = read(projectExpr)
  const pidBeforeRestart = ui('doctor').doctor.ours.appPid
  ui('click', `aria:${L.generate}`)
  await until(
    `!!document.querySelector('.generation-canvas-v2-node[data-node-id=${JSON.stringify(derived.id)}] [data-board="layers.running"]') && !document.querySelector('.generation-canvas-v2-node[data-node-id=${JSON.stringify(derived.id)}] [data-node-layer-split-status]')`,
    'in-flight layer split shows the waiting surface without prematurely rendering the layer-count badge',
    2,
  )
  shot('LS03b-running')
  const splitPostsBeforeRestart = nonGet(vendorHits()).filter((hit) => /"layer_decomposition"\s*:\s*true/.test(hit.body || '')).length
  assert.equal(splitPostsBeforeRestart, 1, 'one layer-split POST sent before cold restart')
  const restarted = ui('restart')
  assert.ok(restarted.appPid && restarted.appPid !== pidBeforeRestart, `cold restart launched a fresh Electron process (${pidBeforeRestart} → ${restarted.appPid})`)
  await until(visible(`[data-project-card][data-project-id=${JSON.stringify(openedProjectId)}]`), 'project card visible in library after cold restart')
  ui('click', `css:[data-project-card][data-project-id=${JSON.stringify(openedProjectId)}]`)
  ui('goto', 'agent-collapsed')
  ui('goto', 'canvas')
  await expect.poll(() => {
    const retrySel = `.generation-canvas-v2-node[data-node-id=${JSON.stringify(derived.id)}] [aria-label=${JSON.stringify(L.retryRetrieval)}]`
    if (read(visible(retrySel))) ui('click', `css:${retrySel}`)
    return read(`!!document.querySelector('.generation-canvas-v2-node[data-node-id=${JSON.stringify(derived.id)}] [data-node-layer-split-status="3"]')`)
  }, { message: `recovered layer-split node shows「${L.status}」after cold restart`, timeout: stationTimeout({ operations: 5 }) }).toBe(true)
  console.log(`✓ cold restart recovery landed「${L.status}」(+0 extra POST)`)
  clickNodeCenter(derived.id)
  await until('!!document.querySelector("[data-composer-host]")', 're-selecting the recovered split node opens its composer')
  const splitPosts = nonGet(vendorHits()).filter((hit) => /"layer_decomposition"\s*:\s*true/.test(hit.body || ''))
  assert.equal(splitPosts.length, 1, 'cold restart and recovery sent zero extra layer-split POSTs (still 1 total)')
  const sent = JSON.parse(splitPosts[0].body)
  assert.equal(sent.layer_decomposition_options?.max_images, 30, 'max_images follows the default 30')
  assert.equal(sent.layer_decomposition_options?.text_recognition, true, 'text_recognition follows the switch')
  fs.writeFileSync(path.join(out, 'layer-split-request.json'), JSON.stringify({ method: splitPosts[0].method, url: splitPosts[0].url, body: sent }, null, 2))
  shot('LS04-split-landed')

  // ⑤b 「N 层」在节点上方的标签行（裁定 C-D12）：选中时生成框钉在节点正下方，角标不能被它盖住；
  // 和「已备好 · 未生成」是同一处的前后两态，不同时出现；未选中照样在；缩放 < 40% 随标签行一起隐藏。
  const selectedFace = statusFace(derived.id)
  assert.ok(selectedFace.composerOpen, `the derived node is still selected with its composer open: ${JSON.stringify(selectedFace)}`)
  assert.ok(selectedFace.shown && selectedFace.inLabelRow, `layer status sits in the label row above the node: ${JSON.stringify(selectedFace)}`)
  assert.equal(selectedFace.text, L.status, 'layer status reads the dictionary line')
  assert.ok(!selectedFace.intersectsComposer && !selectedFace.centerHitsComposer, `layer status is not covered by the composer when selected: ${JSON.stringify(selectedFace)}`)
  assert.equal(selectedFace.readyBadge, false, 'layer status and the ready badge never show together')
  console.log(`✓ layer status「${selectedFace.text}」in the label row, clear of the composer`)
  ui('click', `xy:${blankCanvasPoint().join(',')}`)
  await until('!document.querySelector("[data-composer-host]")', 'clicking blank canvas deselects the node')
  const unselectedFace = statusFace(derived.id)
  assert.ok(unselectedFace.shown && unselectedFace.inLabelRow, `layer status stays in the label row when unselected: ${JSON.stringify(unselectedFace)}`)
  shot('LS04b-split-unselected')
  let zoomSteps = 0
  for (; zoomSteps < 12 && !(zoomPercent() < 40); zoomSteps += 1) ui('click', zoomOutButton)
  assert.ok(zoomPercent() < 40, `zoomed out below 40%: ${zoomPercent()}%`)
  const farFace = statusFace(derived.id)
  assert.equal(farFace.shown, false, `layer status hides with the label row below 40% zoom: ${zoomPercent()}% ${JSON.stringify(farFace)}`)
  console.log(`✓ layer status hidden at ${zoomPercent()}%`)
  shot('LS04c-split-far-zoom')
  for (let i = 0; i < zoomSteps; i += 1) ui('click', zoomInButton)
  await until(`Number.parseFloat(document.querySelector(${JSON.stringify(ZOOM_PERCENT)})?.textContent || "0") >= 40`, 'zoom back to where it was')

  // ⑥ 画板：图层面板列出底图与两层；拖「人物」右下角，等比放大。
  const landed = nodesOf(readProject()).find((node) => node.id === derived.id)
  const resultUrl = landed?.result?.url
  const board = landed?.result?.raw?.whiteboardState
  assert.ok(resultUrl && board, 'split result carries its own whiteboard state')
  const person = board.canvasAssets.find((asset) => board.layers.find((layer) => layer.id === asset.layerId)?.name === '人物')
  assert.ok(person, 'the「人物」layer is on the board')
  clickNodeCenter(derived.id)
  assert.equal(whiteboardTitle(), L.layersHint, 'a split node\'s whiteboard hint says it edits the layers')
  console.log(`✓ whiteboard hint: never split「${L.boardHint}」/ split「${L.layersHint}」`)
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
const createPosts = hits.filter((hit) => hit.method === 'POST' && /\/v1\/images\/generations$/.test(hit.url || ''))
const splitCreatePosts = createPosts.filter((hit) => /"layer_decomposition"\s*:\s*true/.test(hit.body || ''))
const sourceCreatePosts = createPosts.filter((hit) => !/"layer_decomposition"\s*:\s*true/.test(hit.body || ''))
assert.equal(sourceCreatePosts.length, 1, 'whole walk: one source-image create POST')
assert.equal(splitCreatePosts.length, 1, 'whole walk: one layer-split create POST (+0 after restart recovery)')
const postSummary = { sourcePosts: sourceCreatePosts.length, splitPosts: splitCreatePosts.length, extraPostsAfterRestart: 0, totalImageCreates: createPosts.length }
fs.writeFileSync(path.join(out, 'post-counts.json'), JSON.stringify(postSummary, null, 2))
console.log(`POST_COUNTS ${JSON.stringify(postSummary)}`)
const network = fs.readFileSync(path.join(out, 'network.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
assert.equal(network.filter((entry) => entry.kind === 'allowed-request' && !['127.0.0.1', 'localhost', '::1'].includes(new URL(entry.url).hostname)).length, 0, 'zero allowed external requests')
console.log(`✓ layer split: derive → 0-image/pro-fixed → running → cold-restart recovery (+0 POST) → layers → ratio scale → delete then brush → done → no-model guide; evidence: ${out}`)
