// check:concept-owners 的取证层（R33 / R21.3，2026-09-29）。
//
// 只做三件机器活，判据全在 concept-owners-lib.mjs：
//   ① 读源码——工作树，或者某个提交（`--source-ref`，用来复验「现在这本账能不能拦住当年那份代码」）；
//   ② 找**定义**——一个符号在哪些文件里被定义（函数 / 类 / 类型 / 变量 / 对象成员），别名与重导出不算；
//   ③ 数**门**——直接复用 scripts/door-map.mjs 的 AST 引擎，门的判法与 `node scripts/door-map.mjs` 逐字相同，
//      不在这里另写一套（两套数门判据必然漂开，R14.1）。
// 另外住着从 check:identity-compare 并进来的「身份比对」形状探测（2026-09-29 并入，理由见方案 Phase 1 进度）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { dedupeDoors, mapDoorOccurrences } from './door-map.mjs'
import { parseCatFileBatch } from './lib/entryDirectory.mjs'
import { gitPaths } from './lib/gitPaths.mjs'

export const SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
/** 定义扫描的根：第二个 owner 可能长在任何一处——产品代码、测试夹具之外的走查脚本、门岗脚本、官网 worker。 */
export const DEFINITION_ROOTS = ['src', 'electron', 'tests', 'evals', 'scripts', 'worker', 'workers']
/** 「生产入口」只数这两处（pending 冻结管的是生产写入口）；owner 住在别处的概念另加它自己的根。 */
export const PRODUCTION_ROOTS = ['src', 'electron']
/** 目录遍历时整棵跳过的：依赖、构建产物、临时编译输出。 */
const SKIPPED_DIRECTORY = /(?:^|\/)(?:node_modules|dist|release|\.tmp)(?:\/|$)/
/** 不是「生产或走查代码」的文件：单测、夹具、类型声明。它们里面的同名定义是替身，不是第二个 owner。 */
const NOT_A_SOURCE_OF_TRUTH = /(?:^|\/)(?:__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[^./]+$|\.node-test\.[cm]?js$|\.d\.ts$/

export function normalizePath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '')
}

/** 能当「真相」读的源码文件：扩展名对、不是单测/夹具/类型声明。 */
export function isScannableSource(file) {
  const rel = normalizePath(file)
  return SOURCE_EXTENSION.test(rel) && !NOT_A_SOURCE_OF_TRUTH.test(rel) && !SKIPPED_DIRECTORY.test(rel)
}

export function rootOf(file) {
  const rel = normalizePath(file)
  const slash = rel.indexOf('/')
  return slash === -1 ? '' : rel.slice(0, slash)
}

/** 一个文件落在给定根里吗（'' 表示仓库根目录下的文件，如 vite.config.ts）。 */
export function underRoots(file, roots) {
  const root = rootOf(file)
  return roots.includes(root)
}

// ─── 源码来源：工作树 / 某个提交 ─────────────────────────────────────────────

/** 一组文件路径 → 它们的全部上级目录（用来回答「这个目录在不在」）。 */
function directoriesOf(files) {
  const directories = new Set()
  for (const file of files) {
    let slash = file.lastIndexOf('/')
    while (slash > 0) {
      const dir = file.slice(0, slash)
      if (directories.has(dir)) break
      directories.add(dir)
      slash = dir.lastIndexOf('/')
    }
  }
  return directories
}

/**
 * 工作树：按需读、读过就缓存。
 * 「路径在不在」问 git 的精确路径表（已跟踪 + 未跟踪未忽略 − 已删），不问 fs：Windows 的 fs 不分大小写，
 * 登记表里大小写写错的路径本机会过、CI（Linux）会红——两边判据必须一致。不是 git 仓库时才退回 fs。
 */
