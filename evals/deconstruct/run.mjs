#!/usr/bin/env node
// 拆解效果评测（用户 2026-10-18「注意做真实付费测试以及效果测试 构建指标」）：真 Electron、真实素材、走拆解按钮同一个 IPC
// （nomiDesktop.video.deconstruct），每条片子打一份指标（metrics.mjs），整体对照门槛，报告落 evals/runs/。
//
// 跑法（从便宜到贵）：
//   node evals/deconstruct/run.mjs --fixture
//        零花费：读图走夹具回环供应商、去掉音轨（只验量具本身：调用数 = 镜数、指标算得出来）。
//   NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/" NOMI_SPEND_OK=1 NOMI_PAID_CONFIRM=1 \
//     node evals/deconstruct/run.mjs --vision-model apimart/gemini-3.5-flash [--max-calls 60]
//        真付费：拷一份带凭据的隔离副本（_paidRun.mjs：CI 拒跑、用户 Nomi 开着拒跑、原库指纹比对），读图用你选的模型，
//        转写走自动解析（本机 Whisper 有就用本机）。开拆前用本地切点（零成本）数镜，读图总调用超过 --max-calls 的片子不拆。
//
// 片子（都截成有界的小段，落测试自己的 tmp，不写用户素材目录）：
//   talk-mixed     9月12日(1).mov 0–40s：中英混口播，旁边有作者逐字稿 → 对白字错率
//   screenrec-zh   8月12日.mov 120–160s：纯中文录屏口播 → 对白覆盖
//   follow-hand    仓库内真实 1080p15 片（15s、多镜头）→ 读图 / 景别
//   ai-shot        仓库内真 AI 生成镜头（640×360）→ 读图 / 景别
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { SPEND_DIALOG, openPaidWalk } from '../../tests/ux/_paidRun.mjs'
import { readRealCatalog } from '../../tests/ux/_realProfile.mjs'
import { createRuntimeWalk } from '../../tests/ux/agent-runtime-walk-support.mjs'
import { FIXTURE_TEXT_MODEL, FIXTURE_VENDOR } from '../../tests/ux/agent-runtime-fixture.mjs'
import { requireRealMediaAssets } from '../../tests/ux/fixtures/realMedia.mjs'
import { clickOrFail } from '../../tests/ux/_assert.mjs'
import { uiText } from '../../tests/ux/full-walk/invariants.mjs'
import { judgeCase, scoreDeconstruction, THRESHOLDS } from './metrics.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true }
const valueOf = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const [, value] = argv.splice(i, 2); return value ?? null }
const FIXTURE = flag('--fixture')
const VISION_ARG = valueOf('--vision-model')
const MAX_CALLS = Number(valueOf('--max-calls') ?? 60)
const ONLY = valueOf('--only')
// 转写腿显式选哪个（供应商/模型）；不给 = 自动解析，和拆解栏「转写：自动选择」一样。
const TRANSCRIBE_ARG = valueOf('--transcribe-model')
process.argv.splice(2, process.argv.length - 2, ...argv)
const CONFIRM = FIXTURE || process.env.NOMI_PAID_CONFIRM === '1'
const ffmpeg = createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path

const CASES = [
  // speech: true = 这段有人说话，对白列整列空就是不达标（2026-10-19 之前空对白被当成「没给参考稿」静默放过）。
  { id: 'talk-mixed', asset: 'speech-zh-mixed-hevc', start: 0, seconds: 40, audio: true, speech: true, reference: (file) => fs.readFileSync(file.replace(/\.mov$/, '.txt'), 'utf8') },
  { id: 'screenrec-zh', asset: 'speech-zh-only-hevc', start: 120, seconds: 40, audio: true, speech: true },
  { id: 'follow-hand', asset: 'video-canvas-follow-hand-1080p15', start: 0, seconds: 15, audio: false },
  { id: 'ai-shot', asset: 'video-ai-shot-640x360', start: 0, seconds: 10, audio: false },
].filter((item) => !ONLY || ONLY.split(',').includes(item.id))

// 真付费要本机素材库；零花费只用仓库内那两件（不要求 env）。
const cases = FIXTURE ? CASES.filter((item) => !item.audio) : CASES
const { assets } = requireRealMediaAssets([...new Set(cases.map((item) => item.asset))])
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-deconstruct-eval-'))
function clipOf(item) {
  const source = assets.get(item.asset).file
  const out = path.join(tmp, `${item.id}.mp4`)
  const audio = item.audio && !FIXTURE ? ['-c:a', 'aac', '-b:a', '96k'] : ['-an']
  const cut = spawnSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(item.start), '-t', String(item.seconds), '-i', source, ...audio, '-vf', 'scale=640:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
  if (cut.status !== 0) throw new Error(`截 ${item.id} 失败：${String(cut.stderr)}`)
  return { file: out, reference: item.reference && !FIXTURE ? item.reference(source) : undefined }
}

