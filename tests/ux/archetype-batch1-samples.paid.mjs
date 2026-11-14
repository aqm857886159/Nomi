#!/usr/bin/env node
// 真实付费核对 · 模型档案第一批三条样片（设计卡 docs/plan/2026-11-14-mode-input-check.md §8）。**只写脚本，由协调来跑。**
//
//   pnpm build
//   node tests/ux/archetype-batch1-samples.walk.mjs          # 先跑零花费真窗复现（三条反例都在发送前拒、夹具 0 笔才往下）
//   NOMI_SPEND_OK=1 node tests/ux/archetype-batch1-samples.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//     # 凭据缺省从真实资料目录拷进隔离副本（key 不经脚本）；隔离副本里要有 apimart 的这三行：kling-v4-flash / doubao-seedance-2.5 / MiniMax-H3-Max。
//   NOMI_SAMPLES_ONLY=A1,A2,B,C 只跑其中几发（重跑失败那一发用；不给就四发全跑）。
//
// 共四发视频（价目：内置 APIMart 行没有价，跑前协调看 APIMart 价目页）：
//   A1 可灵 4.0 Flash · 视频编辑 · ffmpeg 造的 4 秒 1:1 源视频 · 不带时长 · 比例不动（档案默认）
//   A2 同上 · 比例 16:9                       → 编辑不带时长上游收；记成片画幅（不动比例时是否跟随源视频 1:1、16:9 时改不改——PR3 的依据，只记不判）
//   B  Seedance 2.5 · 全能参考 · 1 张图 · 1080p · 5 秒 · output_format=mov · watermark=false → 1080p 档与新键上游收、回来是 mov
//   C  MiniMax H3-Max（APIMart）· 多模态参考 · 1 张图 · aspect_ratio=adaptive · 768P · 5 秒 → 新通道行跑通、adaptive 被接受
// 每发：花钱前核对节点（模型 / 方式 / 参数 / 连线）→ 点 ↑ → 确认 → 等成片落回 → 闸账本里这一发的视频创建请求恰好 1 次、请求体按判据 → ffprobe 量成片。
// 请求体从走查网络闸的账本读（openPaidWalk 的 recordAllowedBodies：不记请求头，签名查询串与 key 形状的串先打码）。
// 证据摘要写 docs/evidence/2026-11-14-mode-input-check/paid/report.json。
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
import { modeName, pickModeByName, readModeCell } from './_modeMenu.mjs'
import { canvasFitView, collapseAgentPanel } from './_shell.mjs'

const SCRIPT = 'archetype-batch1-samples.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-11-14-mode-input-check/paid')
const APIMART_HOST = 'api.apimart.ai'
const LANDS_MS = stationTimeout({ turns: 6 })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const KLING = { vendorKey: 'apimart', modelKey: 'kling-v4-flash' }
const SEEDANCE = { vendorKey: 'apimart', modelKey: 'doubao-seedance-2.5' }
const H3MAX = { vendorKey: 'apimart', modelKey: 'MiniMax-H3-Max' }
const metaOf = (model, archetypeId, modeId, params) => ({ modelKey: model.modelKey, modelVendor: model.vendorKey, vendor: model.vendorKey, archetype: { id: archetypeId, modeId }, ...params })