export function workingTreeSource(repoRoot) {
  const cache = new Map()
  let listing = null
  let known = null
  const knownPaths = () => {
    if (known !== null) return known
    try {
      const deleted = new Set(gitPaths(['ls-files', '--deleted'], { cwd: repoRoot }))
      const files = gitPaths(['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot })
        .filter((file) => !deleted.has(file))
      known = { files: new Set(files), directories: directoriesOf(files) }
    } catch {
      known = false
    }
    return known
  }
  const walk = (absoluteDir, out) => {
    let entries
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = path.join(absoluteDir, entry.name)
      const rel = normalizePath(path.relative(repoRoot, absolute))
      if (SKIPPED_DIRECTORY.test(rel)) continue
      if (entry.isDirectory()) walk(absolute, out)
      else if (entry.isFile()) out.push(rel)
    }
  }
  return {
    label: '工作树',
    listFiles() {
      if (listing) return listing
      const out = []
      for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
        if (entry.isFile()) out.push(entry.name)
      }
      for (const root of DEFINITION_ROOTS) walk(path.join(repoRoot, root), out)
      listing = out.sort()
      return listing
    },
    exists(file) {
      const rel = normalizePath(file).replace(/\/$/, '')
      const paths = knownPaths()
      if (paths) return paths.files.has(rel) || paths.directories.has(rel)
      return fs.existsSync(path.join(repoRoot, rel))
    },
    read(file) {
      const rel = normalizePath(file)
      if (cache.has(rel)) return cache.get(rel)
      let text = null
      try {
        text = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
      } catch {
        text = null
      }
      cache.set(rel, text)
      return text
    },
  }
}

/** 某个提交：整棵树的路径表一次拿全，内容用 `cat-file --batch` 成批读（一个进程读几千个文件）。 */
export function gitRefSource(repoRoot, ref) {
  const verify = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repoRoot, encoding: 'utf8' })
  if (verify.status !== 0) throw new Error(`读不到提交 ${ref}：${verify.stderr.trim()}`)
  const commit = verify.stdout.trim()
  const all = gitPaths(['ls-tree', '-r', '--name-only', commit], { cwd: repoRoot })
  const files = new Set(all)
  const directories = directoriesOf(all)
  const cache = new Map()
  const load = (rels) => {
    const missing = rels.filter((rel) => !cache.has(rel))
    if (missing.length === 0) return
    const specs = missing.map((rel) => `${commit}:${rel}`)
    const result = spawnSync('git', ['cat-file', '--batch'], {
      cwd: repoRoot,
      input: `${specs.join('\n')}\n`,
      maxBuffer: 1024 * 1024 * 1024,
    })
    if (result.status !== 0) throw new Error(`git cat-file 失败：${String(result.stderr)}`)
    const parsed = parseCatFileBatch(result.stdout, specs)
    missing.forEach((rel, index) => cache.set(rel, parsed.get(specs[index]) ?? null))
  }
  return {
    label: `提交 ${ref}（${commit.slice(0, 9)}）`,
    listAll() {
      return all
    },
    listFiles() {
      return all.filter((file) => !file.includes('/') || DEFINITION_ROOTS.includes(rootOf(file)))
        .filter((file) => !SKIPPED_DIRECTORY.test(file))
        .sort()
    },
    exists(file) {
      const rel = normalizePath(file).replace(/\/$/, '')
      return files.has(rel) || directories.has(rel)
    },
    read(file) {
      const rel = normalizePath(file)
      if (!files.has(rel)) return null
      load([rel])
      return cache.get(rel)
    },
    preload(rels) {
      load(rels.map(normalizePath).filter((rel) => files.has(rel)))
    },
  }
}

// ─── 定义 ─────────────────────────────────────────────────────────────────────

function scriptKindOf(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  return /\.(?:js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
}

export function parseSource(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file))
}

const IDENTIFIER_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g

/** 文本里出现过这批符号里的任何一个吗——解析 AST 之前的廉价预筛。 */
function mentionsAny(text, wanted) {
  for (const match of text.matchAll(IDENTIFIER_TOKEN)) {
    if (wanted.has(match[0])) return true
  }
  return false
}

function definedName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
    return node.name.text
  }
  if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)
    || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
    return node.name.text
  }
  return null
}

function unwrapExpression(expression) {
  let current = expression
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
    || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)
    || (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(current)))) {
    current = current.expression
  }
  return current
}

