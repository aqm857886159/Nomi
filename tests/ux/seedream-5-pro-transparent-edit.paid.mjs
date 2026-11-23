#!/usr/bin/env node
// 真实付费核对 · Seedream 5.0 Pro（APIMart）改图要透明底（#1510 模型档案第一批第三个新模型未核项）。**只写脚本与免费演练，由协调来跑真付费。**
//
//   pnpm build
//   NOMI_PAID_REHEARSAL=no-key node tests/ux/seedream-5-pro-transparent-edit.paid.mjs   # 免费演练（一分钱不花）
//   NOMI_SPEND_OK=1 node tests/ux/seedream-5-pro-transparent-edit.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 只花**一张**图：APIMart `doubao-seedream-5-0-pro` · 改图（edit）· 1K · 1:1 · background=transparent · output_format=png · 1 张带 alpha 通道的 RGBA 参考图。
// 判据：
//   - 发往 api.apimart.ai 的 POST /v1/images/generations 恰好 1 次；
//   - 请求体包含 background="transparent"、output_format="png"、image_urls 恰好 1 张（已托管上传，非 nomi-local://）；
//   - 真付费时：成片落盘为 PNG 且 PNG IHDR 含 alpha 通道（colorType 4/6 或带 tRNS 块），镜头恰好 1 次提交且带供应商任务号。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expectVisible } from './_assert.mjs'
import { SPEND_DIALOG, openPaidWalk } from './_paidRun.mjs'
import { openCanvas } from './agent-runtime-walk-support.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'
import { canvasFitView, collapseAgentPanel } from './_shell.mjs'

