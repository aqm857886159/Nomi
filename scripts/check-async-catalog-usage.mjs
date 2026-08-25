#!/usr/bin/env node
// 棘轮：D2 将 catalog 读路径改为 ipcRenderer.invoke 后，返回值是 Promise。
// 只拦「还没 await 就当数组用」这一族；不猜复杂数据流，宁可漏报，避免把合法的 Promise.then 误判成红。
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(root, 'scripts/async-catalog-usage-baseline.json')
const APIs = new Set(['listModels', 'listVendors', 'listMappings', 'describeChannels', 'listSkills'])
const ARRAY_METHODS = new Set(['find', 'map', 'some', 'filter', 'reduce', 'forEach', 'every', 'includes', 'join'])

function filesUnder(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-electron', '.git'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) filesUnder(full, out)
    else if (/\.(?:[cm]?[jt]sx?|mjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))) node = node.expression
  return node
}

function propName(node) {
  node = unwrap(node)
  return ts.isPropertyAccessExpression(node) ? node.name.text : null
}

function apiCall(node) {
  node = unwrap(node)
  if (!ts.isCallExpression(node)) return null
  const name = propName(node.expression)
  return name && APIs.has(name) ? name : null
}

function isAwaited(node) {
  let parent = node.parent
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent))) parent = parent.parent
  return Boolean(parent && ts.isAwaitExpression(parent))
}

function scanFile(file) {
  const source = fs.readFileSync(file, 'utf8')
  const kind = /\.tsx?$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const hits = []
  const pending = new Map()
  const report = (node, api, shape) => {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
    hits.push({ file: path.relative(root, file), line: pos, api, shape })
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = unwrap(node.expression.expression)
      const api = apiCall(receiver)
      if (api && ARRAY_METHODS.has(method) && !isAwaited(receiver)) report(node, api, `direct .${method}`)
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const api = apiCall(node.initializer)
      if (api && !isAwaited(node.initializer) && ts.isIdentifier(node.name)) pending.set(node.name.text, { api, node })
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && ARRAY_METHODS.has(node.name.text)) {
      const item = pending.get(node.expression.text)
      if (item) report(node, item.api, `variable .${node.name.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

const hits = filesUnder(path.join(root, 'src')).concat(filesUnder(path.join(root, 'electron')), filesUnder(path.join(root, 'tests')))
  .flatMap(scanFile)
  .filter((hit, index, all) => all.findIndex((other) => other.file === hit.file && other.line === hit.line && other.api === hit.api) === index)
const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : []
const allowed = new Set(Array.isArray(baseline) ? baseline : baseline.hits || [])
const key = (hit) => `${hit.file}:${hit.line}:${hit.api}`
const fresh = hits.filter((hit) => !allowed.has(key(hit)))
const silent = hits.filter((hit) => /\?\./.test(fs.readFileSync(path.join(root, hit.file), 'utf8').split('\n')[hit.line - 1] || ''))
console.log(`异步 catalog 返回值用法：发现 ${hits.length} 处，?. 链 ${silent.length} 处，基线 ${allowed.size} 处`)
for (const hit of hits) console.log(`  ${fresh.includes(hit) ? '✗' : '·'} ${key(hit)} (${hit.shape})`)
if (fresh.length) {
  console.error(`❌ 异步 catalog 棘轮失败：${fresh.length} 处新缺陷；Promise 必须先 await 再调用数组方法。`)
  process.exit(1)
}
console.log('✅ 异步 catalog 棘轮通过：无新增 Promise 当数组用法。')
