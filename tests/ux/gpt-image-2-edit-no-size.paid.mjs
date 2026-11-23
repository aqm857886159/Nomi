#!/usr/bin/env node
// 真实付费核对 · gpt-image-2（APIMart）带本地参考图改图、选「自动」比例不发 size、且关着第三方托管开关零碰第三方图床（#1556 + #1531）。**只写脚本与免费演练，由协调来跑真付费。**
//
//   pnpm build
//   NOMI_PAID_REHEARSAL=no-key node tests/ux/gpt-image-2-edit-no-size.paid.mjs   # 免费演练（一分钱不花）
//   NOMI_SPEND_OK=1 node tests/ux/gpt-image-2-edit-no-size.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 只花**一张**图：APIMart `gpt-image-2` · 改图（edit）· 1K · aspect_ratio=auto · 1 张竖图（720×1280 本地文件）。
// 判据：
//   - 第三方公共临时托管开关保持关闭（默认 ask），确认框无托管告知、账本对第三方图床请求数 = 0；
//   - 发往 api.apimart.ai 的 POST /v1/images/generations 恰好 1 次；
//   - 请求体**不含 `size` 键**（omitAuto 生效，由上游按原图比例输出）、带 `image_urls`（1 张非 nomi-local:// URL）；
//   - 真付费时：成图落盘解码且保持竖图比例（height > width）、镜头恰好 1 次提交且带供应商任务号。
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

