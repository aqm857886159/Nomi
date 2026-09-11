#!/usr/bin/env node
// 「这个模型现在能不能用」**单一 owner** 门岗（2026-09-12，真实验收 P0-10 的根因门）。
//
// 那天的现场：DeepSeek 两个文本模型经 MCP 接进来、重启之后——
//   · 设置 → 模型   说「1 个连接 · 2 个模型」「2 个可使用」
//   · 项目库首页横幅 说「创作助手尚未连接模型」
//   · 创作助手模型下拉 说「目录里没有可用的」
// 不是刷新问题。**每个读者各写了一份判据**：设置页只看 enabled、首页横幅要 published + 凭据、
// 助手下拉要 published + vendor.hasApiKey、画布还有第四份。判据各写各的，它们必然漂。
//
// 判据现在只有一份：electron/shared/modelAvailability.ts 的 deriveModelAvailability
//   可用 = 供应商在且启用 → 模型启用 → 目录发布资格成立 → 这家的钥匙此刻解得开
// 结论随每行模型以 `availability` 过 IPC 下发，渲染层不重算。
//
// 这道门查两件事：
//   ① **普查表**（下面的 READERS）里每个读者都还在消费 owner 的结论。谁哪天又自己拼一份，
//      它就不再引用 owner 了 —— 当场红。普查表同时是文档：`--census` 直接吐出
//      docs/plan/2026-09-12-model-availability-single-owner.md 里那张表。
//   ② **AST 棘轮**：全仓扫「凭据词 && 发布/启用词」这种形状的布尔表达式（第二份判据长这个样），
//      新增的必须登记进 VENDOR_CONNECTION_PREDICATES 并写明「它答的是另一个问题」，
//      否则红。基线只减不增。
//
// 为什么棘轮只盯这个形状：三次翻车（2026-06-08 拔 key 仍发请求、2026-09-06 选择器取景开关、
// 2026-09-12 P0-10）写坏的表达式**全部**是「凭据 && 启用/发布」这一个形状。
// 抓不住纯运行时的其它写法——这条限制写在这里：门岗绿 ≠ 这一类不会再发生，
// 类级证据是 src/workbench/ai/modelAvailabilityAgreement.test.ts（同一份目录，三个界面一个答案）。
//
// 用法：node ./scripts/check-model-availability.mjs [--census] [--update-baseline]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { gitPaths } from './lib/gitPaths.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OWNER = 'electron/shared/modelAvailability.ts'
const CATALOG_BINDING = 'electron/catalog/catalogModelAvailability.ts'
const RENDERER_GATE = 'src/config/modelCatalogCache.ts'

/** owner 的结论长什么样——读者引用其中任意一个，就算在消费它。 */
const OWNER_SYMBOLS = [
  'deriveModelAvailability',
  'createCatalogAvailability',
  'catalogModelAvailability',
  'catalogModelIsUsable',
  'keepUsableModelRows',
  'availability',
]

/**
 * 普查表：每个回答「现在有哪些模型能用 / X 角色能用哪些」的读者。
 * `question` 是它对用户说的那句话，`reads` 是它现在读谁。改动这张表 = 改动这条不变量的边界。
 */
