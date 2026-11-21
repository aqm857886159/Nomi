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

// ─── 失败判定旁路（diagnostics.generation-failure-decision）─────────────────────
export const FAILURE_DECISION_OWNER_FILES = new Set([
  'electron/shared/generationFailure.ts', 'electron/shared/generationFailureKinds.ts',
  'electron/shared/generationFailureWire.ts', 'electron/shared/generationFailureDetect.ts',
  'electron/shared/generationFailureCopy.ts',
])
const FAILURE_FAMILY = new Set([
  'classifyGenerationError', 'GenerationErrorReport', 'GenerationErrorKind', 'GenerationErrorAction',
  'decideGenerationFailure', 'GenerationFailureDecision', 'projectGenerationFailure', 'failureActionsFor',
  'narrateGenerationError', 'buildToolErrorOutcome', 'confirmPublicError', 'generationFailureActions',
])
const FAILURE_FIELDS = new Set(['kind', 'errorCode', 'publicCode', 'primary', 'secondary', 'vendorSide'])
const FAILURE_COPY_FIELDS = new Set([...FAILURE_FIELDS, 'reason', 'hint', 'key', 'recoveryActions', 'nextActions'])
const FAILURE_PRODUCERS = new Set(['decideGenerationFailure', 'classifyGenerationError', 'projectGenerationFailure', 'buildToolErrorOutcome', 'confirmPublicError', 'failureActionsFor', 'generationFailureActions'])
const RAW_NAME = /(?:message|raw|msg|text|stderr)$/i
const RAW_METHODS = new Set(['includes', 'indexOf', 'startsWith', 'endsWith', 'match', 'matchAll', 'test', 'search', 'exec'])
const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken])