let model
let paid = null
let walk
if (FIXTURE) {
  model = { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_TEXT_MODEL }
  walk = await createRuntimeWalk('deconstruct-eval-fixture')
  walk.fixture.respond({
    label: 'deconstruct-vision',
    match: (body) => JSON.stringify(body?.messages ?? []).includes('拆解'),
    reply: { type: 'text', text: JSON.stringify({ shotSize: '中景', mood: '平静', visual: '夹具回的画面描述', onScreenText: '', imagePrompt: 'p', motionPrompt: 'm' }) },
  })
} else {
  if (!VISION_ARG?.includes('/')) throw new Error('缺 --vision-model <供应商/模型>（或 --fixture 走零花费）')
  const row = (readRealCatalog().models ?? []).find((candidate) => candidate.kind === 'text' && candidate.enabled && `${candidate.vendorKey}/${candidate.modelKey}` === VISION_ARG)
  if (!row) throw new Error(`目录里没有启用的文本模型 ${VISION_ARG}`)
  model = { vendorKey: row.vendorKey, modelKey: row.modelKey }
  // 转写腿显式点名的模型也要进授权名单：付费走查只装、只放行点名的模型（其余生成模型一律停用），
  // 2026-10-19 之前只授权了读图模型——转写模型在隔离副本里全被停掉，于是每次都是「没有可用的转写模型」，
  // 那不是产品的结论，是量具自己的盲区。不点名 = 隔离副本里没有任何转写模型可用（对白会如实报「没有可用的转写模型」并判不达标）。
  const authorized = [model]
  if (TRANSCRIBE_ARG) {
    const [vendorKey, ...rest] = TRANSCRIBE_ARG.split('/')
    const transcribeRow = (readRealCatalog().models ?? []).find((candidate) => candidate.kind === 'audio' && candidate.enabled && candidate.vendorKey === vendorKey && candidate.modelKey === rest.join('/'))
    if (!transcribeRow) throw new Error(`目录里没有启用的音频模型 ${TRANSCRIBE_ARG}`)
    authorized.push({ vendorKey: transcribeRow.vendorKey, modelKey: transcribeRow.modelKey })
  }
  paid = await openPaidWalk('evals/deconstruct/run.mjs', 'deconstruct-eval', authorized, { buildMarkers: [uiText('zh-CN', 'shotTable.node.idleHint'), 'deconstruct.transcriptUntimed'] })
  walk = paid.walk
}