export const READERS = [
  { file: 'electron/catalog/catalogStore.ts', question: '目录投影：每行模型的 availability（渲染层全部读者的上游）', reads: 'createCatalogAvailability' },
  { file: 'electron/catalog/catalogHealth.ts', question: '目录健康度里的「可执行模型」计数', reads: 'createCatalogAvailability' },
  { file: 'electron/catalog/executableModel.ts', question: '真要发请求时这条模型能不能执行', reads: 'catalogModelAvailability' },
  { file: 'electron/catalog/modelCatalogListing.ts', question: 'MCP list_models 对外的 usable / statusReason', reads: 'createCatalogAvailability' },
  { file: 'electron/ai/textBrainResolver.ts', question: '首页横幅「创作助手连没连上模型」+ 选哪个文本大脑', reads: 'createCatalogAvailability' },
  { file: 'electron/capabilityCore/generationDefaultModelResolver.ts', question: 'Agent 建分镜时的图片/视频默认模型', reads: 'createCatalogAvailability' },
  { file: 'electron/capabilityCore/moduleCatalogBootstrap.ts', question: 'nomi_generation_plan 的语义能力注册表（钥匙那几档按层放行，见文件内注释）', reads: 'createCatalogAvailability' },
  { file: 'electron/capabilityCore/mcpStdioServer.ts', question: 'MCP 视频模型清单', reads: 'createCatalogAvailability' },
  { file: 'electron/capabilityCore/appIntegration.ts', question: '应用内视频模型清单', reads: 'createCatalogAvailability' },
  { file: 'electron/providerAdapter/serviceLanguageModels.ts', question: '适配器可用的语言模型', reads: 'createCatalogAvailability' },
  { file: 'src/config/modelCatalogCache.ts', question: '渲染层第一道闸：画布/分镜所有选择器的选项', reads: 'keepUsableModelRows(availability)' },
  { file: 'src/workbench/ai/assistantModelIdentity.ts', question: '创作助手模型下拉（可用性 + 文本角色）', reads: 'model.availability' },
  { file: 'src/workbench/settings/defaultGenerationModelOptions.ts', question: 'Agent 面板「图片默认 / 视频默认」两行', reads: 'model.availability' },
  { file: 'src/workbench/generationCanvas/runner/usableVendorModel.ts', question: '旧节点重解析时选哪条模型', reads: 'model.availability' },
  { file: 'src/workbench/generationCanvas/runner/catalogTaskResolve.ts', question: '节点执行前的目录重解析', reads: 'model.availability' },
  { file: 'src/ui/onboarding/modelSettingsCatalogProjection.ts', question: '设置页 chip 投影（把 availability 带进渲染层）', reads: 'row.availability' },
  { file: 'src/ui/onboarding/modelSettingsHomeState.ts', question: '设置 → 模型 每行状态与「N 个可使用」', reads: 'model.availability' },
  { file: 'src/ui/onboarding/OnboardingDrawer.tsx', question: '接入抽屉「这家的模型已上线 / N 个」', reads: 'model.availability' },
  { file: 'src/ui/onboarding/onboardingDrawerDerivations.ts', question: '接入抽屉「这一类你已经覆盖了吗」', reads: 'model.availability' },
]

/**
 * **答的是另一个问题**的谓词：它们问「这家连上了没」，不是「这个模型现在能不能用」。
 * 一家可以连得好好的却一个模型都还不能用（都没走完认证）——那时抽屉说「已连接」是对的，
 * 而模型下拉是空的也是对的。每条都必须写清理由；新增未登记的一律红。
 */
export const VENDOR_CONNECTION_PREDICATES = {
  'electron/capabilityCore/generationProviderBootstrap.ts': '供应商 readiness：区分「目录里有这个模型但还没填 key」与「没有这个模型」，前者要指路去填 key',
  'electron/catalog/catalogHealth.ts': '健康度里的 enabledApiKeys 统计的是「钥匙」不是「模型」',
  'src/ui/onboarding/onboardingDrawerConnections.ts': '抽屉卡片分组「已连接 / 可添加」，问的是连接本身',
  'src/workbench/settings/settingsAutomationView.ts': '自动化设置里的连接状态灯（connected / disconnected）',
  'src/workbench/generationCanvas/nodes/decompose/useDecomposeLayers.ts': '「元素拆解」要的是 Replicate 这家通不通，不经过任何模型行',
  'src/workbench/generationCanvas/runner/assetUploadConsent.ts': 'kie 在这里是**素材上传宿主**不是模型供应商，问的是能不能往它那儿传文件',
}

const CREDENTIAL = /\b(hasApiKey|apiKeyDecryptStatus|decryptApiKeyRecord|apiKeysByVendor|credentialStatus|keyStatus)\b/
const PUBLICATION = /\b(published|publishedModes|modelHasPublishedExecution|derivePublishedExecution)\b|\.enabled\b/

function listFiles() {
  return gitPaths(['ls-files', 'src', 'electron'], { cwd: ROOT })
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file))
    .filter((file) => !/\.d\.ts$/.test(file))
    .filter((file) => fs.existsSync(path.join(ROOT, file)))
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 扫「凭据词 && 发布/启用词」形状的布尔表达式，只记最外层那一个（嵌套的是同一处）。 */
export function scanSource(relative, text) {
  if (!CREDENTIAL.test(text)) return []
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = []
  const visit = (node, insideHit) => {
    let hit = insideHit
    if (!insideHit && ts.isBinaryExpression(node)
      && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      const expression = node.getText(source)
      if (CREDENTIAL.test(expression) && PUBLICATION.test(expression)) {
        found.push({
          file: relative,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          expression: expression.replace(/\s+/g, ' ').slice(0, 120),
        })
        hit = true
      }
    }
    ts.forEachChild(node, (child) => visit(child, hit))
  }
  visit(source, false)
  return found
}

function scanPredicates(relative) {
  return scanSource(relative, fs.readFileSync(path.join(ROOT, relative), 'utf8'))
}

