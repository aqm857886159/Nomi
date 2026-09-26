// 分镜两处误报的真机走查（0.22.0 回归，合同 docs/fixes/2026-09-26-storyboard-resolve-vendor-rejected.root-cause.json
// 与 docs/fixes/2026-09-26-storyboard-planned-first-frame-slot.root-cause.json）。
//
// 用户现场：分镜里给视频镜选 APIMart 的 Seedance 2.0「图生视频」、开了首帧——
//   ① 表格上方一条「执行计划检查失败」（每个记了供应商的视频镜都这样），时长检查因此整个没了：
//      超过模型上限的镜头既没有行内警示，点生成也不拦；
//   ② 这一行画面格写「缺参考图参考」、参考列那一格是红的、批量「生成剩余」把它跳过；
//      可生成时那张首帧图本来就会发进这一格。生成完了，那一格照样红。
//
// 这条走查在真实应用里把那条路走完（真人点击、真 IPC、真主进程执行计划检查、真生成执行通路）：
//   A. 打开分镜：没有「执行计划检查失败」，执行计划面板是就绪态（给出了拆条建议）；
//   B. 20 秒那一镜（APIMart Seedance 2.0 上限 15 秒）行上有超上限警示，点它的「生成」被时长闸拦下、零请求；
//   C. 5 秒那一镜：画面格不是「缺必填」，参考列 image_ref 格不红、画的是「本镜首帧」，批量按钮把它算进去；
//   D. 点它的「生成」→ 花钱确认 → 首帧图 → 视频（loopback 收到的视频请求里 image_urls 带着那张首帧图）→ 出片；
//      出片后那一格仍不红，格里就是首帧图。
//
// 只有远端供应商是 loopback 夹具，零额度：内置 APIMart 那家的档案、模型与 curated mapping 原样克隆成一家
// 「APIMart 替身」（独立 vendor key，baseUrl 指向本机夹具，authType none），镜头记的是这一家。
// 内置 apimart 那家的钥匙记录会被删掉——画布执行通路（nomi:tasks:run）按目录直连供应商，
// 不走 NOMI_E2E_PRODUCTION_FIXTURE 那个口子；留着钥匙它就会真的去敲 api.apimart.ai（2026-09-26 实测 401）。
//
// 用法：node tests/ux/storyboard-first-frame-false-alarms.walk.mjs            # 中文
//       WALK_LOCALE=en node tests/ux/storyboard-first-frame-false-alarms.walk.mjs  # 英文
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import {
  createAgentRuntimeFixture,
  FIXTURE_APIMART_MODEL,
  FIXTURE_APIMART_VENDOR,
} from './agent-runtime-fixture.mjs'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const LOCALE = process.env.WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const T = {
  'zh-CN': {
    projectName: '首帧误报走查', creationTab: '创作', continueCreating: '继续创作',
    generateShot: (index) => `生成镜 ${index}`, spendDialog: /开始生成|额度/, confirm: '生成',
    plannedCaption: '本镜首帧', reasonMissing: /缺参考/,
  },
  en: {
    projectName: 'First-frame false alarm walk', creationTab: 'Create', continueCreating: 'Continue creating',
    generateShot: (index) => `Generate shot ${index}`, spendDialog: /Start generation|credit/i, confirm: 'Generate',
    plannedCaption: 'First frame', reasonMissing: /missing required refs/i,
  },
}[LOCALE]

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-first-frame-alarm-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const userDataDir = path.join(tempRoot, 'user-data')
const projectId = 'first-frame-false-alarm-walk'
const projectRoot = path.join(projectsDir, projectId)
const outDir = path.join(repoRoot, 'tests/ux/shots/storyboard-first-frame-false-alarms', LOCALE)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

// APIMart Seedance 2.0 的图生视频只有一个 image_ref 槽（min 1），时长 4–15 秒。
const VIDEO_MODEL = 'doubao-seedance-2.0'
const STANDIN_VENDOR = 'apimart-loopback'
const DESIGN = 'sb-first-frame-alarm'
const videoShot = (index, durationSec, prompt) => ({
  index, shotId: `shot-${index}`, shotKind: 'video', durationSec, anchorIds: [], prompt,
  modelKey: VIDEO_MODEL, modelVendor: STANDIN_VENDOR, modeId: 'i2v',
  keyframe: { enabled: true, prompt: `${prompt}（首帧）`, modelKey: FIXTURE_APIMART_MODEL, modelVendor: STANDIN_VENDOR },
})
const plan = {
  title: T.projectName,
  anchors: [],
  shots: [videoShot(1, 5, '雨夜巷口，霓虹倒影'), videoShot(2, 20, '主角沿巷子一路跑到尽头')],
}
const project = {
  id: projectId, name: T.projectName, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{
      id: 'doc-1', version: 1, title: T.projectName, updatedAt: 10,
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first-frame false alarm walk' }] }] },
    }],
    activeDocumentId: 'doc-1',
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: {
      'doc-1': [{ id: DESIGN, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }],
    },
  },
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

