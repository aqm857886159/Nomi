// 「扫全仓 / 扫目录的守卫测试」的识别器（语法树，不靠文件名猜）。2026-10-10 #1156 / #1142 一天漏 4 个，推送前钩子「相关单测」只挑引用了改动文件的测试，
// 而这类测试不引用具体文件：它们自己遍历仓库源码、对全集做断言。识别口径：
//   walk 调用 = readdirSync / readdir / opendir / globSync / glob / import.meta.glob，或 git 子进程里带 'ls-files'；
//   起点锚在仓库里 = walk 的目录参数（沿同文件内的 const 初始值、函数形参的调用点一路追）出现 __dirname / import.meta.url|dirname / process.cwd() /
//                    repoRoot·REPO_ROOT·ROOT 之类的锚点，且这条来路上没有临时目录（mkdtemp / tmpdir / makeTemp…）。
//   间接扫描 = 测试 import 的相对模块（传递闭包里非测试文件）里有这样的 walk（例：check-network-entry.test.mjs → check-network-entry.mjs 的 checkNetworkEntries()）。
// 只做「有没有」的判定，扫哪些目录由登记表（scripts/pre-push-scan-guards.mjs）写明，两边互相核对。
import fs from 'node:fs'
import path from 'node:path'

import { loadTypeScript } from './moduleReferences.mjs'

/** 测试文件名：vitest 的 *.test.* 与 node:test 的 *.node-test.mjs。 */
export const TEST_FILE = /\.(?:node-)?test\.[cm]?[jt]sx?$/

const WALK_CALLEES = new Set(['readdirSync', 'readdir', 'opendirSync', 'opendir', 'globSync', 'glob', 'readdirp'])
const PROCESS_CALLEES = new Set(['execFileSync', 'execSync', 'spawnSync', 'execFile', 'exec', 'spawn'])
const ANCHOR_TEXT = /__dirname|import\.meta\.(?:url|dirname)|process\.cwd\b|\b(?:repoRoot|REPO_ROOT|ROOT)\b/
/** 把实参的路径值传出来的调用（拼路径 / 取目录 / 字符串处理 / 名字里带 root dir path repo 的辅助函数，如 findRepoRoot）；其余调用不钻实参。 */
const PATH_CALLEE = /^(?:join|resolve|dirname|relative|normalize|fileURLToPath|pathToFileURL|URL|String|replace|replaceAll|slice|split|concat|trim|toString|realpathSync|decodeURIComponent|at)$|root|dir|path|repo/i
const TEMP_TEXT = /mkdtemp|tmpdir|makeTemp|createTemp|makeTestTemp|tempDir|tmpDir|\bTEMP\b|useTempDir|withTemp/i
const SCOPE_DEPTH = 6

