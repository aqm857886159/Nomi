#!/usr/bin/env node
// 真实付费核对 · 「Agent 定的 = 节点上的 = 实际发出的」：Agent 起草的变体和比例，落到画布节点、打开节点、从画布点生成，
// 一路原样到供应商的请求体里。覆盖 #1288（落地线带上变体）+ PR-b（打开节点不改比例）整条「Agent 落地 → 画布生成」。
// **只写脚本，由协调来跑。** 要在同时含这两处修复的构建上跑（`pnpm build` 之后；不含的话花钱前的节点核对会拦下，一分钱不花）。
//
//   pnpm build
//   NOMI_SPEND_OK=1 APIMART_API_KEY=<key，只从环境读> node tests/ux/agent-ratio-variant-landing.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//   # 先零花费探测（走到确认框为止、绝不点生成）：
//   NOMI_SPEND_OK=1 NOMI_PAID_PROBE_DIALOG=1 APIMART_API_KEY=<key> node tests/ux/agent-ratio-variant-landing.paid.mjs
//
// 只花**一条**视频：APIMart · Seedance 2.0 · Mini · 9:16 · 480p · 4 秒 · 无音频（写死在 _ratioVariantWire.mjs 的 RATIO_VARIANT_SHOT，
// 「最便宜的变体」按档案顺序取 Mini——**跑之前请协调核对这一档**；脚本不读价目、不写金额）。
//
// 起草不调真文本模型：Agent 的大脑选仓库的 loopback 夹具（agent-runtime-fixture.mjs，「Fixture 文本」），它按剧本只回一次
// `draft_shots`（就是真模型会发的那个宿主入口），再回一句话收尾——省钱，也不赌模型这次写没写对。宿主、Run、落地线、画布、
// 节点路派发全是真的；只有媒体走真 APIMart。用环境变量里的 key 接入时，接入页会真调一次文本模型验证 key（几个 token，
// 与真人第一次接入一样，openPaidWalk 记进报告）。
//
// 步骤：
//   ① Agent 起草 1 镜（draft_shots：Seedance 2.0 / Mini / aspectRatio 9:16 / 4 秒 / 480p / 无音频，先别生成）；
//   ② 核宿主 Run 里的候选 = 这一档（Agent 定的）；核落地节点 meta = 这一档（节点上的）；
//   ③ 打开节点（选中 → 生成框挂载），再核一遍 meta 没被改；切英文、重开窗口、再打开一次，再核一遍；zh / en 各留截图；
//   ④ 花钱前核对：Run 还是草稿、没有任务、闸没记到任何视频创建请求；任何一项不成立就停（一分钱没花）；
//   ⑤ 在节点上点 ↑ → 确认框「生成」→ 网络闸记下的请求体：发往 APIMart 的视频创建请求恰好 1 次、型号 = Mini 的型号名、比例 9:16
//      （判定在 _ratioVariantWire.mjs，_ratioVariantWire.test.mjs 用真 runtime.runTask 零花费验过）；
//   ⑥ 成片落到这个节点，ffprobe 量出来是竖的（高 > 宽），节点恰好一次提交、带供应商任务号。
// 证据摘要写 docs/evidence/2026-10-22-agent-ratio-variant-landing/paid/report.json；成片拷进工作树 .tmp/（不进仓库）。
//
// 探测模式（NOMI_PAID_PROBE_DIALOG=1）：供应商的源不进放行名单，点 ↑ 之后就算直接提交也会被网络闸当场挡下，结构上花不了钱。
// 走到确认框出现为止：截图、点「取消」、核对节点上没有提交记录。注意：env-key 接入页验证 key 那次文本调用在探测模式下也会被挡、
// 走查当场失败并点名被挡主机——遇到就直接跑正常模式（它在确认框之前同样会停下来做整套核对）。
//
// 凭据与护栏：全部走 tests/ux/_paidRun.mjs 的 openPaidWalk（CI 拒跑、没有 NOMI_SPEND_OK=1 拒跑、构建产物过期拒跑、隔离资料目录、
// 出网只放行授权供应商、跑完删凭据副本）；key 只从环境变量读，不进报告 / 日志 / 截图。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { SPEND_DIALOG, openPaidWalk, readProductionRuns } from './_paidRun.mjs'
import { probeLandedMedia } from './_agentVideoPaid.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { CANVAS_PANEL, chooseAssistantModel, openCanvas, readProject, recorded, sendCanvas } from './agent-runtime-walk-support.mjs'
import { RATIO_VARIANT_SHOT as SHOT, candidateShotProblems, judgeRatioVariantWire, nodeShotProblems } from './_ratioVariantWire.mjs'

