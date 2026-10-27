// 「绕过唯一分配口、直接在系统临时目录建目录」的语法树扫描（2026-10-28，check:test-temp-static 用）。
//
// 起因：系统临时目录的唯一分配口是 scripts/_test-temp.mjs（目录名带创建者进程号，被 SIGKILL 杀掉后有人按进程号回收）。
// 绕开它的 mkdtemp(<系统临时目录>…) 建出来的目录没有归属，进程一被杀就永远留在盘上。旧门岗只认五个固定写法的正则、
// 只扫 tests/ 下文件名带 .test / .walk / .e2e / .probe / .paid 的 .mjs，于是 .cjs / .mts、不带后缀的辅助文件、
// 别名（const tmp = os.tmpdir()）、process.env.TMPDIR 的写法全部漏过去（2026-10-28 实测：四种写法同时存在，旧门岗全绿）。
// 现在按语法树认，范围是 scripts/ 与 tests/ 下全部 JS / TS 源码；存量登记在 scripts/test-temp-bypass-baseline.json（只减不增）。
//
// 判据：调用 mkdtemp / mkdtempSync（任何限定写法：fs.、fs.promises.、fsp.、直接 import 的、fs['mkdtempSync']），
// 第一个参数表达式里出现「系统临时目录」的来路——
//   · os.tmpdir() / tmpdir() 调用；
//   · process.env.TMPDIR / TEMP / TMP（点号或方括号写法）；
//   · 以 /tmp、/var/tmp、/private/tmp、/var/folders 开头的字符串；
//   · 同一函数（或外层函数 / 模块顶层）里由上面几种来路初始化的变量或参数默认值（按词法作用域跟，不按名字全文件通配）。
// 已知限制：语法层。跨函数 / 跨文件传进来的路径看不到；import { tmpdir as t } 之类改名的看不到；注释和字符串里写的不算。
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ALLOCATORS = new Set(['mkdtemp', 'mkdtempSync'])
const TEMP_ENV_NAMES = new Set(['TMPDIR', 'TEMP', 'TMP'])
const TEMP_LITERAL = /^(?:\/tmp|\/var\/tmp|\/private\/tmp|\/var\/folders)(?:[\\/]|$)/
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-electron'])

function scriptKindOf(file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX
  if (/\.(?:[cm]?ts)$/.test(file)) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function calleeName(callee) {
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) return callee.argumentExpression.text
  return null
}

const isScope = (node) => ts.isFunctionLike(node) || ts.isSourceFile(node)

function scopeChain(node) {
  const chain = new Set()
  for (let current = node.parent; current; current = current.parent) if (isScope(current)) chain.add(current)
  return chain
}

/** @returns {{ line: number, call: string }[]} 每一处绕过分配口的 mkdtemp 调用。 */
export function systemTempBypasses(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindOf(file))

  // 变量声明与参数默认值：name → [{ scope, initializer }]
  const declarations = new Map()
  const declare = (node) => {
    if (!node.initializer || !ts.isIdentifier(node.name)) return
    const list = declarations.get(node.name.text) ?? []
    list.push({ scope: [...scopeChain(node)][0], initializer: node.initializer })
    declarations.set(node.name.text, list)
  }
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) declare(node)
    ts.forEachChild(node, collect)
  }
  collect(ast)

  const rooted = (expression, seen = new Set()) => {
    let found = false
    const visit = (node) => {
      if (found) return
      if (ts.isCallExpression(node) && node.arguments.length === 0 && calleeName(node.expression) === 'tmpdir') found = true
      else if (ts.isPropertyAccessExpression(node) && TEMP_ENV_NAMES.has(node.name.text) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'env') found = true
      else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && TEMP_ENV_NAMES.has(node.argumentExpression.text)) found = true
      else if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) && TEMP_LITERAL.test(node.text)) found = true
      else if (ts.isIdentifier(node)) {
        const chain = scopeChain(node)
        for (const declaration of declarations.get(node.text) ?? []) {
          if (!chain.has(declaration.scope) || seen.has(declaration.initializer)) continue
          seen.add(declaration.initializer)
          if (rooted(declaration.initializer, seen)) { found = true; break }
        }
      }
      if (!found) ts.forEachChild(node, visit)
    }
    visit(expression)
    return found
  }

  const hits = []
  const visit = (node) => {
    if (ts.isCallExpression(node) && ALLOCATORS.has(calleeName(node.expression) ?? '') && node.arguments[0] && rooted(node.arguments[0])) {
      hits.push({
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        call: node.getText(ast).replace(/\s+/g, ' ').slice(0, 100),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return hits
}

/** roots 下全部 JS / TS 源码里的绕过：{ 仓库相对路径 → 命中列表 }（只含有命中的文件）。 */
export function scanSystemTempBypasses(repoRoot, roots = ['scripts', 'tests']) {
  const found = new Map()
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8')
        if (!text.includes('mkdtemp')) continue
        const relative = path.relative(repoRoot, full).split(path.sep).join('/')
        const hits = systemTempBypasses(relative, text)
        if (hits.length > 0) found.set(relative, hits)
      }
    }
  }
  for (const root of roots) walk(path.join(repoRoot, root))
  return found
}
