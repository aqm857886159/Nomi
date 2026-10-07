#!/usr/bin/env node
/**
 * 「每个 store 数据字段都要声明寿命，project 级的必须被释放」门岗（C1，2026-09-18）。
 *
 * 为什么要它（审计 `docs/audit/2026-09-17-ownership-lifetime-census.md` §1.1）：
 * 14 个 zustand store 里只有 3 个被项目释放点碰到，而释放点本身是一份**手写清单**——
 * 它是 `0e1be560a`「reduce canvas memory usage」的副产品，不是「项目会话 owner」的设计。
 * 手写清单的问题不是漏了哪个字段，是**没有一处写着「这个字段归谁」**：加字段的人没有任何
 * 机器提示要不要清它。用户那边的样子是：切到新项目后，上一个项目的付费待确认卡、
 * 素材导入进度、常驻活动角标还在。
 *
 * 三条规则（都是硬零）：
 *   ① 每个 zustand store 都要有一份 `declareStoreLifetime` 声明；
 *   ② 声明必须覆盖这个 store 的每一个数据字段（含 slice spread 进来的），不许多也不许少；
 *   ③ 有 `project` 级字段的声明必须给得出 `releaseProject`，且注册表被释放点真的调到。
 *
 * 用法：node scripts/check-store-lifetime.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(repoRoot, 'src')
const RELEASE_FILE = 'src/workbench/project/releaseWorkbenchProjectSession.ts'
const LIFETIMES = new Set(['process', 'window', 'project', 'view', 'turn'])
const failures = []

const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

function walk(root, out = []) {
  if (!fs.existsSync(root)) return out
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(file, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(file)
  }
  return out
}

const FILES = walk(SRC)
const sourceCache = new Map()
function sourceOf(file) {
  if (!sourceCache.has(file)) {
    sourceCache.set(file, ts.createSourceFile(rel(file), fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS))
  }
  return sourceCache.get(file)
}

/** 剥掉包装拿到真正的初始化对象字面量（与 scan-ownership.mjs 同一套判据）。 */
function initializerObject(node, sf) {
  let found = null
  const visit = (n) => {
    if (found) return
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) {
      let inner = n.body
      while (inner && !ts.isObjectLiteralExpression(inner)) {
        if (ts.isParenthesizedExpression(inner)) inner = inner.expression
        else if (ts.isCallExpression(inner) && inner.arguments[0]) inner = inner.arguments[0]
        else break
      }
      if (inner && ts.isObjectLiteralExpression(inner)) { found = inner; return }
      if (n.body && ts.isBlock(n.body)) {
        for (const st of n.body.statements) {
          if (ts.isReturnStatement(st) && st.expression) {
            let expression = st.expression
            while (ts.isParenthesizedExpression(expression)) expression = expression.expression
            if (ts.isObjectLiteralExpression(expression)) { found = expression; return }
          }
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/** 对象字面量 → { data: 字段名[], spreadCalls: 被 spread 的函数名[] }。 */
function splitFields(object, sf) {
  const data = []
  const spreadCalls = []
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      let expression = property.expression
      if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) spreadCalls.push(expression.expression.text)
      continue
    }
    const key = property.name?.getText(sf)
    if (!key) continue
    const initializer = ts.isPropertyAssignment(property) ? property.initializer : null
    const isAction = ts.isMethodDeclaration(property)
      || (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)))
    if (!isAction) data.push(key)
  }
  return { data, spreadCalls }
}

/**
 * 全仓的「初始状态工厂」：名字 → 它返回的对象里的数据字段。
 *
 * 不按名字后缀筛（`*Slice` / `create*` 各有各的写法，按名字必漏），只按**形状**：
 * 一个返回对象字面量的顶层函数。store 那边 spread 了哪个名字，这里就查得到哪个。
 * 查不到的 spread 会被下面报红——门岗数不全字段时必须明说，不许当作「没有字段」放过去。
 */
