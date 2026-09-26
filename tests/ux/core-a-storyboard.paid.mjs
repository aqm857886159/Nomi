#!/usr/bin/env node
/* global process, localStorage, console */
// Opt-in real-provider acceptance. All writes/spend use the original UI/runner.
// NOMI_SPEND_OK=1 node tests/ux/core-a-storyboard.paid.mjs [--packaged /absolute/Nomi] [--first-frame] [--resume-report /absolute/report.json]
//
// 2026-09-26 付费确认新规则（spendConfirmationRequirement）：分镜表里用户自己点的**单行**「生成镜 N」不弹确认；
// 一下跑 ≥2 份（「生成全部」两镜、首帧 + 视频两波）才弹，且确认框里不再有价格行。这条旅程按新规则走：
// 两镜「生成全部」→ 弹框无价 → 取消一笔不发 → 单行「生成镜 1」不弹框出图 → 剩一镜的「生成全部」同样不弹框。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { expect } from '@playwright/test'
import { require as tsxRequire } from 'tsx/cjs/api'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { prepareIsolation, createBlankProject, readProjectPayload } from '../../evals/lib/isoApp.mjs'
import { cheapVideoNodeProblems } from './_agentVideoPaid.mjs'
import { PRICE_LINE, SPEND_DIALOG, assertPaidRunAllowed, spendReceipt, watchSpendDialogs } from './_paidRun.mjs'
import { realNomiProfile, removeRealCredentials, seedRealCredentials } from './_realProfile.mjs'
import { AGENT_PANEL, DOCUMENT, chooseAssistantModel, expandResidentPanel, sendCreation, waitForV4TurnIdle, stopRuntimeApp } from './agent-runtime-walk-support.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { proveProbe, expectAbsent } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

// 开关、CI 拒跑、用户 Nomi 开着拒跑、原库指纹：付费走查唯一那一份（_paidRun.mjs）。
const guard = assertPaidRunAllowed('core-a-storyboard.paid.mjs')
const { values } = parseArgs({ options: { packaged: { type: 'string' }, 'first-frame': { type: 'boolean', default: false }, 'resume-report': { type: 'string' }, 'verify-only': { type: 'boolean', default: false }, 'output-dir': { type: 'string' } } })
if (values.packaged) assert.ok(path.isAbsolute(values.packaged), '--packaged requires an absolute executable path')
const resumed = values['resume-report'] ? JSON.parse(fs.readFileSync(path.resolve(values['resume-report']), 'utf8')) : null
if (values['verify-only']) assert.ok(resumed?.firstFrame?.referenceProof && values['first-frame'], '--verify-only requires a completed first-frame receipt and --first-frame')
const tempRoot = resumed ? path.resolve(resumed.tempRoot) : fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-core-a-paid-'))
// Never prepareIsolation on resume: that owner intentionally deletes its target.
const iso = resumed ? (resumed.isolation ?? { projectsDir: path.join(tempRoot, 'projects'), settingsDir: path.join(tempRoot, 'settings'), chromiumDir: path.join(tempRoot, 'chromium'), capabilityDir: path.join(tempRoot, 'capability') }) : prepareIsolation(tempRoot)
if (resumed) {
  // 上一场收尾时凭据文件已经删了（见 finally）；续跑之前按同一个 owner 重新带进来。
  seedRealCredentials({ settingsDir: iso.settingsDir, userDataDir: iso.chromiumDir })
  assert.equal(resumed.mode, values.packaged ? 'packaged' : 'source-build')
  assert.ok(resumed.projectId && resumed.runId && resumed.projectRoot)
  const relative = path.relative(iso.projectsDir, path.resolve(resumed.projectRoot))
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Resume project must belong to the original isolation')
  for (const directory of Object.values(iso)) {
    assert.ok(path.resolve(directory).startsWith(`${tempRoot}${path.sep}`))
    assert.ok(fs.statSync(directory).isDirectory())
  }
}
// Prove that this script copied the real catalog, including encrypted credentials,
// without changing prices, enabling models, or substituting provider endpoints.
if (!resumed) assert.ok(fs.readFileSync(realNomiProfile().catalogPath).equals(fs.readFileSync(path.join(iso.settingsDir, 'model-catalog.json'))))
const catalog = JSON.parse(fs.readFileSync(path.join(iso.settingsDir, 'model-catalog.json'), 'utf8'))
const textModel = catalog.models.find(model => model.vendorKey === 'apimart' && model.modelKey === 'deepseek-v3.2' && model.enabled)
const imageModel = catalog.models.find(model => model.vendorKey === 'apimart' && model.modelKey === 'z-image-turbo' && model.enabled)
assert.ok(textModel && imageModel, 'Configured apimart deepseek-v3.2 and z-image-turbo must both be enabled')
const outputDir = path.resolve(values['output-dir'] || path.join(repoRoot, '.tmp', `core-a-storyboard-paid-${Date.now()}`))
fs.mkdirSync(outputDir, { recursive: true })
const report = { outputDir, tempRoot, mode: values.packaged ? 'packaged' : 'source-build', startedAt: new Date().toISOString(), launches: [], rounds: [], screenshots: [], results: [], platform: process.platform, windows: 'unverified', agentCost: 'unknown' }
report.isolation = iso
if (resumed) {
  report.resume = { from: path.resolve(values['resume-report']), previousStatus: resumed.status, previousResults: resumed.results ?? [] }
  report.rounds = resumed.rounds ?? []
  report.cancel = resumed.cancel
}
const options = {
  name: 'core-a-storyboard-paid', tempRoot, userDataDir: iso.chromiumDir, projectsDir: iso.projectsDir,
  settingsDir: iso.settingsDir, capabilityDir: iso.capabilityDir,
  ...(values.packaged ? { executablePath: values.packaged } : {
    initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
  }),
  env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
}
const { createProductionRunRepository } = tsxRequire('../../electron/productionRun/productionRunRepository.ts', import.meta.url)
let gui, win, projectRoot, projectId, runId, repository, failure
const editedPrompt = 'A small white ceramic cup beside a sunlit window, warm morning light, clean editorial photograph, no text.'
const keyframePrompt = 'Static wide composition: one white ceramic cup on a wooden table beside a sunlit window, warm morning light, no text.'
const run = () => repository.read(projectId, runId)
const nodes = () => readProjectPayload(projectRoot)?.payload?.generationCanvas?.nodes ?? []
/**
 * 方案正本住在项目记录里（和用户手建的方案同一处），`runId` 同时是那条方案的 id：
 * 模型手里那个 draft id 与用户侧栏那一行是同一个身份。
 */
