// 拖拽分隔条（role="separator" + onPointerDown）按下就要认领手势：pointerdown 里 preventDefault()。
//
// 为什么：分隔条跟着指针走，按下那一点很快就露出了它旁边的内容。浏览器在第一次拖动时按「按下那一点」重新找拖动源，
// 找到原生可拖的东西（<img>、链接、选区）就开始原生拖动：抢走指针（pointercancel），拖宽半截停住，
// 手里变成拖着一张图。实例：提示词库抽屉右缘拖宽，第一步 8px 就把按下点让给了示例卡的封面图；
// 走查里那张图还没加载，浏览器发了 dragstart 又撤回，Playwright 的 mouse.move 等一个永远不来的拖动事件，整条走查挂死。
// 认领的写法和 react-resizable-panels 的分隔条一致（pointerdown 命中分隔条即 preventDefault）。
//
// 这条测试把「新写一个分隔条忘了认领」变成当场红：扫 src 下所有带 role="separator" 和 onPointerDown 的 JSX，
// 处理函数（内联箭头、同文件的函数 / useCallback，以及它直接调用的同文件函数）里必须有 preventDefault()。
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { stripComments } from '../../../scripts/lib/colorMixHue.mjs'

const SRC = path.resolve(__dirname, '../..')
const rel = (file: string): string => path.relative(path.resolve(SRC, '..'), file).split(path.sep).join('/')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 同文件里按名字找函数体：function 声明、const x = () => {}、const x = useCallback(() => {}, …)。 */
function localFunctions(file: ts.SourceFile): Map<string, ts.Node> {
  const found = new Map<string, ts.Node>()
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) found.set(node.name.text, node)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let init: ts.Expression = node.initializer
      if (ts.isCallExpression(init) && init.arguments[0] && (ts.isArrowFunction(init.arguments[0]) || ts.isFunctionExpression(init.arguments[0]))) init = init.arguments[0]
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) found.set(node.name.text, init)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** 处理函数自身 + 它直接按名字调用的同文件函数（一层），拼成一段源码。拿不到返回 null。 */
function handlerSource(expression: ts.Expression, functions: Map<string, ts.Node>, file: ts.SourceFile): string | null {
  const own = ts.isIdentifier(expression) ? functions.get(expression.text) : (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) ? expression : undefined)
  if (!own) return null
  const parts = [own.getText(file)]
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = functions.get(node.expression.text)
      if (callee && callee !== own) parts.push(callee.getText(file))
    }
    ts.forEachChild(node, visit)
  }
  visit(own)
  return parts.join('\n')
}

type Separator = { file: string; line: number; claims: boolean | null }

function scanSeparators(): Separator[] {
  const result: Separator[] = []
  for (const full of sourceFiles(SRC)) {
    const text = stripComments(fs.readFileSync(full, 'utf8'))
    if (!text.includes('separator') || !text.includes('onPointerDown')) continue
    const file = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const functions = localFunctions(file)
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const attrs = node.attributes.properties.filter(ts.isJsxAttribute)
        const attr = (name: string) => attrs.find((a) => ts.isIdentifier(a.name) && a.name.text === name)
        const role = attr('role')
        const down = attr('onPointerDown')
        if (role?.initializer && ts.isStringLiteral(role.initializer) && role.initializer.text === 'separator' && down) {
          const expression = down.initializer && ts.isJsxExpression(down.initializer) ? down.initializer.expression : undefined
          const source = expression ? handlerSource(expression, functions, file) : null
          result.push({
            file: rel(full),
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            claims: source === null ? null : /\.preventDefault\(\)/.test(source),
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return result
}

describe('拖拽分隔条按下即认领手势', () => {
  const separators = scanSeparators()

  it('扫得到全仓已知的拖拽分隔条（扫描本身没失效）', () => {
    const files = new Set(separators.map((s) => s.file))
    for (const known of [
      'src/ui/app-shell/shell/ShellRail.tsx',
      'src/workbench/AssistantPane.tsx',
      'src/workbench/timeline/TimelineResizeHandle.tsx',
      'src/workbench/timeline/TimelineTextTrack.tsx',
      'src/workbench/generationCanvas/nodes/director/panels/EditorSplit.tsx',
    ]) expect(files, known).toContain(known)
  })

  it('每个分隔条的 pointerdown 处理都能静态找到（内联、同文件函数或 useCallback）', () => {
    const unresolved = separators.filter((s) => s.claims === null).map((s) => `${s.file}:${s.line}`)
    expect(unresolved, '分隔条的 onPointerDown 写成了扫描认不出的形状 → 改成内联箭头或同文件函数').toEqual([])
  })

  it('每个分隔条的 pointerdown 都 preventDefault()，原生拖图 / 拖选区接不走指针', () => {
    const offenders = separators.filter((s) => s.claims === false).map((s) => `${s.file}:${s.line}`)
    expect(offenders, 'role="separator" 的 onPointerDown 里补 event.preventDefault()（见文件头）').toEqual([])
  })
})