// apimart 档位只为拿到**apimart 形状**的异步应答（task_id → /v1/tasks 轮询、视频压着直到 releaseVideos）。
const fixture = await createAgentRuntimeFixture({
  rootDir: repoRoot, settingsDir, generationProvider: 'apimart', userDataDir, appName: 'nomi',
})

/** 把内置 APIMart 的这两个模型连同它们的 mapping 克隆成「APIMart 替身」，并拿掉内置那家的钥匙。 */
function installLoopbackStandIn() {
  const catalogPath = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const builtinVendor = catalog.vendors.find((vendor) => vendor.key === FIXTURE_APIMART_VENDOR)
  if (!builtinVendor) throw new Error('夹具目录缺内置 APIMart 那一家——走查前提不成立')
  catalog.vendors.push({ ...builtinVendor, key: STANDIN_VENDOR, name: 'APIMart 替身', baseUrlHint: fixture.baseURL, authType: 'none', authHeader: null, authQueryParam: null })
  for (const modelKey of [VIDEO_MODEL, FIXTURE_APIMART_MODEL]) {
    const model = catalog.models.find((entry) => entry.vendorKey === FIXTURE_APIMART_VENDOR && entry.modelKey === modelKey)
    if (!model) throw new Error(`内置 APIMart 目录里没有 ${modelKey}`)
    catalog.models.push({ ...structuredClone(model), vendorKey: STANDIN_VENDOR })
    const mappings = catalog.mappings.filter((entry) => entry.vendorKey === FIXTURE_APIMART_VENDOR && entry.modelKey === modelKey)
    if (mappings.length === 0) throw new Error(`内置 APIMart 目录里 ${modelKey} 没有 mapping`)
    catalog.mappings.push(...mappings.map((mapping) => ({ ...structuredClone(mapping), id: `${mapping.id}-loopback`, vendorKey: STANDIN_VENDOR })))
  }
  delete catalog.apiKeysByVendor[FIXTURE_APIMART_VENDOR]
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
}
installLoopbackStandIn()

/** 夹具没预期的请求：记下路径和最后一条消息（后台 Agent 调用的来由），别只记一个路径。 */
function describeUnexpected(record) {
  const messages = Array.isArray(record.body?.messages) ? record.body.messages : []
  const last = messages.at(-1)
  const content = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? null)
  return { path: record.path, lastRole: last?.role ?? null, lastMessage: String(content).slice(0, 400), tools: (record.body?.tools ?? []).map((tool) => tool?.function?.name).filter(Boolean).slice(0, 12) }
}