const SCRIPT = 'agent-ratio-variant-landing.paid.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-10-22-agent-ratio-variant-landing/paid')
const PROBE = process.env.NOMI_PAID_PROBE_DIALOG === '1'
const APIMART_HOST = 'api.apimart.ai'
const VIDEO = { vendorKey: SHOT.vendorKey, modelKey: SHOT.modelKey }
const NODE_GENERATE = 'button[data-bar-segment="generate"]'
const VIDEO_LANDS_MS = stationTimeout({ turns: 4 })
const ASK = 'S_RATIO_VARIANT_DRAFT：起草一个竖屏视频镜头，先别生成。'
const DRAFT_CALL = 's-ratio-variant-draft-1'
const DRAFT_ARGS = {
  shots: [{
    title: '雨后窄巷',
    prompt: '雨后的窄巷，石板路反着光，镜头缓慢上摇，竖构图',
    model: `${SHOT.modelKey}@${SHOT.vendorKey}`,
    variantId: SHOT.variantId,
    modeId: SHOT.modeId,
    aspectRatio: SHOT.aspect,
    durationSec: SHOT.durationSec,
    parameters: { resolution: SHOT.resolution, generate_audio: SHOT.generateAudio },
  }],
}

const paid = await openPaidWalk(SCRIPT, 'agent-ratio-variant-landing', [VIDEO], { vendorNetwork: !PROBE, recordAllowedBodies: true })
const { walk } = paid
const evidence = { script: SCRIPT, mode: PROBE ? 'probe-dialog' : 'paid', startedAt: new Date().toISOString(), shot: { ...SHOT } }
let failure
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await paid.lockToAuthorizedModels(win)
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()

  // ── ① Agent 起草（loopback 大脑按剧本只回一次 draft_shots，不调真文本模型）──
  const planner = walk.fixture.expectText({
    label: 'the agent drafts one vertical Seedance 2.0 Mini shot and does not generate',
    match: (body) => flattenRequestText(body).includes('S_RATIO_VARIANT_DRAFT'),
    reply: { type: 'tool', id: DRAFT_CALL, name: 'draft_shots', args: DRAFT_ARGS },
  })
  let operationId
  const drafted = walk.fixture.expectText({
    label: 'the draft result comes back and the agent stops',
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === DRAFT_CALL)
      if (!result) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'text', text: 'S_RATIO_VARIANT_DONE：草稿建好了，等你在画布上点生成。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'draft request')
  await recorded(drafted.received, 'draft result')
  if (!operationId) throw new Error('draft_shots 的结果里没有 operationId（起草没成，一分钱没花）')
  evidence.operationId = operationId

  // ── ② Agent 定的（宿主 Run 里的候选）= 节点上的（落地节点 meta）──
  const run = readProductionRuns(projectRoot).find((candidate) => candidate.runId === operationId)
  const candidate = run?.generationPlan?.shots?.[0]?.candidate ?? run?.generationPlan?.candidate
  const candidateProblems = candidateShotProblems(candidate)
  evidence.candidate = { variantId: candidate?.variantId ?? null, parameters: candidate?.parameters ?? null }
  if (candidateProblems.length) throw new Error(`宿主候选不是这一档（Agent 定的就不对，一分钱没花）：\n  ${candidateProblems.join('\n  ')}`)
  await expect.poll(async () => ((await readProject(win, projectId)).payload.generationCanvas.nodes ?? []).filter((node) => node.meta?.productionRunId === operationId).length,
    { message: '草稿落到画布上（1 个节点）', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const nodeOnDisk = async () => ((await readProject(win, projectId)).payload.generationCanvas.nodes ?? []).find((node) => node.meta?.productionRunId === operationId)
  const shotId = (await nodeOnDisk()).id
  const storeNode = () => win.evaluate((id) => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === id) ?? null, shotId)
  await expect.poll(async () => Boolean(await storeNode()), { message: '节点在画布 store 里', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  const landedMeta = (await storeNode()).meta
  evidence.landedNode = pick(landedMeta)
  const landedProblems = nodeShotProblems(landedMeta)
  if (landedProblems.length) throw new Error(`落地节点不是 Agent 定的这一档（#1288 不在这个构建里？一分钱没花）：\n  ${landedProblems.join('\n  ')}`)

  // ── ③ 打开节点（选中 → 生成框挂载）不改它；切英文、重开窗口、再打开一次也不改 ──
  async function openAndCheck(locale) {
    await win.evaluate((id) => window.__nomiCanvasStore.getState().selectNode(id), shotId)
    const composer = win.locator('.generation-canvas-v2-node__composer').first()
    await proveProbe(composer, `${locale}：生成框挂出来了`)
    // 让挂载后的派生写（若有）都跑完再读：要证的就是它们不碰比例和变体。
    await waitForVisualQuiescence(win)
    const opened = (await storeNode()).meta
    const problems = nodeShotProblems(opened)
    const changedKeys = Object.keys({ ...landedMeta, ...opened }).filter((key) => JSON.stringify(landedMeta[key]) !== JSON.stringify(opened[key]))
    const composerText = (await composer.innerText().catch(() => '')) ?? ''
    evidence[`opened-${locale}`] = { changedKeys, composerShowsAspect: composerText.includes(SHOT.aspect), composerShowsMini: /mini/i.test(composerText) }
    await walk.snap(`0${locale === 'zh' ? 1 : 2}-${locale}-node-opened-before-spend`)
    if (problems.length) throw new Error(`${locale}：打开节点之后它变了（一分钱没花）：\n  ${problems.join('\n  ')}`)
  }
  await openAndCheck('zh')
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await openCanvas(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })
  await expect.poll(async () => Boolean(await storeNode()), { message: '重开窗口后节点还在', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  await openAndCheck('en')
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await openCanvas(win)
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), null, { timeout: stationTimeout({ operations: 2 }) })
  await win.evaluate((id) => window.__nomiCanvasStore.getState().selectNode(id), shotId)

  // ── ④ 花钱前核对：还是草稿、没有任务、闸没记到任何视频创建请求 ──
  const runBefore = readProductionRuns(projectRoot).find((candidateRun) => candidateRun.runId === operationId)
  const preSpend = []
  if ((runBefore?.jobs ?? []).length) preSpend.push(`Run 里已经有 ${runBefore.jobs.length} 个任务`)
  if (judgeRatioVariantWire(paid.readAllowedRequests(), { host: APIMART_HOST }).summary.createRequests !== 0) preSpend.push('点生成之前闸已经记到视频创建请求')
  const finalMeta = (await storeNode()).meta
  preSpend.push(...nodeShotProblems(finalMeta))
  if (preSpend.length) throw new Error(`花钱前核对没过（一分钱没花）：\n  ${preSpend.join('\n  ')}`)

  // ── ⑤ 在节点上点 ↑ ──
  const generateButton = win.locator(`[data-node-id="${shotId}"] ${NODE_GENERATE}`).first()
  walk.report.generateButtonBeforeClick = await bringButtonIntoReach(win, generateButton, '节点底栏的 ↑')
  const clickedAt = Date.now()
  await clickOrFail(generateButton, '节点底栏的 ↑（生成）', { noWaitAfter: true })
  const dialog = win.locator(SPEND_DIALOG)

  if (PROBE) {
    const PROBE_MS = 180_000
    let dialogMs = null
    while (Date.now() - clickedAt < PROBE_MS) {
      if (await dialog.first().isVisible().catch(() => false)) { dialogMs = Date.now() - clickedAt; break }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    evidence.probe = { dialogMs, note: dialogMs === null ? '3 分钟内确认框没出现' : '确认框出现；已点取消，没点生成' }
    if (dialogMs === null) throw new Error(`探测：点 ↑ 之后 ${PROBE_MS / 1000} 秒内确认框一直没出现`)
    await walk.snap('probe-dialog-visible')
    await clickOrFail(dialog.locator('[data-spend-confirm-action="cancel"]'), '确认框「取消」（探测模式绝不点生成）', { noWaitAfter: true })
    await dialog.first().waitFor({ state: 'hidden', timeout: stationTimeout({ operations: 1 }) })
    const runsAfterCancel = (await nodeOnDisk())?.runs?.length ?? 0
    if (runsAfterCancel > 0) throw new Error(`探测模式取消之后镜头上有 ${runsAfterCancel} 条提交记录（不该有）`)
    evidence.verified = ['candidate-is-the-authorized-tier', 'landed-node-equals-candidate', 'opening-node-keeps-variant-and-aspect', 'generate-click-reaches-confirm-dialog', 'cancel-leaves-no-submission']
  } else {
    if (await dialog.first().waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) }).then(() => true).catch(() => false)) {
      await proveProbe(dialog, '付费确认框')
      await walk.snap('03-zh-confirm-dialog')
      await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '确认框「生成」', { noWaitAfter: true })
    }
    let submitted = false
    const submitDeadline = Date.now() + stationTimeout({ operations: 2 })
    while (!submitted && Date.now() < submitDeadline) {
      submitted = ((await nodeOnDisk())?.runs?.length ?? 0) > 0
      if (!submitted) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!submitted) {
      await walk.snap('fail-no-submission')
      throw new Error('点了生成但没有提交：这个镜头没有出现提交记录（见 fail-no-submission 截图）')
    }
    // 请求体一提交就记下了：先核它（成片要等几分钟，这一步红了也照样等成片落地，钱已经花了，证据要齐）。
    const wire = judgeRatioVariantWire(paid.readAllowedRequests(), { host: APIMART_HOST })
    evidence.request = wire.summary

    await expect.poll(async () => (await nodeOnDisk())?.result?.url ?? '', { message: '成片落在这个镜头上', timeout: VIDEO_LANDS_MS }).toMatch(/^nomi-local:\/\//)
    const done = await nodeOnDisk()
    evidence.providerTaskIds = [done.result?.taskId].filter(Boolean)
    const landed = await probeLandedMedia(projectRoot, projectId, done.result.url)
    const keptAt = path.join(walk.report.outputDir, 'result.mp4')
    fs.copyFileSync(landed.filePath, keptAt) // 隔离副本删除前先留下成片
    evidence.landed = { durationSeconds: landed.probe.durationSeconds ?? null, width: landed.probe.width ?? null, height: landed.probe.height ?? null, hasAudio: landed.probe.hasAudio, bytes: landed.bytes, keptAt: path.relative(REPO_ROOT, keptAt) }
    await walk.snap('04-zh-result-landed')

    expect(done.runs?.length, '镜头恰好一次提交').toBe(1)
    expect(done.runs[0].status, '那一次提交成功').toBe('success')
    expect(Boolean(done.result?.taskId), '结果带着供应商任务号').toBe(true)
    expect(landed.probe.durationSeconds ?? 0, '成片是一段真视频（ffprobe 量出时长）').toBeGreaterThan(1)
    expect((landed.probe.height ?? 0) > (landed.probe.width ?? 0), `成片是竖的（${landed.probe.width}×${landed.probe.height}）`).toBe(true)
    if (wire.problems.length) throw new Error(`请求体核对没过：${wire.problems.join('；')}`)
    evidence.verified = ['candidate-is-the-authorized-tier', 'landed-node-equals-candidate', 'opening-node-keeps-variant-and-aspect', 'apimart-body-model-is-mini', 'apimart-body-size-is-9-16', 'one-provider-task', 'result-landed-portrait']
  }
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
  writeEvidence(failure)
}