const SCRIPT = 'seedream-5-pro-transparent-edit.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, process.env.NOMI_SAMPLES_EVIDENCE || 'docs/evidence/2026-11-22-paid-five-entries/seedream-5-pro-transparent-edit')
const APIMART_HOST = 'api.apimart.ai'
const MODEL = { vendorKey: 'apimart', modelKey: 'doubao-seedream-5-0-pro' }
const META = {
  modelKey: MODEL.modelKey,
  modelVendor: MODEL.vendorKey,
  vendor: MODEL.vendorKey,
  archetype: { id: 'seedream-5-pro', modeId: 'edit' },
  size: '1:1',
  resolution: '1K',
  background: 'transparent',
  output_format: 'png',
  watermark: false,
}
const LANDS_MS = stationTimeout({ turns: 4 })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const paid = await openPaidWalk(SCRIPT, 'seedream-5-pro-transparent-edit', [MODEL], {
  hostedUploads: true,
  recordAllowedBodies: true,
  judgesBodyInRehearsal: true,
  rehearsalShots: 1,
  buildMarkers: ['seedream-5-pro', 'transparent'],
})
const { walk } = paid
const evidence = { script: SCRIPT, startedAt: new Date().toISOString(), model: `${MODEL.vendorKey}/${MODEL.modelKey}` }
let failure
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await paid.lockToAuthorizedModels(win)
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await collapseAgentPanel(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })

  // 官方文档要求：透明底改图仅支持恰好 1 张自带 alpha 通道的输入图，且输出格式必须为 png。
  const assetDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(assetDir, { recursive: true })
  const rgbaPng = path.join(assetDir, 'ref-alpha.png')
  execFileSync(ffmpeg.path, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x2A9D8F@0.0:s=512x512,format=rgba,drawbox=x=128:y=128:w=256:h=256:color=0xE76F51@1.0:t=fill',
    '-frames:v', '1', rgbaPng,
  ], { stdio: 'pipe' })

  const shotId = await win.evaluate(({ url, meta }) => {
    const state = window.__nomiCanvasStore.getState()
    const source = state.addNode({ kind: 'image', title: 'ref-alpha.png', prompt: '', position: { x: -520, y: 0 }, meta: { imageWidth: 512, imageHeight: 512 } }).id
    const result = { id: `${source}-r`, type: 'image', url, createdAt: 1 }
    state.updateNode(source, { status: 'success', result, history: [result] })
    const shot = state.addNode({ kind: 'image', title: 'Seedream 5.0 Pro 透明底改图', prompt: '保留主体红色方块并加上金色细描边，保持纯透明背景', position: { x: 0, y: 0 }, meta }).id
    state.connectNodes(source, shot, 'reference')
    state.selectNode(shot)
    return shot
  }, { url: `nomi-local://asset/${projectId}/assets/imported/ref-alpha.png`, meta: META })

  await canvasFitView(win, '适应视图露出 Seedream 5.0 Pro 改图节点')
  const composer = win.locator(`[data-node-id="${shotId}"] .generation-canvas-v2-node__composer`).first()
  await expectVisible(composer, '选中改图节点后生成框出现', stationTimeout({ operations: 2 }))

  const nodeNow = () => win.evaluate((id) => {
    const state = window.__nomiCanvasStore.getState()
    return { node: state.nodes.find((node) => node.id === id) ?? null, edges: state.edges.filter((edge) => edge.target === id).length }
  }, shotId)

  // 花钱前核对：任意一项不成立当场停，一分钱不花。
  const before = await nodeNow()
  const meta = before.node?.meta ?? {}
  const problems = []
  if (meta.modelKey !== MODEL.modelKey || meta.modelVendor !== MODEL.vendorKey) problems.push(`模型是 ${meta.modelVendor}/${meta.modelKey}`)
  if (meta.archetype?.modeId !== 'edit') problems.push(`方式是 ${JSON.stringify(meta.archetype?.modeId)}，应是 edit`)
  if (meta.background !== 'transparent') problems.push(`background 是 ${JSON.stringify(meta.background)}，应是 transparent`)
  if (meta.output_format !== 'png') problems.push(`output_format 是 ${JSON.stringify(meta.output_format)}，应是 png`)
  if (meta.resolution !== '1K') problems.push(`resolution 是 ${JSON.stringify(meta.resolution)}，应是 1K`)
  if (before.edges !== 1) problems.push(`连进来的边有 ${before.edges} 条，应恰好 1 条`)
  const button = composer.locator('button[data-bar-segment="generate"]').first()
  if (await button.isDisabled()) problems.push('生成钮 ↑ 被禁用')
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

  const landed = (node) => /^nomi-local:\/\//.test(String(node?.result?.url ?? ''))
  const deadline = Date.now() + LANDS_MS
  let done = (await nodeNow()).node
  while (!(landed(done) || done?.status === 'error' || done?.status === 'recoverable') && Date.now() < deadline) {
    if (paid.rehearsal && findImageCreates(paid.readAllowedRequests().slice(ledgerBefore)).length > 0) break
    await sleep(1000)
    done = (await nodeNow()).node
  }

  evidence.request = judgeLedger(paid.readAllowedRequests().slice(ledgerBefore))
  if (paid.rehearsal) {
    if (evidence.request.problems.length) throw new Error(`请求体判据没过：${evidence.request.problems.join('；')}`)
  } else {
    evidence.providerTaskIds = (done?.runs ?? []).map((item) => item?.taskId).filter(Boolean)
    if (!landed(done)) throw new Error(`成图没落到节点上：状态 ${done?.status ?? '（读不到节点）'}，${String(done?.error ?? '').slice(0, 300)}`)
    const filePath = resolveLocalAssetFile(projectRoot, projectId, done.result.url)
    const pngInfo = inspectPngAlpha(filePath)
    const keptAt = path.join(walk.report.outputDir, 'result.png')
    fs.copyFileSync(filePath, keptAt)
    evidence.landed = { ...pngInfo, keptAt: path.relative(REPO_ROOT, keptAt) }
    await walk.snap('result-landed')
    const after = [
      ...evidence.request.problems,
      ...((done.runs?.length ?? 0) === 1 ? [] : [`镜头提交了 ${done.runs?.length ?? 0} 次（应恰好 1 次）`]),
      ...(done.result?.taskId ? [] : ['结果没带供应商任务号']),
      ...(pngInfo.isPng ? [] : ['落盘成图不是有效 PNG']),
      ...(pngInfo.hasAlpha ? [] : [`成图不含 alpha 通道（colorType=${pngInfo.colorType}）`]),
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
    if (body.background !== 'transparent') problems.push(`background 是 ${JSON.stringify(body.background)}，应是 transparent`)
    if (body.output_format !== 'png') problems.push(`output_format 是 ${JSON.stringify(body.output_format)}，应是 png`)
    if (!Array.isArray(body.image_urls) || body.image_urls.length !== 1) problems.push(`image_urls 不是 1 张：${JSON.stringify(body.image_urls)}`)
    else if (/^nomi-local:\/\//.test(String(body.image_urls[0] ?? ''))) problems.push('image_urls 仍是 nomi-local:// 未上传')
  }
  return { problems, createRequests: creates.length, keys: body ? Object.keys(body).sort() : null, model: body?.model ?? null, background: body?.background ?? null, output_format: body?.output_format ?? null }
}

function resolveLocalAssetFile(projectRoot, projectId, localUrl) {
  const prefix = `nomi-local://asset/${encodeURIComponent(projectId)}/`
  const rel = decodeURIComponent(String(localUrl).slice(prefix.length))
  return path.join(projectRoot, ...rel.split('/'))
}

function inspectPngAlpha(filePath) {
  const buf = fs.readFileSync(filePath)
  const isPng = buf.length > 33 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (!isPng) return { isPng: false, hasAlpha: false, colorType: null, width: null, height: null, bytes: buf.length }
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  const colorType = buf[25]
  const hasAlpha = colorType === 4 || colorType === 6 || buf.includes(Buffer.from('tRNS', 'ascii'))
  return { isPng: true, hasAlpha, colorType, width, height, bytes: buf.length }
}