/** 初值里有没有「按同名取成员」——`useStore((s) => s.rememberX)` 这种选择器写法取的是 owner 那一份。 */
function selectsSameName(expression, name) {
  let hit = false
  const visit = (node) => {
    if (hit) return
    if (ts.isPropertyAccessExpression(node) && node.name.text === name) {
      hit = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(expression)
  return hit
}

/**
 * 这一处是「又定义了一份」还是「给 owner 那一份起个本地名」。
 * 别名：`const x = owner.x`、`const x = y`、`const x = useStore((s) => s.x)`、对象简写 `{ x }`（后者根本不是
 * PropertyAssignment）。定义：函数 / 类 / 类型、箭头函数或字面量初值、方法。
 * 环境声明（`declare const x`）说的是「别处有」，不算定义。
 */
function isDefinition(node, name) {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isMethodDeclaration(node)) {
    return true
  }
  if (ts.isVariableDeclaration(node) && (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient)) return false
  const initializer = unwrapExpression(node.initializer)
  if (!initializer) return ts.isVariableDeclaration(node)
  if (ts.isIdentifier(initializer) || ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer)) {
    return false
  }
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer) || ts.isClassExpression(initializer)) return true
  return !selectsSameName(initializer, name)
}

/** 接口 / 类型字面量里声明的成员（`beforeDispatch?: (...) => void`）：一个**契约槽位**，不是实现。 */
function signatureName(node) {
  if ((ts.isPropertySignature(node) || ts.isMethodSignature(node)) && node.name && ts.isIdentifier(node.name)) return node.name.text
  return null
}

/**
 * 一批符号在哪些文件里被**定义**：`Map<symbol, [{ path, line, kind }]>`。
 * `kind: 'implementation'` = 真的实现了一份（函数 / 类 / 类型 / 变量 / 对象成员）；
 * `kind: 'signature'` = 只在接口或类型里声明了这个成员（依赖注入的钩子槽位）。槽位能让「主人在不在」成立，
 * 但它本身不是第二个写口——别处给这个槽位填实现，是在接线，不是另立主人。
 * 行号只给人看（跳过去核对），不进基线身份——门的身份是「文件 + 符号」（R21.3）。
 */
