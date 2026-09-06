// R16: real user tasks for local ComfyUI, from first connection to restart recovery.
//
// This script intentionally uses a clean Nomi profile and a real official ComfyUI. It checks
// both sides of every important transition: visible UI state and ComfyUI /history facts.
//
// Usage:
//   pnpm build
//   node scripts/comfyui-real-user-journey.mjs
//
// Optional:
//   COMFY_BASE=http://127.0.0.1:8188 node scripts/comfyui-real-user-journey.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(repoRoot, '.comfyui-real-user-journey')
fs.mkdirSync(outputDir, { recursive: true })

const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-comfyui-user-journey-'))
const userDataDir = path.join(profileRoot, 'user-data')
const settingsDir = path.join(profileRoot, 'settings')
const projectsDir = path.join(profileRoot, 'projects')
for (const dir of [userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const COMFY_BASE = (process.env.COMFY_BASE || 'http://127.0.0.1:8188').replace(/\/+$/, '')
const BAD_ADDRESS = '127.0.0.1:8199'
const GOOD_ADDRESS = COMFY_BASE.replace(/^https?:\/\//, '')
const WORKFLOW_NAME = '真实反色处理'
const OUTPUT_PREFIX = 'nomi-real-user-journey'
const PARAM_FREE_WORKFLOW_NAME = '原样默认值'
const PARAM_FREE_OUTPUT_PREFIX = 'nomi-param-free-journey'

const PARAM_FREE_API_WORKFLOW = {
  '1': {
    class_type: 'EmptyImage',
    inputs: { width: 80, height: 72, batch_size: 1, color: 16711808 },
    _meta: { title: '保留工作流默认值' },
  },
  '2': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: PARAM_FREE_OUTPUT_PREFIX, images: ['1', 0] },
    _meta: { title: '保存结果' },
  },
}

const MISSING_NODE_API_WORKFLOW = {
  '1': { class_type: 'NomiJourneyMissingCommunityNode', inputs: { value: 1 } },
  '2': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'nomi-missing-node-journey', images: ['1', 0] },
  },
}

// A normal ComfyUI UI workflow, not an API export. It has no model dependency and therefore
// runs on a clean official ComfyUI installation.
const UI_WORKFLOW = {
  last_node_id: 3,
  last_link_id: 2,
  nodes: [
    {
      id: 1,
      type: 'EmptyImage',
      pos: [0, 0],
      size: [315, 130],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1], slot_index: 0 }],
      properties: { 'Node name for S&R': 'EmptyImage' },
      widgets_values: [128, 128, 1, 8388736],
    },
    {
      id: 2,
      type: 'ImageInvert',
      pos: [380, 0],
      size: [210, 70],
      flags: {},
      order: 1,
      mode: 0,
      inputs: [{ name: 'image', type: 'IMAGE', link: 1 }],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [2], slot_index: 0 }],
      properties: { 'Node name for S&R': 'ImageInvert' },
    },
    {
      id: 3,
      type: 'SaveImage',
      pos: [650, 0],
      size: [270, 90],
      flags: {},
      order: 2,
      mode: 0,
      inputs: [{ name: 'images', type: 'IMAGE', link: 2 }],
      outputs: [],
      properties: { 'Node name for S&R': 'SaveImage' },
      widgets_values: [OUTPUT_PREFIX],
    },
  ],
  links: [
    [1, 1, 0, 2, 0, 'IMAGE'],
    [2, 2, 0, 3, 0, 'IMAGE'],
  ],
  groups: [],
  config: {},
  extra: {},
  version: 0.4,
}