function parse(file, text) {
  const ts = loadTypeScript()
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.[cm]?tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

/** 一个文件里的 walk 调用点：[{ line, kind, anchored, via }]。anchored = 起点锚在仓库里且不是临时目录。 */
export function walkSites(file, text) {
  const ts = loadTypeScript()
  const ast = parse(file, text)
  const calleeName = (call) => {
    const expr = call.expression
    if (ts.isIdentifier(expr)) return expr.text
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text
    return ''
  }
  // 名字 → 所有初始值表达式（不分作用域；粗但够用：同名不同义最多多判成「锚在仓库」，由必红 / 必绿用例盯着）
  const initializers = new Map()
  // 函数名 → [{ params, calls }]
  const functionParams = new Map()
  const callSites = new Map()
  const addTo = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value) }
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        addTo(initializers, node.name.text, node.initializer)
        if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) addTo(functionParams, node.name.text, node.initializer.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : '')))
      } else if (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
        for (const el of node.name.elements) if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) addTo(initializers, el.name.text, node.initializer)
      }
    }
    if (ts.isParameter(node) && node.initializer && ts.isIdentifier(node.name)) addTo(initializers, node.name.text, node.initializer)
    if (ts.isFunctionDeclaration(node) && node.name) addTo(functionParams, node.name.text, node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : '')))
    if ((ts.isMethodDeclaration(node)) && ts.isIdentifier(node.name)) addTo(functionParams, node.name.text, node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : '')))
    if (ts.isCallExpression(node)) addTo(callSites, calleeName(node), node)
    // 后赋值：let root; … root = path.resolve(__dirname)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) addTo(initializers, node.left.text, node.right)
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      if (ts.isVariableDeclarationList(node.initializer)) for (const d of node.initializer.declarations) if (ts.isIdentifier(d.name)) addTo(initializers, d.name.text, node.expression)
    }
    ts.forEachChild(node, collect)
  }
  collect(ast)

  /**
   * 路径表达式的叶子：只顺着「拼路径」的写法往里看（path.join / resolve / dirname 等、模板串、加号、三元、括号、对象字面量里的 cwd），
   * 不钻进任意函数调用的实参——writeAsset(mediaFixture(...)) 这种里的 __dirname 是读夹具文件内容用的，不是遍历的起点。
   * 返回 { ids: 要继续追的标识符, texts: 叶子文本（锚点 / 临时目录的判定对象） }。
   */
  const leaves = (expr, out = { ids: [], texts: [] }) => {
    if (!expr) return out
    if (ts.isIdentifier(expr)) { out.ids.push(expr); out.texts.push(expr.text); return out }
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isAwaitExpression(expr) || ts.isSpreadElement(expr) || (ts.isTypeAssertionExpression && ts.isTypeAssertionExpression(expr))) return leaves(expr.expression, out)
    if (ts.isPropertyAccessExpression(expr)) {
      const text = expr.getText(ast)
      if (/^(?:import\.meta|process\.env)/.test(text)) { out.texts.push(text); return out }
      out.texts.push(text)
      return leaves(expr.expression, out)
    }
    if (ts.isElementAccessExpression(expr)) return leaves(expr.expression, out)
    if (ts.isTemplateExpression(expr)) { for (const span of expr.templateSpans) leaves(span.expression, out); return out }
    if (ts.isBinaryExpression(expr)) { leaves(expr.left, out); leaves(expr.right, out); return out }
    if (ts.isConditionalExpression(expr)) { leaves(expr.whenTrue, out); leaves(expr.whenFalse, out); return out }
    if (ts.isArrayLiteralExpression(expr)) { for (const el of expr.elements) leaves(el, out); return out }
    if (ts.isObjectLiteralExpression(expr)) { for (const prop of expr.properties) if (ts.isPropertyAssignment(prop)) leaves(prop.initializer, out); return out }
    if (ts.isNewExpression(expr) || ts.isCallExpression(expr)) {
      const callee = expr.expression.getText(ast)
      out.texts.push(callee) // 叶子文本：callee（process.cwd / fs.mkdtempSync / os.tmpdir / makeTempDir …）
      const base = callee.split('.').pop()
      if (PATH_CALLEE.test(base) || PATH_CALLEE.test(callee)) {
        if (ts.isPropertyAccessExpression(expr.expression)) leaves(expr.expression.expression, out) // x.replace(...) 的 x
        for (const arg of expr.arguments ?? []) leaves(arg, out)
      }
      return out
    }
    out.texts.push(expr.getText(ast))
    return out
  }

  /**
   * 表达式的来路（内联同文件 const 初始值与函数形参的调用点实参）。返回 { anchor, temp }：
   * 同一个名字有多个来路时取「锚在仓库且不是临时目录」的那条（同名变量在别的用例里指向临时目录，不能把这处也带成临时）。
   */
  const trace = (expr, seen = new Set(), depth = 0) => {
    const result = { anchor: false, temp: false }
    if (depth > SCOPE_DEPTH || !expr) return result
    const { ids, texts } = leaves(expr)
    for (const text of texts) {
      if (ANCHOR_TEXT.test(text)) result.anchor = true
      if (TEMP_TEXT.test(text)) result.temp = true
    }
    for (const id of ids) {
      const name = id.text
      if (seen.has(name)) continue
      const branches = []
      const nextSeen = new Set([...seen, name])
      for (const init of initializers.get(name) ?? []) branches.push(trace(init, nextSeen, depth + 1))
      // 形参：追到同文件内所有调用点的对应实参
      for (const [fnName, paramLists] of functionParams) {
        for (const params of paramLists) {
          const index = params.indexOf(name)
          if (index < 0) continue
          for (const call of callSites.get(fnName) ?? []) branches.push(trace(call.arguments[index], nextSeen, depth + 1))
        }
      }
      const clean = branches.find((branch) => branch.anchor && !branch.temp)
      if (clean) { result.anchor = true; continue }
      for (const branch of branches) { result.anchor ||= branch.anchor; result.temp ||= branch.temp }
    }
    return result
  }

  const sites = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
      if (WALK_CALLEES.has(name)) {
        const info = trace(node.arguments[0])
        // 没有实参（glob 的 cwd 在选项里）时也看整个调用
        const whole = node.arguments.length > 1 ? trace(node.arguments[node.arguments.length - 1]) : { anchor: false, temp: false }
        const anchor = info.anchor || whole.anchor
        const temp = info.temp || whole.temp
        sites.push({ line, kind: name, anchored: anchor && !temp })
      } else if (PROCESS_CALLEES.has(name) && /ls-files|['"]grep['"]|git grep/.test(node.getText(ast))) {
        sites.push({ line, kind: 'git ls-files|grep', anchored: !TEMP_TEXT.test(node.getText(ast)) })
      } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.getText(ast) === 'import.meta.glob') {
        sites.push({ line, kind: 'import.meta.glob', anchored: true })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return sites
}

