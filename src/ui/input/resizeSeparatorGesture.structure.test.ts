// 自定义尺寸把手按下即认领：resize / grab / move 光标 + onPointerDown，不依赖字面 role。
// 浏览器会在把手移动后按原坐标寻找图片/链接/选区；capture 不会取消原生拖动。
// 同文件实现的把手以捕获指针或注册 onMove 会话认定；纯转发回调不冒充手势 owner。
// 非 pointerdown、外置 CSS 与库托管把手的边界由入口表列明，不能把本扫描当全部拖动行为普查。
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
      found.set(node.name.text, init)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** 展开同文件绑定及调用；工厂返回的 handler 和 className 常量也用同一路径。 */
function expressionSource(expression: ts.Expression, functions: Map<string, ts.Node>, file: ts.SourceFile): string | null {
  const own = ts.isIdentifier(expression) ? functions.get(expression.text) : expression
  if (!own) return null
  const seen = new Set<ts.Node>()
  const parts: string[] = []
  const visit = (node: ts.Node): void => {
    if (seen.has(node)) return
    seen.add(node)
    if (ts.isIdentifier(node)) {
      const binding = functions.get(node.text)
      if (binding) { parts.push(binding.getText(file)); visit(binding) }
    }
    ts.forEachChild(node, visit)
  }
  parts.push(own.getText(file))
  visit(own)
  return parts.join('\n')
}

type Separator = { file: string; line: number; handler: string; claims: boolean | null; ownsGesture: boolean }

function scanSource(text: string, full: string): Separator[] {
  const result: Separator[] = []
  const file = ts.createSourceFile(full, stripComments(text), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const functions = localFunctions(file)
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute)
      const attr = (name: string) => attrs.find((a) => ts.isIdentifier(a.name) && a.name.text === name)
      const expression = (name: string) => {
        const init = attr(name)?.initializer
        return init && ts.isJsxExpression(init) ? init.expression : init
      }
      const down = expression('onPointerDown')
      const classes = expression('className')
      const classSource = classes ? expressionSource(classes, functions, file) : null
      // 光标描述用户可执行的缩放或移动；role 只描述无障碍语义，不作为把手判据。
      if (down && classSource && /\bcursor-(?:(?:col|row|[nesw]{1,4})-resize|grab|grabbing|move)\b/.test(classSource)) {
        const source = expressionSource(down, functions, file)
        result.push({
          file: rel(full),
          handler: down.getText(file),
          line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          claims: source === null ? null : /\.preventDefault\(\)/.test(source),
          ownsGesture: source !== null && /\.setPointerCapture(?:\?\.)?\s*\(|\bonMove\s*:/.test(source),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return result
}

function scanSeparators(): Separator[] {
  return sourceFiles(SRC).flatMap((full) => scanSource(fs.readFileSync(full, 'utf8'), full))
}

describe('尺寸与位置把手按下即认领手势', () => {
  const separators = scanSeparators()

  it('漏认反例：无 role、className 常量和工厂回调仍是把手', () => {
    const found = scanSource(`
      const grip = 'cursor-nwse-resize'
      const begin = () => (event) => event.currentTarget.setPointerCapture(event.pointerId)
      const view = <div className={grip} onPointerDown={begin()} />
    `, 'fixture.tsx')
    expect(found).toHaveLength(1)
    expect(found[0].ownsGesture).toBe(true)
    expect(found[0].claims).toBe(false)
  })

  it('位置把手也按手势认：标题移动不靠 separator role', () => {
    const [handle] = scanSource(`<header className="cursor-grab" onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} />`, 'fixture.tsx')
    expect(handle.ownsGesture).toBe(true)
    expect(handle.claims).toBe(false)
  })

  it('委托回调不冒充本文件发起的手势', () => {
    const [handle] = scanSource(`<div className="cursor-ew-resize" onPointerDown={(event) => forwarded(event)} />`, 'fixture.tsx')
    expect(handle.ownsGesture).toBe(false)
  })

  it('误报反例：视觉 separator、原生 range 和普通捕获点击不属于自定义尺寸把手', () => {
    expect(scanSource(`
      const view = <><div role="separator" />
        <input type="range" className="cursor-ew-resize" onChange={change} />
        <button onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} />
      </>
    `, 'fixture.tsx')).toEqual([])
  })

  it('扫得到原六个分隔条及无 role 的画中画把手（扫描本身没失效）', () => {
    const files = new Set(separators.filter((s) => s.ownsGesture).map((s) => s.file))
    for (const known of [
      'src/ui/app-shell/shell/ShellRail.tsx',
      'src/workbench/AssistantPane.tsx',
      'src/workbench/timeline/TimelineResizeHandle.tsx',
      'src/workbench/timeline/TimelineTextTrack.tsx',
      'src/workbench/generationCanvas/nodes/director/panels/EditorSplit.tsx',
      'src/workbench/generationCanvas/nodes/director/panels/viewport/PipViewport.tsx',
    ]) expect(files, known).toContain(known)
  })

  it.each([
    ['主体移动', 'beginDrag(event, clip.id, clip.startFrame)'],
    ['左端尺寸', "beginResize(event, clip.id, 'left')"],
    ['右端尺寸', "beginResize(event, clip.id, 'right')"],
  ])('字幕%s的独立入口仍被识别并认领', (_name, call) => {
    const handles = separators.filter((s) => s.file.endsWith('/TimelineTextTrack.tsx') && s.handler.includes(call))
    expect(handles).toHaveLength(1)
    expect(handles[0]).toMatchObject({ ownsGesture: true, claims: true })
  })

  it('每个尺寸与位置把手的 pointerdown 都 preventDefault()，原生拖图 / 拖选区接不走指针', () => {
    const offenders = separators.filter((s) => s.ownsGesture && s.claims === false).map((s) => `${s.file}:${s.line}`)
    expect(offenders, '尺寸把手的 onPointerDown 里补 event.preventDefault()（见文件头）').toEqual([])
  })
})
