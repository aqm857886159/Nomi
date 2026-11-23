#!/usr/bin/env node
// 真实付费核对 · Seedance 2.0 / Wan 3.0（APIMart）带素材时空提示词放行并出片（#1531 档案今天就是错的第 5 处未核项）。**只写脚本与免费演练，由协调来跑真付费。**
//
//   pnpm build
//   NOMI_PAID_REHEARSAL=no-key node tests/ux/empty-prompt-with-media.paid.mjs   # 免费演练（一分钱不花）
//   NOMI_SPEND_OK=1 node tests/ux/empty-prompt-with-media.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//   NOMI_SAMPLES_ONLY=seedance 或 NOMI_SAMPLES_ONLY=wan 可只跑其中一发。
//
// 两发最低档短视频（均为 prompt="" + 1 张本地参考/首帧图）：
//   seedance：APIMart `doubao-seedance-2.0` · 图生视频（i2v）· 480p · 4 秒 · 1 张参考图 · 空提示词
//   wan：APIMart `wan3.0-video` · 首帧（first）· 480P · 2 秒 · 无音频 · 1 张首帧图 · 空提示词
// 判据：
//   - 节点提示词为空但生成钮 ↑ 可点、不被「需要提示词」拦住；
//   - 每发对 api.apimart.ai 的 POST /v1/videos/generations 恰好 1 次，请求体无非空 prompt、按各自档案带齐图片输入；
//   - 真付费时：成片落盘且 ffprobe 量出时长 > 1 秒、镜头恰好 1 次提交且带供应商任务号。
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

const SCRIPT = 'empty-prompt-with-media.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, process.env.NOMI_SAMPLES_EVIDENCE || 'docs/evidence/2026-11-22-paid-five-entries/empty-prompt-with-media')
const APIMART_HOST = 'api.apimart.ai'
const LANDS_MS = stationTimeout({ turns: 6 })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const SEEDANCE = { vendorKey: 'apimart', modelKey: 'doubao-seedance-2.0' }
const WAN = { vendorKey: 'apimart', modelKey: 'wan3.0-video' }

const SAMPLES = [
  {
    id: 'seedance',
    label: 'Seedance 2.0 · 图生视频 · 空提示词',
    model: SEEDANCE,
    edgeMode: 'reference',
    modeId: 'i2v',
    meta: {
      modelKey: SEEDANCE.modelKey,
      modelVendor: SEEDANCE.vendorKey,
      vendor: SEEDANCE.vendorKey,
      archetype: { id: 'seedance-2-apimart', modeId: 'i2v' },
      resolution: '480p',
      duration: 4,
      aspect_ratio: '16:9',
    },
    judge: (body) => [
      ...(String(body.prompt ?? '').trim() === '' ? [] : [`prompt 应为空，实际 ${JSON.stringify(body.prompt)}`]),
      ...(Array.isArray(body.image_urls) && body.image_urls.length === 1 ? [] : [`image_urls 不是 1 张：${JSON.stringify(body.image_urls)}`]),
    ],
  },
  {
    id: 'wan',
    label: 'Wan 3.0 · 首帧 · 空提示词',
    model: WAN,
    edgeMode: 'first_frame',
    modeId: 'first',
    meta: {
      modelKey: WAN.modelKey,
      modelVendor: WAN.vendorKey,
      vendor: WAN.vendorKey,
      archetype: { id: 'wan-3.0-apimart', modeId: 'first' },
      resolution: '480P',
      duration: 2,
      audio: false,
    },
    judge: (body) => {
      const roles = Array.isArray(body.image_with_roles) ? body.image_with_roles.map((item) => item?.role ?? null) : []
      return [
        ...(String(body.prompt ?? '').trim() === '' ? [] : [`prompt 应为空，实际 ${JSON.stringify(body.prompt)}`]),
        ...(body.generation_type === 'frame' ? [] : [`generation_type 是 ${JSON.stringify(body.generation_type)}，应是 frame`]),
        ...(roles.join() === 'first_frame' ? [] : [`image_with_roles 角色是 [${roles}]，应恰好 1 张 first_frame`]),
      ]
    },
  },
]

