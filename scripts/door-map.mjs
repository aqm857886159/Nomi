#!/usr/bin/env node
// 数门（R21 / R27，2026-09-11）。输入一个状态的 mutator / store 符号或文件，
// 输出它的**全部写入口与读入口**——能直接粘进根因合同 `doors` 字段的数组。
//
// 为什么要它：2026-09-11 连着三簇 bug 同一个根因形状——**不变量只在一扇门上实现，
// 另一个入口绕过去**（画布写入的两条落地路径、付费收据的两个装配点、SkillRecord 的 7 条投影）。
// 每次都被单独修一次，因为修的人被任务书框在一个文件里：他看得见症状那扇门，看不见另外几扇。
// 「同类问题还能从别的入口回来吗」这一问此前**只能靠人去 grep**，而高负载下人不会去数。
// 数门是机器的活：AST 扫一遍，把门摆在桌面上，再决定修在哪一层。
//
// 判据刻意**宁可多数一扇，不肯漏数一扇**（同 check-gates-chain 的取向）：
// 多数出来的门看得见、人扫一眼就能划掉；漏数的门看不见，而它正是下一份合同的来源。
//
// 用法：
//   node scripts/door-map.mjs applyCanvasToolCall
//   node scripts/door-map.mjs electron/productionRun/productionRunApprovalReceipt.ts
//   node scripts/door-map.mjs readSkillRecords discoverSkillRecordsFromRoots
//   node scripts/door-map.mjs --write=setFoo --read=getFoo
//   node scripts/door-map.mjs applyCanvasToolCall --roots=src --include-tests
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_ROOTS = ['src', 'electron']
const SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const SKIP_PATH = /(?:^|\/)(?:node_modules|dist|release|\.tmp)(?:\/|$)/
const TEST_PATH = /\.(?:test|spec)\.[^.]+$|\.node-test\.[cm]?js$|(?:^|\/)(?:tests?|__tests__)(?:\/|$)/

/**
 * 默认分类：调用**读取型**符号算读入口，调用其它符号算写入口，非调用引用（类型引用、
 * 当值传递）一律算读入口。名字不足以判断时用 `--write=` / `--read=` 显式钉死——
 * 启发式是为了少打字，不是为了替人判断。
 */
const READER_NAME = /^(?:read|get|list|find|discover|peek|select|query|load|snapshot|collect|resolve)[A-Z0-9_]/

function usage(message) {
  if (message) console.error(`✖ ${message}\n`)
  console.error(`数门（door map）——列出一个状态的全部写入口与读入口

用法：
  node scripts/door-map.mjs <符号或文件> [更多符号或文件...] [选项]

选项：
  --write=a,b        把这些符号的调用点一律记为写入口
  --read=a,b         把这些符号的调用点一律记为读入口
  --roots=src,electron   扫描根目录（默认 src,electron）
  --include-tests    把测试文件也算成门（默认不算：测试不是生产入口）

输出：stdout 是能直接粘进 docs/fixes/*.root-cause.json 的 doors 数组；stderr 是人看的摘要。`)
  process.exit(message ? 1 : 0)
}

function parseArgs(argv) {
  const targets = []
  const forced = new Map()
  let roots = DEFAULT_ROOTS
  let includeTests = false
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') usage()
    else if (arg === '--include-tests') includeTests = true
    else if (arg.startsWith('--roots=')) roots = arg.slice(8).split(',').map((s) => s.trim()).filter(Boolean)
    else if (arg.startsWith('--write=') || arg.startsWith('--read=')) {
      const kind = arg.startsWith('--write=') ? 'write' : 'read'
      for (const name of arg.slice(arg.indexOf('=') + 1).split(',').map((s) => s.trim()).filter(Boolean)) {
        forced.set(name, kind)
        targets.push(name)
      }
    } else if (arg.startsWith('-')) usage(`不认识的选项：${arg}`)
    else targets.push(arg)
  }
  if (targets.length === 0) usage('至少要给一个符号名或文件路径')
  return { targets, forced, roots, includeTests }
}

function scriptKindOf(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  // 门岗脚本、hook 与构建脚本住在 .mjs/.cjs 里，它们一样是状态的入口（只是默认 roots 不扫 scripts/）。
  return /\.(?:js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
}

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file))
}

function collectSourceFiles(roots, includeTests) {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(repoRoot, full).split(path.sep).join('/')
      if (SKIP_PATH.test(rel)) continue
      if (entry.isDirectory()) walk(full)
      else if (SOURCE_EXTENSION.test(entry.name) && (includeTests || !TEST_PATH.test(rel))) files.push(rel)
    }
  }
  for (const root of roots) walk(path.resolve(repoRoot, root))
  return files
}

