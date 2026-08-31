import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'
import { CAPABILITY_JOURNEYS } from './journeys.mjs'
import { createBlankProject, launchIsolatedApp, prepareIsolation } from '../lib/isoApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputDir = path.join(repoRoot, 'evals', 'capability-system')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-capability-baseline-'))
const relativeTemp = path.relative(os.tmpdir(), tempRoot)
if (!relativeTemp || relativeTemp.startsWith('..') || path.isAbsolute(relativeTemp)) {
  throw new Error(`Refusing to use unexpected temp directory: ${tempRoot}`)
}

function sourceFiles(root) {
  const files = []
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(fullPath)
      else if (/\.(?:ts|tsx|mts)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(fullPath)
    }
  }
  visit(root)
  return files
}

const scannedFiles = [...sourceFiles(path.join(repoRoot, 'src')), ...sourceFiles(path.join(repoRoot, 'electron'))]
const sourceIndex = scannedFiles.map((file) => ({
  file: path.relative(repoRoot, file).replaceAll('\\', '/'),
  text: fs.readFileSync(file, 'utf8'),
}))

function symbolEvidence(symbol) {
  const matches = sourceIndex
    .filter((entry) => entry.text.includes(symbol))
    .slice(0, 3)
    .map((entry) => entry.file)
  return { symbol, present: matches.length > 0, files: matches }
}

function catalogSummary() {
  const catalogPath = path.join(repoRoot, 'model-catalog.json')
  if (!fs.existsSync(catalogPath)) return { present: false, enabledTextModels: 0 }
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
    const models = Array.isArray(catalog.models) ? catalog.models : []
    return {
      present: true,
      vendors: Array.isArray(catalog.vendors) ? catalog.vendors.length : 0,
      models: models.length,
      enabledTextModels: models.filter((model) => model.enabled && model.kind === 'text').length,
    }
  } catch {
    return { present: true, readable: false, enabledTextModels: 0 }
  }
}