/** 四发：输入（edge 用哪个素材）、节点参数、花钱前核对、请求体判据。 */
const SAMPLES = [
  {
    id: 'A1', label: '可灵 4.0 Flash · 视频编辑 · 比例不动', model: KLING, modeKind: null, modeId: 'edit', input: 'video',
    meta: metaOf(KLING, 'kling-v4-flash', 'edit', {}),
    judge: (body) => [
      ...(Object.hasOwn(body, 'duration') ? [`编辑请求体带着 duration=${JSON.stringify(body.duration)}（编辑不带时长）`] : []),
      ...(body.omni_reference_task_type === 'edit' ? [] : [`omni_reference_task_type 是 ${JSON.stringify(body.omni_reference_task_type)}，应是 edit`]),
      ...(Array.isArray(body.video_urls) && body.video_urls.length === 1 ? [] : [`video_urls 不是一段：${JSON.stringify(body.video_urls)}`]),
    ],
  },
  {
    id: 'A2', label: '可灵 4.0 Flash · 视频编辑 · 16:9', model: KLING, modeKind: null, modeId: 'edit', input: 'video',
    meta: metaOf(KLING, 'kling-v4-flash', 'edit', { aspect_ratio: '16:9' }),
    judge: (body) => [
      ...(Object.hasOwn(body, 'duration') ? [`编辑请求体带着 duration=${JSON.stringify(body.duration)}（编辑不带时长）`] : []),
      ...(body.aspect_ratio === '16:9' ? [] : [`aspect_ratio 是 ${JSON.stringify(body.aspect_ratio)}，这一发要 16:9`]),
    ],
  },
  {
    id: 'B', label: 'Seedance 2.5 · 全能参考 · 1080p · mov', model: SEEDANCE, modeKind: 'reference', modeId: 'omni', input: 'image',
    meta: metaOf(SEEDANCE, 'seedance-2.5-apimart', 'omni', { resolution: '1080p', duration: 5, output_format: 'mov', watermark: false }),
    judge: (body) => [
      ...(body.resolution === '1080p' ? [] : [`resolution 是 ${JSON.stringify(body.resolution)}，应是 1080p`]),
      ...(body.output_format === 'mov' ? [] : [`output_format 是 ${JSON.stringify(body.output_format)}，应是 mov`]),
      ...(body.watermark === false ? [] : [`watermark 是 ${JSON.stringify(body.watermark)}，应是 false`]),
    ],
    // 认容器看文件头：QuickTime 的 ftyp 品牌是「qt  」（mp4 是 isom / mp42 …），不信扩展名。
    landed: (media) => {
      const brand = fs.readFileSync(media.filePath).subarray(8, 12).toString('latin1')
      return brand === 'qt  ' ? [] : [`成片不是 mov（ftyp 品牌「${brand}」 · ${path.basename(media.filePath)}）`]
    },
  },
  {
    id: 'C', label: 'MiniMax H3-Max · 多模态参考 · adaptive · 768P', model: H3MAX, modeKind: 'reference', modeId: 'ref', input: 'image',
    meta: metaOf(H3MAX, 'minimax-h3-max', 'ref', { aspect_ratio: 'adaptive', resolution: '768P', duration: 5 }),
    judge: (body) => [
      ...(body.aspect_ratio === 'adaptive' ? [] : [`aspect_ratio 是 ${JSON.stringify(body.aspect_ratio)}，应是 adaptive`]),
      ...(body.resolution === '768P' ? [] : [`resolution 是 ${JSON.stringify(body.resolution)}，应是 768P`]),
      ...(Array.isArray(body.image_urls) && body.image_urls.length === 1 ? [] : [`image_urls 不是一张：${JSON.stringify(body.image_urls)}`]),
    ],
  },
]
const only = (process.env.NOMI_SAMPLES_ONLY ?? '').split(',').map((item) => item.trim()).filter(Boolean)
const chosen = SAMPLES.filter((sample) => !only.length || only.includes(sample.id))
const models = [...new Map(chosen.map((sample) => [sample.model.modelKey, sample.model])).values()]