const report = walk.report
Object.assign(report, { transcribeModel: TRANSCRIBE_ARG ?? 'auto', mode: FIXTURE ? 'fixture' : CONFIRM ? 'paid' : 'paid-dry', visionModel: `${model.vendorKey}/${model.modelKey}`, maxCalls: MAX_CALLS, thresholds: THRESHOLDS, cases: [] })
let failure
try {
  const { win, app } = await walk.start({ first: true })
  if (paid) await paid.lockToAuthorizedModels(win)
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  await walk.newProject()
  await clickOrFail(win.locator('[data-mode="generation"]'), '生成 tab')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: 60_000 })
  // 出站计数（同 shot-table-vision-leg.paid.mjs）：只计数、不拦截。
  await app.evaluate(() => {
    const counts = { vision: 0, transcribe: 0 }
    globalThis.__evalCounts = counts
    process.getBuiltinModule('node:diagnostics_channel').subscribe('undici:request:create', ({ request }) => {
      if (request?.method !== 'POST') return
      const target = String(request.path ?? '')
      // 转写端点两种形状：OpenAI 兼容（/audio/transcriptions）与 ElevenLabs（/v1/speech-to-text）。
      if (/\/audio\/transcriptions|\/speech-to-text/.test(target)) counts.transcribe += 1
      else if (/\/chat\/completions|\/v1\/messages|generateContent/.test(target)) counts.vision += 1
    })
  })
  const counts = () => app.evaluate(() => ({ ...globalThis.__evalCounts }))
  let spent = 0
  for (const item of cases) {
    const clip = clipOf(item)
    // 导入 + 建视频节点（同一条真 IPC）；开拆前本地数镜（零成本）。
    const seeded = await win.evaluate(async ({ b64 }) => {
      const projectId = /projectId=([^&]+)/.exec(location.href)?.[1]
      const saved = await window.nomiDesktop.assets.importFile({ projectId, bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer, contentType: 'video/mp4', fileName: 'clip.mp4', kind: 'upload' })
      if (!saved.ok) return { error: saved.failure.reason }
      const url = saved.asset.data?.url
      const store = window.__nomiCanvasStore.getState()
      const video = store.addNode({ kind: 'video', title: 'eval', position: { x: 0, y: 0 } })
      store.updateNode(video.id, { result: { id: `eval-${Date.now()}`, type: 'video', url, createdAt: Date.now() } })
      const detected = await window.nomiDesktop.video.detectShotCuts({ videoUrl: url, projectId })
      return { projectId, url, nodeId: video.id, shots: (detected.cuts?.length ?? 0) + 1 }
    }, { b64: fs.readFileSync(clip.file).toString('base64') })
    if (seeded.error) throw new Error(`${item.id} 导入失败：${seeded.error}`)
    if (spent + seeded.shots > MAX_CALLS || !CONFIRM) {
      console.log(`[skip] ${item.id}：${seeded.shots} 镜${CONFIRM ? `，累计会到 ${spent + seeded.shots} 次 > 上限 ${MAX_CALLS}` : '（未设 NOMI_PAID_CONFIRM，只数镜不拆）'}`)
      report.cases.push({ id: item.id, skipped: true, preCountShots: seeded.shots })
      continue
    }
    const before = await counts()
    const startedAt = Date.now()
    // 超过 30 次调用会弹报价卡（短片不弹，长片才弹）：评测已获授权，卡出现就点确认。
    const dialogWatcher = (async () => {
      const dialog = win.locator(SPEND_DIALOG)
      try { await dialog.waitFor({ state: 'visible', timeout: 15_000 }); await dialog.locator('[data-spend-confirm-action="confirm"]').click() } catch { /* 没弹卡 = 短片 */ }
    })()
    const transcribe = TRANSCRIBE_ARG ? { vendorKey: TRANSCRIBE_ARG.split('/')[0], modelKey: TRANSCRIBE_ARG.split('/').slice(1).join('/') } : undefined
    // 照生产（factBridge.deconstructToShotTable）：主进程入口要 requestId（取消口寻址）和 projectBinding（这次拆解归哪个项目会话），缺了直接拒。
    const result = await win.evaluate(async ({ url, projectId, nodeId, vision, transcribe }) => {
      const record = await window.nomiDesktop.projects.readAsync(projectId)
      const projectBinding = { projectId, immutableProjectUuid: record?.immutableProjectUuid, projectGeneration: record?.projectGeneration }
      return window.nomiDesktop.video.deconstruct({ videoUrl: url, projectId, nodeId, vision, requestId: crypto.randomUUID(), projectBinding, ...(transcribe ? { transcribe } : {}) })
    }, { ...seeded, vision: model, transcribe })
    // 主进程回 null = 这次拆解被停下了（取消 / 项目会话对不上 / 窗口没了）：评测没人点取消，出现就是绑定没被接受。
    if (!result) throw new Error(`${item.id} 拆解被主进程判成「已停」（回 null）：projectBinding 与窗口的项目会话对不上`)
    await dialogWatcher
    const seconds = (Date.now() - startedAt) / 1000
    const after = await counts()
    const visionCalls = after.vision - before.vision
    spent += visionCalls
    const metrics = scoreDeconstruction(result, { reference: clip.reference, visionCalls: FIXTURE ? walk.fixture.requests.length - (report.fixtureSeen ?? 0) : visionCalls, seconds })
    if (FIXTURE) report.fixtureSeen = walk.fixture.requests.length
    const misses = judgeCase(metrics, { expectDialogue: Boolean(item.speech) && !FIXTURE })
    const resultMeta = { ...result }
    delete resultMeta.shots
    report.cases.push({ id: item.id, resultMeta, seconds: Math.round(seconds), transcribeCalls: after.transcribe - before.transcribe, metrics, misses, sample: result.shots.slice(0, 3).map((shot) => ({ shotSize: shot.shotSize, visual: shot.visual, motionPrompt: shot.motionPrompt, dialogue: shot.dialogue })) })
    console.log(`[case] ${item.id}：${metrics.shots} 镜 · 读图 ${metrics.readRate} · 画面 ${metrics.fill.visual} · 景别 ${metrics.fill.shotSize}/${metrics.shotSizeValid} · 中文(画面/运镜) ${metrics.zhRate.visual}/${metrics.zhRate.motionPrompt} · 对白 ${metrics.dialogueShotRate ?? '-'} · CER ${metrics.dialogueCer ?? '-'} · 调用 ${metrics.visionCalls}=${metrics.shots}? · ${metrics.secondsPerShot ?? '-'}s/镜${misses.length ? ` · ✖ ${misses.join('；')}` : ''}`)
  }
  const ran = report.cases.filter((item) => !item.skipped)
  report.summary = { ran: ran.length, failing: ran.filter((item) => item.misses.length).map((item) => item.id), visionCalls: spent }
  const out = path.join(repoRoot, 'evals/runs', `deconstruct-${report.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`报告：${path.relative(repoRoot, out)}`)
  if (report.summary.failing.length) process.exitCode = 1
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
  if (paid) await paid.finish(failure)
  else await walk.finish(failure, { unscriptedFixture: true })
}