/** 跟踪原文到判断、判断到判定字段；原文仅用于显示或传给主人不算第二次判定。 */
export function findFailureDecisionBypass({ files, read }) {
  const found = []
  for (const file of files) {
    const rel = normalizePath(file)
    if (!isScannableSource(rel) || !PRODUCTION_ROOTS.includes(rootOf(rel)) || FAILURE_DECISION_OWNER_FILES.has(rel)) continue
    const text = read(rel)
    if (typeof text !== 'string') continue
    if (!mentionsAny(text, FAILURE_FAMILY)) continue
    const source = parseSource(rel, text)
    // 用 TS 的词法绑定区分别名与同名局部变量；不加载依赖或类型库。
    const host = { getSourceFile: (name) => name === rel ? source : undefined, getDefaultLibFileName: () => '',
      writeFile() {}, getCurrentDirectory: () => '', getDirectories: () => [], fileExists: (name) => name === rel,
      readFile: (name) => name === rel ? text : undefined, getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true, getNewLine: () => '\n' }
    const checker = ts.createProgram([rel], { noResolve: true, noLib: true }, host).getTypeChecker()
    const producers = new Set(FAILURE_PRODUCERS)
    const decisionTypes = new Set(['GenerationFailureDecision', 'GenerationErrorReport'])
    let family = false
    const findFamily = (node) => {
      if (ts.isIdentifier(node) && FAILURE_FAMILY.has(node.text)) family = true
      if (ts.isImportSpecifier(node)) {
        const imported = (node.propertyName ?? node.name).text
        if (FAILURE_PRODUCERS.has(imported)) producers.add(node.name.text)
        if (decisionTypes.has(imported)) decisionTypes.add(node.name.text)
      }
      ts.forEachChild(node, findFamily)
    }
    findFamily(source)
    const writes = new Map()
    const collectWrites = (node) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
        const symbol = checker.getSymbolAtLocation(node.left)
        if (!symbol) return
        if (!writes.has(symbol)) writes.set(symbol, [])
        writes.get(symbol).push(node)
      }
      ts.forEachChild(node, collectWrites)
    }
    collectWrites(source)
    const member = (node) => ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : ''
    const callee = (node) => ts.isIdentifier(node) ? node.text : member(node)
    const symbolOfIdentifier = (node) => ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
    const declarations = (node) => symbolOfIdentifier(node)?.declarations ?? []
    const anyChild = (node, predicate, seen) => ts.forEachChild(node, (child) => predicate(child, new Set(seen)) || undefined) || false
    const fromDeclaration = (node, predicate, seen) => declarations(node).map((declaration) => {
      if (declaration.initializer) return predicate(declaration.initializer, new Set(seen))
      if (ts.isBindingElement(declaration)) {
        const binding = declaration.parent.parent
        return binding.initializer && predicate(binding.initializer, new Set(seen))
      }
      return false
    }).find(Boolean) || false
    const raw = (expression, seen = new Set()) => {
      const node = unwrapExpression(expression)
      if (!node || seen.has(node)) return false
      seen.add(node)
      if (['raw', 'message'].includes(member(node))) return true
      if (FAILURE_COPY_FIELDS.has(member(node)) && decision(node.expression)) return false
      if (ts.isCallExpression(node) && producers.has(callee(node.expression))) return false
      if (ts.isIdentifier(node)) {
        if (declarations(node).some((d) => ts.isBindingElement(d) && ['raw', 'message'].includes((d.propertyName ?? d.name).getText(source)))) return true
        if (fromDeclaration(node, raw, seen)) return true
        return RAW_NAME.test(node.text) && declarations(node).some((d) => ts.isParameter(d))
      }
      if (ts.isCallExpression(node) && callee(node.expression) === 'String' && node.arguments.some((arg) => /^(?:e|err|error)$/i.test(arg.getText(source)))) return true
      return anyChild(node, raw, seen)
    }
    const displayRaw = (expression, seen = new Set()) => {
      const node = unwrapExpression(expression)
      if (!node || seen.has(node)) return false
      seen.add(node)
      if (['raw', 'message'].includes(member(node))) return true
      if (ts.isStringLiteralLike(node)) return node.text === ''
      if (ts.isIdentifier(node)) return fromDeclaration(node, displayRaw, seen)
        || (RAW_NAME.test(node.text) && declarations(node).some((d) => ts.isParameter(d)))
      if (ts.isConditionalExpression(node)) return displayRaw(node.whenTrue, new Set(seen)) && displayRaw(node.whenFalse, new Set(seen))
      if (ts.isCallExpression(node) && ['trim', 'slice', 'substring', 'replace', 'replaceAll'].includes(member(node.expression))) return displayRaw(node.expression.expression, seen)
      return false
    }
    const judgment = (expression, seen = new Set()) => {
      const node = unwrapExpression(expression)
      if (!node || seen.has(node)) return false
      seen.add(node)
      if (ts.isConditionalExpression(node) && displayRaw(node)) return false
      if (ts.isIdentifier(node)) return fromDeclaration(node, judgment, seen)
        || (writes.get(symbolOfIdentifier(node)) ?? []).map((write) => !seen.has(write)
          && (judgment(write.right, new Set([...seen, write])) || controlled(write, new Set([...seen, write])))).find(Boolean)
      if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind) && (raw(node.left) || raw(node.right))) return node
      if (ts.isCallExpression(node) && RAW_METHODS.has(member(node.expression)) && raw(node)) return node
      return anyChild(node, judgment, seen)
    }
    const decision = (expression, seen = new Set()) => {
      const node = unwrapExpression(expression)
      if (!node || seen.has(node)) return false
      seen.add(node)
      if (ts.isCallExpression(node) && producers.has(callee(node.expression))) return true
      if (ts.isIdentifier(node)) {
        if (declarations(node).some((d) => d.type && [...decisionTypes].some((name) => new RegExp(`\\b${name}\\b`).test(d.type.getText(source))))) return true
        return fromDeclaration(node, decision, seen)
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return decision(node.expression, seen)
      return ts.isObjectLiteralExpression(node) && node.properties.some((p) => ts.isSpreadAssignment(p) && decision(p.expression, seen))
    }
    const controlled = (node, seen = new Set()) => {
      for (let at = node.parent; at && !ts.isFunctionLike(at); at = at.parent) {
        if (ts.isIfStatement(at)) { const origin = judgment(at.expression, new Set(seen)); if (origin) return origin }
        if (ts.isConditionalExpression(at) && at.condition !== node) { const origin = judgment(at.condition, new Set(seen)); if (origin) return origin }
        if (ts.isCaseBlock(at) && raw(at.parent.expression)) return at.parent.expression
      }
      return false
    }
    const reported = new Set()
    const report = (node, shape) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      const identity = `${line}:${shape}`
      if (reported.has(identity)) return
      reported.add(identity)
      let symbol = '<module>'
      for (let at = node.parent; at; at = at.parent) {
        if (!ts.isFunctionLike(at)) continue
        symbol = at.name?.getText(source) ?? (ts.isVariableDeclaration(at.parent) ? at.parent.name.getText(source) : '<callback>')
        break
      }
      found.push({ path: rel, line,
        symbol, shape, value: node.getText(source).slice(0, 120) })
    }
    const visit = (node) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && FAILURE_FIELDS.has(member(node.left)) && decision(node.left.expression)) report(node, 'decision-field-write')
      if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
        const name = node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : ''
        const value = ts.isPropertyAssignment(node) ? node.initializer : node.name
        const spreadDecision = ts.isObjectLiteralExpression(node.parent) && node.parent.properties.some((p) => ts.isSpreadAssignment(p) && decision(p.expression))
        if (FAILURE_FIELDS.has(name) && spreadDecision && !(member(value) === name && decision(value.expression))) report(node, 'decision-field-override')
        else if (family && FAILURE_COPY_FIELDS.has(name)) {
          const origin = judgment(value) || controlled(node)
          if (origin) report(origin, 'raw-judgment-to-decision')
        }
      }
      if (family && ts.isCallExpression(node) && ['classifyGenerationError', 'decideGenerationFailure'].includes(callee(node.expression))) {
        const first = node.arguments[0] && unwrapExpression(node.arguments[0])
        const message = first && ts.isObjectLiteralExpression(first)
          ? first.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(source) === 'message')?.initializer : first
        if (message && ts.isStringLiteralLike(message) && message.text.trim()) report(node, 'synthetic-rejudge')
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found.sort((left, right) => `${left.path}:${left.line}`.localeCompare(`${right.path}:${right.line}`))
}