// 主进程产物（dist-electron）不压缩：本修复的拒收机读码原样进产物，修前的构建里没有。
const paid = await openPaidWalk(SCRIPT, 'archetype-batch1-samples', models, { hostedUploads: true, recordAllowedBodies: true, buildMarkers: ['mode_input_missing'] })
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
  const run = (args) => execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: 'pipe' })
  run(['-f', 'lavfi', '-i', 'testsrc=s=1024x1024:r=1', '-frames:v', '1', '-y', path.join(assetDir, 'ref.png')])
  run(['-f', 'lavfi', '-i', 'testsrc=s=720x720:r=24:d=4', '-pix_fmt', 'yuv420p', '-y', path.join(assetDir, 'source-1x1.mp4')])
  const sources = await win.evaluate(({ imageUrl, videoUrl }) => {
    const state = window.__nomiCanvasStore.getState()
    const add = (kind, title, url, y, meta) => {
      const id = state.addNode({ kind, title, prompt: '', position: { x: -560, y }, meta }).id
      const result = { id: `${id}-r`, type: kind, url, createdAt: 1 }
      state.updateNode(id, { status: 'success', result, history: [result] })
      return id
    }
    return { image: add('image', 'ref.png', imageUrl, -200, { imageWidth: 1024, imageHeight: 1024 }), video: add('video', 'source-1x1.mp4', videoUrl, 200, {}) }
  }, { imageUrl: `nomi-local://asset/${projectId}/assets/imported/ref.png`, videoUrl: `nomi-local://asset/${projectId}/assets/imported/source-1x1.mp4` })

  for (const [index, sample] of chosen.entries()) {
    const record = { id: sample.id, label: sample.label, model: `${sample.model.vendorKey}/${sample.model.modelKey}` }
    evidence.samples.push(record)
    try {
      await runSample(win, projectRoot, projectId, sources, sample, index, record)
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
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  const report = { ...evidence, finishedAt: new Date().toISOString(), paidCalls: walk.report.paidCalls ?? null, spend: (walk.report.spend?.media ?? []).map(({ taskId, status, model, vendor }) => ({ taskId, status, model, vendor })), result: failure ? 'failed' : 'passed', error: failure ? String(failure.message ?? failure).slice(0, 600) : null }
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
}

async function runSample(win, projectRoot, projectId, sources, sample, index, record) {
  const shot = await win.evaluate(({ meta, title, source, y }) => {
    const state = window.__nomiCanvasStore.getState()
    const id = state.addNode({ kind: 'video', title, prompt: '把画面改成夜景，霓虹灯亮起，镜头缓慢推近，写实', position: { x: 0, y }, meta }).id
    state.connectNodes(source, id, 'reference')
    state.selectNode(id)
    return id
  }, { meta: sample.meta, title: `${sample.id} ${sample.label}`, source: sources[sample.input], y: index * 360 - 400 })
  // 画布只渲染视口里的节点：新镜头可能落在视口外，先像创作者那样点「适应视图」把它带到眼前。
  await canvasFitView(win, `${sample.id}：适应视图，把新镜头带进视口`)
  const composer = win.locator(`[data-node-id="${shot}"] .generation-canvas-v2-node__composer`).first()
  await expectVisible(composer, `${sample.id}：选中镜头后它的生成框出现`, stationTimeout({ operations: 2 }))
  if (sample.modeKind) {
    const want = modeName('zh', sample.modeKind)
    if ((await readModeCell(composer, 'zh')) !== want) await pickModeByName(win, composer, 'zh', want)
  }
  await sleep(800)
  const nodeNow = () => win.evaluate((id) => {
    const state = window.__nomiCanvasStore.getState()
    return { node: state.nodes.find((node) => node.id === id) ?? null, edges: state.edges.filter((edge) => edge.target === id).length }
  }, shot)

  // ── 花钱之前的核对：任何一项不成立就停（这一发一分钱没花）──
  const before = await nodeNow()
  const meta = before.node?.meta ?? {}
  const problems = []
  if (meta.modelKey !== sample.model.modelKey || meta.modelVendor !== sample.model.vendorKey) problems.push(`模型是 ${meta.modelVendor}/${meta.modelKey}`)
  if (meta.archetype?.modeId !== sample.modeId) problems.push(`方式是 ${JSON.stringify(meta.archetype?.modeId)}，这一发要 ${sample.modeId}`)
  for (const [key, value] of Object.entries(sample.meta)) {
    if (['modelKey', 'modelVendor', 'vendor', 'archetype'].includes(key)) continue
    if (meta[key] !== value) problems.push(`${key} 是 ${JSON.stringify(meta[key])}，这一发要 ${JSON.stringify(value)}`)
  }
  if (before.edges !== 1) problems.push(`连进来的边有 ${before.edges} 条，这一发要恰好一条`)
  const button = composer.locator('button[data-bar-segment="generate"]').first()
  if (await button.isDisabled()) problems.push(`↑ 是灰的：${await button.locator('xpath=..').getAttribute('title').catch(() => '—')}`)
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
    await sleep(2000)
    done = (await nodeNow()).node
  }
  record.request = judgeLedger(paid.readAllowedRequests().slice(ledgerBefore), sample)
  record.providerTaskIds = (done?.runs ?? []).map((item) => item?.taskId).filter(Boolean)
  if (!landed(done)) throw new Error(`成片没落到这个镜头上（最多等 ${Math.round(LANDS_MS / 1000)} 秒）：状态 ${done?.status ?? '（读不到节点）'}，${String(done?.error ?? '').slice(0, 300)}`)
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
    ...(sample.landed ? sample.landed(media) : []),
  ]
  if (after.length) throw new Error(`核对没过：${after.join('；')}`)
}

/** 这一发之后闸账本里发往 APIMart 的视频创建请求：恰好 1 次、请求体按这一发的判据。 */
function judgeLedger(entries, sample) {
  const creates = entries.filter((entry) => entry.kind === 'allowed-request' && entry.host === APIMART_HOST && entry.method === 'POST' && /\/videos\/generations$/.test(new URL(entry.url).pathname))
  let body
  try { body = JSON.parse(String(creates[0]?.body?.text ?? '')) } catch { body = null }
  const problems = []
  if (creates.length !== 1) problems.push(`发往 ${APIMART_HOST} 的视频创建请求有 ${creates.length} 次（应恰好 1 次）`)
  if (!body) problems.push('没读到视频创建请求的请求体')
  else problems.push(...sample.judge(body))
  return { problems, createRequests: creates.length, keys: body ? Object.keys(body).sort() : null, model: body?.model ?? null, aspect_ratio: body?.aspect_ratio ?? null }
}