const report = {
  startedAt: new Date().toISOString(),
  comfyBase: COMFY_BASE,
  profileRoot,
  service: {},
  tasks: [],
  screenshots: [],
  errors: [],
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function step(task, name, startedAt, evidence = {}) {
  const durationMs = Date.now() - startedAt
  report.tasks.push({ task, name, durationMs, ...evidence })
  console.log(`  [${task}] ${name}: ${durationMs}ms`)
}

async function screenshot(win, name) {
  const target = path.join(outputDir, name)
  await win.screenshot({ path: target })
  report.screenshots.push(name)
  console.log(`  screenshot: ${name}`)
}

async function assertAppBarDoesNotOverlap(win, label) {
  const geometry = await win.locator('.nomi-appbar').evaluate((header) => {
    const [left, center, right] = Array.from(header.children)
    const rect = (element) => {
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
    }
    return { left: rect(left), center: rect(center), right: rect(right) }
  })
  assert(geometry.left.right <= geometry.center.left, `${label}: 顶栏左区与工作区切换重叠`)
  assert(geometry.center.right <= geometry.right.left, `${label}: 工作区切换与右侧动作重叠`)
  return geometry
}

async function json(url, init) {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response.json()
}

async function poll(label, fn, timeoutMs = 60_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await fn()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms${lastError ? `: ${String(lastError)}` : ''}`)
}

function workflowRuns(history, baselineIds, outputPrefix = OUTPUT_PREFIX) {
  return Object.entries(history)
    .filter(([id, item]) => {
      if (baselineIds.has(id)) return false
      const graph = item?.prompt?.[2] ?? {}
      return Object.values(graph).some((node) => node?.inputs?.filename_prefix === outputPrefix)
    })
    .map(([id, item]) => ({ id, item }))
}

async function waitForSuccessfulRun(baselineIds, timeoutMs = 60_000, outputPrefix = OUTPUT_PREFIX) {
  return poll('ComfyUI successful history entry', async () => {
    const history = await json(`${COMFY_BASE}/history`)
    return workflowRuns(history, baselineIds, outputPrefix).find(({ item }) => item?.status?.status_str === 'success') ?? null
  }, timeoutMs, 600)
}

function readCatalog() {
  return JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
}

function findImportedModel(catalog) {
  return (catalog.models || []).find((model) => model.labelZh === WORKFLOW_NAME)
}

function projectSnapshots() {
  if (!fs.existsSync(projectsDir)) return []
  return fs.readdirSync(projectsDir, { recursive: true })
    .filter((entry) => String(entry).endsWith('project.json'))
    .map((entry) => {
      const file = path.join(projectsDir, String(entry))
      return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) }
    })
}

function generatedImageNode(snapshot) {
  const canvas = snapshot?.data?.payload?.generationCanvas ?? snapshot?.data?.generationCanvas ?? {}
  return (canvas.nodes || []).find((node) => node?.kind === 'image' && node?.result?.type === 'image' && node?.result?.url)
}

function attachDiagnostics(win) {
  const errors = []
  win.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`))
  win.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

