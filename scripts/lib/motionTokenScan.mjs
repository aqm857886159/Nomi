// Match utility boundaries, including variants and !important. Hyphenated domain IDs
// such as apply-transition-all are not Tailwind classes.
import ts from 'typescript'

const utility = /(?<![\w-])(?:duration-(?:\d+(?:\.\d+)?|\[[^\]\n]+\])|ease-(?:in-out|out|in|\[[^\]\n]+\])|transition-all)(?![\w-])/g
const curve = /\bcubic-bezier\s*\(/g
const inlineKeyframes = /@keyframes\b/g

export function isMotionSource(file) {
  return file.startsWith('src/') && /\.(?:tsx?|css)$/.test(file)
    && !/\.(?:spec|test|d)\.tsx?$/.test(file)
    && !/^src\/(?:devlab|vendor)\//.test(file)
    && !['src/design/motion.ts', 'src/theme/nomi-tokens.css'].includes(file)
}

export function scanMotionTokens(file, source) {
  const hits = []
  if (!isMotionSource(file) || !/duration-|ease-|transition-all|@keyframes|cubic-bezier|prefers-reduced-motion|transition\s*=/.test(source)) return hits
  const lines = source.split('\n')
  const add = (token, offset) => {
    const line = source.slice(0, offset).split('\n').length
    hits.push({ line, token, signature: token + ' | ' + lines[line - 1].trim() })
  }
  const inspect = (text, offset, patterns) => {
    for (const re of patterns) {
      for (const match of text.matchAll(re)) add(match[0], offset + match.index)
    }
  }
  if (file.endsWith('.css')) {
    const css = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    inspect(css, 0, [curve, utility])
    return hits
  }
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  function visit(node, inTransition = false) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateMiddle(node) || ts.isTemplateHead(node) || ts.isTemplateTail(node)) {
      const patterns = file.endsWith('.tsx') ? [curve, utility, inlineKeyframes] : [curve, utility]
      inspect(node.getText(ast), node.getStart(ast), patterns)
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'matchMedia' && node.arguments.length
        && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text.includes('prefers-reduced-motion')) {
      add('prefers-reduced-motion query', node.expression.getStart(ast))
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'transition') inTransition = true
    if (inTransition && ts.isPropertyAssignment(node)) {
      const key = node.name.getText(ast)
      if ((key === 'duration' && ts.isNumericLiteral(node.initializer) && Number(node.initializer.text) !== 0)
          || (key === 'ease' && ts.isArrayLiteralExpression(node.initializer))) add('inline motion ' + key, node.getStart(ast))
    }
    ts.forEachChild(node, child => visit(child, inTransition))
  }
  visit(ast)
  return hits
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
