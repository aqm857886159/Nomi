#!/usr/bin/env node
// 「我是不是被直接运行」判断的写法门岗（2026-09-24）。硬零，无基线。
//
// 起因：7 个脚本（其中 5 个是 gates:contracts 里的门岗）用
//   if (import.meta.url === `file://${process.argv[1]}`) main()
// 判断自己是不是入口。Windows 上 import.meta.url 是 `file:///C:/…`（三道斜杠、正斜杠），
// process.argv[1] 是 `C:\…`，两边永远不等 → main() 一次都不执行 → 零输出、退出码 0。
// 门岗在 Windows 上**静默报绿**，和「检查过、没问题」长得一模一样。
// 修完真跑一遍，check:supply-chain-pins 立刻红出一个藏在下面的 Windows 路径 bug——
// 从没执行过的门岗，连它自己的 bug 都攒着没人看见。
//
// 为什么是一整族而不是那一行：手拼 file URL 的写法仓库里有好几种，坏法各不同——
//   · `file://${argv1}`             Windows 上恒不等；
//   · new URL(argv1, 'file:')       Windows 上盘符被当成协议名，恒不等；
//   · new URL(`file://${argv1}`)    普通路径碰巧对，路径里有 `#` `?` `%` 就在**任何平台**上不等。
// 只有 node:url 的 pathToFileURL / fileURLToPath 按 Node 自己生成 import.meta.url 的同一套规则转换。
//
// 2026-10-10 扩一族同源写法（6 道门岗只在 Windows 上红，见 scripts/lib/repoPaths.mjs）：
//   url-pathname-as-path  把 `import.meta.url` 的 URL.pathname 当磁盘路径（Windows 上是 `/D:/…`，文件被误报不存在）；
//   import-bare-path      `import(path.join(…))` / `import(path.resolve(…))`：盘符路径被 ESM 当协议（ERR_UNSUPPORTED_ESM_URL_SCHEME）；
//                         以及 import(`file://${…}`) 手拼 URL（盘符 / 反斜杠 / 空格全不对）；
//   bare-cmd-spawn        execFileSync / spawnSync / execFile / spawn 的命令直接写 pnpm / npm / npx / tsx 且没开 shell（Windows 上是 .cmd，ENOENT）。
// 修法一律走 scripts/lib/repoPaths.mjs（repoRoot / importLocal / toFileUrl / repoRelativePosix）或 process.execPath。
//
// 判据（只认这一族，不扩张）：
//   argv-url-by-hand  把 process.argv[1] 手拼成 URL（`file:` 开头的模板/拼接，或 new URL(…) 且没过转换函数）；
//   meta-url-vs-hand  import.meta.url 跟一个手拼的 URL（`file:` 字面量 / new URL）比相等；
//   meta-url-vs-argv  import.meta.url 跟 process.argv 比相等，两边都没过 pathToFileURL / fileURLToPath。
// 用语法树而不是正则：注释、报错文案、本门岗测试里的样本串都是字符串，不是代码，天然不误伤。
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { gitPaths } from './lib/gitPaths.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_FILE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/
const CONVERTERS = new Set(['pathToFileURL', 'fileURLToPath'])
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
])

export const FIX_HINT = 'process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href'

function scriptKindOf(file) {
  if (/\.[jt]sx$/.test(file)) return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX
  return /\.(?:js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
}

function some(node, predicate) {
  if (predicate(node)) return true
  return ts.forEachChild(node, (child) => some(child, predicate) || undefined) === true
}

const isImportMetaUrl = (node) =>
  ts.isPropertyAccessExpression(node)
  && node.name.text === 'url'
  && ts.isMetaProperty(node.expression)
  && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword

const isProcessArgv = (node) =>
  ts.isPropertyAccessExpression(node)
  && node.name.text === 'argv'
  && ts.isIdentifier(node.expression)
  && node.expression.text === 'process'

/** `process.argv[1]`——脚本路径那一格；别的下标可能是用户传进来的真网址，不归本门管。 */
const isScriptPathArg = (node) =>
  ts.isElementAccessExpression(node)
  && isProcessArgv(node.expression)
  && ts.isNumericLiteral(node.argumentExpression)
  && node.argumentExpression.text === '1'

const isConverterCall = (node) => {
  if (!ts.isCallExpression(node)) return false
  const callee = node.expression
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
  return CONVERTERS.has(name)
}

const BARE_CMD_CALLEES = new Set(['execFileSync', 'execFile', 'spawnSync', 'spawn'])
const BARE_CMDS = new Set(['pnpm', 'npm', 'npx', 'tsx'])
const calleeName = (node) => (ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '')

const startsWithFileScheme = (text) => /^file:/i.test(text)

/** `file:` 开头的字符串 / 模板字面量（手拼 file URL 的原料）。 */
const isFileSchemeLiteral = (node) =>
  ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && startsWithFileScheme(node.text))
  || (ts.isTemplateExpression(node) && startsWithFileScheme(node.head.text))

