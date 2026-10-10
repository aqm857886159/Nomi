// 「测试 / 门岗自检往真实仓库路径写文件」的语法树扫描（2026-10-10）。
//
// 起因：gate-mutation-harness 的 withMutation 原地改真实工作区里的生产文件，被杀时留下变异后的生产代码
// （同一天两次）。类根因是「测试对真实仓库路径有写权」；还原机制（finally / 信号 / 恢复档）兜不住 Windows 被杀与并发。
// 这里把它变成机器判据：测试文件里，写 / 删 / 建目录 / 拷贝目标 / 改名这类调用，目标路径一旦由 repoRoot（或 process.cwd()）
// 拼出来、又不在 `.tmp` 下，就算违规——要写就写 makeTempDir 给的临时目录。
//
// 判据（只认这一族）：
//   · 目标参数：writeFileSync / appendFileSync / rmSync / rmdirSync / unlinkSync / mkdirSync / truncateSync / mkdtempSync /
//     writeFile / appendFile / rm / unlink / mkdir / createWriteStream 取第 1 个参数；copyFileSync / cpSync / copyFile / cp 取第 2 个；
//     renameSync / rename 两个都算；
//   · 参数表达式里出现标识符 repoRoot / REPO_ROOT / repositoryRoot 或 process.cwd()；
//   · 且表达式里没有以 `.tmp` 开头的字符串字面量（仓库约定的 gitignore 草稿区）。
// 已知限制：先赋给变量、跨函数传递的路径看不到；这是语法层的拦截，不是沙箱。真正的隔离靠 gate-mutation-harness 的临时副本。
import ts from 'typescript'

const ROOT_NAMES = new Set(['repoRoot', 'REPO_ROOT', 'repositoryRoot'])
const FIRST_ARG = new Set(['writeFileSync', 'appendFileSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'mkdirSync', 'truncateSync', 'mkdtempSync', 'writeFile', 'appendFile', 'rm', 'unlink', 'mkdir', 'createWriteStream', 'mkdtemp'])
const SECOND_ARG = new Set(['copyFileSync', 'cpSync', 'copyFile', 'cp'])
const BOTH_ARGS = new Set(['renameSync', 'rename'])

function calleeName(call) {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return ''
}

function isProcessCwd(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'cwd'
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'process'
}

/** 表达式里引用了仓库根（直接，或经 aliases 里记过的变量）。 */
function mentionsRepo(node, aliases) {
  let found = false
  const visit = (child) => {
    if (found) return
    if (ts.isIdentifier(child) && (ROOT_NAMES.has(child.text) || aliases.has(child.text))) found = true
    else if (isProcessCwd(child)) found = true
    else ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function underTmp(node) {
  let found = false
  const visit = (child) => {
    if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child) || ts.isTemplateHead(child)) {
      if (/^\.tmp(?:[\\/]|$|-)/u.test(child.text)) found = true
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

/** @returns {{ line: number, call: string }[]} */
export function repoWriteViolations(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /\.(?:ts|mts|cts)$/u.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS)
  const aliases = new Set() // 不跟踪变量别名：按名字全文件通配会把别处同名的临时目录变量误伤；直接引用已覆盖这类事故的写法
  const hits = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      const targets = FIRST_ARG.has(name) ? [node.arguments[0]]
        : SECOND_ARG.has(name) ? [node.arguments[1]]
          : BOTH_ARGS.has(name) ? [node.arguments[0], node.arguments[1]] : []
      for (const target of targets) {
        if (target && mentionsRepo(target, aliases) && !underTmp(target)) {
          hits.push({ line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, call: name })
          break
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return hits
}
