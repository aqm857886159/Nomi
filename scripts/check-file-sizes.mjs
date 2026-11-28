#!/usr/bin/env node
// 文件体积门岗：按仓库 Prettier 配置归一化后统计代码行，防止压行或删注释逃过模块化边界。
// 650 行黄牌提示最大的顶层声明；800 行红牌。legacy/frozen 基线共用一份 JSON，棘轮只减不增、零松弛且达标即退表。

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as prettier from 'prettier'

import { gitPaths } from './lib/gitPaths.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MAX_LINES = 800
const WARNING_LINES = 650
const BASELINE_PATH = 'scripts/file-size-baseline.json'
const SCAN_DIRS = ['src', 'electron']
const SOURCE_RE = /\.(?:tsx?|[mc]ts)$/
const TEST_RE = /\.test\.(?:tsx?|[mc]ts)$/

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
}

const baseline = readJson(BASELINE_PATH)
const baselineEntries = baseline.entries ?? {}

function requestedPaths() {
  const raw = process.env.NOMI_FILESIZE_PATHS
  if (!raw) return null
  try {
    const values = JSON.parse(raw)
    if (!Array.isArray(values)) throw new Error('must be an array')
    return new Set(values)
  } catch (error) {
    throw new Error(`NOMI_FILESIZE_PATHS 不是 JSON 路径数组：${error.message}`, { cause: error })
  }
}

function listFiles() {
  const selected = requestedPaths()
  const allTracked = gitPaths(['ls-files', ...SCAN_DIRS], { cwd: ROOT })
    .filter((file) => SOURCE_RE.test(file))
    .filter((file) => !TEST_RE.test(file))
    .filter((file) => !/\.d\.(?:ts|[mc]ts)$/.test(file))
    .filter((file) => !/^src\/i18n\/(locales\/.*|resources)\.ts$/.test(file))
    .filter((file) => fs.existsSync(path.join(ROOT, file)))
  const trackedSet = new Set(allTracked)
  if (selected === null) return { files: allTracked, trackedSet }
  const baselineEdited = selected.has(BASELINE_PATH)
  const files = allTracked.filter(
    (file) => selected.has(file) || (baselineEdited && Object.prototype.hasOwnProperty.call(baselineEntries, file)),
  )
  return { files, trackedSet }
}

function lineStarts(text) {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) if (text[index] === '\n') starts.push(index + 1)
  return starts
}

function lineAt(starts, position) {
  let low = 0
  let high = starts.length
  while (low + 1 < high) {
    const middle = (low + high) >> 1
    if (starts[middle] <= position) low = middle
    else high = middle
  }
  return low + 1
}

function formattedCodeLines(text, languageVariant) {
  const starts = lineStarts(text)
  const ends = [...starts.slice(1).map((position) => position - 1), text.length]
  const comments = []
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, text)
  let token
  while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      comments.push([scanner.getTokenPos(), scanner.getTextPos()])
    }
  }
  const coveredByComment = (position) => comments.some(([start, end]) => position >= start && position < end)
  const codeLines = new Set()
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]
    const end = ends[index]
    let firstNonWhitespace = start
    while (firstNonWhitespace < end && /\s/.test(text[firstNonWhitespace])) firstNonWhitespace += 1
    if (firstNonWhitespace >= end) continue
    let hasCode = false
    for (let position = firstNonWhitespace; position < end; position += 1) {
      if (!/\s/.test(text[position]) && !coveredByComment(position)) {
        hasCode = true
        break
      }
    }
    if (hasCode) codeLines.add(index + 1)
  }
  return { codeLines, starts }
}

function declarationName(node) {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((item) => item.name.getText()).join(', ')
  if (node.name) return node.name.getText()
  return `<${ts.SyntaxKind[node.kind]}>`
}

function topDeclarations(formatted, relativePath, codeLines, starts) {
  const scriptKind = relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const languageVariant = relativePath.endsWith('.tsx') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard
  const sourceFile = ts.createSourceFile(relativePath, formatted, ts.ScriptTarget.Latest, true, scriptKind)
  if (sourceFile.parseDiagnostics.length > 0) {
    const message = ts.flattenDiagnosticMessageText(sourceFile.parseDiagnostics[0].messageText, ' ')
    throw new Error(`TypeScript AST 解析失败：${message}`)
  }
  const declarations = []
  for (const node of sourceFile.statements) {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)) continue
    const start = lineAt(starts, node.getStart(sourceFile))
    const end = lineAt(starts, node.end)
    const lines = [...codeLines].filter((line) => line >= start && line <= end).length
    declarations.push({ name: declarationName(node), lines })
  }
  return { declarations: declarations.sort((left, right) => right.lines - left.lines).slice(0, 3), languageVariant }
}

