// Match utility boundaries, including variants and !important. Hyphenated domain IDs
// such as apply-transition-all are not Tailwind classes.
import ts from 'typescript'
import postcss from 'postcss'

const utility = /(?<![\w-])(?:duration-(?:\d+(?:\.\d+)?|\[[^\]\n]+\])|ease-(?:in-out|out|in|\[[^\]\n]+\])|transition-all|active:!?scale-\[0?\.970*\]!?)(?![\w-])/g
const curve = /\bcubic-bezier\s*\(/g
const inlineKeyframes = /@keyframes\b/g
const cssMotionProperty = /^(?:transition|animation)(?:-(?:duration|delay|timing-function))?$/i
const cssDeclarationHint = /(?:^|[;{])\s*(?:transition|animation)(?:-(?:duration|delay|timing-function))?\s*:/i
const cssTiming = /(?<![\w.-])(?:[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?m?s(?![\w-])|linear(?:\s*\(|(?![\w-])))/gi
const scanHint = /duration-|ease-|transition-all|@keyframes|cubic-bezier|prefers-reduced-motion|transition['"]?\s*[:=]|animation\s*:|(?:transition|animation)-(?:duration|delay|timing-function)\s*:|active:!?scale-/i

function withoutCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
}

export function isMotionSource(file) {
  return file.startsWith('src/') && /\.(?:tsx?|css)$/.test(file)
    && !/\.(?:spec|test|d)\.tsx?$/.test(file)
    && !/^src\/(?:devlab|vendor)\//.test(file)
    && !['src/design/motion.ts', 'src/theme/nomi-tokens.css'].includes(file)
}

export function scanMotionTokens(file, source) {
  if (!isMotionSource(file) || !scanHint.test(source)) return []
  const hits = new Map()
  const lines = source.split('\n')
  const add = (token, offset) => {
    const line = source.slice(0, offset).split('\n').length
    hits.set(offset, { line, token, signature: token + ' | ' + lines[line - 1].trim() })
  }
  const inspect = (text, offset, patterns) => {
    for (const re of patterns) {
      for (const match of text.matchAll(re)) add(match[0], offset + match.index)
    }
  }
  const results = () => [...hits.entries()].sort(([a], [b]) => a - b).map(([, hit]) => hit)
  const inspectCss = (css, offset) => {
    postcss.parse(css, { from: file }).walkDecls(cssMotionProperty, declaration => {
      const value = declaration.raws.value?.raw ?? declaration.value
      const valueOffset = declaration.source.start.offset + declaration.prop.length + declaration.raws.between.length
      inspect(withoutCssComments(value), offset + valueOffset, [cssTiming])
    })
  }
  if (file.endsWith('.css')) {
    inspect(withoutCssComments(source), 0, [curve, utility])
    inspectCss(source, 0)
    return results()
  }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  let checker
  const inspected = new Set()
  const name = node => ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : undefined

  function inspectTransition(node) {
    if (!node || inspected.has(node)) return
    inspected.add(node)
    if (ts.isIdentifier(node)) {
      // Use TypeScript's lexical bindings so shadowed names resolve at the JSX use.
      checker ??= ts.createProgram([file], { noLib: true, noResolve: true }, {
        getSourceFile: path => path === file ? ast : undefined,
        getDefaultLibFileName: () => '', getCurrentDirectory: () => '',
        getCanonicalFileName: path => path, useCaseSensitiveFileNames: () => true,
        fileExists: path => path === file, readFile: path => path === file ? source : undefined,
        getNewLine: () => '\n', writeFile: () => {},
      }).getTypeChecker()
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration
      if (declaration && ts.isVariableDeclaration(declaration)) inspectTransition(declaration.initializer)
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      inspectTransition(node.expression)
    } else if (ts.isConditionalExpression(node)) {
      inspectTransition(node.whenTrue)
      inspectTransition(node.whenFalse)
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) inspectTransition(property.expression)
        if (!ts.isPropertyAssignment(property)) continue
        const key = name(property.name)
        const value = property.initializer
        const number = ts.isPrefixUnaryExpression(value) ? value.operand : value
        if ((key === 'duration' && ts.isNumericLiteral(number) && Number(number.text) !== 0)
          || (key === 'ease' && ts.isArrayLiteralExpression(value))) {
          add('inline motion ' + key, property.getStart(ast))
        } else if (key !== 'duration' && key !== 'ease') {
          inspectTransition(value)
        }
      }
    }
  }

  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateMiddle(node) || ts.isTemplateHead(node) || ts.isTemplateTail(node)) {
      const patterns = file.endsWith('.tsx') ? [curve, utility, inlineKeyframes] : [curve, utility]
      const text = node.getText(ast).slice(1, ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? -2 : -1)
      const offset = node.getStart(ast) + 1
      inspect(text, offset, patterns)
      if (ts.isNoSubstitutionTemplateLiteral(node) && cssDeclarationHint.test(text)) inspectCss(text, offset)
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'matchMedia' && node.arguments.length
        && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text.includes('prefers-reduced-motion')) {
      add('prefers-reduced-motion query', node.expression.getStart(ast))
    }
    if (ts.isJsxAttribute(node) && name(node.name) === 'transition' && node.initializer && ts.isJsxExpression(node.initializer)) {
      inspectTransition(node.initializer.expression)
    }
    if (ts.isPropertyAssignment(node) && name(node.name) === 'transition') {
      inspectTransition(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return results()
}

export function checkMotionMirror(css, expected) {
  const errors = []
  const seen = new Set()
  postcss.parse(css).walkDecls(/^--nomi-(?:duration|ease)-/, ({ prop, value }) => {
    if (seen.has(prop)) errors.push(`✗ motion mirror: duplicate ${prop}`)
    if (value.trim() !== expected[prop]) errors.push(`✗ motion mirror: ${prop} expected ${expected[prop]}, got ${value.trim()}`)
    seen.add(prop)
  })
  for (const [prop, value] of Object.entries(expected)) {
    if (!seen.has(prop)) errors.push(`✗ motion mirror: missing ${prop} (${value})`)
  }
  return errors
}

// Each exception describes one occurrence, not a quota that can be spent elsewhere.
export function compareMotionBaseline(file, hits, baseline) {
  const remaining = [...(baseline[file] ?? [])]
  const errors = []
  for (const hit of hits) {
    const index = remaining.indexOf(hit.signature)
    if (index < 0) errors.push(`${file}:${hit.line}  ${hit.token} — use src/design/motion.ts`)
    else remaining.splice(index, 1)
  }
  if (remaining.length) errors.push(`${file}: remove ${remaining.length} retired motion exception(s) from scripts/motion-token-baseline.json`)
  return errors
}
