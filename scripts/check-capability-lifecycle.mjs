#!/usr/bin/env node
// 能力生命周期门岗（2026-09-17，批次 2 · J 块）。抓的是一类**当场什么都不报错**的结构退化：
// 一项 `renderer_required` 能力的渲染层执行路径，去读一个**只由某个 .tsx 组件的 useEffect 发布**的
// store 字段。组件没挂载，字段就是 null，能力就「不存在」——而执行路径把「不存在」说成「过期」
// （`surface_port_stale`），模型照建议重试，三次熔断，整条会话报废。
//
// 起因：`document.read` / `document.write` 的端口此前只由创作页 `WorkbenchEditor` 的 useEffect 发布
// （`setCreationDocumentTools`），真人默认冷启动落画布、创作页从未挂载 → `read_script` 必挂。
// 24 个契约里就这 2 个绑在组件生命周期上，其余 22 个都绑在项目会话 store 或主进程。
// 修法是把 owner 上移到项目会话层（`src/workbench/project/documentSessionPort.ts`）；本门岗守住它不回来。
//
// 判据（三步，全部按 TypeScript AST 算，不靠登记）：
//   ① 执行路径文件 = `src/` 里调用 `registerProjectCanvasReadSurface(` 或定义 `registerCapabilityApplyHandler`
//      的非测试文件（渲染层把能力 handler 接进 surface port / apply 管线的两处）。一个都找不到 = 红：
//      门岗的前提不成立，不能假绿。
//   ② 组件发布的字段 = 某个 `.tsx` 的 useEffect 里调用了 store 动作 `setXxx`，`xxx` 是 store 状态字段，
//      且 `src/` 里**没有任何非组件写入**——「写入」= 非 .tsx 文件里给 `xxx:` 赋一个非 null 值，
//      且不在 `setXxx` 动作自己的函数体里（那只是把组件的值转手）。置 null 的释放不算 owner。
//   ③ 执行路径文件里任何 `.xxx` 读取 → 违规行。
// 硬零，无棘轮基线：2026-09-17 修完就是 0，新增当场红。规则先在修复前的树上验过会红（3 行：
// NomiStudioApp.tsx 的 document.read / document.write handler + capabilityApplyHandler 的 document.write）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/** 读盘：`src/` 下全部非测试 ts/tsx，Map<相对路径, 源码>。 */
export function collectSourceFiles(root = repoRoot) {
  const files = new Map()
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|stories)\.tsx?$/.test(entry.name)) {
        files.set(path.relative(root, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8'))
      }
    }
  }
  walk(path.join(root, 'src'))
  return files
}