async function analyzeFile(relativePath, { force = false } = {}) {
  const absolutePath = path.join(ROOT, relativePath)
  const source = fs.readFileSync(absolutePath, 'utf8')
  const nonWhitespaceCharacters = source.replace(/\s/g, '').length
  // 800 is a safe lower bound: a formatted code line must contain at least one non-whitespace character.
  // This rejects obviously small files before the slower Prettier pass without making the metric evadable by compression.
  // 基线表内文件强制完整测量，避免瘦身到极小文件后跳过退表检查。
  if (!force && nonWhitespaceCharacters < WARNING_LINES + 1) return { relativePath, formattedLines: nonWhitespaceCharacters, declarations: [], skipped: true }
  const options = (await prettier.resolveConfig(absolutePath)) ?? {}
  let formatted
  try {
    formatted = await prettier.format(source, { ...options, filepath: absolutePath })
  } catch (error) {
    throw new Error(`Prettier 格式化失败：${error.message}`, { cause: error })
  }
  const languageVariant = relativePath.endsWith('.tsx') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard
  const { codeLines, starts } = formattedCodeLines(formatted, languageVariant)
  const { declarations } = topDeclarations(formatted, relativePath, codeLines, starts)
  return { relativePath, formattedLines: codeLines.size, declarations, skipped: false }
}