function fail(lines) {
  console.error(`\n✖ 「这个模型现在能不能用」单一 owner 门岗未通过。\n${lines.join('\n')}`)
  process.exit(1)
}

function main() {
  // ── ① owner 还在，且每个读者都还在消费它 ────────────────────────────────────────
  const problems = []
  for (const required of [OWNER, CATALOG_BINDING, RENDERER_GATE]) {
    if (!fs.existsSync(path.join(ROOT, required))) problems.push(`  · 缺少 ${required}（判据 owner 或它的接线层被删了）`)
  }
  if (problems.length === 0) {
    const ownerSource = fs.readFileSync(path.join(ROOT, OWNER), 'utf8')
    for (const symbol of ['deriveModelAvailability', 'MODEL_UNUSABLE_REASONS']) {
      if (!ownerSource.includes(`export ${symbol === 'MODEL_UNUSABLE_REASONS' ? 'const' : 'function'} ${symbol}`)) {
        problems.push(`  · ${OWNER} 不再导出 ${symbol}`)
      }
    }
    for (const reader of READERS) {
      const full = path.join(ROOT, reader.file)
      if (!fs.existsSync(full)) {
        problems.push(`  · 普查表里的读者不见了：${reader.file}（文件没了就把它从 READERS 删掉，别让表说谎）`)
        continue
      }
      const code = stripComments(fs.readFileSync(full, 'utf8'))
      if (!OWNER_SYMBOLS.some((symbol) => code.includes(symbol))) {
        problems.push([
          `  · ${reader.file} 不再引用可用性 owner 的任何结论`,
          `    它回答的是：${reader.question}`,
          '    要么把它接回 owner，要么它已经不回答这个问题了——那就从 READERS 里删掉并说明。',
        ].join('\n'))
      }
    }
  }
  if (problems.length > 0) fail(problems)

  // ── ② 第二份判据的 AST 棘轮 ─────────────────────────────────────────────────────
  const findings = listFiles().flatMap(scanPredicates)
    .filter((finding) => finding.file !== OWNER && finding.file !== CATALOG_BINDING)
  findings.sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`))

  if (process.argv.includes('--census')) {
    console.log('| 读者 | 它回答的问题 | 现在读谁 |')
    console.log('|---|---|---|')
    for (const reader of READERS) console.log(`| \`${reader.file}\` | ${reader.question} | \`${reader.reads}\` |`)
    console.log('\n**答的是另一个问题（「这家连上了没」，不是「这个模型能不能用」）：**\n')
    console.log('| 文件 | 为什么它可以自己判 |')
    console.log('|---|---|')
    for (const [file, reason] of Object.entries(VENDOR_CONNECTION_PREDICATES)) console.log(`| \`${file}\` | ${reason} |`)
    process.exit(0)
  }

  const unregistered = findings.filter((finding) => !(finding.file in VENDOR_CONNECTION_PREDICATES))
  console.log(`模型可用性：普查表 ${READERS.length} 个读者全部接在 owner 上；`
    + `「凭据 && 启用/发布」形状的表达式 ${findings.length} 处，登记为「另一个问题」的文件 ${Object.keys(VENDOR_CONNECTION_PREDICATES).length} 个。`)

  if (unregistered.length > 0) {
    fail([
      `  新增了 ${unregistered.length} 处第二份判据：`,
      ...unregistered.map((finding) => `   · ${finding.file}:${finding.line} — ${finding.expression}`),
      '',
      '  「这个模型现在能不能用」只有一份判据，住在 electron/shared/modelAvailability.ts，',
      '  结论随每行模型以 availability 下发。2026-09-12 真实验收 P0-10 就是这类副本漂开的结果：',
      '  同一时刻设置页说「2 个可使用」、首页说「尚未连接」、助手下拉说「没有可用的」。',
      '',
      '  修法：读 model.availability（渲染层）或 createCatalogAvailability(state)（主进程）。',
      '  它真的在答另一个问题（「这家连上了没」）？登记进 VENDOR_CONNECTION_PREDICATES 并写明理由——',
      '  理由会过期，写下来才能被复核。绝不允许为了让红变绿而随手登记。',
    ])
  }

  const staleRegistrations = Object.keys(VENDOR_CONNECTION_PREDICATES)
    .filter((file) => !findings.some((finding) => finding.file === file))
  if (staleRegistrations.length > 0) {
    console.log(`↓ 已清偿 ${staleRegistrations.length} 条登记，请从 VENDOR_CONNECTION_PREDICATES 删掉：`)
    for (const file of staleRegistrations) console.log(`   · ${file}`)
  }

  console.log('✅ 单一 owner 门岗通过（没有第二份「能不能用」的判据）。')

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
