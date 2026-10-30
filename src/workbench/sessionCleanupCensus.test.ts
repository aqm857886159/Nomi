import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type Concept = { subject: string; lifecycle: string; write_api: { symbol: string }[] }
type CleanupCall = { file: string; line: number; symbol: string }
const root = path.resolve(__dirname, '../..')
const registryDir = path.join(root, 'docs/engineering/concept-owners')
// 普查直接读取概念登记 registry；新增 live-interaction 概念自动成为一行检查，不能靠删清单变绿。
const registry: Concept[] = fs.readdirSync(registryDir).sort()
  .filter(file => file.endsWith('.json'))
  .map(file => JSON.parse(fs.readFileSync(path.join(registryDir, file), 'utf8')) as Concept)
  .filter(concept => concept.lifecycle === 'live-interaction')

// 按概念、符号豁免资源释放，开/关/完成业务会话没有豁免。
const resourceReleaseExemptions: Record<string, Record<string, string>> = {
  'canvas.video-playback': {
    releaseNodeVideoPlayback: '只在 playingVideo === video 时释放该 DOM 播放器的独占引用；不关闭持久编辑会话。',
  },
}

function productionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionFiles(file)
    return /\.tsx?$/.test(file) && !/\.(?:test|spec|node-test)\./.test(file) && !file.endsWith('.d.ts') ? [file] : []
  })
}

function parseProgram(contents: Map<string, string>) {
  contents = new Map([...contents].map(([file, text]) => [file.replace(/\\/g, "/"), text]))
  const options: ts.CompilerOptions = { noResolve: true, noLib: true, jsx: ts.JsxEmit.Preserve }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (file, languageVersion) => {
    const source = contents.get(file.replace(/\\/g, "/"))
    return source === undefined ? undefined : ts.createSourceFile(file, source, languageVersion, true)
  }
  const program = ts.createProgram([...contents.keys()], options, host)
  return { sources: program.getSourceFiles(), checker: program.getTypeChecker() }
}

type LocalFunction = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration
function localFunction(expression: ts.Node, checker: ts.TypeChecker, seen = new Set<ts.Node>()): LocalFunction | undefined {
  if (seen.has(expression)) return undefined
  seen.add(expression)
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) || ts.isFunctionDeclaration(expression)) return expression
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) {
    return localFunction(expression.expression, checker, seen)
  }
  if (!ts.isIdentifier(expression)) return undefined
  // TS 的词法绑定选就近声明；同名内层变量/参数不会误解析到外层 cleanup。
  const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration
  if (!declaration || declaration.getSourceFile() !== expression.getSourceFile()) return undefined
  if (ts.isFunctionDeclaration(declaration)) return declaration
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) return localFunction(declaration.initializer, checker, seen)
  return undefined
}

function calledName(expression: ts.LeftHandSideExpression, checker: ts.TypeChecker): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) return expression.argumentExpression.text
  if (!ts.isIdentifier(expression)) return undefined
  const imported = checker.getSymbolAtLocation(expression)?.declarations?.find(ts.isImportSpecifier)
  return imported?.propertyName?.text ?? expression.text
}