/** 契约里声明 `availability: "renderer_required"` 的能力 id（只用于报告；判据不按 id 分支）。 */
export function rendererRequiredCapabilities(root = repoRoot) {
  const dir = path.join(root, 'electron/shared/agentCapabilities')
  if (!fs.existsSync(dir)) return []
  const ids = []
  for (const entry of fs.readdirSync(dir)) {
    if (!/\.ts$/.test(entry) || /\.test\.ts$/.test(entry)) continue
    const source = fs.readFileSync(path.join(dir, entry), 'utf8')
    for (const match of source.matchAll(/id:\s*["']([a-z0-9.]+)["'][\s\S]{0,600}?availability:\s*["']renderer_required["']/g)) ids.push(match[1])
  }
  return [...new Set(ids)].sort()
}

function parse(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function calleeName(call) {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

function hasAncestor(node, predicate) {
  for (let current = node.parent; current; current = current.parent) if (predicate(current)) return true
  return false
}

const isEffectCall = (node) => ts.isCallExpression(node) && /^(useEffect|useLayoutEffect)$/.test(calleeName(node) ?? '')

/** `.tsx` 里 useEffect 作用域内调用的 `setXxx(`。 */
function componentPublishers(file, sourceFile) {
  const found = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      if (name && /^set[A-Z]/.test(name) && hasAncestor(node, isEffectCall)) found.push({ action: name, at: `${file}:${lineOf(sourceFile, node)}` })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/** store 状态字段：store/slice 文件里接口/类型成员（PropertySignature）的名字。 */
function storeStateFields(sourceFile) {
  const fields = new Set()
  const visit = (node) => {
    if (ts.isPropertySignature(node) && node.name && ts.isIdentifier(node.name)) fields.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return fields
}

/** 非组件文件里对 `field:` 的非 null 写入（对象字面量赋值），排除 `setField` 动作自己的函数体。 */
function nonComponentWrites(sourceFile, field, action) {
  let count = 0
  const insideOwnSetter = (node) => hasAncestor(node, (ancestor) =>
    (ts.isPropertyAssignment(ancestor) || ts.isMethodDeclaration(ancestor)) && ancestor.name && ts.isIdentifier(ancestor.name) && ancestor.name.text === action)
  const visit = (node) => {
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isIdentifier(node.name) && node.name.text === field) {
      const initializer = ts.isPropertyAssignment(node) ? node.initializer : node.name
      const isNull = initializer.kind === ts.SyntaxKind.NullKeyword
      if (!isNull && !insideOwnSetter(node)) count += 1
    }
    if (ts.isCallExpression(node) && calleeName(node) === action && !insideOwnSetter(node)) count += 1
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return count
}

/** 执行路径文件里读 `.field`（属性访问，不是赋值左值）。 */
function fieldReads(sourceFile, field) {
  const lines = []
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === field) {
      const assigned = ts.isBinaryExpression(node.parent) && node.parent.left === node && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      if (!assigned) lines.push(lineOf(sourceFile, node))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...new Set(lines)]
}

/**
 * 纯函数判据，供 CLI 与 node-test 共用。
 * @param {Map<string, string>} files 相对路径 → 源码（只含 src/ 非测试文件）
 * @returns {{ executionPaths: string[]; violations: Array<{at: string; field: string; publishedBy: string[]}> }}
 */
export function scanCapabilityLifecycle(files) {
  const parsed = new Map([...files].map(([file, source]) => [file, parse(file, source)]))

  // ① 执行路径。
  const executionPaths = []
  for (const [file, sourceFile] of parsed) {
    let defines = false
    let calls = false
    let definesApply = false
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'registerProjectCanvasReadSurface') defines = true
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'registerCapabilityApplyHandler') definesApply = true
      if (ts.isCallExpression(node) && calleeName(node) === 'registerProjectCanvasReadSurface') calls = true
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    if (!defines && (calls || definesApply)) executionPaths.push(file)
  }
  if (!executionPaths.length) throw new Error('capability-lifecycle: 找不到任何渲染层执行路径文件（registerProjectCanvasReadSurface 调用 / registerCapabilityApplyHandler 定义）——门岗前提不成立，不能假绿')

  // store 状态字段。
  const storeFiles = [...parsed.keys()].filter((file) => /src\/workbench\/(workbenchStore|\w+Slice)\.ts$/.test(file))
  const storeFields = new Set()
  for (const file of storeFiles) for (const field of storeStateFields(parsed.get(file))) storeFields.add(field)

  // ② 组件发布、且没有非组件 owner 的字段。
  const publishedBy = new Map()
  for (const [file, sourceFile] of parsed) {
    if (!file.endsWith('.tsx')) continue
    for (const publisher of componentPublishers(file, sourceFile)) {
      const field = lowerFirst(publisher.action.replace(/^set/, ''))
      if (!storeFields.has(field)) continue
      if (!publishedBy.has(field)) publishedBy.set(field, { action: publisher.action, at: [] })
      publishedBy.get(field).at.push(publisher.at)
    }
  }
  for (const [field, info] of [...publishedBy]) {
    const owned = [...parsed].some(([file, sourceFile]) => file.endsWith('.ts') && nonComponentWrites(sourceFile, field, info.action) > 0)
    if (owned) publishedBy.delete(field)
  }

  // ③ 执行路径里读这些字段。
  const violations = []
  for (const file of executionPaths) {
    for (const [field, info] of publishedBy) {
      for (const line of fieldReads(parsed.get(file), field)) violations.push({ at: `${file}:${line}`, field, publishedBy: info.at })
    }
  }
  violations.sort((a, b) => a.at.localeCompare(b.at))
  return { executionPaths, violations }
}

function main() {
  const files = collectSourceFiles()
  const capabilities = rendererRequiredCapabilities()
  const { executionPaths, violations } = scanCapabilityLifecycle(files)
  console.log(`能力生命周期门岗：renderer_required 能力 ${capabilities.length} 项（${capabilities.join(', ')}）`)
  console.log(`  渲染层执行路径文件 ${executionPaths.length} 个：${executionPaths.join(', ')}`)
  if (!violations.length) {
    console.log('  ✓ 没有执行路径读取「只由 .tsx 组件 useEffect 发布」的 store 字段（硬零）')
    return
  }
  console.error(`  ✗ ${violations.length} 处执行路径读取了只由组件生命周期发布的 store 字段：`)
  for (const violation of violations) console.error(`    ${violation.at}  .${violation.field}  ← 唯一发布者：${violation.publishedBy.join('；')}`)
  console.error('  修法：把这份能力的 owner 上移到项目会话层（src/workbench/project/），组件挂载只做增强覆盖；')
  console.error('  参考 src/workbench/project/documentSessionPort.ts 与 docs/lessons/capability-bound-to-component-lifecycle-reports-stale.md')
  process.exit(1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