/** 一个文件导出的全部符号名——把「给我这个文件的门」翻译成「给我它导出的这些符号的门」。 */
function exportedSymbolsOf(relFile) {
  const absolute = path.resolve(repoRoot, relFile)
  const source = parse(relFile, fs.readFileSync(absolute, 'utf8'))
  const names = new Set()
  const isExported = (node) => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      if (!isExported(statement.declarationList.declarations[0] ?? statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement))
      && statement.name && isExported(statement)
    ) {
      names.add(statement.name.text)
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text)
    }
  }
  return [...names]
}

/** 这个 identifier 是「声明它自己」还是「用它」。声明、import/export 绑定、对象字面量的键都不算门。 */
function isBindingOccurrence(node) {
  const parent = node.parent
  if (!parent) return false
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent)
    || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent)) return true
  if (parent.name !== node) return false
  return ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isVariableDeclaration(parent)
    || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent)
    || ts.isEnumMember(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)
    || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isPropertyAssignment(parent)
    || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isModuleDeclaration(parent)
}

/** 这个 identifier 是不是被调用（含 `ns.symbol(...)` 这种命名空间调用）。 */
function isCallTarget(node) {
  const parent = node.parent
  if (!parent) return false
  if (ts.isCallExpression(parent) && parent.expression === node) return true
  return ts.isPropertyAccessExpression(parent) && parent.name === node
    && !!parent.parent && ts.isCallExpression(parent.parent) && parent.parent.expression === parent
}

function classify(symbol, called, forced) {
  const override = forced.get(symbol)
  if (override) return override
  if (!called) return 'read'
  return READER_NAME.test(symbol) ? 'read' : 'write'
}

export function mapDoors({ files, readFile, targetSymbols, forced = new Map() }) {
  const wanted = new Set(targetSymbols)
  const doors = []
  for (const file of files) {
    const text = readFile(file)
    if (![...wanted].some((symbol) => text.includes(symbol))) continue
    const source = parse(file, text)
    const visit = (node) => {
      if (ts.isIdentifier(node) && wanted.has(node.text) && !isBindingOccurrence(node)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        doors.push({ kind: classify(node.text, isCallTarget(node), forced), path: file, line, symbol: node.text })
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(source, visit)
  }
  const seen = new Set()
  return doors
    .filter((door) => {
      const key = `${door.kind}|${door.path}|${door.line}|${door.symbol}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path) || a.line - b.line || a.symbol.localeCompare(b.symbol))
}

function main() {
  const { targets, forced, roots, includeTests } = parseArgs(process.argv.slice(2))
  const targetSymbols = new Set()
  for (const target of targets) {
    if (SOURCE_EXTENSION.test(target) && fs.existsSync(path.resolve(repoRoot, target))) {
      const exported = exportedSymbolsOf(target)
      if (exported.length === 0) usage(`${target} 没有导出任何符号，数不出门`)
      for (const name of exported) targetSymbols.add(name)
    } else if (target.includes('/')) {
      usage(`文件不存在：${target}（符号名请直接写名字，不要带斜杠）`)
    } else {
      targetSymbols.add(target)
    }
  }

  const files = collectSourceFiles(roots, includeTests)
  const doors = mapDoors({
    files,
    readFile: (file) => fs.readFileSync(path.resolve(repoRoot, file), 'utf8'),
    targetSymbols,
    forced,
  })

  const writes = doors.filter((door) => door.kind === 'write')
  const reads = doors.filter((door) => door.kind === 'read')
  console.error(`数门：${[...targetSymbols].sort().join(', ')}`)
  console.error(`  扫了 ${files.length} 个文件（roots=${roots.join(',')}${includeTests ? '，含测试' : '，不含测试'}）`)
  console.error(`  写入口 ${writes.length} 扇 · 读入口 ${reads.length} 扇 · 共 ${doors.length} 扇`)
  for (const door of doors) console.error(`  [${door.kind}] ${door.path}:${door.line} ${door.symbol}`)
  console.error(`\n把下面这段粘进 docs/fixes/<日期>-<题目>.root-cause.json 的 "doors"；`)
  console.error(`门 ≥2 扇而本次没合并它们，必须在 "door_reduction.why_not" 里写清为什么。`)
  console.log(JSON.stringify(doors, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) main()