function cleanupCensus(contents: Map<string, string>): CleanupCall[] {
  const { sources, checker } = parseProgram(contents)
  const calls: CleanupCall[] = []
  const visited = new Set<ts.Node>()
  function inspectCleanup(expression: ts.Node) {
    const cleanup = localFunction(expression, checker)
    if (!cleanup?.body || visited.has(cleanup)) return
    visited.add(cleanup)
    const inspect = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const symbol = calledName(node.expression, checker)
        if (symbol) calls.push({ file: node.getSourceFile().fileName, line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1, symbol })
      }
      ts.forEachChild(node, inspect)
    }
    inspect(cleanup.body)
  }
  function inspectEffect(expression: ts.Expression) {
    const setup = localFunction(expression, checker)
    if (!setup?.body) return
    if (!ts.isBlock(setup.body)) return inspectCleanup(setup.body)
    const returns = (node: ts.Node) => {
      // 内层函数的 return 不属于 effect setup。
      if (ts.isFunctionLike(node)) return
      if (ts.isReturnStatement(node) && node.expression) inspectCleanup(node.expression)
      ts.forEachChild(node, returns)
    }
    returns(setup.body)
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments[0]) {
      const callee = node.expression
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'React' ? callee.name.text : undefined
      if (name === 'useEffect' || name === 'useLayoutEffect') inspectEffect(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  sources.forEach(source => visit(source))
  return calls
}

const files = productionFiles(path.join(root, 'src/workbench'))
const calls = cleanupCensus(new Map(files.map(file => [file, fs.readFileSync(file, 'utf8')])))

describe('组件卸载的会话写接口普查', () => {
  it('登记包含画板四个写接口，且扫描范围非空', () => {
    expect(registry.find(concept => concept.subject === 'canvas.whiteboard-session')?.write_api.map(api => api.symbol).sort())
      .toEqual(['closeWhiteboard', 'finishWhiteboard', 'openWhiteboard', 'registerWhiteboardFinish'])
    expect(files.length).toBeGreaterThan(0)
    expect(calls.length).toBeGreaterThan(0)
  })

  it('资源释放豁免必须仍在登记内并写明理由', () => {
    for (const [subject, exemptions] of Object.entries(resourceReleaseExemptions)) {
      const concept = registry.find(row => row.subject === subject)
      for (const [symbol, reason] of Object.entries(exemptions)) {
        expect(concept?.write_api.map(api => api.symbol)).toContain(symbol)
        expect(reason.length).toBeGreaterThan(0)
      }
    }
  })

  it.each(registry)('$subject cleanup 不调用会话业务写接口', concept => {
    const forbidden = new Set(concept.write_api.map(api => api.symbol))
    const hits = calls.filter(call => forbidden.has(call.symbol) && !resourceReleaseExemptions[concept.subject]?.[call.symbol])
      .map(call => `${path.relative(root, call.file)}:${call.line} ${call.symbol} [${concept.subject}]`)
    expect(hits, '组件卸载只释放视图资源，会话的开 / 关 / 完成只走显式边界。\n' + hits.join('\n')).toEqual([])
  })
})

describe('cleanup 普查解析边界', () => {
  it.each([
    ['箭头 cleanup', 'useEffect(() => () => closeWhiteboard(id), [])', 1],
    ['React layout / 函数表达式', 'React.useLayoutEffect(function () { return function () { closeWhiteboard(id) } }, [])', 1],
    ['就近标识符', 'function C() { const stop = () => closeWhiteboard(id); useEffect(() => { return stop }, []) }', 1],
    ['函数声明与别名', 'function C() { function stop() { closeWhiteboard(id) }; const cleanup = stop; React.useEffect(() => cleanup, []) }', 1],
    ['effect 标识符', 'const setup = () => () => closeWhiteboard(id); useLayoutEffect(setup, [])', 1],
    ['分支返回', 'useEffect(() => { if (ready) return () => closeWhiteboard(id); return undefined }, [])', 1],
    ['导入改名', 'import { closeWhiteboard as close } from "./session"; useEffect(() => () => close(id), [])', 1],
    ['setup 直接调用不是 cleanup', 'useEffect(() => { closeWhiteboard(id); return undefined }, [])', 0],
    ['setup 返回 disposer 的调用不是 cleanup 函数体', 'useEffect(() => registerWhiteboardFinish(id, finish), [])', 0],
    ['内层 return 不是 setup 返回', 'useEffect(() => { const factory = () => { return () => closeWhiteboard(id) }; return undefined }, [])', 0],
    ['就近同名遮蔽', 'const stop = () => closeWhiteboard(id); function C() { const stop = () => removeEventListener("x", fn); useEffect(() => stop, []) }', 0],
    ['参数遮蔽', 'const stop = () => closeWhiteboard(id); function C(stop) { useEffect(() => stop, []) }', 0],
  ] as const)('%s', (_name, source, expected) => {
    const found = cleanupCensus(new Map([['census-fixture.tsx', source]]))
    expect(found.filter(call => call.symbol === 'closeWhiteboard')).toHaveLength(expected)
  })
})