async function forceChinese(win) {
  const locale = await win.evaluate(() => window.localStorage.getItem('nomi:locale:v1'))
  if (locale === 'zh-CN') return
  await win.evaluate(() => window.localStorage.setItem('nomi:locale:v1', 'zh-CN'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  await win.waitForTimeout(1500)
}

async function skipFirstRunIntro(win) {
  const skip = win.locator('[data-splash-skip="true"]')
  if (!(await skip.isVisible().catch(() => false))) return null
  const started = Date.now()
  await skip.click()
  await skip.waitFor({ state: 'detached', timeout: 3000 })
  return Date.now() - started
}

async function openModelsSettings(win) {
  const started = Date.now()
  await win.getByRole('button', { name: '设置', exact: true }).first().click()
  const settingsDialog = win.getByRole('dialog', { name: '设置', exact: true })
  await settingsDialog.waitFor({ state: 'visible', timeout: 5000 })
  const modelsTab = settingsDialog.getByRole('button', { name: '模型', exact: true })
  await modelsTab.waitFor({ state: 'visible', timeout: 5000 })
  const settingsOpenMs = Date.now() - started
  const modelsStarted = Date.now()
  await modelsTab.click()
  await win.locator('[data-settings-section="models"]').waitFor({ state: 'visible', timeout: 5000 })
  const modelsTabVisibleMs = Date.now() - modelsStarted
  const localGroupStarted = Date.now()
  await win.getByText('有本地 ComfyUI', { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 })
  return {
    settingsOpenMs,
    modelsTabVisibleMs,
    localGroupReadyMs: Date.now() - localGroupStarted,
    totalMs: Date.now() - started,
  }
}

async function ensureComfyCardExpanded(win) {
  if (await win.getByRole('button', { name: '改', exact: true }).first().isVisible().catch(() => false)) return
  await win.getByText(/^(本地 ComfyUI|Local ComfyUI|ComfyUI · 本地或云端)$/).first().click()
  await win.getByRole('button', { name: '改', exact: true }).first().waitFor({ timeout: 5000 })
}

async function editVisibleComfyAddress(win, value) {
  await win.getByRole('button', { name: '改', exact: true }).first().click()
  const input = win.getByRole('textbox', { name: '接入地址（本地 / 云端）' })
  await input.fill(value)
  await win.getByRole('button', { name: '保存地址', exact: true }).click()
  await win.waitForTimeout(1200)
}

async function runFirstSession() {
  const session = await launchNomiApp({
    name: 'comfyui-real-user-journey-first',
    userDataDir,
    settingsDir,
    projectsDir,
    env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` },
    settleMs: 1800,
  })
  const { app, win } = session
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  const errors = attachDiagnostics(win)

  try {
    await forceChinese(win)
    const introSkipMs = await skipFirstRunIntro(win)
    if (introSkipMs !== null) step('T0', '有明确目标时跳过首次开屏动画', Date.now() - introSkipMs)

    console.log('\nT1: first connection, visible failure, and recovery')
    const openStarted = Date.now()
    const settingsTimings = await openModelsSettings(win)
    await win.getByText('有本地 ComfyUI', { exact: false }).first().click()
    await win.waitForTimeout(400)
    await win.getByText(/^(本地 ComfyUI|Local ComfyUI|ComfyUI · 本地或云端)$/).first().click()
    await win.waitForTimeout(500)
    step('T1', '找到本地 ComfyUI 配置入口', openStarted, settingsTimings)

    const badStarted = Date.now()
    await editVisibleComfyAddress(win, BAD_ADDRESS)
    await win.getByRole('button', { name: '启用 ComfyUI', exact: true }).click()
    await win.waitForTimeout(2400)
    await ensureComfyCardExpanded(win)
    const offlineText = await win.evaluate(() => document.body.innerText)
    assert(offlineText.includes('启用了，但没探测到 ComfyUI'), '错误地址没有显示明确的未连接状态')
    assert(offlineText.includes('http://127.0.0.1:8199'), '错误状态没有显示实际检查的地址')
    await screenshot(win, '01-wrong-address-visible.png')
    step('T1', '错误地址给出可恢复反馈', badStarted, { address: 'http://127.0.0.1:8199' })

    const recoverStarted = Date.now()
    await editVisibleComfyAddress(win, GOOD_ADDRESS)
    await ensureComfyCardExpanded(win)
    await poll('connected ComfyUI card', async () => {
      const text = await win.evaluate(() => document.body.innerText)
      return text.includes('已连上 ComfyUI') && text.includes('v0.33.0') && text.includes('增强模式')
    }, 15_000, 400)
    await screenshot(win, '02-recovered-enhanced.png')
    const enabledCatalog = readCatalog()
    const vendor = (enabledCatalog.vendors || []).find((item) => item.key === 'comfyui-local')
    assert(vendor?.enabled === true, '恢复连接后 catalog 没有持久化 enabled=true')
    assert(vendor?.baseUrlHint === COMFY_BASE, `地址没有规范化并持久化为 ${COMFY_BASE}`)
    step('T1', '改回真实地址并进入增强模式', recoverStarted, { version: '0.33.0', address: vendor.baseUrlHint })

    console.log('\nT2: import a normal workflow.json, configure it, and run it')
    const importStarted = Date.now()
    const importOpen = win.getByRole('button', { name: '导入自定义工作流', exact: false }).first()
    await importOpen.scrollIntoViewIfNeeded()
    await importOpen.click()
    const workflowInput = win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' })
    const importPanel = workflowInput.locator('xpath=..')
    const instructions = await importPanel.innerText()
    assert(instructions.includes('workflow.json'), '导入入口没有告诉用户普通 workflow.json 可直接使用')
    assert(instructions.includes('workflow_api.json'), '导入入口没有保留 API workflow 兼容说明')
    await workflowInput.fill(JSON.stringify(UI_WORKFLOW))
    await importPanel.getByRole('button', { name: '分析工作流', exact: true }).click()
    await importPanel.getByText('已识别为', { exact: false }).waitFor({ timeout: 30_000 })
    await win.waitForTimeout(1200)
    const analyzedText = await importPanel.innerText()
    assert(analyzedText.includes('图片'), '普通 workflow.json 没有识别出图片输出')
    assert(!analyzedText.includes('缺 1 个节点') && !analyzedText.includes('输入引用了本机没有'), '内置节点工作流被错误报告为缺件')
    await screenshot(win, '03-ui-workflow-analyzed.png')
    step('T2', '普通 workflow.json 自动转换并完成本机对账', importStarted)

    const persistStarted = Date.now()
    await importPanel.getByPlaceholder('给它起个名', { exact: false }).fill(WORKFLOW_NAME)
    await importPanel.getByRole('button', { name: '导入', exact: true }).click()
    await ensureComfyCardExpanded(win)
    await win.getByText(WORKFLOW_NAME, { exact: true }).first().waitFor({ timeout: 12_000 })
    await win.waitForTimeout(1000)
    const importedCatalog = readCatalog()
    const imported = findImportedModel(importedCatalog)
    const draft = imported?.meta?.comfyWorkflowImport
    assert(imported, '导入后 catalog 找不到工作流模型')
    assert(draft?.uiWorkflowText, '普通 workflow.json 的原始 UI graph 没有持久化')
    assert(JSON.parse(draft.uiWorkflowText).nodes?.length === 3, '持久化的 UI graph 节点数不正确')
    assert(!draft.binding?.promptNodeId, '无提示词工作流被虚构了提示词绑定')
    assert(draft.binding?.outputNodeId === '3', '输出没有绑定到 SaveImage #3')
    const paramKeys = (draft.binding?.params || []).map((param) => param.inputKey)
    assert(paramKeys.includes('width') && paramKeys.includes('height'), '宽度和高度没有暴露为画布字段')
    step('T2', '导入并保留 API prompt 与原 UI graph', persistStarted, { modelKey: imported.modelKey, params: paramKeys })

    const settingsStarted = Date.now()
    await win.getByRole('button', { name: `打开「${WORKFLOW_NAME}」的工作流设置` }).click()
    await win.locator('[data-comfyui-workflow-page]').waitFor({ timeout: 10_000 })
    const preview = win.locator('[data-workflow-preview]')
    const previewText = await preview.innerText()
    assert(/宽度|width/i.test(previewText) && /高度|height/i.test(previewText), '设置页没有显示已暴露的宽高字段')
    const widthInput = preview.getByRole('textbox', { name: '宽度' })
    const heightInput = preview.getByRole('textbox', { name: '高度' })
    await widthInput.fill('96')
    await heightInput.fill('96')
    await win.locator('[data-workflow-save]').click()
    await win.waitForTimeout(900)
    await screenshot(win, '04-workflow-settings-persisted.png')
    await win.getByRole('button', { name: '关闭工作流设置' }).click()
    await win.waitForTimeout(500)
    await win.getByRole('button', { name: `打开「${WORKFLOW_NAME}」的工作流设置` }).click()
    await win.locator('[data-comfyui-workflow-page]').waitFor({ timeout: 10_000 })
    const reopenedCatalog = readCatalog()
    const reopenedDraft = findImportedModel(reopenedCatalog)?.meta?.comfyWorkflowImport
    assert(reopenedDraft?.uiWorkflowText === draft.uiWorkflowText, '关闭重开后原 UI graph 发生变化')
    assert(JSON.stringify(reopenedDraft?.binding) === JSON.stringify(draft.binding), '关闭重开后绑定或字段发生变化')
    step('T2', '工作流设置关闭重开后仍完整', settingsStarted)

    const testRunStarted = Date.now()
    const idsBeforeTestRun = new Set(Object.keys(await json(`${COMFY_BASE}/history`)))
    const reopenedPreview = win.locator('[data-workflow-preview]')
    await reopenedPreview.getByRole('textbox', { name: '宽度' }).fill('96')
    await reopenedPreview.getByRole('textbox', { name: '高度' }).fill('96')
    await win.locator('[data-workflow-test-run]').click()
    await win.getByText('运行测试', { exact: true }).waitFor({ timeout: 60_000 })
    const settingsRun = await waitForSuccessfulRun(idsBeforeTestRun)
    const settingsPrompt = settingsRun.item?.prompt ?? []
    const settingsGraph = settingsPrompt[2] ?? {}
    const settingsClientId = settingsPrompt[3]?.client_id
    assert(settingsGraph?.['1']?.inputs?.width === 96 && settingsGraph?.['1']?.inputs?.height === 96,
      '设置页填的 96×96 没有真正进入 ComfyUI 工作流')
    assert(/^nomi-[0-9a-f-]{36}$/.test(settingsClientId ?? ''), '真实请求没有使用会话唯一 client_id')
    step('T2', '从设置页真实运行成功', testRunStarted, {
      promptId: settingsRun.id,
      clientId: settingsClientId,
      submittedSize: [settingsGraph['1'].inputs.width, settingsGraph['1'].inputs.height],
    })

    console.log('\nT2B: recover bad imports, warn about missing nodes, and preserve an explicit empty parameter list')
    await win.getByRole('button', { name: '关闭工作流设置' }).click()
    await ensureComfyCardExpanded(win)
    await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
    const recoveryInput = win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' })
    const recoveryPanel = recoveryInput.locator('xpath=..')

    const badJsonStarted = Date.now()
    await recoveryInput.fill('{broken')
    await recoveryPanel.getByRole('button', { name: '分析工作流', exact: true }).click()
    await recoveryPanel.getByText('不是合法 JSON', { exact: false }).waitFor({ timeout: 10_000 })
    step('T2B', '粘贴错误 JSON 后给出明确修复提示', badJsonStarted)

    const missingNodeStarted = Date.now()
    await recoveryInput.fill(JSON.stringify(MISSING_NODE_API_WORKFLOW))
    await recoveryPanel.getByRole('button', { name: '分析工作流', exact: true }).click()
    const missingNodeWarning = recoveryPanel.getByText('本机 ComfyUI 缺', { exact: false })
    await missingNodeWarning.waitFor({ timeout: 15_000 })
    const missingNodeText = await missingNodeWarning.innerText()
    assert(missingNodeText.includes('NomiJourneyMissingCommunityNode'), '缺少社区节点的预警没有点名具体节点')
    await screenshot(win, '05-missing-node-preflight.png')
    step('T2B', '缺少社区节点在导入前可见', missingNodeStarted, {
      missingNode: 'NomiJourneyMissingCommunityNode',
    })

    await recoveryPanel.getByRole('button', { name: '收起', exact: true }).click()
    await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
    const cleanInput = win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' })
    const cleanPanel = cleanInput.locator('xpath=..')
    await cleanInput.fill(JSON.stringify(PARAM_FREE_API_WORKFLOW))
    await cleanPanel.getByRole('button', { name: '分析工作流', exact: true }).click()
    await cleanPanel.getByText('已识别为', { exact: false }).waitFor({ timeout: 15_000 })
    await win.waitForTimeout(700)
    while (await cleanPanel.getByRole('button', { name: '删除参数' }).count()) {
      await cleanPanel.getByRole('button', { name: '删除参数' }).first().click()
    }
    await cleanPanel.getByText('还没有手动参数', { exact: false }).waitFor()
    await cleanPanel.getByPlaceholder('给它起个名', { exact: false }).fill(PARAM_FREE_WORKFLOW_NAME)
    await cleanPanel.getByRole('button', { name: '导入', exact: true }).click()
    await ensureComfyCardExpanded(win)
    await win.getByText(PARAM_FREE_WORKFLOW_NAME, { exact: true }).first().waitFor({ timeout: 12_000 })

    const multiCatalog = readCatalog()
    const originalModel = findImportedModel(multiCatalog)
    const paramFreeModel = (multiCatalog.models || []).find((model) => model.labelZh === PARAM_FREE_WORKFLOW_NAME)
    const originalParams = originalModel?.meta?.comfyWorkflowImport?.binding?.params ?? []
    const emptyBinding = paramFreeModel?.meta?.comfyWorkflowImport?.binding
    assert(originalParams.length >= 2 && originalParams.every((param) => param.paramKey.startsWith('comfy_')),
      '导入第二条工作流后，第一条的参数配置被串改')
    assert(Array.isArray(emptyBinding?.params) && emptyBinding.params.length === 0, '用户明确删空的参数没有持久化为 params: []')
    assert(!Object.hasOwn(emptyBinding ?? {}, 'numeric'), '新导入仍存了会复活旧参数的 numeric 字段')

    const emptySettingsStarted = Date.now()
    await win.getByRole('button', { name: `打开「${PARAM_FREE_WORKFLOW_NAME}」的工作流设置` }).click()
    await win.locator('[data-comfyui-workflow-page]').waitFor({ timeout: 10_000 })
    let emptyPreview = win.locator('[data-workflow-preview]')
    await emptyPreview.getByText('画布上只会有一个「生成」钮', { exact: false }).waitFor()
    assert(await emptyPreview.locator('input, textarea, [role="combobox"]').count() === 0, '显式空参数却仍在预览中出现控件')
    await screenshot(win, '06-explicit-empty-params.png')

    const workflowPage = win.locator('[data-comfyui-workflow-page]')
    await workflowPage.getByText(WORKFLOW_NAME, { exact: true }).locator('xpath=ancestor::button[1]').click()
    await win.locator('[data-workflow-preview]').getByRole('textbox', { name: '宽度' }).waitFor()
    await workflowPage.getByText(PARAM_FREE_WORKFLOW_NAME, { exact: true }).locator('xpath=ancestor::button[1]').click()
    emptyPreview = win.locator('[data-workflow-preview]')
    await emptyPreview.getByText('画布上只会有一个「生成」钮', { exact: false }).waitFor()

    const idsBeforeDefaultRun = new Set(Object.keys(await json(`${COMFY_BASE}/history`)))
    await win.locator('[data-workflow-test-run]').click()
    await win.getByText('运行测试', { exact: true }).waitFor({ timeout: 60_000 })
    const defaultRun = await waitForSuccessfulRun(idsBeforeDefaultRun, 60_000, PARAM_FREE_OUTPUT_PREFIX)
    const defaultPrompt = defaultRun.item?.prompt ?? []
    const defaultGraph = defaultPrompt[2] ?? {}
    const defaultClientId = defaultPrompt[3]?.client_id
    assert(defaultGraph?.['1']?.inputs?.width === 80 && defaultGraph?.['1']?.inputs?.height === 72,
      '删空参数后应该使用工作流原样默认值 80×72')
    assert(defaultRun.id !== settingsRun.id, '连续运行不同工作流时 prompt_id 必须每个任务唯一')
    assert(defaultClientId === settingsClientId && /^nomi-[0-9a-f-]{36}$/.test(defaultClientId ?? ''),
      '同一 Nomi 主进程会话内 client_id 应保持稳定')
    step('T2B', '空参数保存、切换、重开与真跑均保持原样', emptySettingsStarted, {
      promptId: defaultRun.id,
      sharedSessionClientId: defaultClientId,
      submittedSize: [defaultGraph['1'].inputs.width, defaultGraph['1'].inputs.height],
      isolatedFrom: settingsRun.id,
    })

    console.log('\nT3: generate in a real project and recover after restart')
    await win.getByRole('button', { name: '关闭工作流设置' }).click()
    await win.keyboard.press('Escape')
    await win.waitForTimeout(700)
    await win.getByText('新建空白项目', { exact: false }).first().click()
    await win.waitForTimeout(2200)
    await win.keyboard.press('Escape').catch(() => {})
    await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
    await win.waitForTimeout(1200)
    // 左缘点法收口在 ../tests/ux/_canvasRail.mjs：结构锚点，不认走 i18n 的 aria-label，找不到当场抛。
    await addCanvasNodeFromRail(win, 'image')
    await win.waitForTimeout(1200)
    const node = win.locator('[data-kind="image"][data-node-id]').first()
    await node.waitFor({ timeout: 10_000 })
    await node.click({ position: { x: 40, y: 40 } })
    await win.waitForTimeout(800)

    const modelTrigger = win.locator('button[aria-label="模型"], button[aria-label="选择模型"]').first()
    await modelTrigger.click()
    await win.getByText(WORKFLOW_NAME, { exact: false }).first().click()
    await win.waitForTimeout(1200)
    const selectedText = await win.evaluate(() => document.body.innerText)
    assert(selectedText.includes('无需提示词'), '无提示词工作流没有显示诚实说明')
    assert(await node.locator('.generation-canvas-v2-node__prompt-input').count() === 0, '无提示词工作流仍显示提示词编辑器')
    assert(await node.getByRole('button', { name: '打开素材盒提示词' }).count() === 0, '无提示词工作流仍显示提示词库入口')
    assert(await node.getByRole('button', { name: '用 Nomi 优化提示词' }).count() === 0, '无提示词工作流仍显示提示词优化入口')
    await screenshot(win, '05-project-ready-without-prompt.png')

    const generationStarted = Date.now()
    const idsBeforeCanvasRun = new Set(Object.keys(await json(`${COMFY_BASE}/history`)))
    await node.locator('button[aria-label="生成素材"]').click()
    await win.waitForTimeout(500)
    const afterClickText = await win.evaluate(() => document.body.innerText)
    assert(!afterClickText.includes('会消耗模型额度'), '本地 ComfyUI 仍弹出云端额度确认')
    const canvasRun = await waitForSuccessfulRun(idsBeforeCanvasRun)
    const historyFinishedAt = Date.now()
    const resultImage = await poll('generated image in Nomi node', async () => {
      const image = node.locator('img').first()
      if (!(await image.isVisible().catch(() => false))) return null
      const naturalWidth = await image.evaluate((element) => element.naturalWidth)
      return naturalWidth > 0 ? { naturalWidth, src: await image.getAttribute('src') } : null
    }, 30_000, 400)
    const resultVisibleAt = Date.now()
    assert(resultImage.src, 'Nomi 节点的结果图片没有可读取 URL')
    await screenshot(win, '06-real-result-visible.png')
    step('T3', '空白项目无提示词真实生成', generationStarted, {
      promptId: canvasRun.id,
      comfyFinishedMs: historyFinishedAt - generationStarted,
      visibleResultMs: resultVisibleAt - generationStarted,
      naturalWidth: resultImage.naturalWidth,
    })

    const saveStarted = Date.now()
    await win.waitForTimeout(3500)
    const snapshots = projectSnapshots()
    const saved = snapshots.find((snapshot) => generatedImageNode(snapshot))
    assert(saved, '生成完成后 project.json 没有保存图片节点结果')
    step('T3', '项目结果自动保存到磁盘', saveStarted, { projectFile: saved.file, projectName: saved.data.name })
    report.firstSessionErrors = errors
    assert(errors.length === 0, `首轮出现页面错误:\n${errors.join('\n')}`)
  } catch (error) {
    await screenshot(win, 'ERROR-first-session.png').catch(() => {})
    throw error
  } finally {
    await session.close()
  }
}

async function runRestartSession() {
  const restartStarted = Date.now()
  const session = await launchNomiApp({
    name: 'comfyui-real-user-journey-restart',
    userDataDir,
    settingsDir,
    projectsDir,
    env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` },
    settleMs: 1800,
  })
  const { app, win } = session
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  const errors = attachDiagnostics(win)

  try {
    await forceChinese(win)
    const snapshot = projectSnapshots().find((item) => generatedImageNode(item))
    assert(snapshot, '重启前找不到已保存项目')
    const projectName = snapshot.data.name
    if (!(await win.locator('[data-kind="image"][data-node-id]').first().isVisible().catch(() => false))) {
      await win.locator('[data-project-card="true"]').filter({ hasText: projectName }).first().click()
      await win.waitForTimeout(2200)
    }
    const generationTab = win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true })
    if (await generationTab.isVisible().catch(() => false)) await generationTab.click()
    await win.waitForTimeout(1200)
    const restoredNode = win.locator('[data-kind="image"][data-node-id]').first()
    await restoredNode.waitFor({ timeout: 10_000 })
    await restoredNode.click({ position: { x: 40, y: 40 } })
    await win.waitForTimeout(700)
    assert((await win.evaluate(() => document.body.innerText)).includes(WORKFLOW_NAME), '重启后节点没有保留所选 ComfyUI 工作流')
    const restoredImage = await poll('restored project image', async () => {
      const image = restoredNode.locator('img').first()
      if (!(await image.isVisible().catch(() => false))) return null
      return (await image.evaluate((element) => element.naturalWidth)) > 0 ? image : null
    }, 15_000, 400)
    assert(await restoredImage.getAttribute('src'), '重启后结果图片 URL 丢失')
    const catalog = readCatalog()
    const imported = findImportedModel(catalog)
    assert(imported?.meta?.comfyWorkflowImport?.uiWorkflowText, '重启后 workflow.json 原图丢失')
    await screenshot(win, '07-restart-restored-result.png')
    step('T3', '彻底重启后工作流与结果恢复', restartStarted, { projectName })

    console.log('\nBilingual UI check: English import entry')
    await win.evaluate(() => window.localStorage.setItem('nomi:locale:v1', 'en'))
    await win.reload({ waitUntil: 'domcontentloaded' })
    await win.waitForTimeout(1600)
    await win.getByRole('button', { name: 'Settings', exact: true }).first().click()
    const settingsDialog = win.getByRole('dialog', { name: 'Settings', exact: true })
    await settingsDialog.waitFor({ state: 'visible', timeout: 5000 })
    await settingsDialog.getByRole('button', { name: 'Models', exact: true }).click()
    await win.waitForTimeout(900)
    await win.getByText(/^(本地 ComfyUI|Local ComfyUI|ComfyUI · Local or cloud)$/).first().click()
    await win.waitForTimeout(500)
    await win.getByRole('button', { name: 'Import custom workflow', exact: false }).first().click()
    const englishInput = win.getByRole('textbox', { name: 'ComfyUI workflow JSON' })
    const englishPanelText = await englishInput.locator('xpath=..').innerText()
    assert(englishPanelText.includes('workflow.json') && englishPanelText.includes('workflow_api.json'), '英文入口没有同时说明两种 workflow 格式')
    assert(await win.evaluate(() => document.documentElement.lang) === 'en', '切换英文后 document.lang 未同步')
    const englishDesktopGeometry = await assertAppBarDoesNotOverlap(win, '英文 1440px')
    await screenshot(win, '08-english-import-entry.png')
    await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1024, height: 768 }))
    await win.waitForTimeout(500)
    const englishNarrowGeometry = await assertAppBarDoesNotOverlap(win, '英文 1024px')
    await screenshot(win, '09-english-narrow-no-overlap.png')
    await win.reload({ waitUntil: 'domcontentloaded' })
    await win.waitForTimeout(1200)
    assert(await win.evaluate(() => window.localStorage.getItem('nomi:locale:v1')) === 'en', '刷新后英文偏好没有保留')
    step('T3', '英文入口、窄桌面布局与语言持久化', Date.now(), {
      desktopGeometry: englishDesktopGeometry,
      narrowGeometry: englishNarrowGeometry,
    })

    report.restartSessionErrors = errors
    assert(errors.length === 0, `重启轮出现页面错误:\n${errors.join('\n')}`)
  } catch (error) {
    await screenshot(win, 'ERROR-restart-session.png').catch(() => {})
    throw error
  } finally {
    await session.close()
  }
}

