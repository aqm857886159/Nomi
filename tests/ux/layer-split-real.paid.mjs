#!/usr/bin/env node
// 真实付费核对 · 图层分离（APIMart Seedream 5.5）回来的形状（设计卡 docs/plan/2026-11-26-layer-split.md ★9、裁定 C-E10）。
// **只写脚本与免费演练，由协调来跑真付费。**
//
//   pnpm build
//   NOMI_PAID_REHEARSAL=no-key node tests/ux/layer-split-real.paid.mjs   # 免费演练（一分钱不花）
//   NOMI_SPEND_OK=1 node tests/ux/layer-split-real.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 只花**一次**：`seedream-5-5` · 图层分离 · 最多 2 层（含底图，是上限）· 清晰度 1K · 1 张参考图（仓库自带真实 AI 镜头的一帧）。
// 派生走真入口：选中原图 → 改图 ▾ → 图层分离（0 个创建请求）；层数 / 清晰度在花钱前写成 2 / 1K（界面上的调法由
// tests/ux/layer-split.walk.mjs 在假供应商下走过），花钱前核对生成框那一格写的就是「2 层 · 1K」。
// 判据：
//   - 发往 api.apimart.ai 的 POST /v1/images/generations 恰好 1 次；
//   - 请求体 model=seedream-5-5、layer_decomposition=true、layer_decomposition_options.max_images=2、size=1K、
//     不带 background、image_urls 恰好 1 张（已托管上传，非 nomi-local://）；
//   - 真付费时：节点结果带图层分离标记、画板里有底图 + 至少 1 层，结果带供应商任务号，镜头恰好提交 1 次。
// 形状核对材料（C-E10，记进 report.json，由协调对着合成截图判，不是自动判据）：每层文件的像素尺寸与底图比（整幅透明 / 按框裁切）、
// 有无 alpha、在画板上的框、叠放顺序（画板里从下到上）与层名；按张计费看 spend 里的 providerCost。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expectVisible } from './_assert.mjs'
import { SPEND_DIALOG, openPaidWalk, spendReceipt } from './_paidRun.mjs'
import { openCanvas } from './agent-runtime-walk-support.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'
import { canvasFitView, collapseAgentPanel } from './_shell.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { uiText } from './full-walk/invariants.mjs'