const sliceFields = new Map()
for (const file of FILES) {
  const sf = sourceOf(file)
  const visit = (node) => {
    const named = (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name
    if (named) {
      const object = ts.isFunctionDeclaration(node)
        ? initializerObject(node, sf)
        : (node.initializer ? initializerObject(node.initializer, sf) : null)
      if (object) sliceFields.set(node.name.getText(sf), splitFields(object, sf))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

/** slice 可能再 spread 下一层 slice，展开到不动点。 */
function expandSlice(name, seen = new Set()) {
  if (seen.has(name)) return []
  seen.add(name)
  const entry = sliceFields.get(name)
  if (!entry) return []
  return [...entry.data, ...entry.spreadCalls.flatMap((next) => expandSlice(next, seen))]
}

// ── 扫 store ────────────────────────────────────────────────────────────────
const stores = []
for (const file of FILES.filter((f) => /from ['"]zustand/.test(fs.readFileSync(f, 'utf8')))) {
  const sf = sourceOf(file)
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer
      && /^create(Store)?\b/.test(node.initializer.getText(sf).replace(/\s+/g, ' '))) {
      const object = initializerObject(node.initializer, sf)
      if (object) {
        const { data, spreadCalls } = splitFields(object, sf)
        const fromSlices = spreadCalls.flatMap((name) => expandSlice(name))
        stores.push({
          name: node.name.getText(sf),
          file: rel(file),
          fields: [...new Set([...data, ...fromSlices])].sort(),
          unresolvedSpreads: spreadCalls.filter((name) => !sliceFields.has(name)),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}
console.log(`scanned=${stores.length}`)

// ── 扫声明 ──────────────────────────────────────────────────────────────────
const declarations = new Map()
for (const file of FILES) {
  const source = fs.readFileSync(file, 'utf8')
  if (!source.includes('declareStoreLifetime(')) continue
  const sf = sourceOf(file)
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'declareStoreLifetime') {
      const argument = node.arguments[0]
      if (!argument || !ts.isObjectLiteralExpression(argument)) {
        failures.push(`${rel(file)}: declareStoreLifetime 的参数不是对象字面量——门岗读不到声明就等于没有声明`)
        return
      }
      let storeName = null
      const fields = new Map()
      let hasRelease = false
      for (const property of argument.properties) {
        const key = ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property) ? property.name?.getText(sf) : null
        if (key === 'store' && ts.isPropertyAssignment(property)) storeName = property.initializer.getText(sf).replace(/['"]/g, '')
        if (key === 'releaseProject') hasRelease = true
        if (key === 'fields' && ts.isPropertyAssignment(property)) {
          let value = property.initializer
          while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value)) value = value.expression
          if (ts.isObjectLiteralExpression(value)) {
            for (const entry of value.properties) {
              if (!ts.isPropertyAssignment(entry)) continue
              fields.set(entry.name.getText(sf).replace(/['"]/g, ''), entry.initializer.getText(sf).replace(/['"]/g, ''))
            }
          }
        }
      }
      if (storeName) declarations.set(storeName, { file: rel(file), fields, hasRelease })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

// ── 规则①②③ ────────────────────────────────────────────────────────────────
for (const store of stores) {
  const declaration = declarations.get(store.name)
  if (!declaration) {
    failures.push(`${store.file}: ${store.name} 没有 declareStoreLifetime 声明——`
      + `每个数据字段都要写明寿命（process/window/project/view/turn），否则「切项目要不要清它」没有答案`)
    continue
  }
  if (store.unresolvedSpreads.length > 0) {
    failures.push(`${store.file}: ${store.name} spread 了解析不到的 slice（${store.unresolvedSpreads.join(', ')}）`
      + `——门岗数不全它的字段，等于这个 store 的声明无法校验`)
  }
  for (const field of store.fields) {
    if (!declaration.fields.has(field)) {
      failures.push(`${declaration.file}: ${store.name}.${field} 没有寿命声明——新增字段必须同时写明它活到什么时候`)
    }
  }
  for (const [field, lifetime] of declaration.fields) {
    if (!store.fields.includes(field)) {
      failures.push(`${declaration.file}: ${store.name}.${field} 声明了寿命但 store 里没有这个字段（孤儿声明）`)
    }
    if (!LIFETIMES.has(lifetime)) {
      failures.push(`${declaration.file}: ${store.name}.${field} 的寿命 '${lifetime}' 不在 {${[...LIFETIMES].join(' | ')}} 里`)
    }
  }
  const projectScoped = [...declaration.fields].filter(([, lifetime]) => lifetime === 'project')
  if (projectScoped.length > 0 && !declaration.hasRelease) {
    failures.push(`${declaration.file}: ${store.name} 有 ${projectScoped.length} 个 project 级字段却没有 releaseProject`
      + `——声明说它归项目会话管，就必须给得出清理它的办法`)
  }
}

// 释放点必须**从注册表派生**，不许再手写清单：它不许直接 setState 到这些 store 上。
{
  const releasePath = path.join(repoRoot, RELEASE_FILE)
  const source = fs.existsSync(releasePath) ? fs.readFileSync(releasePath, 'utf8') : ''
  if (!source) failures.push(`${RELEASE_FILE}: 找不到项目释放点`)
  else {
    if (!/storeLifetimeRegistry\(\)/.test(source)) {
      failures.push(`${RELEASE_FILE}: 释放点没有遍历 storeLifetimeRegistry()——`
        + `它又变回一份手写清单了，而手写清单正是这条门岗要治的东西`)
    }
    for (const match of source.matchAll(/(use[A-Z]\w*Store)\.setState\(/g)) {
      failures.push(`${RELEASE_FILE}: 直接对 ${match[1]} setState 是手写清单——改成在该 store 的 releaseProject 里清`)
    }
  }
}

if (failures.length) {
  console.error('check:store-lifetime 失败：\n')
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  console.error('\n为什么有这条门岗：docs/audit/2026-09-17-ownership-lifetime-census.md §1.1 / §6 C1')
  process.exit(1)
}
const projectFields = [...declarations.values()]
  .reduce((total, d) => total + [...d.fields].filter(([, l]) => l === 'project').length, 0)
console.log(`check:store-lifetime 通过（${stores.length} 个 store 全部声明；其中 ${projectFields} 个 project 级字段由释放点派生清理）`)
