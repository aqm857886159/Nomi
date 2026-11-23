#!/usr/bin/env node
// 真实付费核对 · Veo 3.1 Fast（APIMart）首尾帧方式带比例（#1531 + #1567 + #1576 + #1590）。**只写脚本与免费演练，由协调来跑真付费。**
//
//   pnpm build
//   NOMI_PAID_REHEARSAL=no-key node tests/ux/veo-31-fast-firstlast-aspect.paid.mjs   # 免费演练（一分钱不花）
//   NOMI_SPEND_OK=1 node tests/ux/veo-31-fast-firstlast-aspect.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 只花**一条**视频：APIMart `veo3.1-fast` · 首尾帧（modeId="frame"）· 2 张竖图（first_frame + last_frame，720×1280）· aspect_ratio=9:16 · 720p。
// 判据：
//   - 发往 api.apimart.ai 的 POST /v1/videos/generations 恰好 1 次；
//   - 请求体包含 `aspect_ratio: "9:16"`（图模式带比例不再被丢）、`generation_type: "frame"`、`resolution: "720p"`、`image_urls` 恰好 2 张有序 URL（非 nomi-local://）；
//   - 真付费时：成片落盘且 ffprobe 量出竖屏（height > width）与正时长 > 1 秒、镜头恰好 1 次提交且带供应商任务号。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { clickOrFail, expectVisible } from './_assert.mjs'
import { SPEND_DIALOG, openPaidWalk } from './_paidRun.mjs'
import { probeLandedMedia } from './_agentVideoPaid.mjs'
import { openCanvas } from './agent-runtime-walk-support.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'
import { canvasFitView, collapseAgentPanel } from './_shell.mjs'