const SCRIPT = 'gpt-image-2-edit-no-size.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, process.env.NOMI_SAMPLES_EVIDENCE || 'docs/evidence/2026-11-22-paid-five-entries/gpt-image-2-edit-no-size')
const APIMART_HOST = 'api.apimart.ai'
const MODEL = { vendorKey: 'apimart', modelKey: 'gpt-image-2' }
const META = {
  modelKey: MODEL.modelKey,
  modelVendor: MODEL.vendorKey,
  vendor: MODEL.vendorKey,
  archetype: { id: 'gpt-image-2', modeId: 'i2i' },
  aspect_ratio: 'auto',
  resolution: '1K',
}
const LANDS_MS = stationTimeout({ turns: 4 })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const paid = await openPaidWalk(SCRIPT, 'gpt-image-2-edit-no-size', [MODEL], {
  hostedUploads: true,
  recordAllowedBodies: true,
  judgesBodyInRehearsal: true,
  rehearsalShots: 1,
  buildMarkers: ['size_wire', 'anonymousHostingEnabled'],
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

  // 竖屏 9:16 本地参考图：省略 size 时上游按首张输入图比例出图，真付费后可据此验证成图竖屏。
  const assetDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(assetDir, { recursive: true })
  execFileSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=720x1280:r=1', '-frames:v', '1', path.join(assetDir, 'ref-9x16.png')], { stdio: 'pipe' })

  const shotId = await win.evaluate(({ url, meta }) => {
    const state = window.__nomiCanvasStore.getState()
    const source = state.addNode({ kind: 'image', title: 'ref-9x16.png', prompt: '', position: { x: -520, y: 0 }, meta: { imageWidth: 720, imageHeight: 1280 } }).id
    const result = { id: `${source}-r`, type: 'image', url, createdAt: 1 }
    state.updateNode(source, { status: 'success', result, history: [result] })
    const shot = state.addNode({ kind: 'image', title: 'GPT Image 2 本地参考改图（不发 size）', prompt: '把背景改成黄昏暖橙色天际线，保持原有竖幅构图与主体位置', position: { x: 0, y: 0 }, meta }).id
    state.connectNodes(source, shot, 'reference')
    state.selectNode(shot)
    return shot
  }, { url: `nomi-local://asset/${projectId}/assets/imported/ref-9x16.png`, meta: META })

  await canvasFitView(win, '适应视图露出 GPT Image 2 改图节点')
  const composer = win.locator(`[data-node-id="${shotId}"] .generation-canvas-v2-node__composer`).first()
  await expectVisible(composer, '选中改图节点后生成框出现', stationTimeout({ operations: 2 }))

  const nodeNow = () => win.evaluate((id) => {
    const state = window.__nomiCanvasStore.getState()
    return { node: state.nodes.find((node) => node.id === id) ?? null, edges: state.edges.filter((edge) => edge.target === id).length }
  }, shotId)

  const before = await nodeNow()
  const meta = before.node?.meta ?? {}
  const problems = []
  if (meta.modelKey !== MODEL.modelKey || meta.modelVendor !== MODEL.vendorKey) problems.push(`模型是 ${meta.modelVendor}/${meta.modelKey}`)
  if (meta.archetype?.modeId !== 'i2i') problems.push(`方式是 ${JSON.stringify(meta.archetype?.modeId)}，应是 i2i`)
  if (meta.aspect_ratio !== 'auto') problems.push(`aspect_ratio 是 ${JSON.stringify(meta.aspect_ratio)}，应是 auto`)
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
    const dims = probeImageDims(filePath)
    const keptAt = path.join(walk.report.outputDir, `result${path.extname(filePath) || '.png'}`)
    fs.copyFileSync(filePath, keptAt)
    evidence.landed = { ...dims, keptAt: path.relative(REPO_ROOT, keptAt) }
    await walk.snap('result-landed')
    const after = [
      ...evidence.request.problems,
      ...((done.runs?.length ?? 0) === 1 ? [] : [`镜头提交了 ${done.runs?.length ?? 0} 次（应恰好 1 次）`]),
      ...(done.result?.taskId ? [] : ['结果没带供应商任务号']),
      ...((dims.height ?? 0) > (dims.width ?? 0) ? [] : [`成图未跟随竖图输入比例（${dims.width}×${dims.height}）`]),
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
  const relayHost = walk.report.hostedUploadRelayAllowed ? new URL(walk.report.hostedUploadRelayAllowed).host : null
  const thirdPartyUploads = entries.filter((entry) => entry.kind === 'allowed-request' && entry.host !== APIMART_HOST && (!relayHost || entry.host !== relayHost))
  const problems = []
  if (creates.length !== 1) problems.push(`发往 ${APIMART_HOST} 的图片创建请求有 ${creates.length} 次（应恰好 1 次）`)
  if (thirdPartyUploads.length > 0) problems.push(`关着第三方托管却向非授权主机发了请求：${thirdPartyUploads.map((item) => item.host).join('、')}`)
  if (!body) problems.push('没读到图片创建请求的请求体')
  else {
    if (Object.hasOwn(body, 'size')) problems.push(`请求体带着 size=${JSON.stringify(body.size)}（gpt-image-2 改图选 auto 时应省略 size）`)
    if (!Array.isArray(body.image_urls) || body.image_urls.length !== 1) problems.push(`image_urls 不是 1 张：${JSON.stringify(body.image_urls)}`)
    else if (/^nomi-local:\/\//.test(String(body.image_urls[0] ?? ''))) problems.push('image_urls 仍是 nomi-local:// 未上传')
  }
  return { problems, createRequests: creates.length, thirdPartyUploads: thirdPartyUploads.length, keys: body ? Object.keys(body).sort() : null, model: body?.model ?? null, hasSize: body ? Object.hasOwn(body, 'size') : null }
}

function resolveLocalAssetFile(projectRoot, projectId, localUrl) {
  const prefix = `nomi-local://asset/${encodeURIComponent(projectId)}/`
  const rel = decodeURIComponent(String(localUrl).slice(prefix.length))
  return path.join(projectRoot, ...rel.split('/'))
}

function probeImageDims(filePath) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', filePath], { encoding: 'utf8' })
  const stream = JSON.parse(out)?.streams?.[0] ?? {}
  return { width: Number(stream.width) || null, height: Number(stream.height) || null, bytes: fs.statSync(filePath).size }
}