async function closeAppHard(instance) {
  const child = instance.process()
  await Promise.race([instance.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

const { app, win } = await launchNomiApp({
  name: `storyboard-first-frame-false-alarms-${LOCALE}`, tempRoot, settingsDir, projectsDir, userDataDir, settleMs: 1200,
  initialLocalStorage: {
    'nomi:locale:v1': LOCALE, 'nomi-color-scheme': 'light',
    'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
  },
  env: {
    NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_DISABLE_AUTO_UPDATE: '1',
    NOMI_E2E_PRODUCTION_FIXTURE: '0',
    // 产物从本机夹具取回（127.0.0.1）：只在未打包构建里、按精确 origin 放行，分类器本身不放宽。
    NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: fixture.baseURL,
  },
  args: ['--no-proxy-server'],
})
const failures = []
const evidence = { locale: LOCALE, checks: {}, requests: {} }
const snap = async (name) => { await screenshotSettled(win, { path: path.join(outDir, name) }) }
const row = (index) => win.locator(`[data-storyboard-row="${index}"]`).first()
const refSlot = (index) => row(index).locator('[data-storyboard-ref-slot="image_ref"]').first()
const spendDialog = () => win.locator('div.fixed.inset-0').filter({ hasText: T.spendDialog }).last()

try {
  const projectCard = win.locator('[data-project-card]', { hasText: T.projectName }).first()
  await expectVisible(projectCard, '隔离 profile 里的走查项目卡没出现')
  await projectCard.hover()
  const cont = projectCard.getByText(T.continueCreating, { exact: false }).first()
  if (await cont.isVisible().catch(() => false)) await cont.click()
  else await projectCard.dblclick()
  await clickOrFail(win.getByRole('button', { name: T.creationTab, exact: true }), '切到创作页')
  await clickOrFail(win.locator(`[data-storyboard-id="${DESIGN}"]`), '侧栏选中分镜设计')
  await expectVisible(win.locator('[data-storyboard-editor="true"]'), '分镜编辑器没有渲染')

  // ── A. 执行计划检查：就绪（有拆条建议），不是「执行计划检查失败」 ──
  const readyPanel = win.locator('[data-storyboard-strategy-state="ready"]').first()
  const ready = await proveProbe(readyPanel, 'A：执行计划面板就绪（主进程真实检查通过、给出拆条建议）', stationTimeout({ operations: 2 }))
  await expectAbsent(win.locator('[data-storyboard-strategy-state="error"]'), { provenBy: ready, message: 'A：仍然显示「执行计划检查失败」' })
  evidence.checks.strategyPanel = 'ready'

  // ── B. 时长：20 秒那一镜行上有超上限警示 ──
  await expectVisible(row(2).locator('[data-storyboard-row-duration-warning="overflow"]'), 'B：20 秒那一镜没有超上限警示（时长检查没在工作）')
  const warning = await proveProbe(row(2).locator('[data-storyboard-row-duration-warning="overflow"]'), 'B：超上限警示')
  await expectAbsent(row(1).locator('[data-storyboard-row-duration-warning]'), { provenBy: warning, message: 'B：5 秒那一镜不该有时长警示' })
  evidence.checks.durationWarning = (await row(2).locator('[data-storyboard-row-duration-warning]').textContent())?.trim()

  // ── C. 开了首帧的图生视频镜：不缺参考、不红、进批量 ──
  await expectVisible(row(1).locator('[data-storyboard-frame="ready"]'), 'C：镜 1 画面格不是就绪态（仍判「缺参考」？）')
  const slotProbe = await proveProbe(refSlot(1), 'C：镜 1 的 image_ref 格')
  await expect(refSlot(1), 'C：镜 1 的 image_ref 格仍是红的缺参考').toHaveAttribute('data-storyboard-ref-state', 'filled')
  await expectVisible(refSlot(1).locator('[data-storyboard-ref-planned="first-frame"]'), 'C：镜 1 的 image_ref 格里没有「本镜首帧」')
  await expect(refSlot(1), 'C：镜 1 的 image_ref 格说明文字不是「本镜首帧」').toContainText(T.plannedCaption)
  await expectAbsent(row(1).locator('[data-storyboard-frame="missing-required"]'), { provenBy: slotProbe, message: 'C：镜 1 画面格仍显示缺必填参考' })
  const batchButton = win.locator('[data-storyboard-batch="true"]').first()
  // 两镜都判「缺参考」时批量一镜都跑不了、按钮是灰的；页脚的排除原因里也不该再有「缺参考」。
  await expect(batchButton, 'C：批量「生成剩余」不可点（开了首帧的镜仍被判缺参考、排除在批量外）').toBeEnabled()
  const progress = win.locator('[data-storyboard-progress="true"]').first()
  await expectVisible(progress, 'C：页脚进度没有渲染')
  await expect(progress, 'C：页脚仍说有镜头因缺参考不进批量').not.toContainText(T.reasonMissing)
  evidence.checks.footer = (await progress.textContent())?.trim()
  evidence.checks.batchLabel = (await batchButton.textContent())?.trim()
  await snap('01-before-generation.png')

  // ── B'. 超上限那一镜点「生成」：时长闸拦下，零请求 ──
  await clickOrFail(row(2).getByRole('button', { name: T.generateShot(2) }), "B'：点镜 2 生成")
  const feedback = win.locator('[data-storyboard-action-feedback]').first()
  const blocked = await proveProbe(feedback, "B'：时长闸的拦截说明")
  await expectAbsent(spendDialog(), { provenBy: blocked, message: "B'：超上限的镜头没被拦，直接弹了花钱确认" })
  evidence.checks.durationGate = (await feedback.textContent())?.trim()
  if (fixture.images.length + fixture.videos.length !== 0) failures.push(`B'：时长闸拦截后仍有 ${fixture.images.length + fixture.videos.length} 次供应商请求`)
  await snap('02-duration-gate-blocks-shot-2.png')

  // ── D. 镜 1 真生成：首帧图 → 视频，视频请求带着首帧图 ──
  await clickOrFail(row(1).getByRole('button', { name: T.generateShot(1) }), 'D：点镜 1 生成')
  await expectVisible(spendDialog(), 'D：没有弹花钱确认卡（执行通路断了）')
  await clickOrFail(spendDialog().getByRole('button', { name: T.confirm, exact: true }), 'D：确认生成（loopback 零额度）')
  await expect.poll(() => fixture.images.length, { timeout: stationTimeout({ operations: 3 }), message: 'D：确认后 loopback 没收到首帧图请求' }).toBe(1)
  await expect.poll(() => fixture.videos.length, { timeout: stationTimeout({ operations: 4 }), message: 'D：首帧图出来后没有发视频请求' }).toBe(1)
  const videoBody = fixture.videos[0].body ?? {}
  const imageUrls = Array.isArray(videoBody.image_urls) ? videoBody.image_urls : []
  evidence.requests.video = { model: videoBody.model ?? null, image_urls: imageUrls, keys: Object.keys(videoBody).sort() }
  // 这就是「首帧填的是 image_ref」的线上证据：图生视频只有 image_urls 这一个图片入口，首帧图就在里面。
  if (imageUrls.length !== 1 || imageUrls[0] !== `${fixture.baseURL}/fixture/image.jpg`) {
    failures.push(`D：视频请求的 image_urls 应当恰好是那一张首帧图（${fixture.baseURL}/fixture/image.jpg），实际 ${JSON.stringify(imageUrls)}`)
  }
  // 出片前（视频还在跑）：首帧图已出，参考格里就是它。
  await expectVisible(refSlot(1).locator('[data-storyboard-ref-planned="first-frame"] img'), 'D：首帧图出来后参考格里没有那张图')
  await expect(refSlot(1), 'D：生成中那一格变红了').toHaveAttribute('data-storyboard-ref-state', 'filled')
  await snap('03-first-frame-in-slot-while-video-runs.png')
  fixture.releaseVideos()
  await expectVisible(row(1).locator('[data-storyboard-frame="done"]'), 'D：视频出片后镜 1 没有变成已生成', stationTimeout({ operations: 6 }))
  await expect(refSlot(1), 'D：出片后那一格又变红了').toHaveAttribute('data-storyboard-ref-state', 'filled')
  await expectVisible(refSlot(1).locator('[data-storyboard-ref-planned="first-frame"] img'), 'D：出片后参考格里不是首帧图')
  evidence.checks.afterGeneration = await refSlot(1).getAttribute('data-storyboard-ref-state')
  await snap('04-after-generation.png')

  // 生成通路只许打到这两条：一张首帧图、一段视频。夹具没预期的**生成**请求一律算失败。
  // 后台 Agent 的文本调用（/v1/chat/completions）不是这条走查的对象：照实记进证据，不在这里判。
  const strayGeneration = fixture.unexpected.filter((record) => record.path !== '/v1/chat/completions')
  if (strayGeneration.length) failures.push(`D：出现夹具没预期的生成请求：${strayGeneration.map((record) => record.path).join(', ')}`)
  if (fixture.images.length !== 1 || fixture.videos.length !== 1) {
    failures.push(`D：应当恰好一张首帧图 + 一段视频，实际 ${fixture.images.length} / ${fixture.videos.length}`)
  }
} catch (error) {
  failures.push(`走查中断：${error?.message ?? error}`)
  await snap('99-failure.png').catch(() => undefined)
  evidence.failureEditorText = await win.locator('[data-storyboard-editor="true"]').first().innerText().catch(() => null)
} finally {
  evidence.requestCounts = { images: fixture.images.length, videos: fixture.videos.length, unexpected: fixture.unexpected.map(describeUnexpected) }
  evidence.projectRoot = projectRoot
  await closeAppHard(app)
  await fixture.close()
}

fs.writeFileSync(path.join(outDir, 'evidence.json'), `${JSON.stringify({ ...evidence, failures }, null, 2)}\n`)
if (failures.length) {
  console.error(`❌ 分镜首帧误报走查失败（${LOCALE}）：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`✅ 分镜首帧误报走查通过（${LOCALE}）：执行计划检查就绪、超上限镜有警示且被拦、首帧格不红且进批量、真生成后仍不红`)
console.log(`   截图与证据：${outDir}`)
void DEFAULT_TIMEOUT_MS
