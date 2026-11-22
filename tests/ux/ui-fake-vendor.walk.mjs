// 共享驱动的目标走查：真界面生成、打开图/视频、读回落盘、退出后端口关闭。
// 无真实账号或素材依赖；顶层 .walk.mjs 按现有清单进入夜跑。
// node tests/ux/ui-fake-vendor.walk.mjs --out /仓库外目录 [--locale en]
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { parseDriverArgs } from './uiDriverOptions.mjs'
import { stationTimeout } from './_station-budget.mjs'

const options = parseDriverArgs(['--vendor', 'fake-apimart', '--vendor-pending', '1', ...process.argv.slice(2)])
const out = options.out
const client = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.mjs')
const env = { ...process.env, NOMI_TEST_NETWORK_GUARD: '1', NOMI_UI_DIR: path.join(makeTempDir('nomi-fake-vendor-walk-'), 'ipc') }
const en = options.locale === 'en'
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
const imageReady = (selector) => `!![...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.complete && e.naturalWidth > 0)`
const videoReady = (selector) => `!![...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.readyState >= 2 && e.videoWidth > 0 && e.duration > 0 && !e.error)`
async function generated(expression, label) {
  await expect.poll(() => {
    if (read(visible('[data-spend-confirm-action="confirm"]'))) ui('click', 'css:[data-spend-confirm-action="confirm"]')
    return read(expression)
  }, { message: label, timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  console.log(`✓ ${label}`)
}
function portOpen(origin) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(new URL(origin).port) })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', (error) => error.code === 'ECONNREFUSED' ? resolve(false) : reject(error))
  })
}

let origin
try {
  console.log(ui('up', '--vendor', 'fake-apimart', '--vendor-pending', String(options.vendorPending), '--out', out, '--locale', options.locale, '--theme', options.theme, '--size', options.sizeName))
  const doctor = ui('doctor').doctor
  assert.equal(doctor.ok, true)
  origin = doctor.fakeVendor?.origin
  assert.ok(origin && new URL(origin).hostname === '127.0.0.1', 'doctor must identify the loopback vendor')
  assert.equal(await portOpen(origin), true)
  const features = ui('features').features
  assert.ok(features['canvas-node'] && features.storyboard)
  ui('goto', 'model-settings')
  await generated(visible('[data-model-home-connected] [data-model-home-connection="apimart"], [data-model-home-connected] [data-model-home-available="apimart"]'), 'APIMart appears in connected suppliers')
  shot('vendor-connected')

  for (const kind of ['image', 'video']) {
    ui('goto', 'canvas-node', kind)
    ui('fill', 'css:[data-prompt-box] .ProseMirror', `FAKE_VENDOR_${kind}: 雨后天台，固定镜头`)
    ui('click', `aria:${en ? 'Model' : '模型'}`)
    ui('click', `role:option=${kind === 'image' ? 'GPT Image 2' : 'Seedance 2.0'}`)
    shot(`canvas-${kind}-before`)
    ui('click', `aria:${en ? 'Generate asset' : '生成素材'}`)
    const selector = `.generation-canvas-v2-node[data-kind="${kind}"] ${kind === 'image' ? '.generation-canvas-v2-node__preview img' : 'video'}`
    await generated(kind === 'image' ? imageReady(selector) : videoReady(selector), `canvas ${kind} decodes on node`)
    ui('click', `aria:${en ? `Preview ${kind} fullscreen` : `全屏预览${kind === 'image' ? '图片' : '视频'}`}`)
    await generated(kind === 'image' ? imageReady('[role="dialog"] img') : videoReady('[role="dialog"] video'), `canvas ${kind} opens in preview`)
    shot(`canvas-${kind}-opened`)
    ui('press', 'Escape')
  }

  ui('goto', 'storyboard')
  ui('fill', 'css:[data-storyboard-row="1"] [contenteditable="true"]', 'FAKE_VENDOR_storyboard: 海边的白色灯塔')
  ui('click', `aria:${en ? 'Model' : '模型'}`)
  ui('click', 'role:option=GPT Image 2')
  shot('storyboard-before')
  ui('click', `aria:${en ? 'Generate shot 1' : '生成镜 1'}`)
  await generated(imageReady('[data-storyboard-row="1"] [data-storyboard-frame="done"] img'), 'storyboard shot 1 image decodes')
  shot('storyboard-generated')
  const projectId = read('decodeURIComponent(location.href.match(/projectId=([^&#]+)/)?.[1] || "")')
  assert.ok(projectId, 'opened project has an identity')
  const persisted = read(`window.nomiDesktop.projects.readAsync(${JSON.stringify(projectId)})`)
  fs.writeFileSync(path.join(out, 'project-readback.json'), JSON.stringify(persisted, null, 2))
  for (const kind of ['image', 'video']) assert.ok(persisted.payload.generationCanvas.nodes.some(node => node.result?.type === kind && node.result.url), `${kind} persisted on node`)
  assert.ok(persisted.payload.generationCanvas.nodes.some(node => node.meta?.shotId === 'shot-1' && node.prompt.includes('FAKE_VENDOR_storyboard') && node.result?.type === 'image' && node.result.url), 'storyboard shot 1 image persisted with its shot identity')
  ui('goto', 'canvas-node', 'image')
  ui('goto', 'storyboard')
  await generated(imageReady('[data-storyboard-row="1"] [data-storyboard-frame="done"] img'), 'storyboard image survives reopening')
  shot('storyboard-reopened')
  fs.writeFileSync(path.join(out, 'project-after-reopen.json'), JSON.stringify(read(`window.nomiDesktop.projects.readAsync(${JSON.stringify(projectId)})`), null, 2))
  fs.writeFileSync(path.join(out, 'storyboard-prompt-after-reopen.json'), JSON.stringify({ text: read('document.querySelector(\'[data-storyboard-row="1"] [contenteditable="true"]\')?.textContent') }))
  assert.equal(ui('doctor').doctor.ok, true)
} finally {
  ui('down')
  if (origin) assert.equal(await portOpen(origin), false, 'down must close the fake vendor port')
}
const hits = JSON.parse(fs.readFileSync(path.join(out, 'vendor-requests.json'), 'utf8'))
for (const kind of ['image', 'video', 'storyboard']) {
  assert.ok(hits.some(hit => hit.method === 'POST' && /\/generations$/.test(hit.url) && hit.body.includes(`FAKE_VENDOR_${kind}`)), `${kind} request reached fake vendor`)
}
assert.ok(hits.some(hit => hit.url === '/fixture/video.mp4'), 'real MP4 downloaded')
const polls = hits.filter(hit => hit.url.startsWith('/v1/tasks/'))
const taskUrls = [...new Set(polls.map(hit => hit.url))]
assert.equal(taskUrls.length, 3, 'three separate tasks were polled')
for (const url of taskUrls) assert.ok(polls.filter(hit => hit.url === url).length >= options.vendorPending + 1, 'each task went through the requested pending polls')
const network = fs.readFileSync(path.join(out, 'network.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
const guard = network.find(entry => entry.kind === 'guard-loaded')
for (const layer of ['fetch', 'http', 'https', 'socket', 'chromium']) assert.ok(guard?.layers.includes(layer), `${layer} network guard actually loaded`)
assert.equal(network.filter(entry => entry.kind === 'guard-error').length, 0, 'no missing network guard layer')
assert.equal(network.filter(entry => entry.kind === 'allowed-request' && !['127.0.0.1', 'localhost', '::1'].includes(new URL(entry.url).hostname)).length, 0, 'zero allowed external requests')
console.log(`✓ canvas image + video + storyboard image + shutdown; evidence: ${out}`)