const only = (process.env.NOMI_SAMPLES_ONLY ?? '').split(',').map((item) => item.trim()).filter(Boolean)
const chosen = only.length ? SAMPLES.filter((sample) => only.includes(sample.id)) : SAMPLES
const models = [...new Map(chosen.map((sample) => [sample.model.modelKey, sample.model])).values()]

const paid = await openPaidWalk(SCRIPT, 'empty-prompt-with-media', models, {
  hostedUploads: true,
  recordAllowedBodies: true,
  judgesBodyInRehearsal: true,
  rehearsalShots: chosen.length,
  buildMarkers: ['seedance-2-apimart', 'wan-3.0-apimart'],
})
const { walk } = paid
const evidence = { script: SCRIPT, startedAt: new Date().toISOString(), samples: [] }
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
  execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=832x480:r=1', '-frames:v', '1', path.join(assetDir, 'frame.png')], { stdio: 'pipe' })
  const sourceId = await win.evaluate(({ url }) => {
    const state = window.__nomiCanvasStore.getState()
    const id = state.addNode({ kind: 'image', title: 'frame.png', prompt: '', position: { x: -560, y: 0 }, meta: { imageWidth: 832, imageHeight: 480 } }).id
    const result = { id: `${id}-r`, type: 'image', url, createdAt: 1 }
    state.updateNode(id, { status: 'success', result, history: [result] })
    return id
  }, { url: `nomi-local://asset/${projectId}/assets/imported/frame.png` })

  for (const [index, sample] of chosen.entries()) {
    const record = { id: sample.id, label: sample.label, model: `${sample.model.vendorKey}/${sample.model.modelKey}` }
    evidence.samples.push(record)
    try {
      await runSample(win, projectRoot, projectId, sourceId, sample, index, record)
      record.result = 'passed'
    } catch (error) {
      record.result = 'failed'
      record.error = String(error?.message ?? error).slice(0, 600)
      await walk.snap(`${sample.id}-failed`).catch(() => {})
    }
  }
  const red = evidence.samples.filter((item) => item.result !== 'passed')
  if (red.length) throw new Error(`样片没过：${red.map((item) => `${item.id}：${item.error}`).join(' | ')}`)
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