const SCRIPT = 'veo-31-fast-firstlast-aspect.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, process.env.NOMI_SAMPLES_EVIDENCE || 'docs/evidence/2026-11-22-paid-five-entries/veo-31-fast-firstlast-aspect')
const APIMART_HOST = 'api.apimart.ai'
const MODEL = { vendorKey: 'apimart', modelKey: 'veo3.1-fast' }
const META = {
  modelKey: MODEL.modelKey,
  modelVendor: MODEL.vendorKey,
  vendor: MODEL.vendorKey,
  archetype: { id: 'veo-3.1', modeId: 'frame' },
  aspect_ratio: '9:16',
  aspect_ratio_user_set: true,
  resolution: '720p',
}
const LANDS_MS = stationTimeout({ turns: 6 })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const paid = await openPaidWalk(SCRIPT, 'veo-31-fast-firstlast-aspect', [MODEL], {
  hostedUploads: true,
  recordAllowedBodies: true,
  judgesBodyInRehearsal: true,
  rehearsalShots: 1,
  buildMarkers: ['veo-3.1', 'generation_type'],
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

  const assetDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(assetDir, { recursive: true })
  const run = (args) => execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' })
  run(['-f', 'lavfi', '-i', 'color=c=0x1D3557:s=720x1280:d=1,drawbox=x=120:y=220:w=480:h=480:color=0xE9C46A:t=fill', '-frames:v', '1', path.join(assetDir, 'first-9x16.png')])
  run(['-f', 'lavfi', '-i', 'color=c=0x264653:s=720x1280:d=1,drawbox=x=120:y=580:w=480:h=480:color=0x2A9D8F:t=fill', '-frames:v', '1', path.join(assetDir, 'last-9x16.png')])

  const shotId = await win.evaluate(({ firstUrl, lastUrl, meta }) => {
    const state = window.__nomiCanvasStore.getState()
    const addImg = (title, url, y) => {
      const id = state.addNode({ kind: 'image', title, prompt: '', position: { x: -560, y }, meta: { imageWidth: 720, imageHeight: 1280 } }).id
      const result = { id: `${id}-r`, type: 'image', url, createdAt: 1 }
      state.updateNode(id, { status: 'success', result, history: [result] })
      return id
    }
    const firstId = addImg('first-9x16.png', firstUrl, -260)
    const lastId = addImg('last-9x16.png', lastUrl, 220)
    const shot = state.addNode({ kind: 'video', title: 'Veo 3.1 Fast 首尾帧 9:16', prompt: '从首帧平稳过渡到尾帧，镜头垂直微移，自然光线', position: { x: 0, y: 0 }, meta }).id
    state.connectNodes(firstId, shot, 'first_frame')
    state.connectNodes(lastId, shot, 'last_frame')
    state.selectNode(shot)
    return shot
  }, {
    firstUrl: `nomi-local://asset/${projectId}/assets/imported/first-9x16.png`,
    lastUrl: `nomi-local://asset/${projectId}/assets/imported/last-9x16.png`,
    meta: META,
  })

  await canvasFitView(win, '适应视图露出 Veo 3.1 Fast 首尾帧节点')
  const composer = win.locator(`[data-node-id="${shotId}"] .generation-canvas-v2-node__composer`).first()
  await expectVisible(composer, '选中镜头后生成框出现', stationTimeout({ operations: 2 }))

  const nodeNow = () => win.evaluate((id) => {
    const state = window.__nomiCanvasStore.getState()
    return {
      node: state.nodes.find((node) => node.id === id) ?? null,
      edges: state.edges.filter((edge) => edge.target === id).map((edge) => edge.mode ?? 'reference'),
    }
  }, shotId)

  const before = await nodeNow()
  const meta = before.node?.meta ?? {}
  const problems = []
  if (meta.modelKey !== MODEL.modelKey || meta.modelVendor !== MODEL.vendorKey) problems.push(`模型是 ${meta.modelVendor}/${meta.modelKey}`)
  if (meta.archetype?.modeId !== 'frame') problems.push(`方式是 ${JSON.stringify(meta.archetype?.modeId)}，应是 frame`)
  if (meta.aspect_ratio !== '9:16') problems.push(`aspect_ratio 是 ${JSON.stringify(meta.aspect_ratio)}，应是 9:16`)
  if (meta.resolution !== '720p') problems.push(`resolution 是 ${JSON.stringify(meta.resolution)}，应是 720p`)
  if (!before.edges.includes('first_frame') || !before.edges.includes('last_frame') || before.edges.length !== 2) {
    problems.push(`连进来的边是 [${before.edges}]，应恰好一条 first_frame 与一条 last_frame`)
  }
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
    if (paid.rehearsal && findVideoCreates(paid.readAllowedRequests().slice(ledgerBefore)).length > 0) break
    await sleep(1000)
    done = (await nodeNow()).node
  }

  evidence.request = judgeLedger(paid.readAllowedRequests().slice(ledgerBefore))
  if (paid.rehearsal) {
    if (evidence.request.problems.length) throw new Error(`请求体判据没过：${evidence.request.problems.join('；')}`)
  } else {
    evidence.providerTaskIds = (done?.runs ?? []).map((item) => item?.taskId).filter(Boolean)
    if (!landed(done)) throw new Error(`成片没落到镜头上：状态 ${done?.status ?? '（读不到节点）'}，${String(done?.error ?? '').slice(0, 300)}`)
    const media = await probeLandedMedia(projectRoot, projectId, done.result.url)
    const keptAt = path.join(walk.report.outputDir, `result${path.extname(media.filePath) || '.mp4'}`)
    fs.copyFileSync(media.filePath, keptAt)
    evidence.landed = { durationSeconds: media.probe.durationSeconds ?? null, width: media.probe.width ?? null, height: media.probe.height ?? null, bytes: media.bytes, keptAt: path.relative(REPO_ROOT, keptAt) }
    await walk.snap('result-landed')
    const after = [
      ...evidence.request.problems,
      ...((done.runs?.length ?? 0) === 1 ? [] : [`镜头提交了 ${done.runs?.length ?? 0} 次（应恰好 1 次）`]),
      ...(done.result?.taskId ? [] : ['结果没带供应商任务号']),
      ...((media.probe.durationSeconds ?? 0) > 1 ? [] : ['成片量不出时长']),
      ...((media.probe.height ?? 0) > (media.probe.width ?? 0) ? [] : [`成片不是竖屏（${media.probe.width}×${media.probe.height}）：上游首尾帧未认 9:16`]),
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

function findVideoCreates(entries) {
  return entries.filter((entry) => entry.kind === 'allowed-request' && entry.host === APIMART_HOST && entry.method === 'POST' && /\/videos\/generations$/.test(new URL(entry.url).pathname))
}

function judgeLedger(entries) {
  const creates = findVideoCreates(entries)
  let body
  try { body = JSON.parse(String(creates[0]?.body?.text ?? '')) } catch { body = null }
  const problems = []
  if (creates.length !== 1) problems.push(`发往 ${APIMART_HOST} 的视频创建请求有 ${creates.length} 次（应恰好 1 次）`)
  if (!body) problems.push('没读到视频创建请求的请求体')
  else {
    if (body.aspect_ratio !== '9:16') problems.push(`aspect_ratio 是 ${JSON.stringify(body.aspect_ratio)}，应是 9:16`)
    if (body.generation_type !== 'frame') problems.push(`generation_type 是 ${JSON.stringify(body.generation_type)}，应是 frame`)
    if (body.resolution !== '720p') problems.push(`resolution 是 ${JSON.stringify(body.resolution)}，应是 720p`)
    if (!Array.isArray(body.image_urls) || body.image_urls.length !== 2) problems.push(`image_urls 不是 2 张有序首尾帧：${JSON.stringify(body.image_urls)}`)
    else if (body.image_urls.some((u) => /^nomi-local:\/\//.test(String(u ?? '')))) problems.push('image_urls 含未上传的 nomi-local://')
  }
  return { problems, createRequests: creates.length, keys: body ? Object.keys(body).sort() : null, model: body?.model ?? null, aspect_ratio: body?.aspect_ratio ?? null, generation_type: body?.generation_type ?? null }
}
