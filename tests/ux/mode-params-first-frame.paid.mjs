#!/usr/bin/env node
// 真实付费核对 ·「这个方式认哪些参数」（设计卡 docs/plan/2026-11-12-mode-params-owner.md 第 8 格）。**只写脚本，由协调来跑。**
//
//   pnpm build
//   node tests/ux/mode-params-first-frame.walk.mjs          # 先跑零花费真窗复现（同一幕、本机夹具、三幕都过才往下）
//   NOMI_SPEND_OK=1 node tests/ux/mode-params-first-frame.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//     # 凭据缺省从真实资料目录拷进隔离副本（key 不经脚本）；隔离副本里要有 apimart/wan3.0-video 这一行。
//
// 只花**一条**视频：APIMart Wan 3.0 · 480P · 2 秒 · 无音频（档案里最低清晰度、最短时长）。
// 一幕：视频节点文生存了 size 9:16 → 连一张首帧图（方式现算成首帧，首帧方式不收比例）→ 点 ↑ → 确认 → 等成片落回。
// 判据：发往 api.apimart.ai 的视频创建请求恰好 1 次；请求体**没有 size**、generation_type = frame、image_with_roles 恰好一张 first_frame；
//   上游受理（结果带供应商任务号）并出片（ffprobe 量出时长）；节点上存的 size 还是 9:16（不写回）。
// 花钱之前的核对（任何一项不成立就一分钱不花）：节点就是这一档（模型 / 480P / 2 秒 / 无音频）、存着 size 9:16、首帧连上了。
// 请求体从走查网络闸的账本读（openPaidWalk 的 recordAllowedBodies：不记请求头，签名查询串与 key 形状的串先打码）。
// 证据摘要写 docs/evidence/2026-11-12-mode-params-first-frame/paid/report.json。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expect, expectVisible } from './_assert.mjs'
import { SPEND_DIALOG, openPaidWalk } from './_paidRun.mjs'
import { probeLandedMedia } from './_agentVideoPaid.mjs'
import { openCanvas } from './agent-runtime-walk-support.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'

