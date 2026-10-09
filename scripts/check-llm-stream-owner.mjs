#!/usr/bin/env node
// LLM 流式调用单一 owner 门岗（2026-10-09；复审后改为语法树判定）。
//
// 起因：ai@4 的 streamText 在请求发不出去（网闸拦 / DNS / 断网，fetch 本身抛）或用户点停止时，既不抛也不关——
// textStream 静默结束、finishReason 永不 settle，错误只通过 onError 交出来。哪个调用点没接对，就是一个会让界面
// 永远停在「提交中」、让主进程任务永久悬挂的洞（真模型走查 2026-10-09 实测）。接对一次（electron/ai/streamTextTask.ts），
// 就不该再有第二个拿到这些函数的地方：任何要跑文本流的代码一律走 streamTextTask。
//
// 规则：任何文件（除 OWNER 外）**不管怎么拿**，只要从 "ai" 拿到 streamText / generateText / streamObject 就红：
//   · 具名导入（含 `as` 改名）；`import * as ns` 之后取这些成员、或让 ns 整个流出去（赋值 / 传参 / 导出）；
//   · 默认导入、`import x = require('ai')`、`require('ai')`、动态 `import('ai')`（拿到的是整个模块，追不住就当违规）；
//   · 重导出：`export { streamText } from 'ai'`、`export * from 'ai'`、`export * as ns from 'ai'`。
// 只引类型 / 错误类（APICallError 等）/ generateObject 不算。零基线，新增即红。
//
// 管什么 / 不管什么（2026-10-09 复审 2 裁定）：管**不小心**直接用——上面每一种写得出来的拿法都拦。
// 不管**故意**绕：`import(变量)`、`import("a" + "i")`、`const load = require; load("ai")` 这类非字面量的模块加载，
// 静态扫描追不住，也不追（追了就是无止境的猫鼠游戏），靠评审抓；残留风险写在 PR 正文「## 自审」。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const OWNER = 'electron/ai/streamTextTask.ts'
export const BANNED = new Set(['streamText', 'generateText', 'streamObject'])
const PACKAGE = 'ai'

const isAi = (node) => Boolean(node) && ts.isStringLiteralLike(node) && node.text === PACKAGE

/** 一个文件里，以哪些方式拿到了被禁函数。返回人话列表。 */
export function bannedAccesses(source, fileName = 'file.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const hits = []
  const namespaces = new Set()
  const note = (node, text) => hits.push(`${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${text}`)

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && isAi(node.moduleSpecifier)) {
      const clause = node.importClause
      if (clause && !clause.isTypeOnly) {
        if (clause.name) note(node, '默认导入 ai（拿到整个模块）')
        const bindings = clause.namedBindings
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text
            if (!element.isTypeOnly && BANNED.has(imported)) note(element, `具名导入 ${imported}`)
          }
        }
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && isAi(node.moduleReference.expression)) {
      note(node, 'import x = require("ai")')
    } else if (ts.isExportDeclaration(node) && isAi(node.moduleSpecifier) && !node.isTypeOnly) {
      if (!node.exportClause) note(node, 'export * from "ai"')
      else if (ts.isNamespaceExport(node.exportClause)) note(node, 'export * as ns from "ai"')
      else {
        for (const element of node.exportClause.elements) {
          const exported = (element.propertyName ?? element.name).text
          if (!element.isTypeOnly && BANNED.has(exported)) note(element, `重导出 ${exported}`)
        }
      }
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && isAi(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) note(node, '动态 import("ai")')
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') note(node, 'require("ai")')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // 命名空间导入：只许 ns.<非禁名> 这种成员访问；取禁名、或让 ns 整个流出去都算违规。
  if (namespaces.size) {
    const scanUses = (node) => {
      if (ts.isImportDeclaration(node)) return
      if (ts.isIdentifier(node) && namespaces.has(node.text)) {
        const parent = node.parent
        const member = ts.isPropertyAccessExpression(parent) && parent.expression === node
          ? parent.name.text
          : ts.isElementAccessExpression(parent) && parent.expression === node && ts.isStringLiteralLike(parent.argumentExpression)
            ? parent.argumentExpression.text
            : null
        if (member === null) note(node, `命名空间 ${node.text} 整个流出去 / 动态取成员`)
        else if (BANNED.has(member)) note(node, `命名空间取 ${node.text}.${member}`)
      }
      ts.forEachChild(node, scanUses)
    }
    scanUses(sf)
  }
  return hits
}

export function scan(root) {
  const found = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'dist-electron', '.git', '.tmp'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(tsx?|mts|cts|mjs|cjs|jsx?)$/.test(entry.name) || /\.(test|node-test)\.[cm]?[jt]sx?$/.test(entry.name)) continue
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (rel === OWNER) continue
      const accesses = bannedAccesses(fs.readFileSync(full, 'utf8'), rel)
      if (accesses.length) found.push({ file: rel, accesses })
    }
  }
  for (const dir of ['src', 'electron', 'workers', 'scripts']) walk(path.join(root, dir))
  return found
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const hits = scan(root)
  if (hits.length) {
    console.error(`✖ ${hits.length} 个文件从 ai 里拿到了流式调用（只许 ${OWNER}）：`)
    for (const hit of hits) for (const access of hit.accesses) console.error(`  ${hit.file}:${access}`)
    console.error('  → 改走 streamTextTask（它接了 onError、并保证停止 / 出错 / 超时都让 await 收口；裸 streamText 会让调用永远挂住）')
    process.exit(1)
  }
  console.log(`✅ LLM 流式调用单一 owner：只有 ${OWNER} 拿得到 streamText / generateText / streamObject`)
}
