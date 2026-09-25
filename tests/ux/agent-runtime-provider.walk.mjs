#!/usr/bin/env node
// Separate, explicitly enabled paid smoke. Uses a formal Nomi.app and synthetic text only.
// Never prints credentials or opens/copies a user's projects. No transport or model is mocked.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_PERMISSION, CREATION_PANEL, DOCUMENT, INTERVENTION_CONFIRM, TOOL_RECEIPT,
  readProject, finalizeRuntimeWalk, openCanvas, sendCanvas, sendCreation,
  permissionTier, stopRuntimeApp, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { realNomiProfile, removeRealCredentials, seedRealCredentialStore } from './_realProfile.mjs'

if (process.env.NOMI_AGENT_LIVE !== '1') throw new Error('Explicit paid evaluation requires NOMI_AGENT_LIVE=1')
const [flag, executablePath, ...extra] = process.argv.slice(2)
if (flag !== '--packaged' || !path.isAbsolute(executablePath ?? '') || extra.length) {
  throw new Error('Usage: NOMI_AGENT_LIVE=1 node <walk.mjs> --packaged /absolute/Nomi.app/Contents/MacOS/Nomi')
}

const vendorKey = 'apimart'
const modelKey = 'deepseek-v4-pro'
// 真实资料目录在哪、钥匙是哪几份文件，只问 owner（三平台 + NOMI_REAL_PROFILE_USER_DATA 覆盖口）。
const profile = realNomiProfile({ env: process.env })
if (!path.isAbsolute(profile.userDataDir)) throw new Error('NOMI_REAL_PROFILE_USER_DATA must be an absolute directory')
const sourceFile = profile.catalogPath
const sourceBytes = fs.readFileSync(sourceFile)
const source = JSON.parse(sourceBytes.toString('utf8'))
const vendor = source.vendors.find((entry) => entry.key === vendorKey && entry.enabled !== false)
const model = source.models.find((entry) => entry.vendorKey === vendorKey && entry.modelKey === modelKey && entry.enabled !== false)
// Existing image declarations only: they make offline node/model selection
// realistic. This walk never approves a media-generation tool or calls one.
const imageModels = source.models.filter((entry) => entry.vendorKey === vendorKey && entry.kind === 'image' && entry.enabled !== false)
const imageKeys = new Set(imageModels.map((entry) => entry.modelKey))
const imageMappings = (source.mappings ?? []).filter((entry) => entry.vendorKey === vendorKey && imageKeys.has(entry.modelKey))
const credential = source.apiKeysByVendor?.[vendorKey]
if (!vendor || !model || !credential?.apiKey || credential.enabled === false || credential.enc !== 'safeStorage') {
  throw new Error('The requested live model needs an existing enabled, OS-encrypted APIMart credential')
}
const sourceEndpoint = new URL(vendor.baseUrlHint)
if (sourceEndpoint.origin !== 'https://api.apimart.ai' || vendor.providerKind !== 'openai-compatible') {
  throw new Error('This smoke is limited to the verified official APIMart endpoint/protocol')
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-pi-provider-'))
const settingsDir = path.join(tempRoot, 'settings')
// 显式给出并交给启动器：Windows 的钥匙（Local State）要在 App 起来之前放进它真正用的 userData。
const userDataDir = path.join(tempRoot, 'user-data')
const catalogFile = path.join(settingsDir, 'model-catalog.json')
const outputDir = path.join(repoRoot, '.tmp', `pi-provider-packaged-${Date.now()}`)
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(outputDir, { recursive: true })
const ORIGINAL = '这是隔离验收文稿。一位创作者把红色杯子放到白桌中央。'
const APPEND = 'NOMIPILIVEAPPEND：验收完成。'
let launched
let projectRoot
let failure
const report = { vendorKey, modelKey, outputDir, tempRoot, paid: true, monetaryCost: 'not supplied by provider response' }

function modelResponses() {
  if (!projectRoot) return []
  return readLaneTranscripts(projectRoot).flatMap(laneMessages).filter((message) => message.role === 'assistant')
}

try {
  // A minimal v8 input, not a downgrade/rewrite of the user's (possibly newer) catalog.
  // Even a partial failed write is owned by the finally cleanup below.
  fs.writeFileSync(catalogFile, JSON.stringify({
    version: 8, vendors: [vendor], models: [model, ...imageModels], mappings: imageMappings, apiKeysByVendor: { [vendorKey]: credential },
  }), { flag: 'wx', mode: 0o600 })
  seedRealCredentialStore(userDataDir, profile)
  launched = await launchNomiApp({
    name: 'pi-live-provider', tempRoot, settingsDir, userDataDir, executablePath, settleMs: 0,
    env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
  })
  const { app, win } = launched
  win.setDefaultTimeout(120_000)
  const platform = await app.evaluate(({ app: mainApp }) => ({
    packaged: mainApp.isPackaged, appPath: mainApp.getAppPath(), node: process.versions.node,
    electron: process.versions.electron, userData: mainApp.getPath('userData'),
  }))
  expect(platform.packaged).toBe(true)
  expect(platform.appPath.endsWith('app.asar')).toBe(true)
  expect(platform.userData).toBe(launched.userDataDir)
  report.platform = platform
  await win.evaluate(({ vendorKey, modelKey }) => {
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
    localStorage.setItem('nomi-color-scheme', 'light')
    localStorage.setItem('nomi.assistantModel', JSON.stringify({ vendorKey, modelKey }))
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  }, { vendorKey, modelKey })
  await win.reload({ waitUntil: 'domcontentloaded' })
  expect(win.url().startsWith('file:')).toBe(true)
  await clickOrFail(win.getByRole('button', { name: /^新建空白项目/ }), '创建隔离真模型验收项目')
  await expect(win.locator(DOCUMENT)).toBeVisible({ timeout: 120_000 })
  const projectId = await win.evaluate(() => {
    const url = new URL(location.href)
    return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  })
  const projects = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
  projectRoot = projects.find((project) => project.id === projectId)?.rootPath
  expect(projectRoot).toBeTruthy()
  expect(path.relative(launched.projectsDir, projectRoot).startsWith('..')).toBe(false)
  await win.locator(DOCUMENT).fill(ORIGINAL)
  await sendCreation(win, '这是一条连接验收消息。请不要调用任何工具，只回复 NOMI_PI_LIVE_OK。')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, doneTimeout: 120_000,
    settledBy: win.locator(CREATION_PANEL).getByText('NOMI_PI_LIVE_OK', { exact: false }).last() })
  await expect(win.locator(CREATION_PANEL)).toContainText('NOMI_PI_LIVE_OK', { timeout: 120_000 })
  expect(modelResponses().at(-1).stopReason).toBe('stop')
  expect(modelResponses()[0].usage.totalTokens).toBeGreaterThan(0)
  await clickOrFail(win.locator(`${CREATION_PANEL} ${COMPOSER_PERMISSION}`), '开启每步确认验收')
  await clickOrFail(win.locator(permissionTier('step')), '每步问')

  // 20 动词：文稿写只有 `write_script(where)` 一个动词；`append_to_end` 今天只是**传输层**的方法名
  // （`documentWrite.ts`），模型那边没有这个工具，点名它等于叫它调一个不存在的东西。
  await sendCreation(win, `请只调用一次 write_script（where=end），把这句原样追加到文末：${APPEND}。不要调用其他工具，不要扩写。`)
  // v4：待批准的操作落在**介入槽**里（composer 正上方那一格），一次一个。
  const approval = win.locator(`${CREATION_PANEL} ${APPROVAL_CARD}`).filter({ hasText: APPEND })
  const proof = await proveProbe(approval, 'The real model must propose an actual append for human approval', 120_000)
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  expect(JSON.stringify((await readProject(win, projectId)).payload.workbenchDocument)).not.toContain(APPEND)
  await screenshotSettled(win, { path: path.join(outputDir, '01-live-approval.png') })
  await clickOrFail(approval.locator(INTERVENTION_CONFIRM), '批准真模型追加')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, doneTimeout: 120_000, settledBy: win.locator(DOCUMENT).getByText(APPEND, { exact: false }) })
  expect(modelResponses().at(-1).stopReason).toBe('stop')
  await expect(win.locator(DOCUMENT)).toContainText(APPEND)
  expect((await win.locator(DOCUMENT).innerText()).split(APPEND)).toHaveLength(2)
  await expectAbsent(approval, { provenBy: proof, message: 'The real approval is consumed exactly once' })
  const messages = readLaneTranscripts(projectRoot).flatMap(laneMessages)
  const assistants = messages.filter((message) => message.role === 'assistant')
  expect(assistants.length).toBeGreaterThanOrEqual(3)
  expect(assistants.every((message) => message.provider === vendorKey && message.model === modelKey)).toBe(true)
  // 转录里的 `toolName` 是模型调的那个**动词**（真 pi 落盘实核：`tests/agent-runtime/__fixtures__/lane-projection.json`），
  // 不是它翻成的方法名。写方法名在这里是一条恒假的断言。
  expect(messages.filter((message) => message.role === 'toolResult' && message.toolName === 'write_script')).toHaveLength(1)
  await expect.poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocument),
    { timeout: 30_000 }).toContain(APPEND)
  await screenshotSettled(win, { path: path.join(outputDir, '02-live-applied.png') })
  await clickOrFail(win.locator('[aria-label="文本工具栏"]').getByRole('button', { name: '撤销', exact: true }), '撤销真模型的实际变更')
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  await screenshotSettled(win, { path: path.join(outputDir, '03-live-undone.png') })

  await openCanvas(win)
  // ── 20 动词之后这一幕为什么长这样（拍板 2026-09-11 / 本分支的根因合同）──
  //
  // 旧版让真模型「一次 `nomi_canvas_write` 同时建两个 image 节点并连参考」。那一次调用就是本分支
  // 关掉的那扇门：画布写动词能把生成类节点摆上画布，于是有一条永远不出付费卡的路
  // （`docs/fixes/2026-09-11-agent-generation-second-door.root-cause.json`）。v2 里三个画布写动词
  // 收到生成类 kind 一律 `wrong_verb` 拒绝并点名 `draft_shots`，所以那一次调用在今天**不可能成功**——
  // 照抄旧断言只会得到一条恒红（或者更糟：靠放宽断言变成恒绿）的走查。
  //
  // 所以这一幕改成 v2 里真的走得通、且形状每一项都从生产代码可核对的那条路：
  // `make_artifact` 一次一件（`canvas.write` / `create_canvas_nodes`，`verbSemanticInput.ts`
  // 写死了它只造一个 `agent-artifact` 节点）＋ `arrange_canvas` 连一条参考线
  // （`connect_canvas_edges`）。付费那条路（`draft_shots` / `generate`）落在下面的禁用判据里：
  // 真模型碰一下这一幕就红——这才是一条付费冒烟该证的事。
  //
  // 每一步各自出一张介入槽卡、各自留一行收据（每步确认档），撤销只认**最后**那份提案的收据
  // （`laneReceiptUndo.undoableLaneToolCallId`），所以最后撤的是连线，两个节点留在画布上。
  const plan = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}`)
  const landCanvasStep = async (ask, approveLabel, expected) => {
    await sendCanvas(win, ask)
    // A real provider may spend most of the runtime's first-response budget thinking.
    // Playwright's locator expectation has its own 5s default and ignores page.setDefaultTimeout,
    // so use the same explicit 120s bound as the durable turn checks above.
    await expect(plan).toBeVisible({ timeout: 120_000 })
    await expect(plan.locator(INTERVENTION_CONFIRM)).toBeVisible()
    // 批准之前盘上一个字都不许变：这一条是「提案不是改动」的唯一凭据。
    const before = (await readProject(win, projectId)).payload.generationCanvas
    // Only this step's own control is approved; generic generation approvals are
    // never clicked, even if a model ignores the explicit no-generation request.
    await clickOrFail(plan.locator(INTERVENTION_CONFIRM), approveLabel)
    await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, doneTimeout: 120_000, settledBy: win.locator(`${CANVAS_PANEL} ${TOOL_RECEIPT}`).last() })
    expect(modelResponses().at(-1).stopReason).toBe('stop')
    await expect.poll(async () => {
      const canvas = (await readProject(win, projectId)).payload.generationCanvas
      return { nodes: canvas.nodes.length, edges: canvas.edges.length }
    }, { timeout: 30_000 }).toEqual(expected)
    return before
  }

  const untouched = await landCanvasStep(
    '在画布上放一张手写的纯文本卡片，标题就叫 NOMILIVESOURCE，正文随便写一句。不要生成任何图片或视频，不要起任何生成任务。',
    '批准真模型建 NOMILIVESOURCE 卡片', { nodes: 1, edges: 0 })
  expect(untouched.nodes).toHaveLength(0)
  expect(untouched.edges).toHaveLength(0)
  await screenshotSettled(win, { path: path.join(outputDir, '04-live-canvas-proposal.png') })
  await landCanvasStep(
    '再放一张同样的手写纯文本卡片，标题叫 NOMILIVETARGET。仍然不要生成任何东西。',
    '批准真模型建 NOMILIVETARGET 卡片', { nodes: 2, edges: 0 })
  await landCanvasStep(
    '把 NOMILIVESOURCE 当参考连到 NOMILIVETARGET，只连线，不要生成任何东西。',
    '批准真模型连参考线', { nodes: 2, edges: 1 })
  // 证据块（`landed` … `receipt`）被 `agent-runtime-provider.test.mjs` 原样抽出来对着合成转录跑，
  // 所以它只许用注入进去的那几个东西（readProject / win / projectId / readLaneTranscripts /
  // projectRoot / laneMessages / expect）：抽一个读画布的小助手出来，块里就找不到它了。
  const landed = (await readProject(win, projectId)).payload.generationCanvas
  const from = landed.nodes.find((node) => node.title === 'NOMILIVESOURCE')
  const to = landed.nodes.find((node) => node.title === 'NOMILIVETARGET')
  // 手作产物节点的 kind 由 `make_artifact` 的翻译写死（`verbSemanticInput.ts`：`agent-artifact`）。
  // 它**不是**生成类 kind——这一幕从头到尾没有任何东西可生成，也就没有任何东西可花钱。
  expect(from?.kind).toBe('agent-artifact')
  expect(to?.kind).toBe('agent-artifact')
  expect(landed.edges[0]).toMatchObject({ source: from.id, target: to.id })
  expect(landed.edges[0].mode ?? 'reference').toBe('reference')
  const allMessages = readLaneTranscripts(projectRoot).flatMap(laneMessages)
  const toolCalls = allMessages.filter((message) => message.role === 'assistant').flatMap((message) => message.content)
    .filter((part) => part.type === 'toolCall')
  // 转录里记的是**动词名**（模型看到的那 20 个），不是传输层的方法名（`append_to_end` / `nomi_generation_plan`
  // 那些）。名单写动词名，写别的就成了一条恒真的断言：谁都不在名单里，mediaCalls 永远非空。
  const allowedTools = ['read_script', 'write_script', 'look_at_canvas', 'make_artifact', 'arrange_canvas']
  const mediaCalls = toolCalls.filter((part) => !allowedTools.includes(part.name))
  expect(mediaCalls, 'No media generation or unrelated tool may be requested in this smoke').toHaveLength(0)
  const createCalls = toolCalls.filter((part) => part.name === 'make_artifact')
  const createResults = allMessages.filter((message) => message.role === 'toolResult' && message.toolName === 'make_artifact')
  expect(createCalls).toHaveLength(2)
  expect(createResults).toHaveLength(2)
  expect(createResults.map((result) => result.toolCallId)).toEqual(createCalls.map((call) => call.id))
  for (const result of createResults) {
    expect(result).toMatchObject({ isError: false, details: { applied: true, operation: 'create_canvas_nodes' } })
  }
  expect(createResults.flatMap((result) => result.details.affectedNodeIds).toSorted()).toEqual([from.id, to.id].toSorted())
  const linkCalls = toolCalls.filter((part) => part.name === 'arrange_canvas')
  const linkResults = allMessages.filter((message) => message.role === 'toolResult' && message.toolName === 'arrange_canvas')
  expect(linkCalls).toHaveLength(1)
  expect(linkResults).toHaveLength(1)
  expect(linkResults[0]).toMatchObject({ toolCallId: linkCalls[0].id, isError: false,
    details: { applied: true, operation: 'connect_canvas_edges', connectedCount: 1 } })
  expect(linkResults[0].details.affectedEdgeIds).toHaveLength(1)
  const receipt = win.locator(`${CANVAS_PANEL} ${TOOL_RECEIPT}`).last()
  await expect(receipt).toHaveCount(1)
  await screenshotSettled(win, { path: path.join(outputDir, '05-live-canvas-committed.png') })
  // 撤销只认最后那份提案（G5 owner 的那一份），所以撤掉的是连线，两个节点留着。
  await clickOrFail(receipt.getByRole('button', { name: '撤销', exact: true }), '撤销真模型连的那条参考线')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return { nodes: canvas.nodes.length, edges: canvas.edges.length }
  }, { timeout: 30_000 }).toEqual({ nodes: 2, edges: 0 })
  // v4 里发送与停止是同一颗钮：运行态由 composer 的 data-mode 标记，回合落地后它必须不在。
  await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`)).toBeHidden()
  await screenshotSettled(win, { path: path.join(outputDir, '06-live-canvas-undone.png') })
  report.modelResponses = allMessages.filter((message) => message.role === 'assistant').length
  report.mediaToolRequests = mediaCalls.length
  report.verified = ['real-text-response', 'document-approval-apply-undo', 'reported-canvas-task-approval-apply-undo']
  report.responses = modelResponses().map(({ stopReason, usage }) => ({ stopReason, usage }))
  report.totalTokens = report.responses.reduce((sum, response) => sum + response.usage.totalTokens, 0)
} catch (error) {
  failure = error
  process.exitCode = 1
  if (launched) {
    try { await launched.win.screenshot({ path: path.join(outputDir, 'FAIL.png') }) }
    catch (captureError) { console.error('Failure screenshot unavailable:', captureError.message) }
  }
} finally {
  await finalizeRuntimeWalk(report, {
    error: failure,
    cleanup: [
      () => launched && stopRuntimeApp(launched.app),
      () => {
        // Only our exclusive temporary credential copy (catalog + key store) is removed; never write the source.
        report.temporaryCredentialRemoved = removeRealCredentials({ settingsDir, userDataDir, profile })
      },
    ],
    collect: () => {
      report.responses ??= modelResponses().map(({ stopReason, usage }) => ({ stopReason, usage }))
      report.sourceUnchanged = createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex')
        === createHash('sha256').update(sourceBytes).digest('hex')
      expect(report.sourceUnchanged, 'source catalog changed during live evaluation').toBe(true)
    },
  })
}