export function collectDefinitions({ files, read, symbols }) {
  const wanted = new Set(symbols)
  const found = new Map()
  if (wanted.size === 0) return found
  for (const file of files) {
    if (!isScannableSource(file)) continue
    const text = read(file)
    if (typeof text !== 'string' || !mentionsAny(text, wanted)) continue
    const source = parseSource(file, text)
    const record = (name, node, kind) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      const list = found.get(name) ?? []
      list.push({ path: normalizePath(file), line, kind })
      found.set(name, list)
    }
    const visit = (node) => {
      const name = definedName(node)
      if (name && wanted.has(name) && isDefinition(node, name)) {
        record(name, node, 'implementation')
      } else {
        const slot = signatureName(node)
        if (slot && wanted.has(slot)) record(slot, node, 'signature')
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(source, visit)
  }
  return found
}

// ─── 门（复用 door-map 的引擎）─────────────────────────────────────────────────

/** 一批符号的门表：`[{ kind, path, symbol }]`，判法与 `node scripts/door-map.mjs` 相同。 */
export function collectDoors({ files, read, symbols }) {
  const scannable = files.filter(isScannableSource)
  const occurrences = mapDoorOccurrences({
    files: scannable,
    readFile: (file) => read(file) ?? '',
    targetSymbols: [...new Set(symbols)],
  })
  return dedupeDoors(occurrences)
}

// ─── 身份比对（原 check:identity-compare，2026-09-29 并入）──────────────────────

/**
 * 已知的身份维度。**不是随便一个字段名**——这些是「认错了就会把另一个项目/窗口/会话当成自己」的那几个
 * （审计 docs/audit/2026-09-17-ownership-lifetime-census.md §2）。加维度要连同 owner 的比对函数一起加。
 */
export const IDENTITY_DIMENSIONS = new Set([
  'projectId', 'immutableProjectUuid', 'projectGeneration', 'canonicalRootDigest',
  'bindingId', 'surfaceInstanceId', 'portRevision', 'nonce',
  'webContentsId', 'processId', 'frameRoutingId',
])
export const COMPARATOR_NAME = /^(same|matches)[A-Z]|^is[A-Z].*Same/

/** 与原门岗逐字相同的扫描面：src/ 与 electron/ 下的 TS 源码，排除 `.test.`。 */
export function isIdentityScanFile(file) {
  const rel = normalizePath(file)
  if (!PRODUCTION_ROOTS.includes(rootOf(rel)) || /(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(rel)) return false
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  return /\.(ts|tsx|mts|cts)$/.test(base) && !/\.test\./.test(base)
}

/**
 * 找「长得像身份比对」的函数：名字像比对（`same*` / `matches*` / `is*Same*`）、函数体里逐字比了
 * ≥2 个已知身份维度（`a.projectId === b.projectId`）。**从 owner import 就隐身**：
 * `return sameOwner(a, b)` 的函数体里没有维度字面量，扫描器看不到它——想不被判红，办法就是别再列字段。
 */
export function findIdentityComparators({ files, read }) {
  const found = []
  for (const file of files) {
    if (!isIdentityScanFile(file)) continue
    const text = read(file)
    if (typeof text !== 'string') continue
    const rel = normalizePath(file)
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true,
      rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node) => {
      const fnName = (ts.isFunctionDeclaration(node) && node.name?.text)
        || (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
          ? node.name.text : null)
      if (fnName && COMPARATOR_NAME.test(fnName)) {
        const dimensions = new Set()
        const scan = (candidate) => {
          if (ts.isBinaryExpression(candidate)
            && (candidate.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
              || candidate.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
            for (const side of [candidate.left, candidate.right]) {
              if (ts.isPropertyAccessExpression(side) && IDENTITY_DIMENSIONS.has(side.name.text)) dimensions.add(side.name.text)
              if (ts.isElementAccessExpression(side) && ts.isStringLiteralLike(side.argumentExpression)
                && IDENTITY_DIMENSIONS.has(side.argumentExpression.text)) dimensions.add(side.argumentExpression.text)
            }
          }
          ts.forEachChild(candidate, scan)
        }
        scan(node)
        if (dimensions.size >= 2) found.push({ path: rel, symbol: fnName, dimensions: [...dimensions].sort() })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found.sort((left, right) => `${left.path}::${left.symbol}`.localeCompare(`${right.path}::${right.symbol}`))
}

// shortcut: 仅识别已知 AST 形状，出现新旁路时升级为不暴露账本的读取接口。
export function findShotJobSelections({ files, read }) {
  const found = []
  for (const file of files) {
    if (!isScannableSource(file) || !PRODUCTION_ROOTS.includes(rootOf(file))) continue
    const text = read(file)
    if (!text || !/\b(?:jobs|ProductionJob|jobsForShot)\b/.test(text)) continue
    const rel = normalizePath(file)
    if (rel === 'electron/shared/productionShotJobs.ts') continue
    const source = parseSource(rel, text)
    const producers = new Set(['jobsForShot'])
    const scopes = new Map()
    const scopeOf = (node) => {
      for (let at = node; at; at = at.parent) {
        if (ts.isSourceFile(at) || ts.isBlock(at) || ts.isFunctionLike(at)) return at
      }
    }
    const bind = (node, name, value) => {
      const scope = scopeOf(node.parent)
      if (!scopes.has(scope)) scopes.set(scope, new Map())
      scopes.get(scope).set(name, value)
    }
    const collect = (node) => {
      if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'jobsForShot') producers.add(node.name.text)
      if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
        if (ts.isIdentifier(node.name)) bind(node, node.name.text, node)
        else if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (ts.isIdentifier(element.name) && (element.propertyName ?? element.name).getText(source) === 'jobs') {
              bind(node, element.name.text, { ledgerBinding: true })
            }
          }
        }
      }
      ts.forEachChild(node, collect)
    }
    collect(source)
    const declarationOf = (node) => {
      for (let at = node.parent; at; at = at.parent) {
        const declaration = scopes.get(at)?.get(node.text)
        if (declaration) return declaration
      }
    }
    const isJobListCall = (expression) => {
      let callee = unwrapExpression(expression)
      const seen = new Set()
      while (callee && ts.isIdentifier(callee) && !seen.has(callee.text)) {
        if (producers.has(callee.text)) return true
        seen.add(callee.text)
        callee = unwrapExpression(declarationOf(callee)?.initializer)
      }
      return Boolean(callee && ((ts.isPropertyAccessExpression(callee) && callee.name.text === 'jobsForShot')
        || (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression) && callee.argumentExpression.text === 'jobsForShot')))
    }
    const ledger = (expression, seen = new Set()) => {
      const node = unwrapExpression(expression)
      if (!node || seen.has(node)) return false
      seen.add(node)
      if (ts.isPropertyAccessExpression(node)) return node.name.text === 'jobs'
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text === 'jobs'
      if (ts.isIdentifier(node)) {
        const declaration = declarationOf(node)
        return Boolean(declaration && (declaration.ledgerBinding
          || (declaration.type && /(?:ProductionJob\s*\[|(?:ReadonlyArray|Array)\s*<\s*ProductionJob\b|ProductionRun\s*\[\s*['"]jobs['"])/.test(declaration.type.getText(source)))
          || ledger(declaration.initializer, seen)))
      }
      if (ts.isArrayLiteralExpression(node)) return node.elements.some((item) => ts.isSpreadElement(item) && ledger(item.expression, seen))
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
        return ledger(node.left, seen) || ledger(node.right, seen)
      }
      if (ts.isCallExpression(node) && isJobListCall(node.expression)) return true
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.getText(source) === 'Array.from') return ledger(node.arguments[0], seen)
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ['filter', 'slice', 'sort', 'toSorted', 'reverse', 'toReversed'].includes(node.expression.name.text)) {
        return ledger(node.expression.expression, seen)
      }
      return false
    }
    const symbolOf = (node) => {
      for (let at = node.parent; at; at = at.parent) {
        if (!ts.isFunctionLike(at)) continue
        if (at.name && ts.isIdentifier(at.name)) return at.name.text
        if (ts.isVariableDeclaration(at.parent) && ts.isIdentifier(at.parent.name)) return at.parent.name.text
      }
      return '<inline>'
    }
    const visit = (node) => {
      let selection = ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ledger(node.initializer)
      selection ||= ts.isElementAccessExpression(node) && ledger(node.expression)
        && /^(?:0|-1)$|\.length\s*-\s*1$/.test(node.argumentExpression.getText(source))
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ledger(node.expression.expression)) {
        const method = node.expression.name.text
        const predicate = node.arguments.map((arg) => arg.getText(source)).join(' ')
        const callback = node.arguments[0]
        const numericFold = node.arguments[1] && ts.isNumericLiteral(unwrapExpression(node.arguments[1]))
          && callback && ts.isArrowFunction(callback) && ts.isCallExpression(callback.body)
          && /^Math\.(?:max|min)$/.test(callback.body.expression.getText(source))
        selection ||= ['at', 'pop', 'shift'].includes(method)
          || (['find', 'findLast'].includes(method) && /\b(?:shotId|shotNodeId|nodeId)\b/.test(predicate) && !/\bjobId\b/.test(predicate))
          || (method === 'reduce' && /\b(?:attempt|createdAt|updatedAt)\b/.test(predicate) && !numericFold)
      }
      if (selection) {
        const symbol = symbolOf(node)
        // 已登记的专用问题：冻结合同内重做、整个 Run 最近活动导航。它们不按镜/节点挑当前任务。
        const specialized = (rel === 'electron/productionRun/prepareProductionGenerationAuthorization.ts' && symbol === 'latestJobFor')
          || (rel === 'src/workbench/production/productionRunView.ts' && symbol === 'latestJob')
          || (rel === 'src/workbench/production/useProductionStatus.ts' && symbol === 'useProductionStatus')
          || (rel === 'electron/productionRun/productionGenerationHistory.ts' && symbol === 'findGenerationExecutionJob')
          || (rel === 'electron/productionRun/productionGenerationAuthorizationState.ts' && symbol === 'deriveGenerationReauthorizationState')
          || (rel === 'electron/productionRun/productionGenerationSeal.ts' && symbol === 'applyGenerationSeal')
          || (rel === 'electron/productionRun/singleShotRunLifecycle.ts' && symbol === 'markSingleShotCompleted')
          || (rel === 'electron/productionRun/submissionIntent.ts' && ['inspect', 'claim'].includes(symbol))
        if (!specialized) found.push({ path: rel, symbol, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

// ─── 失败判定旁路（diagnostics.generation-failure-decision，2026-11-18）──────────────────────────
// 「这次失败算哪一类、给什么公开码、说什么、能做什么」只在 electron/shared/generationFailure 判一次；出口只投影。
// 这里认出共享层之外两种写法：
//   ① 子串 / 正则认码：对「像原文的变量」（message / raw / text …）做 includes / indexOf / startsWith / match / test，
//      比对的是封闭词表里的公开码或失败类别（含别名、模板字符串、正则字面量、内联）；
//   ② 构造或覆盖：在引用了失败判定家族符号的文件里，对象字面量的 kind / errorCode / publicCode / primary / secondary
//      取值是封闭词表里的字面量（含常量别名、三目 / ?? / || 的分支）。
// 封闭词表不手抄：从 owner 文件读（类别 / 动作取自两个联合类型，公开码取自词条文件两张表的键），改词表即自动跟上。
// shortcut: 仅识别已知 AST 形状；出现新旁路时升级为把判定入口收成唯一导出的读取接口。
export const FAILURE_DECISION_OWNER_FILES = new Set([
  'electron/shared/generationFailure.ts',
  'electron/shared/generationFailureKinds.ts',
  'electron/shared/generationFailureWire.ts',
  'electron/shared/generationFailureDetect.ts',
  'electron/shared/generationFailureCopy.ts',
])
const FAILURE_FAMILY = new Set([
  'classifyGenerationError', 'GenerationErrorReport', 'GenerationErrorKind', 'GenerationErrorAction',
  'decideGenerationFailure', 'GenerationFailureDecision', 'projectGenerationFailure', 'failureActionsFor',
  'narrateGenerationError', 'buildToolErrorOutcome', 'confirmPublicError', 'generationFailureActions',
])
const FAILURE_FIELDS = new Set(['kind', 'errorCode', 'publicCode', 'primary', 'secondary'])
const MESSAGE_LIKE = /(?:message|raw|msg|text|detail|reason|stderr|output|body)$/i
const REGEX_METHODS = new Set(['test', 'match', 'matchAll', 'search'])
const STRING_METHODS = new Set(['includes', 'indexOf', 'startsWith', 'endsWith'])

function stringLiteralsOfUnion(type) {
  const out = new Set()
  const visit = (node) => {
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteralLike(node.literal)) out.add(node.literal.text)
    ts.forEachChild(node, visit)
  }
  visit(type)
  return out
}

/** 封闭词表：类别、动作、公开码。读不到 owner 文件时返回空表（扫描随之什么都不认，由 registry 的 owner-unresolved 兜底）。 */
export function collectFailureVocabulary({ read }) {
  const kinds = new Set()
  const actions = new Set()
  const codes = new Set()
  const owner = read('electron/shared/generationFailureKinds.ts')
  if (typeof owner === 'string') {
    const source = parseSource('generationFailureKinds.ts', owner)
    for (const statement of source.statements) {
      if (!ts.isTypeAliasDeclaration(statement)) continue
      if (statement.name.text === 'GenerationErrorKind') for (const value of stringLiteralsOfUnion(statement.type)) kinds.add(value)
      if (statement.name.text === 'GenerationErrorAction') for (const value of stringLiteralsOfUnion(statement.type)) actions.add(value)
    }
  }
  const copy = read('electron/shared/generationFailureCopy.ts')
  if (typeof copy === 'string') {
    const source = parseSource('generationFailureCopy.ts', copy)
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !/^TOOL_(?:ERROR|USER_ACTION)_HINT$/.test(declaration.name.text)) continue
        const init = declaration.initializer && unwrapExpression(declaration.initializer)
        if (!init || !ts.isObjectLiteralExpression(init)) continue
        for (const property of init.properties) {
          if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) codes.add(property.name.text)
        }
      }
    }
  }
  return { kinds, actions, codes }
}

function stringsOf(expression, resolve, depth = 0) {
  const node = unwrapExpression(expression)
  if (!node || depth > 3) return []
  if (ts.isStringLiteralLike(node)) return [node.text]
  if (ts.isTemplateExpression(node)) return []
  if (ts.isConditionalExpression(node)) return [...stringsOf(node.whenTrue, resolve, depth + 1), ...stringsOf(node.whenFalse, resolve, depth + 1)]
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
    return [...stringsOf(node.left, resolve, depth + 1), ...stringsOf(node.right, resolve, depth + 1)]
  }
  if (ts.isIdentifier(node)) return stringsOf(resolve(node.text), resolve, depth + 1)
  return []
}

function receiverName(expression) {
  const node = unwrapExpression(expression)
  if (!node) return ''
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) return receiverName(node.expression.expression)
  return ''
}