async function runSample(win, projectRoot, projectId, sourceId, sample, index, record) {
  const shotId = await win.evaluate(({ meta, title, source, edgeMode, y }) => {
    const state = window.__nomiCanvasStore.getState()
    const id = state.addNode({ kind: 'video', title, prompt: '', position: { x: 0, y }, meta }).id
    state.connectNodes(source, id, edgeMode)
    state.selectNode(id)
    return id
  }, { meta: sample.meta, title: `${sample.id} ${sample.label}`, source: sourceId, edgeMode: sample.edgeMode, y: -420 - index * 360 })

  await canvasFitView(win, `${sample.id}：适应视图`)
  const composer = win.locator(`[data-node-id="${shotId}"] .generation-canvas-v2-node__composer`).first()
  await expectVisible(composer, `${sample.id}：生成框出现`, stationTimeout({ operations: 2 }))

  const nodeNow = () => win.evaluate((id) => {
    const state = window.__nomiCanvasStore.getState()
    return { node: state.nodes.find((node) => node.id === id) ?? null, edges: state.edges.filter((edge) => edge.target === id).length }
  }, shotId)

  const before = await nodeNow()
  const meta = before.node?.meta ?? {}
  const problems = []
  if (meta.modelKey !== sample.model.modelKey || meta.modelVendor !== sample.model.vendorKey) problems.push(`模型是 ${meta.modelVendor}/${meta.modelKey}`)
  if (meta.archetype?.modeId !== sample.modeId) problems.push(`方式是 ${JSON.stringify(meta.archetype?.modeId)}，应是 ${sample.modeId}`)
  if (String(before.node?.prompt ?? '') !== '') problems.push(`提示词不为空：${JSON.stringify(before.node?.prompt)}`)
  if (before.edges !== 1) problems.push(`连进来的边有 ${before.edges} 条，应恰好 1 条`)
  const button = composer.locator('button[data-bar-segment="generate"]').first()
  if (await button.isDisabled()) problems.push('带素材空提示词时生成钮 ↑ 仍被禁用')
  await walk.snap(`${sample.id}-before-spend`)
  if (problems.length) throw new Error(`花钱前核对没过（这一发一分钱没花）：${problems.join('；')}`)

  const ledgerBefore = paid.readAllowedRequests().length
  await bringButtonIntoReach(win, button, `${sample.id} 节点底栏的 ↑`)
  await clickOrFail(button, `${sample.id} 节点底栏的 ↑（生成）`, { noWaitAfter: true })
  const dialog = win.locator(SPEND_DIALOG)
  if (await dialog.first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) }).then(() => true).catch(() => false)) {
    await walk.snap(`${sample.id}-confirm-dialog`)
    await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), `${sample.id} 确认框「生成」`, { noWaitAfter: true })
  }

  const landed = (node) => /^nomi-local:\/\//.test(String(node?.result?.url ?? ''))
  const deadline = Date.now() + LANDS_MS
  let done = (await nodeNow()).node
  while (!(landed(done) || done?.status === 'error' || done?.status === 'recoverable') && Date.now() < deadline) {
    if (paid.rehearsal && findVideoCreates(paid.readAllowedRequests().slice(ledgerBefore)).length > 0) break
    await sleep(1000)
    done = (await nodeNow()).node
  }

  record.request = judgeLedger(paid.readAllowedRequests().slice(ledgerBefore), sample)
  if (paid.rehearsal) {
    if (record.request.problems.length) throw new Error(`请求体判据没过：${record.request.problems.join('；')}`)
    return
  }
  record.providerTaskIds = (done?.runs ?? []).map((item) => item?.taskId).filter(Boolean)
  if (!landed(done)) throw new Error(`成片没落到镜头上：状态 ${done?.status ?? '（读不到节点）'}，${String(done?.error ?? '').slice(0, 300)}`)
  const media = await probeLandedMedia(projectRoot, projectId, done.result.url)
  const keptAt = path.join(walk.report.outputDir, `${sample.id}-result${path.extname(media.filePath) || '.mp4'}`)
  fs.copyFileSync(media.filePath, keptAt)
  record.landed = { durationSeconds: media.probe.durationSeconds ?? null, width: media.probe.width ?? null, height: media.probe.height ?? null, bytes: media.bytes, keptAt: path.relative(REPO_ROOT, keptAt) }
  await walk.snap(`${sample.id}-result-landed`)
  const after = [
    ...record.request.problems,
    ...((done.runs?.length ?? 0) === 1 ? [] : [`镜头提交了 ${done.runs?.length ?? 0} 次（应恰好 1 次）`]),
    ...(done.result?.taskId ? [] : ['结果没带供应商任务号']),
    ...((media.probe.durationSeconds ?? 0) > 1 ? [] : ['成片量不出时长']),
  ]
  if (after.length) throw new Error(`核对没过：${after.join('；')}`)
}

function findVideoCreates(entries) {
  return entries.filter((entry) => entry.kind === 'allowed-request' && entry.host === APIMART_HOST && entry.method === 'POST' && /\/videos\/generations$/.test(new URL(entry.url).pathname))
}

function judgeLedger(entries, sample) {
  const creates = findVideoCreates(entries)
  let body
  try { body = JSON.parse(String(creates[0]?.body?.text ?? '')) } catch { body = null }
  const problems = []
  if (creates.length !== 1) problems.push(`发往 ${APIMART_HOST} 的视频创建请求有 ${creates.length} 次（应恰好 1 次）`)
  if (!body) problems.push('没读到视频创建请求的请求体')
  else problems.push(...sample.judge(body))
  return { problems, createRequests: creates.length, keys: body ? Object.keys(body).sort() : null, model: body?.model ?? null, prompt: body?.prompt ?? null }
}
