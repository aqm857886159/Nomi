#!/usr/bin/env node
// 真实用户任务（R13）：**Agent 付费卡生成一段视频 → 片子落进项目 → 在画布上点「下载」存到本地 → 双击能打开吗？**
//
// 0.22.0 的现场：供应商产物地址的 basename 很长（签名段 / 哈希段），落盘时整段名字被截到 90 字，
// 扩展名跟着被截掉，文件落成 `.bin`（合同 docs/fixes/2026-09-26-asset-name-keeps-extension.root-cause.json）。
// App 里嗅字节照样能播；可一出 App 就不认：「下载」存成 `.bin`，Windows 双击打不开，MCP 预览回 octet-stream。
//
// 这条走查把那条路走完并钉住：
//   ① 供应商回一个 148 字的出片地址 → 落进项目的文件以 `.mp4` 结尾（不是 `.bin`），名字在预算内；
//   ② 画布上选中这个视频节点点「下载」→ 另存对话框给的默认名以 `.mp4` 结尾，存下来的就是那段视频；
//   ③ 英文界面重开，同一个按钮（Download）同样存成 `.mp4`。
//
// 零额度 + 碰不到真供应商：远端供应商是 loopback 夹具；另外把被测 App 的公网出口（HTTPS_PROXY）指到本机一个
// **只记账、一律拒绝**的代理——任何请求都到不了公网；从打开画布到走完，打向供应商主机的尝试必须是零条。
// 另存对话框在主进程里换成一个替身，只记下默认名并返回一个临时目录里的路径（原生对话框点不了）。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { panCanvasUntilInside } from './_canvasHit.mjs'
import { FIXTURE_APIMART_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

// 干净装机那一档（内置目录没有价目）：付费卡照样能确认，花费由供应商结算——夹具出站只认回环，一分钱不花。
process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const VIDEO_MODEL = 'kling-v3'
const LONG_NAME = `seedance-output-${'c0ffee'.repeat(22)}.mp4`
const ASK = 'S_LONG_NAME：夜雨里的霓虹街角，做成视频。'
const PLAN_CALL = 's-long-name-1'
const GENERATE_CALL = `${PLAN_CALL}-generate`

/** 公网出口的「黑洞」代理：记下每一次想出去的请求（CONNECT 与明文），一律拒绝。 */
async function startEgressSink() {
  const attempts = []
  const record = (method, request) => attempts.push({
    method, target: request.url, at: new Date().toISOString(), agent: request.headers['user-agent'] ?? null,
  })
  const server = http.createServer((request, response) => {
    record(request.method, request)
    response.writeHead(403).end('walk: public egress is not allowed')
  })
  server.on('connect', (request, socket) => {
    record('CONNECT', request)
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { attempts, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

/** 目录里每一家供应商的主机名（baseUrlHint + mapping 里写死的绝对地址）。回环地址不算。 */
function vendorHostsOf(catalogPath) {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const hosts = new Set()
  const add = (value) => {
    try {
      const host = new URL(String(value)).hostname
      if (host && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) hosts.add(host)
    } catch { /* not a URL */ }
  }
  for (const vendor of catalog.vendors ?? []) add(vendor.baseUrlHint)
  for (const match of JSON.stringify(catalog.mappings ?? []).matchAll(/https?:\/\/[^"\s\\]+/g)) add(match[0])
  return hosts
}

/** 代理日志里的目标（CONNECT 是 host:port，明文请求是完整 URL）→ 主机名。 */
function hostOf(target) {
  const value = String(target || '')
  if (/^https?:\/\//i.test(value)) {
    try { return new URL(value).hostname } catch { return value }
  }
  return value.replace(/:\d+$/, '')
}

function readRun(projectRoot, runId) {
  const snapshot = path.join(projectRoot, '.nomi', 'runs', runId, 'run.json')
  if (!fs.existsSync(snapshot)) return null
  return JSON.parse(fs.readFileSync(snapshot, 'utf8')).run
}

/** 主进程里的另存对话框替身：记下默认名，返回临时目录里的同名路径（真正的写盘仍由 downloadAssetToDisk 自己做）。 */
async function stubSaveDialog(app, directory) {
  await app.evaluate(({ dialog }, dir) => {
    globalThis.__walkSaveDialog = []
    dialog.showSaveDialog = async (...args) => {
      const options = args.find((arg) => arg && typeof arg === 'object' && 'defaultPath' in arg) ?? {}
      const name = String(options.defaultPath || '').split(/[\\/]/).pop()
      globalThis.__walkSaveDialog.push(name)
      return { canceled: false, filePath: `${dir}/${name}` }
    }
  }, directory)
}

async function downloadThroughNode(app, win, nodeId, label) {
  const before = (await app.evaluate(() => globalThis.__walkSaveDialog?.length ?? 0))
  await clickOrFail(win.locator(`[data-node-id="${nodeId}"]`), '选中视频节点', { position: { x: 40, y: 40 } })
  // 打开项目时画布会摆一次全貌，节点可能贴着舞台上沿，它头顶的浮条（下载在这里）一截钻进顶栏底下。
  // 画布不替人挪（2026-09-25 拍板），人会自己把它拖下来——走查照做（panCanvasUntilInside，中键拖），拖不进就红。
  const toolbarPan = await panCanvasUntilInside(win, win.locator(`[data-node-id="${nodeId}"] [data-node-floating-toolbar="true"]`))
  expect(toolbarPan.ok, `像用户一样把节点浮条拖进舞台：${JSON.stringify(toolbarPan)}`).toBe(true)
  await clickOrFail(win.getByRole('button', { name: label, exact: true }), `节点浮条上的「${label}」`)
  await expect.poll(() => app.evaluate(() => globalThis.__walkSaveDialog?.length ?? 0), {
    message: `点「${label}」之后弹了另存对话框`, timeout: DEFAULT_TIMEOUT_MS,
  }).toBe(before + 1)
  return app.evaluate((_electron, index) => globalThis.__walkSaveDialog[index], before)
}

const sink = await startEgressSink()
const egressEnv = {
  HTTPS_PROXY: sink.url, HTTP_PROXY: sink.url, ALL_PROXY: sink.url,
  https_proxy: sink.url, http_proxy: sink.url, all_proxy: sink.url,
  NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
}
const walk = await createRuntimeWalk('spend-long-output-name', {
  generationProvider: 'apimart',
  videoResultPath: `/fixture/${LONG_NAME}`,
  env: egressEnv,
})
const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-walk-downloads-'))
let failure
/** 每一步的时刻：公网尝试（黑洞代理那边带时间）要能对上是哪一步惹出来的。 */
const steps = []
const mark = (label) => steps.push({ label, at: new Date().toISOString() })
try {
  const { app, win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  const projectRoot = walk.report.projectRoot
  await openCanvas(win)
  await stubSaveDialog(app, saveDir)
  mark('canvas-open')

  const planner = walk.fixture.expectText({
    label: 'the agent drafts one video shot',
    match: (body) => flattenRequestText(body).includes('S_LONG_NAME'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'draft_shots', args: {
      shots: [{ title: '镜头 1', prompt: '夜雨里的霓虹街角，积水倒影', taskKind: 'text_to_video', candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: VIDEO_MODEL } }],
    } },
  })
  let operationId
  const draftDone = walk.fixture.expectText({
    label: 'the draft result carries the host operationId',
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL)
      if (!result) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'hold' },
  })
  const generateDone = walk.fixture.expectText({
    label: 'generate returns once the user approved the card',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === GENERATE_CALL),
    reply: { type: 'text', text: 'S_LONG_NAME_DONE：已经开始生成。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'video draft request')
  await recorded(draftDone.received, 'video draft result')
  draftDone.release({ type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } })

  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.filter((node) => node.kind === 'video').length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const nodeId = (await readProject(win, projectId)).payload.generationCanvas.nodes.find((node) => node.kind === 'video').id
  const node = win.locator(`[data-node-id="${nodeId}"]`)

  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await expect(card, '付费卡在 Agent 面板里等着').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  mark('card-confirm')
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '付费卡上的主按钮', { noWaitAfter: true })
  await expect.poll(() => walk.fixture.videos.length, { message: '确认之后供应商真的收到了视频生成请求', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  await recorded(generateDone.received, 'generate returned after approval')
  mark('provider-finished')
  walk.fixture.releaseVideos()
  await expect(node, '供应商一出片，节点就变成结果').toHaveAttribute('data-status', 'success', { timeout: stationTimeout({ operations: 4 }) })

  // ── ① 落盘名：148 字的出片地址 → 以 .mp4 结尾、名字在预算内 ─────────────────────────
  const run = readRun(projectRoot, operationId)
  const artifact = run?.artifacts.find((item) => item.kind === 'video' && item.status !== 'rejected')
  const relativePath = String(artifact?.projectRelativePath || '')
  walk.report.storedRelativePath = relativePath
  expect(relativePath, '长出片地址落进项目的文件以 .mp4 结尾（0.22.0 是 .bin）').toMatch(/\.mp4$/)
  expect(path.posix.basename(relativePath).length, '落盘名在预算内（主干 ≤ 90 − 扩展名，外加 25 位物化键）').toBeLessThanOrEqual(115)
  expect(fs.statSync(path.join(projectRoot, relativePath)).size, '落盘的是那段真视频的字节').toBeGreaterThan(100_000)
  // 节点先在屏上变成「成功」，项目文件稍后才落盘（保存有防抖）——读盘要轮询到它真写下来，别一次采样。
  const landedUrl = async () => String((await readProject(win, projectId)).payload.generationCanvas.nodes.find((item) => item.id === nodeId)?.result?.url || '')
  await expect.poll(landedUrl, { message: '节点结果地址同样以 .mp4 结尾', timeout: DEFAULT_TIMEOUT_MS }).toMatch(/\.mp4$/)
  await walk.snap('long-output-landed-zh')

  // ── ② 画布「下载」→ 默认名以 .mp4 结尾，存下来的就是那段视频 ─────────────────────────
  mark('landed')
  const zhName = await downloadThroughNode(app, win, nodeId, '下载')
  mark('downloaded-zh')
  walk.report.downloadNameZh = zhName
  expect(zhName, '另存对话框的默认名以 .mp4 结尾（0.22.0 是 .bin）').toMatch(/\.mp4$/)
  await expect.poll(() => fs.existsSync(path.join(saveDir, zhName)) ? fs.statSync(path.join(saveDir, zhName)).size : 0, {
    message: '存到本地的文件就是那段视频', timeout: DEFAULT_TIMEOUT_MS,
  }).toBe(fs.statSync(path.join(projectRoot, relativePath)).size)
  await walk.snap('long-output-downloaded-zh')

  // ── ③ 英文重开：Download 同样存成 .mp4 ───────────────────────────────────────────
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await expect(win.locator(`[data-node-id="${nodeId}"]`), 'EN · 重开之后节点仍是结果').toHaveAttribute('data-status', 'success', { timeout: DEFAULT_TIMEOUT_MS })
  mark('reloaded-en')
  const enName = await downloadThroughNode(app, win, nodeId, 'Download')
  mark('downloaded-en')
  walk.report.downloadNameEn = enName
  expect(enName, 'EN · 默认名以 .mp4 结尾').toMatch(/\.mp4$/)
  await walk.snap('long-output-downloaded-en')

  // ── 碰不到真供应商 ──────────────────────────────────────────────────────────────────
  // 公网出口整体都被黑洞接走，任何请求都到不了公网（这是「碰不到」的保证）。这里再核一遍：
  // 从打开画布到走完，**没有任何一条**请求想去供应商主机——有就说明生成 / 落盘 / 下载某条路没走夹具口子。
  // 启动那一刻的 GET /models（`startCatalogReconciliation` 对有钥匙的文本供应商做的零额度对账，
  // 夹具目录里内置 APIMart 带着夹具钥匙）不属于这条任务，照实记进报告、同样被黑洞拒掉。
  const vendorHosts = vendorHostsOf(path.join(walk.report.tempRoot, 'settings', 'model-catalog.json'))
  const vendorAttempts = sink.attempts.filter((attempt) => vendorHosts.has(hostOf(attempt.target)))
  const taskStart = steps.find((step) => step.label === 'canvas-open')?.at ?? ''
  walk.report.vendorEgressAtStartup = vendorAttempts.filter((attempt) => attempt.at < taskStart)
  walk.report.vendorEgressDuringTask = vendorAttempts.filter((attempt) => attempt.at >= taskStart)
  expect(vendorHosts.has('api.apimart.ai'), '供应商主机清单是真读出来的（含 APIMart）').toBe(true)
  expect(walk.report.vendorEgressDuringTask, '生成 → 落盘 → 下载整条路上没有任何请求想去供应商').toEqual([])

  walk.report.verified = [
    'long-provider-url-basename-lands-as-mp4',
    'canvas-download-suggests-and-saves-mp4-zh',
    'canvas-download-suggests-mp4-en',
    'no-vendor-request-during-the-task-and-no-public-egress-possible',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.report.publicEgressAttempts = sink.attempts
  walk.report.steps = steps
  await walk.finish(failure)
  await sink.close()
  fs.rmSync(saveDir, { recursive: true, force: true })
}