const ui = {
  launched: false,
  projectCreated: false,
  probeMs: 0,
  creationPromptPicker: false,
  creationPromptPickerRendered: false,
  browserEntry: false,
  browserEntryRendered: false,
  assetLibraryEntry: false,
  assetLibraryRendered: false,
  structuredElicitation: false,
  rightsFilter: false,
  capabilityLibrary: false,
}
let app
const probeStartedAt = performance.now()
try {
  const iso = prepareIsolation(tempRoot, { requireCatalog: false })
  const launched = await launchIsolatedApp(repoRoot, iso)
  app = launched.app
  const win = launched.win
  ui.launched = true
  await createBlankProject(win, iso.projectsDir)
  ui.projectCreated = true
  ui.creationPromptPickerRendered = (await win.locator('[data-creation-prompt-picker="true"]').count()) > 0
  ui.browserEntryRendered = (await win.getByRole('button', { name: /浏览器/ }).count()) > 0
  ui.assetLibraryRendered =
    (await win.getByRole('tab', { name: /素材库/ }).count()) > 0 ||
    (await win.getByRole('button', { name: /素材库/ }).count()) > 0
  ui.structuredElicitation = (await win.locator('[data-agent-elicitation], [data-creative-brief]').count()) > 0
  ui.rightsFilter = (await win.getByText(/许可待确认|需要署名|权利状态/, { exact: false }).count()) > 0
  ui.capabilityLibrary = (await win.getByText('能力库', { exact: true }).count()) > 0
} catch (error) {
  ui.error = error instanceof Error ? error.message : String(error)
} finally {
  ui.probeMs = Math.round(performance.now() - probeStartedAt)
  if (app) await app.close().catch(() => undefined)
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

// 空白项目只挂当前工作面；未挂载不等于产品没有对应 surface。代码入口用于补足
// “存在但不在当前 DOM”的事实，结构化合同仍必须由 requiredSymbols 单独证明。
ui.creationPromptPicker = ui.creationPromptPickerRendered || symbolEvidence('CreationPromptPicker').present
ui.browserEntry = ui.browserEntryRendered || symbolEvidence('nomi-open-browser').present
ui.assetLibraryEntry = ui.assetLibraryRendered || symbolEvidence('AssetLibraryPanel').present

const relatedSurfaceByJourney = {
  J1: ui.creationPromptPicker,
  J2: ui.browserEntry,
  J3: ui.assetLibraryEntry,
  J4: ui.assetLibraryEntry || ui.browserEntry,
  J5: ui.creationPromptPicker,
  J6: ui.assetLibraryEntry,
  J7: ui.creationPromptPicker,
  J8: true,
  J9: ui.assetLibraryEntry,
  J10: true,
}

const results = CAPABILITY_JOURNEYS.map((journey) => {
  const evidence = journey.requiredSymbols.map(symbolEvidence)
  const presentCount = evidence.filter((entry) => entry.present).length
  const completeContracts = presentCount === evidence.length
  const relatedSurface = Boolean(relatedSurfaceByJourney[journey.id])
  const success = completeContracts && relatedSurface
  const status = success ? 'success' : relatedSurface || presentCount > 0 ? 'partial' : 'blocked'
  return {
    id: journey.id,
    title: journey.title,
    p0: journey.p0,
    status,
    score: success ? 1 : status === 'partial' ? 0.25 : 0,
    expectedArtifact: journey.expectedArtifact,
    contractEvidence: evidence,
    relatedSurface,
    timeToOutcomeMs: null,
    interactionCount: null,
    agentTurns: null,
    blockingReason: success
      ? null
      : `缺少 ${
          evidence
            .filter((entry) => !entry.present)
            .map((entry) => entry.symbol)
            .join('、') || '可完成任务的产品入口'
        }`,
  }
})

const p0Results = results.filter((result) => result.p0)
const report = {
  generatedAt: new Date().toISOString(),
  baselineKind: 'ui-and-contract-readiness',
  environment: {
    platform: process.platform,
    node: process.version,
    modelCatalog: catalogSummary(),
    note: '无可用文本模型；未运行模型质量、agentTurns、token 或真实 time-to-outcome。',
  },
  ui,
  summary: {
    journeys: results.length,
    success: results.filter((result) => result.status === 'success').length,
    partial: results.filter((result) => result.status === 'partial').length,
    blocked: results.filter((result) => result.status === 'blocked').length,
    p0Readiness: Number((p0Results.reduce((sum, result) => sum + result.score, 0) / p0Results.length).toFixed(3)),
  },
  results,
}

fs.writeFileSync(
  path.join(outputDir, 'baseline-2026-08-29.json'),
  await format(JSON.stringify(report), { parser: 'json', printWidth: 120 }),
)

const lines = [
  '# Nomi 能力系统当前基线',
  '',
  `> 生成时间：${report.generatedAt}`,
  '> 基线类型：真实 Electron 入口 + 当前代码合同就绪度，不是模型质量评测。',
  '',
  `当前结果：${report.summary.success} success / ${report.summary.partial} partial / ${report.summary.blocked} blocked；P0 就绪度 ${Math.round(report.summary.p0Readiness * 100)}%。`,
  '',
  '本机没有可用文本模型，因此 `agentTurns`、token、真实完成时间和输出质量均保留为 `null`。这不是跳过失败：当前基线明确证明了入口和合同缺口；模型接好后必须用同一任务定义复跑 with/without。',
  '',
  '| 任务 | 状态 | 当前可用面 | 关键缺口 |',
  '|---|---|---|---|',
  ...results.map(
    (result) =>
      `| ${result.id} ${result.title} | ${result.status} | ${result.relatedSurface ? '有相关入口' : '无'} | ${result.blockingReason || '—'} |`,
  ),
  '',
  '## 环境证据',
  '',
  `- Electron 启动：${ui.launched ? '成功' : '失败'}；隔离项目创建：${ui.projectCreated ? '成功' : '失败'}；探测耗时：${ui.probeMs} ms。`,
  `- 已实现相关 surface：Prompt 选择器=${ui.creationPromptPicker}，浏览器=${ui.browserEntry}，素材库=${ui.assetLibraryEntry}。`,
  `- 空白项目当前 DOM：Prompt 选择器=${ui.creationPromptPickerRendered}，浏览器=${ui.browserEntryRendered}，素材库=${ui.assetLibraryRendered}；未挂载不等于未实现。`,
  `- 当前缺失入口：结构化补问=${!ui.structuredElicitation}，权利筛选=${!ui.rightsFilter}，能力库=${!ui.capabilityLibrary}。`,
  `- 模型目录：${report.environment.modelCatalog.enabledTextModels} 个已启用文本模型。`,
  '',
  '## 复跑门',
  '',
  '1. P0 实现后先复跑 J1-J4/J9/J10，要求结构化产物真实写入项目。',
  '2. 配置文本模型后，补 `agentTurns`、token、time-to-outcome 和 with/without 质量分。',
  '3. P0 通过后再跑 J5-J8；P1 能力不能用来掩盖 P0 合同缺失。',
  '',
]
fs.writeFileSync(path.join(outputDir, 'baseline-2026-08-29.md'), lines.join('\n'))
console.log(JSON.stringify(report.summary, null, 2))