const SCRIPT = 'mode-params-first-frame.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-11-12-mode-params-first-frame/paid')
const MODEL = { vendorKey: 'apimart', modelKey: 'wan3.0-video' }
const SIZE = '9:16'
const META = { modelKey: MODEL.modelKey, modelVendor: MODEL.vendorKey, vendor: MODEL.vendorKey, archetype: { id: 'wan-3.0-apimart' }, size: SIZE, resolution: '480P', duration: 2, audio: false }
const APIMART_HOST = 'api.apimart.ai'
const LANDS_MS = stationTimeout({ turns: 4 })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 主进程产物（dist-electron）不压缩：方式参数主人的函数名原样留在 catalog/taskParams.js 里，修前的构建里没有它。
const paid = await openPaidWalk(SCRIPT, 'mode-params-first-frame', [MODEL], { hostedUploads: true, recordAllowedBodies: true, buildMarkers: ['effectiveModeParams'] })
const { walk } = paid
const evidence = { script: SCRIPT, startedAt: new Date().toISOString(), model: `${MODEL.vendorKey}/${MODEL.modelKey} · 480P · 2s · 无音频`, storedSize: SIZE }
let failure
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await paid.lockToAuthorizedModels(win)
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })

  const assetDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(assetDir, { recursive: true })
  execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=832x480:r=1', '-frames:v', '1', '-y', path.join(assetDir, 'first.png')], { stdio: 'pipe' })
  const ids = await win.evaluate(({ url, meta }) => {
    const state = window.__nomiCanvasStore.getState()
    const frame = state.addNode({ kind: 'image', title: 'first.png', prompt: '', position: { x: -520, y: 0 }, meta: { imageWidth: 832, imageHeight: 480 } }).id
    const result = { id: 'first-r', type: 'image', url, createdAt: 1 }
    state.updateNode(frame, { status: 'success', result, history: [result] })
    const shot = state.addNode({ kind: 'video', title: '方式参数核对', prompt: '海边清晨，镜头缓慢推近，写实', position: { x: 0, y: 0 }, meta }).id
    state.connectNodes(frame, shot, 'first_frame')
    state.selectNode(shot)
    return { frame, shot }
  }, { url: `nomi-local://asset/${projectId}/assets/imported/first.png`, meta: META })
  const nodeNow = () => win.evaluate((id) => {
    const state = window.__nomiCanvasStore.getState()
    return { node: state.nodes.find((node) => node.id === id) ?? null, edges: state.edges.filter((edge) => edge.target === id).map((edge) => edge.mode ?? 'reference') }
  }, ids.shot)
  const composer = win.locator(`[data-node-id="${ids.shot}"] .generation-canvas-v2-node__composer`).first()
  await expectVisible(composer, '选中镜头后它的生成框出现', stationTimeout({ operations: 2 }))

  // ── 花钱之前的核对：任何一项不成立就停（一分钱没花）──
  const before = await nodeNow()
  const problems = []
  const meta = before.node?.meta ?? {}
  if (meta.modelKey !== MODEL.modelKey || meta.modelVendor !== MODEL.vendorKey) problems.push(`模型是 ${meta.modelVendor}/${meta.modelKey}`)
  if (meta.resolution !== '480P' || Number(meta.duration) !== 2 || meta.audio !== false) problems.push(`档位是 ${meta.resolution} · ${meta.duration}s · audio=${meta.audio}`)
  if (meta.size !== SIZE) problems.push(`节点存的 size 是 ${JSON.stringify(meta.size)}，这一幕要 ${SIZE}`)
  if (before.edges.join() !== 'first_frame') problems.push(`连进来的边是 [${before.edges}]，这一幕要恰好一条首帧`)
  await walk.snap('before-spend')
  if (problems.length) throw new Error(`花钱前核对没过（一分钱没花）：\n  ${problems.join('\n  ')}`)

  const button = composer.locator('button[data-bar-segment="generate"]').first()
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
    await sleep(2000)
    done = (await nodeNow()).node
  }
  evidence.request = judgeLedger(paid.readAllowedRequests())
  evidence.providerTaskIds = (done?.runs ?? []).map((run) => run?.taskId).filter(Boolean)
  evidence.storedSizeAfter = done?.meta?.size ?? null
  if (!landed(done)) {
    await walk.snap('fail-not-landed')
    throw new Error(`成片没落到这个镜头上（最多等 ${Math.round(LANDS_MS / 1000)} 秒）：状态 ${done?.status ?? '（读不到节点）'}，${String(done?.error ?? '').slice(0, 300)}`)
  }
  const media = await probeLandedMedia(projectRoot, projectId, done.result.url)
  const keptAt = path.join(walk.report.outputDir, 'result.mp4')
  fs.copyFileSync(media.filePath, keptAt)
  evidence.landed = { durationSeconds: media.probe.durationSeconds ?? null, width: media.probe.width ?? null, height: media.probe.height ?? null, bytes: media.bytes, keptAt: path.relative(REPO_ROOT, keptAt) }
  await walk.snap('result-landed')
  expect(done.runs?.length, '镜头恰好一次提交').toBe(1)
  expect(Boolean(done.result?.taskId), '结果带着供应商任务号').toBe(true)
  expect(media.probe.durationSeconds ?? 0, '成片是一段真视频（ffprobe 量出时长）').toBeGreaterThan(1)
  expect(evidence.storedSizeAfter, '节点上存的 size 没被改写').toBe(SIZE)
  if (evidence.request.problems.length) throw new Error(`请求体核对没过：${evidence.request.problems.join('；')}`)
  evidence.verified = ['scene-armed-before-spend', 'request-has-no-size', 'first-frame-shape', 'one-provider-task', 'result-landed-and-probed', 'stored-size-kept']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  const report = { ...evidence, finishedAt: new Date().toISOString(), paidCalls: walk.report.paidCalls ?? null, spend: (walk.report.spend?.media ?? []).map(({ taskId, status, model, vendor }) => ({ taskId, status, model, vendor })), result: failure ? 'failed' : 'passed', error: failure ? String(failure.message ?? failure).slice(0, 600) : null }
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
}

/** 闸账本里发往 APIMart 的视频创建请求：恰好 1 次、没有 size、首帧形状对。 */
function judgeLedger(entries) {
  const creates = entries.filter((entry) => entry.kind === 'allowed-request' && entry.host === APIMART_HOST && entry.method === 'POST' && /\/videos\/generations$/.test(new URL(entry.url).pathname))
  let body
  try { body = JSON.parse(String(creates[0]?.body?.text ?? '')) } catch { body = null }
  const problems = []
  if (creates.length !== 1) problems.push(`发往 ${APIMART_HOST} 的视频创建请求有 ${creates.length} 次（应恰好 1 次）`)
  if (!body) problems.push('没读到视频创建请求的请求体')
  else {
    if (Object.hasOwn(body, 'size')) problems.push(`请求体带着 size=${JSON.stringify(body.size)}（首帧方式不收比例）`)
    if (body.generation_type !== 'frame') problems.push(`generation_type 是 ${JSON.stringify(body.generation_type)}，应是 frame`)
    const roles = Array.isArray(body.image_with_roles) ? body.image_with_roles.map((item) => item?.role ?? null) : []
    if (roles.join() !== 'first_frame') problems.push(`image_with_roles 的角色是 [${roles}]，应恰好一张 first_frame`)
  }
  return { problems, createRequests: creates.length, keys: body ? Object.keys(body).sort() : null, model: body?.model ?? null, generation_type: body?.generation_type ?? null }
}