const SCRIPT = 'layer-split-real.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, process.env.NOMI_SAMPLES_EVIDENCE || 'docs/evidence/2026-11-26-layer-split/paid-shape')
const APIMART_HOST = 'api.apimart.ai'
const MODEL = { vendorKey: 'apimart', modelKey: 'seedream-5-5' }
const LAYERS = 2
const SIZE = '1K'
const SOURCE_VIDEO = 'video-ai-shot-640x360'
const LANDS_MS = stationTimeout({ turns: 4 })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const paid = await openPaidWalk(SCRIPT, 'layer-split-real', [MODEL], {
  hostedUploads: true,
  recordAllowedBodies: true,
  judgesBodyInRehearsal: true,
  rehearsalShots: 1,
  // 会原样进产物的字面量：线缆的分层参数键、图层分离节点浮条「画板」的说明（这次新加的界面文案）。
  buildMarkers: ['layer_decomposition_options', uiText('zh-CN', 'generationCommon.imageToolbar.whiteboardLayersHint')],
})
const { walk } = paid
const evidence = { script: SCRIPT, startedAt: new Date().toISOString(), model: `${MODEL.vendorKey}/${MODEL.modelKey}`, layers: LAYERS, size: SIZE }
let failure
let projectRootSeen
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await paid.lockToAuthorizedModels(win)
  const { projectId, projectRoot } = await walk.newProject()
  projectRootSeen = projectRoot
  await openCanvas(win)
  await collapseAgentPanel(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })

  // 参考图：仓库自带真实 AI 镜头的一帧（有人物、门框、桌面，拆得出东西）。
  const { assets } = requireRealMediaAssets([SOURCE_VIDEO])
  const assetDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(assetDir, { recursive: true })
  const sourcePng = path.join(assetDir, 'layer-split-source.png')
  execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2', '-i', assets.get(SOURCE_VIDEO).file, '-frames:v', '1', sourcePng], { stdio: 'pipe' })
  const sourceSize = pngSize(sourcePng)

  const sourceId = await win.evaluate(({ url, size }) => {
    const state = window.__nomiCanvasStore.getState()
    const id = state.addNode({ kind: 'image', title: 'layer-split-source.png', prompt: '', position: { x: -520, y: 0 }, meta: { imageWidth: size.width, imageHeight: size.height } }).id
    const result = { id: `${id}-r`, type: 'image', url, createdAt: 1 }
    state.updateNode(id, { status: 'success', result, history: [result] })
    state.selectNode(id)
    return id
  }, { url: `nomi-local://asset/${projectId}/assets/imported/layer-split-source.png`, size: sourceSize })
  await canvasFitView(win, '适应视图露出原图节点')

  const canvasNow = () => win.evaluate(() => {
    const state = window.__nomiCanvasStore.getState()
    return { nodes: state.nodes.map((node) => ({ id: node.id, kind: node.kind, meta: node.meta ?? {}, status: node.status, result: node.result ?? null, runs: node.runs ?? [], prompt: node.prompt ?? '' })), edges: state.edges.map((edge) => ({ source: edge.source, target: edge.target })) }
  })

  // 改图 ▾ → 图层分离：只派生一个连着原图的节点，一个创建请求都不发。
  const createsBeforeDerive = findImageCreates(paid.readAllowedRequests()).length
  await clickOrFail(win.locator('[data-toolbar-action-menu="refine"]').first(), '原图浮条「改图 ▾」')
  await clickOrFail(win.getByRole('menuitem').filter({ hasText: /图层分离|Split layers/ }).first(), '菜单「图层分离」')
  let derivedId = null
  const deriveDeadline = Date.now() + stationTimeout({ operations: 2 })
  while (!derivedId && Date.now() < deriveDeadline) {
    const now = await canvasNow()
    derivedId = now.edges.find((edge) => edge.source === sourceId && now.nodes.some((node) => node.id === edge.target && !node.result))?.target ?? null
    if (!derivedId) await sleep(250)
  }
  if (!derivedId) throw new Error('点「图层分离」后没有派生出连着原图的新节点（一分钱没花）')
  if (findImageCreates(paid.readAllowedRequests()).length !== createsBeforeDerive) throw new Error('派生就发了创建请求（应 0 个）')

  // 花钱前把层数 / 清晰度写成这次要的最小形状（2 层 · 1K）。
  await win.evaluate(({ id, layers, size }) => {
    const state = window.__nomiCanvasStore.getState()
    const node = state.nodes.find((candidate) => candidate.id === id)
    state.updateNode(id, { meta: { ...(node?.meta ?? {}), layer_count: layers, layer_size: size } })
    state.selectNode(id)
  }, { id: derivedId, layers: LAYERS, size: SIZE })
  await canvasFitView(win, '适应视图露出派生的图层分离节点')
  const composer = win.locator(`[data-node-id="${derivedId}"] .generation-canvas-v2-node__composer`).first()
  await expectVisible(composer, '选中派生节点后生成框出现', stationTimeout({ operations: 2 }))

  // 花钱前核对：任意一项不成立当场停，一分钱不花。
  const before = await canvasNow()
  const derived = before.nodes.find((node) => node.id === derivedId)
  const meta = derived?.meta ?? {}
  const summaries = await composer.locator('[data-parameter-summary]').evaluateAll((items) => items.map((item) => item.getAttribute('data-parameter-summary') ?? ''))
  const cell = summaries.find((text) => /图层分离|Split layers/.test(text)) ?? ''
  const problems = []
  if (meta.modelKey !== MODEL.modelKey || meta.modelVendor !== MODEL.vendorKey) problems.push(`模型是 ${meta.modelVendor}/${meta.modelKey}`)
  if (meta.archetype?.modeId !== 'layers') problems.push(`方式是 ${JSON.stringify(meta.archetype?.modeId)}，应是 layers`)
  if (meta.layer_count !== LAYERS) problems.push(`layer_count 是 ${JSON.stringify(meta.layer_count)}，应是 ${LAYERS}`)
  if (meta.layer_size !== SIZE) problems.push(`layer_size 是 ${JSON.stringify(meta.layer_size)}，应是 ${SIZE}`)
  if (!cell.includes(String(LAYERS)) || !cell.includes(SIZE)) problems.push(`生成框那一格写的是 ${JSON.stringify(cell)}，应写 ${LAYERS} 层 · ${SIZE}`)
  if (before.edges.filter((edge) => edge.target === derivedId).length !== 1) problems.push('连进派生节点的边不是恰好 1 条')
  const button = composer.locator('button[data-bar-segment="generate"]').first()
  if (await button.isDisabled()) problems.push('生成钮 ↑ 被禁用')
  evidence.beforeSpend = { cell, sendKeyText: (await composer.innerText()).replace(/\s+/g, ' ').slice(0, 200), sourceSize }
  await walk.snap('before-spend')
  if (problems.length) throw new Error(`花钱前核对没过（一分钱没花）：${problems.join('；')}`)

  const ledgerBefore = paid.readAllowedRequests().length
  await bringButtonIntoReach(win, button, '节点底栏的 ↑')
  await clickOrFail(button, '节点底栏的 ↑（生成）', { noWaitAfter: true })
  const dialog = win.locator(SPEND_DIALOG)
  if (await dialog.first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) }).then(() => true).catch(() => false)) {
    await walk.snap('confirm-dialog')
    await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '确认框「生成」', { noWaitAfter: true })
  }

  const landed = (node) => /^nomi-local:\/\//.test(String(node?.result?.url ?? '')) && Boolean(node?.result?.raw?.layerSplit)
  const nodeNow = async () => (await canvasNow()).nodes.find((node) => node.id === derivedId) ?? null
  const deadline = Date.now() + LANDS_MS
  let done = await nodeNow()
  while (!(landed(done) || done?.status === 'error' || done?.status === 'recoverable') && Date.now() < deadline) {
    if (paid.rehearsal && findImageCreates(paid.readAllowedRequests().slice(ledgerBefore)).length > 0) break
    await sleep(1000)
    done = await nodeNow()
  }

  evidence.request = judgeLedger(paid.readAllowedRequests().slice(ledgerBefore))
  if (paid.rehearsal) {
    if (evidence.request.problems.length) throw new Error(`请求体判据没过：${evidence.request.problems.join('；')}`)
  } else {
    evidence.providerTaskIds = (done?.runs ?? []).map((item) => item?.taskId).filter(Boolean)
    if (!landed(done)) throw new Error(`图层没落到节点上：状态 ${done?.status ?? '（读不到节点）'}，${String(done?.error ?? '').slice(0, 300)}`)
    const board = done.result.raw.whiteboardState
    const keptDir = path.join(walk.report.outputDir, 'layers')
    fs.mkdirSync(keptDir, { recursive: true })
    // 画板里的顺序就是叠放序（从下到上，第 0 行是「背景」，不带图）。
    evidence.shape = {
      mark: done.result.raw.layerSplit,
      board: board?.canvasDimensions ?? null,
      layers: (board?.canvasAssets ?? []).map((asset, order) => {
        const file = resolveLocalAssetFile(projectRoot, projectId, asset.url)
        const info = fs.existsSync(file) ? inspectPng(file) : { missing: true }
        const keptAt = path.join(keptDir, `${String(order).padStart(2, '0')}-${path.basename(file)}`)
        if (!info.missing) fs.copyFileSync(file, keptAt)
        const layer = board.layers.find((candidate) => candidate.id === asset.layerId)
        return { order, name: layer?.name ?? asset.name ?? null, placed: { x: asset.x, y: asset.y, width: asset.width, height: asset.height }, file: info, keptAt: path.relative(REPO_ROOT, keptAt) }
      }),
    }
    const base = evidence.shape.layers[0]?.file
    evidence.shape.layers.forEach((layer) => {
      if (!layer.file?.width || !base?.width) return
      layer.fullCanvas = layer.file.width === base.width && layer.file.height === base.height
    })
    await walk.snap('result-landed')
    const after = [
      ...evidence.request.problems,
      ...((done.runs?.length ?? 0) === 1 ? [] : [`镜头提交了 ${done.runs?.length ?? 0} 次（应恰好 1 次）`]),
      ...(done.result?.taskId ? [] : ['结果没带供应商任务号']),
      ...(evidence.shape.layers.length >= 2 ? [] : [`画板里只有 ${evidence.shape.layers.length} 张图（应是底图 + 至少 1 层）`]),
      ...(evidence.shape.layers.length <= LAYERS ? [] : [`回来 ${evidence.shape.layers.length} 张，超过上限 ${LAYERS}`]),
      ...evidence.shape.layers.filter((layer) => layer.file?.missing).map((layer) => `第 ${layer.order} 张没落盘`),
    ]
    if (after.length) throw new Error(`核对没过：${after.join('；')}`)
  }
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
  const report = {
    ...evidence,
    finishedAt: new Date().toISOString(),
    paidCalls: walk.report.paidCalls ?? null,
    spend: (walk.report.spend?.media ?? []).map(({ taskId, status, model, vendor }) => ({ taskId, status, model, vendor })),
    providerCost: paid.rehearsal ? null : spendReceipt(projectRootSeen).media.map(({ taskId, providerCost }) => ({ taskId, providerCost })),
    result: failure ? 'failed' : 'passed',
    error: failure ? String(failure.message ?? failure).slice(0, 600) : null,
  }
  fs.writeFileSync(path.join(walk.report.outputDir, 'paid-summary.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (!paid.rehearsal) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
}

function findImageCreates(entries) {
  return entries.filter((entry) => entry.kind === 'allowed-request' && entry.host === APIMART_HOST && entry.method === 'POST' && /\/images\/generations$/.test(new URL(entry.url).pathname))
}

function judgeLedger(entries) {
  const creates = findImageCreates(entries)
  let body
  try { body = JSON.parse(String(creates[0]?.body?.text ?? '')) } catch { body = null }
  const problems = []
  if (creates.length !== 1) problems.push(`发往 ${APIMART_HOST} 的图片创建请求有 ${creates.length} 次（应恰好 1 次）`)
  if (!body) problems.push('没读到图片创建请求的请求体')
  else {
    if (body.model !== MODEL.modelKey) problems.push(`model 是 ${JSON.stringify(body.model)}，应是 ${MODEL.modelKey}`)
    if (body.layer_decomposition !== true) problems.push(`layer_decomposition 是 ${JSON.stringify(body.layer_decomposition)}，应是 true`)
    if (body.layer_decomposition_options?.max_images !== LAYERS) problems.push(`max_images 是 ${JSON.stringify(body.layer_decomposition_options?.max_images)}，应是 ${LAYERS}`)
    if (body.size !== SIZE) problems.push(`size 是 ${JSON.stringify(body.size)}，应是 ${SIZE}`)
    if ('background' in body) problems.push('图层分离不能带 background，请求体里带了')
    if (!Array.isArray(body.image_urls) || body.image_urls.length !== 1) problems.push(`image_urls 不是 1 张：${JSON.stringify(body.image_urls)}`)
    else if (/^nomi-local:\/\//.test(String(body.image_urls[0] ?? ''))) problems.push('image_urls 仍是 nomi-local:// 未上传')
  }
  return { problems, createRequests: creates.length, keys: body ? Object.keys(body).sort() : null, model: body?.model ?? null, size: body?.size ?? null, options: body?.layer_decomposition_options ?? null }
}

function resolveLocalAssetFile(projectRoot, projectId, localUrl) {
  const prefix = `nomi-local://asset/${encodeURIComponent(projectId)}/`
  const rel = decodeURIComponent(String(localUrl).slice(prefix.length))
  return path.join(projectRoot, ...rel.split('/'))
}

function pngSize(file) {
  const header = fs.readFileSync(file).subarray(0, 24)
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

function inspectPng(filePath) {
  const buf = fs.readFileSync(filePath)
  const isPng = buf.length > 33 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (!isPng) return { isPng: false, hasAlpha: null, width: null, height: null, bytes: buf.length }
  const colorType = buf[25]
  return { isPng: true, hasAlpha: colorType === 4 || colorType === 6 || buf.includes(Buffer.from('tRNS', 'ascii')), colorType, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length }
}