function gitShow(ref, relativePath) {
  try {
    return execFileSync('git', ['show', `${ref}:${relativePath}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function resolveOriginRef(ref) {
  try {
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', ref], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (mergeBase) return mergeBase
  } catch {
    // 无共同祖先、无 HEAD 或浅克隆时退回直接读 ref
  }
  return ref
}

/**
 * origin/main 上的基线。`legacyAllowlist` = origin/main 还没有基线 JSON、只有旧脚本里的 ALLOWLIST：
 * 这就是唯一一次迁移窗口（旧 5 项按格式化代码行重算、写入冻结项）。JSON 一合进 main，窗口在结构上关上，不认提交号。
 */
function originEntries() {
  if (process.env.NOMI_FILESIZE_SKIP_BASELINE_COMPARE === '1') return null
  const ref = process.env.NOMI_FILESIZE_ORIGIN_REF ?? 'origin/main'
  const baseRef = resolveOriginRef(ref)
  const json = gitShow(baseRef, BASELINE_PATH)
  if (json) {
    try {
      return { entries: JSON.parse(json).entries ?? {}, legacyAllowlist: false }
    } catch (error) {
      throw new Error(`${ref}:${BASELINE_PATH} 不是合法 JSON：${error.message}`, { cause: error })
    }
  }
  const oldScript = gitShow(baseRef, 'scripts/check-file-sizes.mjs')
  if (!oldScript) return null
  const match = oldScript.match(/const ALLOWLIST = \{([\s\S]*?)\n\};/)
  if (!match) return { entries: {}, legacyAllowlist: true }
  const entries = {}
  for (const item of match[1].matchAll(/"([^"]+)"\s*:\s*(\d+)/g)) entries[item[1]] = { kind: 'legacy', max: Number(item[2]) }
  return { entries, legacyAllowlist: true }
}

function baselineDriftErrors() {
  const origin = originEntries()
  if (origin === null) return { errors: [], warnings: ['⚠ 未找到 origin/main 基线，跳过基线漂移比较（本地夹具或无远端引用）'] }
  const previous = origin.entries
  const migrationWindow = origin.legacyAllowlist
  const errors = []
  const warnings = []
  for (const [file, entry] of Object.entries(baselineEntries)) {
    const old = previous[file]
    if (!old) {
      if (!migrationWindow) errors.push(`✗ 基线新增 ${file}（清单只许变短；新增冻结/白名单必须先拆）`)
      continue
    }
    if (entry.max > old.max && !migrationWindow) errors.push(`✗ 基线上调 ${file}: ${entry.max} > origin/main ${old.max}（基线只许降不许升）`)
    if (entry.max < old.max) warnings.push(`↓ 基线下调 ${file}: ${entry.max} < origin/main ${old.max}`)
    if (entry.kind !== old.kind && !migrationWindow) errors.push(`✗ 基线 kind 变更 ${file}: ${old.kind ?? 'legacy'} → ${entry.kind}`)
  }
  if (migrationWindow) warnings.push(`ℹ 一次性基线迁移已启用：origin/main 还没有 ${BASELINE_PATH}（只有旧白名单）；合入后清单只许变短`)
  return { errors, warnings }
}

function baselineEntriesValidityErrors(trackedSet, analyzedSet) {
  const errors = []
  for (const [file, entry] of Object.entries(baselineEntries)) {
    if (!trackedSet.has(file)) {
      errors.push(`✗ ${file}: 基线文件已不存在或不再属于受检源码，请同 PR 从 ${BASELINE_PATH} 退表移除`)
      continue
    }
    if (!Number.isInteger(entry?.max)) {
      errors.push(`✗ ${file}: 基线上限 max 非有效整数（实际：${JSON.stringify(entry?.max)}），请修正或从 ${BASELINE_PATH} 移除`)
      continue
    }
    if (!analyzedSet.has(file) && entry.max <= MAX_LINES) {
      errors.push(`✗ ${file}: 基线上限 ${entry.max} <= 红线 ${MAX_LINES}（已达标，请同 PR 从 ${BASELINE_PATH} 退表移除）`)
    }
  }
  return errors
}

function baselineMessage(relativePath, currentLines, entry, declarations) {
  const largest = declarations[0]?.name ?? entry?.topDeclarations?.[0]?.name ?? '最大顶层声明'
  if (!entry) {
    if (currentLines > MAX_LINES) return `✗ ${relativePath}: ${currentLines} 行 > 上限 ${MAX_LINES}（新文件巨壳；最大顶层声明 ${largest}，请按职责拆分）`
    return null
  }
  if (!Number.isInteger(entry.max)) return null
  if (currentLines > entry.max) {
    if (entry.max <= MAX_LINES) {
      return `✗ ${relativePath}: ${currentLines} 行 > 基线上限 ${entry.max}（${largest}），且基线上限 <= 红线 ${MAX_LINES}；请拆到 <= ${MAX_LINES} 行并从 ${BASELINE_PATH} 退表移除`
    }
    return `✗ ${relativePath}: ${currentLines} 行 > 冻结上限 ${entry.max}（${largest}；新口径落地时已超线，冻结，按职责逐步拆）`
  }
  if (currentLines <= MAX_LINES) {
    return `✗ ${relativePath}: 当前实测 ${currentLines} 行 <= 红线 ${MAX_LINES}（已达标，请同 PR 从 ${BASELINE_PATH} 退表移除）`
  }
  if (currentLines < entry.max) {
    return `✗ ${relativePath}: 登记上限 ${entry.max} 高出当前实测 ${currentLines} 行（零松弛棘轮；请同 PR 将 ${BASELINE_PATH} 中该项 max 收紧为 ${currentLines}）`
  }
  return null
}

async function checkFileSizes() {
  const { files, trackedSet } = listFiles()
  const analyzedSet = new Set(files)
  const errors = []
  const warnings = []
  const drift = baselineDriftErrors()
  errors.push(...drift.errors)
  warnings.push(...drift.warnings)
  errors.push(...baselineEntriesValidityErrors(trackedSet, analyzedSet))
  for (const relativePath of files) {
    const entry = baselineEntries[relativePath]
    const result = await analyzeFile(relativePath, { force: Boolean(entry) })
    if (result.skipped) continue
    const currentLines = result.formattedLines
    const message = baselineMessage(relativePath, currentLines, entry, result.declarations)
    if (message?.startsWith('✗')) errors.push(message)
    else if (message) warnings.push(message)
    if (currentLines >= WARNING_LINES && currentLines <= MAX_LINES && !message) {
      warnings.push(`⚠ ${relativePath}: ${currentLines} 行达到黄牌（最大顶层声明 ${result.declarations.map((item) => `${item.name} ${item.lines} 行`).join('、') || '未识别'}；按职责拆分）`)
    }
  }
  for (const warning of warnings) console.warn(warning)
  if (errors.length > 0) {
    console.error(`\n文件体积门岗未通过（格式化代码行；650 黄牌，800 红牌，基线只降不升且零松弛）：\n${errors.join('\n')}\n`)
    process.exitCode = 1
    return
  }
  console.log(`✓ 文件体积门岗通过：格式化代码行；黄牌 ${WARNING_LINES}，红牌 ${MAX_LINES}；冻结/legacy 基线 ${Object.keys(baselineEntries).length} 个（棘轮只减不增、零松弛）。`)
}

checkFileSizes().catch((error) => {
  console.error(`文件体积门岗无法运行：${error.message}`)
  process.exitCode = 1
})