const isNewUrl = (node) =>
  ts.isNewExpression(node)
  && (ts.isIdentifier(node.expression) ? node.expression.text === 'URL'
    : ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'URL')

/** 最左端的 `+` 操作数——`'file://' + x + y` 这种拼接从这里认。 */
function leftmostOperand(node) {
  let current = node
  while (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) current = current.left
  return current
}

const isHandBuiltUrl = (node) =>
  (isFileSchemeLiteral(node) && !ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node))
  || (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && isFileSchemeLiteral(leftmostOperand(node)))
  || (isNewUrl(node) && !some(node, isConverterCall))

export function scanSource(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindOf(file))
  const hits = []
  // 归档证据（docs/）里的历史代码不改，新一族写法只管活的脚本 / 测试 / 源码
  const portable = !file.startsWith('docs/')
  const report = (node, rule) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    if (hits.some((hit) => hit.line === line)) return
    hits.push({ file, line, rule, text: source.split('\n')[line - 1].trim().slice(0, 160) })
  }
  const visit = (node) => {
    if (isHandBuiltUrl(node) && some(node, isScriptPathArg)) {
      report(node, 'argv-url-by-hand')
      return
    }
    // 新一族：同源 Windows 路径写法
    if (portable && ts.isPropertyAccessExpression(node) && node.name.text === 'pathname' && some(node.expression, isImportMetaUrl) && !some(node.expression, isConverterCall)) {
      report(node, 'url-pathname-as-path')
      return
    }
    if (portable && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
      const arg = node.arguments[0]
      const callee = ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression) ? arg.expression : null
      const pathCall = callee && ts.isIdentifier(callee.expression) && callee.expression.text === 'path' && ['join', 'resolve'].includes(callee.name.text)
      const handUrl = ts.isTemplateExpression(arg) && startsWithFileScheme(arg.head.text) && !some(arg, isConverterCall)
      if (pathCall || handUrl) {
        report(node, 'import-bare-path')
        return
      }
    }
    if (portable && ts.isCallExpression(node) && BARE_CMD_CALLEES.has(calleeName(node)) && node.arguments.length > 0
      && ts.isStringLiteralLike(node.arguments[0]) && BARE_CMDS.has(node.arguments[0].text)
      && !node.arguments.slice(1).some((arg) => /shell/.test(arg.getText(sourceFile)))) {
      report(node, 'bare-cmd-spawn')
      return
    }
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind)) {
      const sides = [node.left, node.right]
      const metaSide = sides.find((side) => some(side, isImportMetaUrl))
      const otherSide = sides.find((side) => side !== metaSide)
      if (metaSide && otherSide) {
        if (some(otherSide, (child) => isFileSchemeLiteral(child) || (isNewUrl(child) && !some(child, isConverterCall)))) {
          report(node, 'meta-url-vs-hand')
          return
        }
        if (some(otherSide, isProcessArgv) && !sides.some((side) => some(side, isConverterCall))) {
          report(node, 'meta-url-vs-argv')
          return
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return hits
}

/** 已跟踪 + 未跟踪未忽略：新写的脚本还没 `git add` 也要被扫到。 */
export function collectFiles(root) {
  return gitPaths(['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root })
    .filter((file) => SOURCE_FILE.test(file))
}

export function main({ root = repoRoot, log = console.log } = {}) {
  const files = collectFiles(root)
  // 扫到 0 个文件也会报绿——那种绿和真绿长得一模一样，所以这里 fail-closed。
  if (files.length === 0) {
    log(`✖ check:main-guard 一个源文件都没扫到（${root}）——遍历失效，不能当作通过`)
    return 1
  }
  const hits = []
  let scanned = 0
  for (const file of files) {
    const abs = path.join(root, file)
    if (!fs.existsSync(abs)) continue // 工作区里已删、索引里还在
    const source = fs.readFileSync(abs, 'utf8')
    if (!source.includes("import.meta.url") && !source.includes("process.argv") && !source.includes("import(") && !source.includes("file:") && !/pnpm|npm|npx|tsx/.test(source)) continue
    scanned += 1
    hits.push(...scanSource(source, file))
  }
  if (hits.length > 0) {
    log(`✖ check:main-guard：${hits.length} 处只在 Windows 上坏的路径 / URL / 命令写法（手拼 file URL 判断入口、URL.pathname 当路径、import(裸路径)、不开 shell 直接 spawn pnpm 等）——Linux CI 看不见：`)
    for (const hit of hits) log(`    ${hit.file}:${hit.line}  [${hit.rule}]  ${hit.text}`)
    log(`\n  → 判断入口：if (${FIX_HINT}) main()；路径 / 动态 import / 相对路径比较走 scripts/lib/repoPaths.mjs；起 tsx 用 process.execPath + --import tsx`)
    return 1
  }
  log(`✅ check:main-guard：${files.length} 个源文件，其中 ${scanned} 个用到 import.meta.url / process.argv 已逐个解析，没有手拼 file URL 的入口判断（硬零，无基线）`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