// ─── 重发放行旁路（canvas.shot-run：失败后再发一次只由主进程一处定）──────────────
/** 「结果未知」这张状态表的唯一住处；别处按状态自列这两个就是第二份清单。 */
export const OPEN_AS_OWNER_FILE = 'electron/shared/productionJobOpenAs.ts'
const RESULT_UNKNOWN_STATES = ['submission_unknown', 'reconciling']
/**
 * 标「已收尾」（放掉节点占用）只许在这几处：自己收尾、撤回还没交的出价、交给观察者、找回后摇铃——
 * 以及唯一一处替别的 Run 放：重发主人的准入（`assertNodeIdle`，只放决定号里那几笔）。
 */
export const OCCUPANCY_RELEASE_OWNERS = new Map([
  ['electron/capabilityCore/appIntegrationCanvasShot.ts', new Set(['settle', 'withdrawConsent', 'assertNodeIdle', 'handOff'])],
  ['electron/capabilityCore/canvasShotSettledBell.ts', null],
  ['electron/productionRun/canvasShotRunIndex.ts', null],
])
const OCCUPANCY_RELEASE = 'markCanvasRunSettled'
const OCCUPANCY_MODULE = /(?:^|\/)canvasShotRunIndex(?:\.[cm]?[jt]s)?$/
const LIST_BUILDERS = ['assign', 'concat', 'of', 'from']

/**
 * 两个落点，都锚在落点不锚名字：
 * - `result-unknown-list`：主人表之外，一个字面量清单（数组 / Set / `||` 比较链 / 展开 / Object.assign / concat）里的状态恰好是
 *   「结果未知」那两个——改名、内联、常量别名、属性赋值、展开拼接都会把同一组字面量带进来；
 * - `occupancy-release`：主人之外拿到「标已收尾」这个写口（具名 / 改名 / 整模块 / 动态 import），或主人文件里在登记的函数之外碰它。
 */