/** 报告里只留这一档相关的几样（不整份倒 meta）。 */
function pick(meta) {
  return {
    modelKey: meta?.modelKey ?? null, vendor: meta?.modelVendor ?? meta?.vendor ?? null, variantId: meta?.archetype?.variantId ?? null,
    modeId: meta?.archetype?.modeId ?? null, size: meta?.size ?? null, resolution: meta?.resolution ?? null, duration: meta?.duration ?? null,
    generateAudio: meta?.generate_audio ?? null, aspectExplicit: meta?.aspect_ratio_user_set ?? null,
  }
}

function writeEvidence(error) {
  const report = {
    ...evidence,
    finishedAt: new Date().toISOString(),
    paidCalls: walk.report.paidCalls ?? null,
    spend: (walk.report.spend?.media ?? []).map(({ taskId, status, model, vendor }) => ({ taskId, status, model, vendor })),
    providerTaskIds: evidence.providerTaskIds ?? (walk.report.spend?.media ?? []).map((entry) => entry.taskId).filter(Boolean),
    networkAllowlist: walk.report.networkAllowlist ?? null,
    networkBlocked: walk.report.networkBlocked ?? [],
    walkOutputDir: walk.report.outputDir ? path.relative(REPO_ROOT, walk.report.outputDir) : null,
    failure: error ? String(error?.message ?? error).slice(0, 2000) : null,
  }
  // 证据摘要进仓库：落盘前最后一道，内容里不许有 key 原串（openPaidWalk 的证据目录自检管不到这里）。
  const key = String(process.env.APIMART_API_KEY ?? '').trim()
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (key.length >= 8 && text.includes(key)) { console.error('[paid] 证据摘要里出现了 key 原串，拒绝写入仓库——请更换这把 key'); process.exitCode = 1; return }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  const file = path.join(EVIDENCE_DIR, PROBE ? 'probe-report.json' : 'report.json')
  fs.writeFileSync(file, text)
  console.log(`[paid] 证据摘要：${path.relative(REPO_ROOT, file)}`)
}