const plan = () => Object.values(readProjectPayload(projectRoot)?.payload?.storyboardDesignsByDocumentId ?? {})
  .flat().find(design => design.id === runId)?.plan
const boundNodes = () => nodes().filter(node => node.meta?.storyboardDesignId === runId)
const execution = () => ({ jobs: run()?.jobs ?? [], nodes: nodes().map(node => ({ id: node.id, runs: node.runs ?? [], result: node.result ?? null, taskId: node.progress?.taskId ?? null })) })
const identity = () => boundNodes().map(node => ({ nodeId: node.id, resultId: node.result?.id ?? null })).sort((a, b) => a.nodeId.localeCompare(b.nodeId))
const editor = () => win.locator('[data-storyboard-editor="true"]')
const dialog = () => win.locator(SPEND_DIALOG)
function completedResults() {
  return nodes().filter(node => node.result?.id && node.meta?.storyboardDesignId).map(node => ({
    runId: node.meta.storyboardDesignId, nodeId: node.id, resultId: node.result.id, taskId: node.result.taskId ?? null,
    cost: node.result.provenance?.cost ?? 'unknown', costSource: 'result.provenance.cost', type: node.result.type,
  }))
}
function assertRemainingImage() {
  validateDraft()
  const shots = plan().shots
  const done = boundNodes().filter(node => node.result?.url)
  assert.equal(done.length, 1, 'Resume/batch requires exactly one existing completed image')
  assert.equal(done[0].meta.shotId, shots[0].shotId, 'Only the first shot may already be complete')
  assert.equal(done[0].result.type, 'image')
  assert.ok(done[0].result.id && done[0].result.taskId)
  assert.equal(done[0].runs?.length, 1)
  assert.equal(done[0].runs[0].status, 'success')
  assert.equal(done[0].result.provenance?.provider, 'apimart')
  assert.equal(done[0].result.provenance?.modelKey, 'z-image-turbo')
  const pending = boundNodes().filter(node => node.meta.shotId === shots[1].shotId)
  assert.ok(pending.length <= 1)
  for (const node of pending) {
    assert.ok(!node.result && !node.runs?.length && !node.progress?.taskId, 'Remaining shot must never have been submitted')
  }
  assert.equal(nodes().filter(node => node.runs?.length || node.result).length, 1, 'No unrelated paid task may exist before continuation')
}
async function snap(label) {
  const file = path.join(outputDir, `${label}.png`)
  await win.screenshot({ path: file })
  report.screenshots.push(file)
}
async function start() {
  gui = await launchNomiApp(options)
  win = gui.win
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  const info = await gui.app.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'), pid: process.pid }))
  assert.equal(info.packaged, Boolean(values.packaged))
  assert.equal(info.userData, iso.chromiumDir)
  assert.ok(win.url().startsWith('file:'), 'Acceptance must use the built application')
  if (!values.packaged) {
    assert.equal(path.resolve(info.appPath), repoRoot)
    info.buildStamp = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'build-stamp.json'), 'utf8'))
    assert.deepEqual(info.buildStamp, JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist-electron', 'build-stamp.json'), 'utf8')))
  }
  report.launches.push(info)
}
async function openPlan() {
  if (!win.url().includes(`projectId=${projectId}`)) {
    await win.locator('[data-project-card]').first().click()
  }
  await win.getByRole('button', { name: /^(创作|Create)$/ }).click()
  const treeToggle = win.locator('[data-creation-resource-tree-toggle]:visible')
  await expect(treeToggle).toBeVisible()
  if (await treeToggle.getAttribute('data-creation-resource-tree-toggle') === 'expand') await treeToggle.click()
  await win.locator(`[data-storyboard-id="${runId}"]`).click()
  await expect(editor()).toBeVisible()
  const collapse = win.locator('[data-creation-resource-tree-toggle="collapse"]:visible')
  if (await collapse.isVisible()) await collapse.click()
}
function trajectory() {
  if (!projectRoot) return { calls: [], results: [] }
  const calls = [], results = []
  for (const session of readLaneTranscripts(projectRoot)) for (const message of laneMessages(session)) {
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) if (part.type === 'toolCall') calls.push({ id: part.id, name: part.name, args: part.arguments })
    }
    if (message.role === 'toolResult') results.push({ id: message.toolCallId, name: message.toolName, isError: message.isError === true,
      text: (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n') })
  }
  return { calls, results }
}
function validateDraft() {
  const draft = run().generationPlan
  assert.equal(draft.shots.length, 2, 'Exactly two image shots are authorized')
  for (const shot of draft.shots) {
    assert.equal(shot.candidate.providerId, 'apimart')
    assert.equal(shot.candidate.modelId, 'z-image-turbo')
    assert.equal(shot.candidate.mode, 'text_to_image')
    assert.equal((shot.candidate.references ?? []).length, 0)
  }
  assert.equal(plan()?.shots.length, 2, 'The original runner must read exactly the authorized two image shots')
  for (const shot of plan().shots) {
    assert.equal(shot.modelVendor, 'apimart')
    assert.equal(shot.modelKey, 'z-image-turbo')
    assert.equal(shot.shotKind, 'image')
    assert.ok(!shot.keyframe?.enabled)
    assert.equal((shot.anchorIds ?? []).length, 0)
    assert.equal(Object.values(shot.referenceBindings ?? {}).flat().length, 0)
  }
  assert.equal((plan()?.anchors ?? []).length, 0)
}
/** 确认框在屏上：它说的是几份、里面没有价格行（新规则），原文进报告。 */
async function readDialog(label) {
  await expect(dialog()).toBeVisible()
  const text = await dialog().innerText()
  assert.ok(!PRICE_LINE.test(text), `${label}: the confirmation dialog must not show a price line (got: ${text.replace(/\s+/g, ' ')})`)
  report[label] = text
  await snap(label)
  return text
}
/**
 * 用户自己点的单个生成：点下去**全程不弹确认框**，直接出图。观察者挂在真实 DOM 上（确认框可能一闪而过），
 * 活体探针是这一行画框的状态——它没走过任何一个值，「0 次弹框」就不作数。
 */
async function generateWithoutDialog(label, click, row) {
  assert.equal(values['verify-only'], false, 'Read-only verification cannot approve spending')
  validateDraft()
  const frame = `[data-storyboard-editor="true"] [data-storyboard-row="${row}"] [data-storyboard-frame]`
  const watch = await watchSpendDialogs(win, { selector: frame, attribute: 'data-storyboard-frame' })
  await click()
  await expect(editor().locator(`[data-storyboard-row="${row}"] [data-storyboard-frame]`)).toHaveAttribute('data-storyboard-frame', 'done', { timeout: stationTimeout({ operations: 12 }) })
  const seen = await watch.read()
  report[label] = seen
  assert.ok(seen.liveness.length >= 2, `${label}: the observer must see the row frame change before trusting "no dialog" (${JSON.stringify(seen.liveness)})`)
  assert.equal(seen.dialogs, 0, `${label}: a single user-initiated generation must not show a confirmation dialog`)
}
async function assertRestored(expected) {
  await openPlan()
  await expect(editor().locator('[data-storyboard-prompt-block] [contenteditable="true"]').first()).toHaveText(editedPrompt)
  await expect(editor().locator('[data-storyboard-frame="done"]')).toHaveCount(2)
  await expect.poll(identity).toEqual(expected)
  await expect(editor().locator('[data-storyboard-frame] img')).toHaveCount(2)
  for (const img of await editor().locator('[data-storyboard-frame] img').all()) {
    await expect.poll(() => img.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  }
}
// Optional second paid journey: original row -> original two-wave confirmation.
async function firstFrameJourney() {
  assert.equal(values['verify-only'], false, 'Read-only verification cannot create or submit a new journey')
  const model = catalog.models.find(item => item.vendorKey === 'apimart' && item.modelKey === 'doubao-seedance-2.0' && item.enabled)
  assert.ok(model, 'The configured Seedance 2.0 model must be enabled')
  const imageRunId = runId
  const documentId = run().origin.sourceDocument.documentId
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await openPlan()
  await win.locator('[data-creation-resource-tree-toggle="expand"]:visible').click()
  await win.locator(`button[data-document-id="${documentId}"]:not([data-storyboard-id])`).click()
  await expandResidentPanel(win)
  await chooseAssistantModel(win, textModel.labelZh)
  await win.keyboard.press('Escape')
  const priorRuns = new Set(repository.list(projectId).map(item => item.runId))
  const before = trajectory()
  await sendCreation(win, '请新建另一个独立分镜方案，只含1镜视频，不修改已有图片方案。镜头为窗前白瓷杯缓慢推进镜头。使用apimart/doubao-seedance-2.0，taskKind=image_to_video，modeId=i2v，variantId=fast，parameters和分镜params均包含model=doubao-seedance-2.0-fast、duration=4、resolution=480p、generate_audio=false；durationSec=4。首帧keyframe.enabled=true，keyframe.modelVendor=apimart，modelKey=z-image-turbo，modeId=t2i，params={size:"16:9",resolution:"1K"}，prompt描述窗前白瓷杯的静态构图。没有任何锚卡、anchorIds、外部参考图或referenceBindings。仅创建草稿，不执行、不报价、不申请付费，创建后停止。')
  await waitForV4TurnIdle(win, { panel: AGENT_PANEL, doneTimeout: stationTimeout({ turns: 2 }) })
  const after = trajectory()
  const calls = after.calls.filter(call => !before.calls.some(item => item.id === call.id))
  const results = after.results.filter(result => calls.some(call => call.id === result.id))
  const created = repository.list(projectId).filter(item => !priorRuns.has(item.runId))
  report.rounds.push({ purpose: 'optional-first-frame', calls, results, succeeded: created.length === 1 && results.some(result => result.name === 'draft_shots' && !result.isError) })
  assert.equal(created.length, 1, 'Exactly one new first-frame plan must exist')
  runId = created[0].runId
  const validate = () => {
    const generation = run().generationPlan
    assert.equal(generation.shots.length, 1)
    assert.equal(plan()?.shots.length, 1)
    assert.equal((plan().anchors ?? []).length, 0)
    const candidate = generation.shots[0].candidate, shot = plan().shots[0]
    assert.equal(candidate.providerId, 'apimart')
    assert.equal(candidate.modelId, 'doubao-seedance-2.0')
    assert.equal(candidate.mode, 'image_to_video')
    assert.equal(candidate.modeId, 'i2v')
    assert.equal((candidate.references ?? []).length, 0)
    assert.equal(shot.shotKind, 'video')
    assert.equal(shot.modelVendor, 'apimart')
    assert.equal(shot.modelKey, 'doubao-seedance-2.0')
    assert.equal(shot.modeId, 'i2v')
    assert.equal(shot.durationSec, 4)
    for (const params of [candidate.parameters, shot.params]) {
      assert.equal(params.model, 'doubao-seedance-2.0-fast')
      assert.equal(params.duration, 4)
      assert.equal(params.resolution, '480p')
      assert.equal(params.generate_audio, false)
    }
    assert.equal((shot.anchorIds ?? []).length, 0)
    assert.equal(Object.values(shot.referenceBindings ?? {}).flat().length, 0)
    assert.equal(shot.keyframe.enabled, true)
    assert.equal(shot.keyframe.modelVendor, 'apimart')
    assert.equal(shot.keyframe.modelKey, 'z-image-turbo')
    assert.equal(shot.keyframe.modeId, 't2i')
    assert.deepEqual(shot.keyframe.params, { size: '16:9', resolution: '1K' })
  }
  validate()
  await openPlan()
  await editor().getByRole('textbox', { name: '镜 1 首帧图提示词', exact: true }).fill(keyframePrompt)
  await expect.poll(() => plan().shots[0].keyframe.prompt).toBe(keyframePrompt)
  validate()
  assert.equal(boundNodes().filter(node => node.result || node.runs?.length).length, 0)
  await editor().locator('[data-storyboard-row="1"] [data-storyboard-generate-state]').click()
  await expect(dialog()).toBeVisible()
  await expect.poll(() => boundNodes().length).toBe(2)
  const pending = boundNodes()
  const keyframe = pending.find(node => node.meta?.storyboardKeyframe === true)
  const video = pending.find(node => node.kind === 'video')
  assert.ok(keyframe && video)
  const edges = readProjectPayload(projectRoot).payload.generationCanvas.edges
  const dependency = edges.filter(edge => edge.target === video.id)
  assert.equal(dependency.length, 1)
  assert.ok(dependency.some(edge => edge.source === keyframe.id && edge.mode === 'first_frame'))
  assert.equal(video.meta.shotId, keyframe.meta.shotId)
  // 花钱前核对画布执行器真正会派发的那一档：分镜表这条路按**节点 meta** 派发（不按 Run 里的草稿候选）。
  const videoProblems = cheapVideoNodeProblems(video.meta)
  report.firstFrameVideoMeta = { archetype: video.meta?.archetype, modelKey: video.meta?.modelKey, duration: video.meta?.duration, resolution: video.meta?.resolution, generate_audio: video.meta?.generate_audio }
  if (videoProblems.length) {
    await dialog().locator('[data-spend-confirm-action="cancel"]').click()
    throw new Error(`First-frame video is not the authorised Seedance 2.0 fast · 480p · 4s · no-audio tier; cancelled before spending: ${videoProblems.join('; ')}`)
  }
  // 首帧 + 视频是一下跑两份：新规则下照样弹确认，框里说清两份、没有价格行。
  const quote = await readDialog('zh-first-frame-quote')
  assert.match(quote, /2\s*(张|个|项|次|份)/, 'Original confirmation must cover both media tasks')
  report.firstFrame = { runId, imageRunId, quote, keyframeNodeId: keyframe.id, videoNodeId: video.id }
  validate()
  await dialog().locator('[data-spend-confirm-action="confirm"]').click()
  await expect.poll(() => boundNodes().filter(node => node.result?.url).length, { timeout: stationTimeout({ turns: 3 }) }).toBe(2)
  await verifyFirstFrameResults(keyframePrompt)
}
async function verifyFirstFrameResults(keyframePrompt) {
  const done = boundNodes()
  assert.equal(done.length, 2)
  const frameDone = done.find(node => node.id === report.firstFrame.keyframeNodeId)
  const videoDone = done.find(node => node.id === report.firstFrame.videoNodeId)
  assert.ok(frameDone?.result?.url && videoDone?.result?.url)
  const generation = run().generationPlan
  assert.equal(generation.shots.length, 1)
  assert.equal(plan().shots.length, 1)
  assert.equal(plan().shots[0].keyframe.prompt, keyframePrompt)
  for (const params of [generation.shots[0].candidate.parameters, plan().shots[0].params, videoDone.result.provenance?.params?.extras]) {
    assert.equal(params.resolution, '480p')
    assert.equal(params.duration, 4)
    assert.equal(params.generate_audio, false)
    assert.equal(params.model, 'doubao-seedance-2.0-fast')
  }
  const dependency = readProjectPayload(projectRoot).payload.generationCanvas.edges.filter(edge => edge.target === videoDone.id)
  assert.equal(dependency.length, 1)
  assert.equal(dependency[0].source, frameDone.id)
  assert.equal(dependency[0].mode, 'first_frame')
  assert.equal(videoDone.meta.refSnapshot?.[frameDone.id], frameDone.result.id, 'Video must consume this exact keyframe result version')
  assert.ok(videoDone.runs[0].startedAt >= frameDone.runs[0].completedAt, 'Video wave starts after the keyframe completes')
  report.firstFrame.referenceProof = { edges: dependency, sourceResultId: frameDone.result.id, refSnapshot: videoDone.meta.refSnapshot, videoProvenance: videoDone.result.provenance }
  const serializedParams = JSON.stringify(videoDone.result.provenance?.params ?? {})
  assert.ok([frameDone.result.url, frameDone.result.providerUrl].filter(Boolean).some(url => serializedParams.includes(url)), 'Actual video provenance must include the generated keyframe URL')
  for (const node of done) {
    assert.equal(node.runs.length, 1, 'No retry or extra media task is authorized')
    assert.ok(node.result.taskId)
  }
  // Inspect the actual persisted files with the existing ffprobe owner in Node.
  // Playwright's Electron evaluate context supports neither require nor dynamic import.
  const { probeMediaMetadata } = tsxRequire('../../electron/export/mediaProbe.ts', import.meta.url)
  report.firstFrame.media = []
  for (const rawUrl of [frameDone.result.url, videoDone.result.url]) {
    const url = new URL(rawUrl)
    assert.equal(url.protocol, 'nomi-local:')
    assert.equal(url.hostname, 'asset')
    const [ownerId, ...parts] = url.pathname.slice(1).split('/').map(decodeURIComponent)
    assert.equal(ownerId, projectId)
    const filePath = fs.realpathSync(path.resolve(projectRoot, ...parts))
    const relative = path.relative(fs.realpathSync(projectRoot), filePath)
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    report.firstFrame.media.push({ projectId, filePath, probe: await probeMediaMetadata(filePath) })
  }
  await openPlan()
  assert.ok(report.firstFrame.media[0].probe.width > 0 && report.firstFrame.media[0].probe.height > 0, 'Real first-frame bytes must decode')
  const videoProbe = report.firstFrame.media[1].probe
  assert.equal(videoProbe.kind, 'video')
  assert.ok(videoProbe.width > 0 && videoProbe.height > 0 && videoProbe.durationSeconds > 0)
  assert.ok(Math.abs(videoProbe.durationSeconds - 4) < 0.5, 'Provider output must match the authorized four seconds')
  // The vendor documents a resolution preset, not an exact pixel-size mapping.
  // Preserve the actual dimensions and mismatch; do not resize the product or
  // infer exact-pixel compliance from the locally recorded execution parameters.
  report.firstFrame.resolution = {
    requestedPreset: '480p', width: videoProbe.width, height: videoProbe.height,
    exactShortEdgeMatch: Math.min(videoProbe.width, videoProbe.height) === 480,
    pixelMapping: 'not-defined-in-provider-documentation',
    source: 'https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md',
    checkedAt: '2026-09-20',
  }
  assert.equal(videoProbe.hasAudio, false)
  const saved = identity()
  const executionBefore = execution()
  await snap('zh-first-frame-real-video')
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await stopRuntimeApp(gui.app)
  gui = undefined
  await start()
  await openPlan()
  await expect(editor().getByRole('textbox', { name: 'Keyframe image prompt for shot 1', exact: true })).toHaveValue(keyframePrompt)
  await expect(editor().locator('[data-storyboard-frame="done"]')).toHaveCount(1)
  await expect.poll(identity).toEqual(saved)
  assert.deepEqual(execution(), executionBefore)
  await snap('en-first-frame-cold-restored')
}

try {
  await start()
  if (resumed) {
    projectRoot = path.resolve(resumed.projectRoot)
    projectId = resumed.projectId
    runId = resumed.runId
    Object.assign(report, { projectRoot, projectId, runId })
    assert.equal(readProjectPayload(projectRoot).id, projectId)
    repository = createProductionRunRepository({ projectDirResolver: id => id === projectId ? projectRoot : null })
    validateDraft()
    assert.equal(plan().shots[0].prompt, editedPrompt)
    const completedCount = boundNodes().filter(node => node.result?.url).length
    if (values['verify-only']) assert.equal(completedCount, 2, 'Read-only verification requires both original completed images; never submit missing work')
    if (completedCount === 1) assertRemainingImage()
    else {
      assert.equal(completedCount, 2, 'Resume requires one or two completed authorized images')
      assert.deepEqual(completedResults(), resumed.results, 'A completed-image resume must exactly match the saved provider receipts')
      assert.equal(nodes().filter(node => node.runs?.length || node.result).length, values['verify-only'] ? 4 : 2, 'Resume must contain exactly the authorized completed tasks')
      assert.equal(repository.list(projectId).length, values['verify-only'] ? 2 : 1, 'Do not create a duplicate first-frame plan on resume')
    }
    report.resume.completedBefore = completedResults()
    await openPlan()
    await expect(editor().locator('[data-storyboard-row="1"] [data-storyboard-frame]')).toHaveAttribute('data-storyboard-frame', 'done')
    await expect(editor().locator('[data-storyboard-frame="done"]')).toHaveCount(completedCount)
    const restoredImage = editor().locator('[data-storyboard-row="1"] [data-storyboard-frame] img')
    await expect.poll(() => restoredImage.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
    await snap('zh-resume-existing-paid-image')
  } else {
    projectRoot = await createBlankProject(win, iso.projectsDir)
    projectId = readProjectPayload(projectRoot).id
    assert.ok(projectId, 'The real project must have a persisted id')
    report.projectRoot = projectRoot
    report.projectId = projectId
    repository = createProductionRunRepository({ projectDirResolver: id => id === projectId ? projectRoot : null })
    const consent = win.getByRole('button', { name: '不分享', exact: true })
    if (await consent.isVisible()) await consent.click()
    await expect(win.locator(DOCUMENT)).toBeVisible()
    await win.locator(DOCUMENT).fill('清晨：第一镜，阳光穿过窗户照在桌上的白色陶瓷杯。第二镜，窗外一株绿色植物在晨光里。两张独立静态图片，不要视频，不要参考图。')
    await expandResidentPanel(win)
    await chooseAssistantModel(win, textModel.labelZh)
    await win.keyboard.press('Escape')
    const chosen = await win.evaluate(() => JSON.parse(localStorage.getItem('nomi.assistantModel') || 'null'))
    assert.equal(chosen?.vendorKey, 'apimart', 'UI must select the authorized provider')
    assert.equal(chosen?.modelKey, 'deepseek-v3.2')
    const requests = [
      '请读取当前文稿，创建一个恰好两镜的分镜方案草稿。每镜都是纯图片，taskKind=text_to_image，均使用已配置 apimart 的 z-image-turbo。不要视频、首帧、参考图或参考卡。不执行生成、不报价、不请求付费；只创建这一个两镜分镜草稿，完成后停止。',
      '上一轮尚未产生可选的两镜方案。请继续同一个任务：将当前文稿拆成恰好两镜图片分镜草稿，均使用 apimart/z-image-turbo，text_to_image，不要首帧或参考图。只创建草稿，不执行生成或付费。',
    ]
    for (let index = 0; index < requests.length; index++) {
      const before = trajectory()
      await sendCreation(win, requests[index])
      await waitForV4TurnIdle(win, { panel: AGENT_PANEL, doneTimeout: stationTimeout({ turns: 2 }) })
      const after = trajectory()
      const calls = after.calls.filter(call => !before.calls.some(prior => prior.id === call.id))
      const results = after.results.filter(result => calls.some(call => call.id === result.id))
      const created = repository.list(projectId)
      report.rounds.push({ round: index + 1, calls, results, createdRuns: created.map(item => item.runId), succeeded: created.length === 1 && results.some(result => result.name === 'draft_shots' && !result.isError) })
      assert.equal(nodes().filter(node => node.result || node.runs?.length).length, 0, 'Agent draft must not execute media')
      if (created.length) { assert.equal(created.length, 1); runId = created[0].runId; break }
    }
    assert.ok(runId, 'No real storyboard after the authorized maximum of two Agent rounds')
    report.runId = runId
    validateDraft()
    await openPlan()
    await expect(editor().locator('[data-storyboard-row]')).toHaveCount(2)
    await editor().locator('[data-storyboard-prompt-block] [contenteditable="true"]').first().fill(editedPrompt)
    await expect.poll(() => plan()?.shots[0].prompt).toBe(editedPrompt)
    await snap('zh-original-edited')
    const firstGenerate = () => editor().locator('[data-storyboard-row="1"] [data-storyboard-generate-state]')
    const batch = () => editor().locator('[data-storyboard-batch]')
    // ① 两镜一起「生成全部」= 一下跑两份：弹确认框、框里没有价格行。先取消——一笔都不发。
    const beforeCancel = execution()
    await batch().click()
    const cancel = dialog().locator('[data-spend-confirm-action="cancel"]')
    const proof = await proveProbe(cancel, 'Generating both shots at once asks first')
    assert.match(await readDialog('zh-batch-two-dialog'), /2\s*(张|个|项|次|份)/, 'The confirmation says two images')
    await expect.poll(() => boundNodes().length).toBeGreaterThan(0)
    const materialized = boundNodes().map(node => node.id)
    await cancel.click()
    await expectAbsent(cancel, { provenBy: proof })
    assert.deepEqual(run().jobs ?? [], beforeCancel.jobs, 'Cancel must not schedule a Run job')
    for (const node of nodes()) {
      const prior = beforeCancel.nodes.find(item => item.id === node.id)
      assert.deepEqual(node.runs ?? [], prior?.runs ?? [], 'Cancel must not create a task/attempt')
      assert.deepEqual(node.result ?? null, prior?.result ?? null, 'Cancel must not create a result')
      assert.equal(node.progress?.taskId ?? null, prior?.taskId ?? null)
    }
    assert.deepEqual(boundNodes().map(node => node.id), materialized, 'Cancel preserves the materialized nodes')
    report.cancel = { nodesPreserved: materialized, newTasks: 0, newResults: 0 }
    // ② 单行「生成镜 1」：用户自己点的单个生成，不弹框、直接出图。
    await generateWithoutDialog('zh-single-row-no-dialog', () => firstGenerate().click(), 1)
    await expect.poll(() => boundNodes().filter(node => node.result?.url).length).toBe(1)
  }
  if (boundNodes().filter(node => node.result?.url).length !== 2) {
    // ③ 只剩一镜的「生成全部」同样只跑一份：不弹框，而且不重跑已完成的第 1 镜。
    const firstResult = identity().find(item => item.resultId)
    assertRemainingImage()
    await expect(editor().locator('[data-storyboard-frame="done"]')).toHaveCount(1)
    await expect(editor().locator('[data-storyboard-batch]')).toBeEnabled()
    await generateWithoutDialog('zh-batch-remaining-one-no-dialog', () => editor().locator('[data-storyboard-batch]').click(), 2)
    await expect(editor().locator('[data-storyboard-frame="done"]')).toHaveCount(2, { timeout: stationTimeout({ operations: 12 }) })
    await expect.poll(() => boundNodes().filter(node => node.result?.url).length).toBe(2)
    assert.deepEqual(identity().find(item => item.nodeId === firstResult.nodeId), firstResult, 'Batch must not regenerate the completed first shot')
  }
  for (const node of boundNodes()) {
    assert.equal(node.runs?.length, 1, 'Exactly one paid attempt per authorized image; no automatic retry')
    assert.equal(node.runs[0].status, 'success')
    assert.equal(node.result?.type, 'image')
    assert.equal(node.result?.provenance?.provider, 'apimart')
    assert.equal(node.result?.provenance?.modelKey, 'z-image-turbo')
    assert.ok(node.result?.id && node.result?.taskId, 'Provider result/task identity must be persisted')
  }
  const expected = identity()
  await assertRestored(expected)
  await snap('zh-two-real-images')
  const completed = execution()
  await win.reload({ waitUntil: 'domcontentloaded' })
  await assertRestored(expected)
  assert.deepEqual(execution(), completed, 'Hot reload must not add tasks or replace results')
  await snap('zh-hot-restored')
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await stopRuntimeApp(gui.app)
  gui = undefined
  await start()
  await assertRestored(expected)
  assert.deepEqual(execution(), completed, 'Cold reopen must not add tasks or replace results')
  await snap('en-cold-restored')
  if (values['verify-only']) {
    report.firstFrame = structuredClone(resumed.firstFrame)
    runId = report.firstFrame.runId
    assert.deepEqual(completedResults(), resumed.results)
    await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
    await win.reload({ waitUntil: 'domcontentloaded' })
    await verifyFirstFrameResults(keyframePrompt)
    assert.deepEqual(completedResults(), resumed.results, 'Read-only verification must not add paid tasks')
  } else if (values['first-frame']) await firstFrameJourney()
} catch (error) {
  failure = error
  if (win && !win.isClosed()) { try { await snap('FAIL') } catch { /* Preserve original failure. */ } }
} finally {
  if (gui) { try { await stopRuntimeApp(gui.app) } catch (error) { failure ??= error } }
  if (projectRoot) report.results = completedResults() // Preserve actual paid output even when a later assertion fails.
  report.trajectory = trajectory()
  const completedCalls = report.trajectory.calls.filter(call => report.trajectory.results.some(result => result.id === call.id && !result.isError)).length
  report.toolSuccessRate = { successful: completedCalls, total: report.trajectory.calls.length }
  const draftCalls = report.trajectory.calls.filter(call => call.name === 'draft_shots')
  report.draftToolWriteRate = { successful: draftCalls.filter(call => report.trajectory.results.some(result => result.id === call.id && !result.isError)).length, total: draftCalls.length }
  report.roundSuccessRate = { successful: report.rounds.filter(round => round.succeeded).length, total: report.rounds.length }
  if (projectRoot) report.spend = spendReceipt(projectRoot)
  // App 已关：凭据副本（目录里的 key 密文 + 钥匙）当场删掉，项目与隔离设置留作证据（续跑时按 owner 重新带进来）；原库必须一字未动。
  report.credentialCopyRemoved = removeRealCredentials({ settingsDir: iso.settingsDir, userDataDir: iso.chromiumDir })
  try { report.realProfileAfter = guard.assertRealProfileUntouched() } catch (error) { failure ??= error }
  report.realProfileBefore = guard.realProfileBefore
  report.status = failure ? 'failed' : 'passed'
  report.error = failure ? String(failure.stack || failure) : undefined
  report.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`${report.status}: ${path.join(outputDir, 'report.json')}`)
  if (failure) { console.error(report.error); process.exitCode = 1 }
}