export function findResendOwnerBypass({ files, read }) {
  const found = []
  for (const file of files) {
    const rel = normalizePath(file)
    if (!isScannableSource(rel) || !PRODUCTION_ROOTS.includes(rootOf(rel))) continue
    const text = read(rel)
    if (typeof text !== 'string') continue
    const listCandidate = rel !== OPEN_AS_OWNER_FILE && RESULT_UNKNOWN_STATES.every((state) => text.includes(state))
    const owners = OCCUPANCY_RELEASE_OWNERS.get(rel)
    const releaseCandidate = owners !== null && (text.includes(OCCUPANCY_RELEASE) || text.includes('canvasShotRunIndex'))
    if (!listCandidate && !releaseCandidate) continue
    const source = parseSource(rel, text)
    const report = (node, shape) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      if (found.some((item) => item.path === rel && item.line === line && item.shape === shape)) return
      found.push({ path: rel, line, symbol: enclosing(node), shape, value: node.getText(source).slice(0, 120) })
    }
    const enclosing = (node) => {
      for (let at = node.parent; at; at = at.parent) {
        if (ts.isFunctionDeclaration(at) && at.name) return at.name.text
        if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent) && ts.isIdentifier(at.parent.name)) return at.parent.name.text
        if (ts.isMethodDeclaration(at) && at.name && ts.isIdentifier(at.name)) return at.name.text
      }
      return '<module>'
    }
    // 同一文件里的常量：名字 → 初值（别名、展开、拼接都顺着它解）。
    const constants = new Map()
    const collect = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer)
      ts.forEachChild(node, collect)
    }
    collect(source)
    const members = (expression, seen = new Set()) => {
      const node = unwrapExpression(expression)
      const out = new Set()
      if (!node || seen.has(node)) return out
      seen.add(node)
      const add = (child) => { for (const value of members(child, seen)) out.add(value) }
      if (ts.isStringLiteralLike(node)) out.add(node.text)
      else if (ts.isIdentifier(node) && constants.has(node.text)) add(constants.get(node.text))
      else if (ts.isArrayLiteralExpression(node)) node.elements.forEach((element) => add(ts.isSpreadElement(element) ? element.expression : element))
      else if (ts.isNewExpression(node) && node.arguments?.length) add(node.arguments[0])
      else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && LIST_BUILDERS.includes(node.expression.name.text)) {
        if (node.expression.name.text === 'concat') add(node.expression.expression)
        node.arguments.forEach(add)
      } else if (ts.isBinaryExpression(node) && ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind) || EQUALITY.has(node.operatorToken.kind))) {
        add(node.left); add(node.right)
      }
      return out
    }
    const isResultUnknownList = (node) => {
      const values = members(node)
      return RESULT_UNKNOWN_STATES.every((state) => values.has(state)) && [...values].every((value) => RESULT_UNKNOWN_STATES.includes(value))
    }
    const orChainTop = (node) => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken
      && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    const listShape = (node) => ts.isArrayLiteralExpression(node) || ts.isNewExpression(node) || orChainTop(node)
      || (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && LIST_BUILDERS.includes(node.expression.name.text))
    // 数组里套着的、被展开 / 拼接的子清单不重复报：只报最外层那一个。
    const insideReportedList = (node) => {
      for (let at = node.parent; at; at = at.parent) if (listShape(at) && isResultUnknownList(at)) return true
      return false
    }
    const releaseAllowed = (node) => owners !== undefined && owners.has(enclosing(node))
    const localNames = new Set([OCCUPANCY_RELEASE])
    const visit = (node) => {
      if (listCandidate && listShape(node) && isResultUnknownList(node) && !insideReportedList(node)) report(node, 'result-unknown-list')
      if (releaseCandidate) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && OCCUPANCY_MODULE.test(node.moduleSpecifier.text)) {
          const bindings = node.importClause?.namedBindings
          if (bindings && ts.isNamespaceImport(bindings) && owners === undefined) report(node, 'occupancy-release')
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              if ((element.propertyName ?? element.name).text !== OCCUPANCY_RELEASE) continue
              localNames.add(element.name.text)
              if (owners === undefined) report(element, 'occupancy-release')
            }
          }
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && OCCUPANCY_MODULE.test(node.arguments[0].text) && owners === undefined) {
          report(node, 'occupancy-release')
        } else if (ts.isIdentifier(node) && localNames.has(node.text) && !ts.isImportSpecifier(node.parent)
          && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) && !releaseAllowed(node)) {
          report(node, 'occupancy-release')
        } else if (((ts.isPropertyAccessExpression(node) && node.name.text === OCCUPANCY_RELEASE)
          || (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === OCCUPANCY_RELEASE))
          && !releaseAllowed(node)) {
          report(node, 'occupancy-release')
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found.sort((left, right) => `${left.path}:${left.line}`.localeCompare(`${right.path}:${right.line}`))
}