export function findFailureDecisionBypass({ files, read }) {
  const { kinds, actions, codes } = collectFailureVocabulary({ read })
  if (!kinds.size && !codes.size) return []
  const found = []
  for (const file of files) {
    const rel = normalizePath(file)
    // 测试夹具工具（*TestUtils.ts）住在 electron/ 下但不是出口：它按码给样本分桶，不是在替用户说失败。
    if (!isScannableSource(rel) || !PRODUCTION_ROOTS.includes(rootOf(rel)) || FAILURE_DECISION_OWNER_FILES.has(rel) || /TestUtils\.[cm]?[jt]sx?$/.test(rel)) continue
    const text = read(rel)
    if (typeof text !== 'string') continue
    const inFamily = mentionsAny(text, FAILURE_FAMILY)
    const mentionsCode = [...codes].some((code) => text.includes(code))
    if (!inFamily && !mentionsCode) continue
    const source = parseSource(rel, text)
    const constants = new Map()
    const collect = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const)) constants.set(node.name.text, node.initializer)
      ts.forEachChild(node, collect)
    }
    collect(source)
    const resolve = (name) => constants.get(name)
    const symbolOf = (node) => {
      for (let at = node.parent; at; at = at.parent) {
        if (!ts.isFunctionLike(at)) continue
        if (at.name && ts.isIdentifier(at.name)) return at.name.text
        if (ts.isVariableDeclaration(at.parent) && ts.isIdentifier(at.parent.name)) return at.parent.name.text
      }
      return '<module>'
    }
    const report = (node, shape, value) => found.push({
      path: rel, symbol: symbolOf(node), shape, value,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    })
    const isCodeOrKind = (value) => codes.has(value) || (kinds.has(value) && value.includes('-'))
    const regexBody = (literal) => literal.text.slice(1, literal.text.lastIndexOf('/'))
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text
        const target = node.expression.expression
        // ① 正则认码：/…code…/.test(message)、message.match(/…code…/)
        if (REGEX_METHODS.has(method)) {
          const targetNode = unwrapExpression(target)
          const argNode = node.arguments[0] && unwrapExpression(node.arguments[0])
          const literal = targetNode && ts.isRegularExpressionLiteral(targetNode) ? targetNode
            : argNode && ts.isRegularExpressionLiteral(argNode) ? argNode : null
          const subject = literal === targetNode ? node.arguments[0] : target
          if (literal && subject && MESSAGE_LIKE.test(receiverName(subject))) {
            for (const code of codes) if (regexBody(literal).includes(code)) report(node, 'regex-code-match', code)
          }
        }
        // ① 子串认码：message.includes('code')（含常量别名、三目分支）
        if (STRING_METHODS.has(method) && MESSAGE_LIKE.test(receiverName(target))) {
          for (const value of stringsOf(node.arguments[0], resolve)) if (isCodeOrKind(value)) report(node, 'substring-code-match', value)
        }
      }
      // ② 出口自己编一句话再判一遍：把字面量塞进判定入口（还原「认不出就拿 'network error' 重新分类」这种二次改判）。
      // 该传的是输入事实（语言、瞬时、任务来源），不是一句编出来的原文。
      if (inFamily && ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression)
        const name = callee && (ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '')
        if (name === 'classifyGenerationError' || name === 'decideGenerationFailure') {
          const first = node.arguments[0] && unwrapExpression(node.arguments[0])
          const message = first && ts.isObjectLiteralExpression(first)
            ? first.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(source) === 'message')?.initializer
            : first
          for (const value of stringsOf(message, resolve)) if (value.trim()) report(node, 'synthetic-rejudge', value)
        }
      }
      // ② 构造或覆盖（只在引用了失败判定家族符号的文件里）
      if (inFamily && ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name))
        && FAILURE_FIELDS.has(node.name.text) && ts.isObjectLiteralExpression(node.parent)) {
        for (const value of stringsOf(node.initializer, resolve)) {
          if (kinds.has(value) || actions.has(value) || codes.has(value)) report(node, 'decision-field-override', `${node.name.text}:${value}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found.sort((left, right) => `${left.path}:${left.line}`.localeCompare(`${right.path}:${right.line}`))
}