const IMPORT_SPEC = /(?:from|import|require)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g
const RESOLVE_EXTS = ['', '.mjs', '.js', '.cjs', '.mts', '.cts', '.ts', '.tsx', '/index.mjs', '/index.js', '/index.ts', '/index.tsx']
const JS_TO_TS = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] }

function resolveRelative(fromFile, spec, root) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
  const ext = path.posix.extname(base)
  const swapped = (JS_TO_TS[ext] ?? []).map((replacement) => `${base.slice(0, -ext.length)}${replacement}`)
  for (const candidate of [...RESOLVE_EXTS.map((suffix) => `${base}${suffix}`), ...swapped]) {
    try { if (fs.statSync(path.join(root, candidate)).isFile()) return candidate } catch { /* 下一个候选 */ }
  }
  return null
}

/** 间接扫描只顺着 src / electron 以外的模块找（scripts、tests、evals、根目录配置里的扫描器）：src / electron 的生产代码里有的是对用户目录的 readdir（scratchCleanup 之类），不是对仓库的扫描。 */
const SCANNER_TERRITORY = /^(?!(?:src|electron)\/)/
/** 单个文件的事实（walk 点 + 相对 import 说明符），按 root+路径+内容缓存：闭包遍历会反复经过同一批文件。 */
const fileFacts = new Map()
function factsOf(file, root) {
  let text = ''
  try { text = fs.readFileSync(path.join(root, file), 'utf8') } catch { return { text: '', sites: [], specs: [] } }
  const key = `${root}|${file}`
  const cached = fileFacts.get(key)
  if (cached && cached.text === text) return cached
  // 先用便宜的文本正则筛，再上语法树：绝大多数测试文件根本不碰 readdir / glob / git ls-files
  const sites = /readdir|opendir|glob|ls-files|grep/.test(text) ? walkSites(file, text).filter((site) => site.anchored) : []
  const specs = [...text.matchAll(IMPORT_SPEC)].map((match) => match[1])
  const facts = { text, sites, specs }
  fileFacts.set(key, facts)
  return facts
}

/**
 * 一个测试文件的扫描证据：自己的 walk 点 + 相对 import 闭包里「非测试文件」的 walk 点。
 * 返回 [{ file, line, kind }]（只含 anchored 的）。root 是仓库根（临时副本里测用）。
 */
export function scanEvidence(testFile, root) {
  const evidence = []
  const seen = new Set()
  const queue = [testFile]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const facts = factsOf(file, root)
    // 闭包里别的测试文件不算（它们自己单独判定）；入口测试自己算
    if (file === testFile || !TEST_FILE.test(file)) for (const site of facts.sites) evidence.push({ file, line: site.line, kind: site.kind })
    for (const spec of facts.specs) {
      // 先按路径判领地再去解析（解析要 stat 好几次；绝大多数 import 指向 src / electron，直接略过）
      if (!SCANNER_TERRITORY.test(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)))) continue
      const resolved = resolveRelative(file, spec, root)
      if (resolved && !TEST_FILE.test(resolved)) queue.push(resolved)
    }
  }
  return evidence
}

/** 仓库里所有被 git 跟踪的测试文件（相对路径，正斜杠）。 */
export function trackedTestFiles(root, listFiles) {
  return listFiles().filter((file) => TEST_FILE.test(file))
}