async function main() {
  console.log(`Official ComfyUI: ${COMFY_BASE}`)
  const stats = await json(`${COMFY_BASE}/system_stats`)
  const objectInfo = await json(`${COMFY_BASE}/object_info`)
  for (const nodeType of ['EmptyImage', 'ImageInvert', 'SaveImage']) {
    assert(objectInfo[nodeType], `ComfyUI is missing required built-in node ${nodeType}`)
  }
  report.service = {
    version: stats.system?.comfyui_version,
    frontendVersion: stats.system?.required_frontend_version,
    nodeTypes: Object.keys(objectInfo).length,
  }
  assert(report.service.version, 'ComfyUI system_stats did not report a version')
  const baselineIds = new Set(Object.keys(await json(`${COMFY_BASE}/history`)))

  await runFirstSession()
  await runRestartSession()

  const finalHistory = await json(`${COMFY_BASE}/history`)
  const runs = [
    ...workflowRuns(finalHistory, baselineIds),
    ...workflowRuns(finalHistory, baselineIds, PARAM_FREE_OUTPUT_PREFIX),
  ]
  assert(runs.length >= 3, `expected at least three real workflow runs, got ${runs.length}`)
  assert(runs.every(({ item }) => item?.status?.status_str === 'success'), 'one of the real workflow runs did not finish successfully')
  report.realRuns = runs.map(({ id, item }) => ({ id, status: item.status.status_str }))
  report.completedAt = new Date().toISOString()
  report.status = 'passed'
}

try {
  await main()
  console.log(`\nPASS: complete ComfyUI user journey (${report.realRuns.length} real runs)`)
} catch (error) {
  report.status = 'failed'
  report.errors.push(error instanceof Error ? error.stack || error.message : String(error))
  console.error('\nFAIL:', error)
  process.exitCode = 1
} finally {
  report.completedAt ||= new Date().toISOString()
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`Report: ${path.join(outputDir, 'report.json')}`)
}
