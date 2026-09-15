import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const CALL_FUNCTION = /\b(?:callTool|callToolOrThrow|invokeTool|toolCall)\s*\(\s*(['"`])(nomi_[a-z0-9_]+)\1/g
const NAME_PROPERTY = /(?:['"]?name['"]?\s*:\s*)(['"`])(nomi_[a-z0-9_]+)\1/g
const MARKDOWN_EXECUTABLE_FENCE = /```(?:js|javascript|mjs|ts|typescript|mts|tsx)\s*\n([\s\S]*?)^```/gm

export const EXECUTABLE_EXTENSIONS = new Set(['.js', '.mjs', '.mts', '.ts', '.tsx'])

export function collectFiles(dir, { includeMarkdown = false } = {}) {
  if (!fs.existsSync(dir)) return []
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(full, { includeMarkdown }))
    else if (EXECUTABLE_EXTENSIONS.has(path.extname(entry.name)) || (includeMarkdown && entry.name.endsWith('.md')))
      files.push(full)
  }
  return files
}

export function executableUnits(source, file) {
  if (!file.endsWith('.md')) return [{ source, lineOffset: 0 }]
  const units = []
  for (const match of source.matchAll(MARKDOWN_EXECUTABLE_FENCE)) {
    const start = match.index ?? 0
    const lineOffset = source.slice(0, start).split('\n').length
    units.push({ source: match[1], lineOffset })
  }
  return units
}

// Group tokens by their immediate delimiter owner. Unlike a context window,
// this tolerates reordered fields, long values and incomplete excerpt syntax.
// TypeScript owns lexing so braces in comments/strings are not object boundaries.
function hostNamePositions(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  const K = ts.SyntaxKind
  const closing = new Map([
    [K.OpenBraceToken, K.CloseBraceToken],
    [K.OpenBracketToken, K.CloseBracketToken],
    [K.OpenParenToken, K.CloseParenToken],
  ])
  const stack = [{ tokens: [] }]
  const positions = new Set()
  for (let kind = scanner.scan(); kind !== K.EndOfFileToken; kind = scanner.scan()) {
    const group = stack[stack.length - 1]
    if (kind === K.CloseBraceToken && group.template) {
      // Resume template text after ${...}; its closing brace is not an object.
      if (scanner.reScanTemplateToken(false) === K.TemplateTail) stack.pop()
      continue
    }
    if (kind === K.TemplateHead) {
      stack.push({ tokens: [], template: true })
      continue
    }
    if (kind === group.close) {
      stack.pop()
      if (group.open !== K.OpenBraceToken) continue
      const fields = new Map()
      for (let i = 0; i < group.tokens.length - 2; i++) {
        const [key, colon, value] = group.tokens.slice(i, i + 3)
        if ((i === 0 || group.tokens[i - 1].kind === K.CommaToken) && colon.kind === K.ColonToken)
          fields.set(key.text, { key, value })
      }
      const type = fields.get('type')?.value
      const host =
        (type?.kind === K.StringLiteral && type.text === 'tool') ||
        (type?.kind === K.StringLiteral && type.text === 'toolCall' && fields.has('id') && fields.has('arguments')) ||
        ['intent', 'capabilityRefs', 'inputSchema', 'outputSchema'].every((key) => fields.has(key))
      const name = fields.get('name')
      if (host && name) positions.add(name.key.index)
      continue
    }
    group.tokens.push({
      kind,
      index: scanner.getTokenPos(),
      text: kind === K.StringLiteral ? scanner.getTokenValue() : scanner.getTokenText(),
    })
    if (closing.has(kind)) stack.push({ tokens: [], open: kind, close: closing.get(kind) })
  }
  return positions
}

/**
 * 静态入参形状（2026-09-15 补）：工具**名**对得上不等于**入参**对得上。
 *
 * #797 把 `nomi_timeline_read` / `nomi_media_query` / `nomi_document_edit` 的入参从
 * `operation` 改成派生（range / query / where），单测都改了，四个 e2e 调用点漏了——
 * CI 只在跑到那一条时才红（`capability_input_invalid`），而另外三处压根还没跑到。
 * 名字门岗当时是绿的：它只查名字。
 *
 * 所以这里再扫一层：紧跟在工具名后面的**字面量对象**的顶层键，必须都在该工具已发布的
 * 入参属性里。只判字面量——展开、变量、条件都跳过（判不出来就别假装判得出，静默通过比
 * 报假红更坏，所以跳过的那些不计入统计）。
 */
export function scanCallArgumentKeys(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source)
  const K = ts.SyntaxKind
  const OPEN = new Set([K.OpenBraceToken, K.OpenBracketToken, K.OpenParenToken])
  const CLOSE = new Set([K.CloseBraceToken, K.CloseBracketToken, K.CloseParenToken])
  const calls = []
  let pending = null
  let current = null
  let depth = 0
  /** 顶层「键位置」= 紧跟 `{` 或 `,` 之后的那个记号。 */
  let atKeyPosition = false
  /** 模板字面量的 `${` 会开一个「看起来像对象」的括号——和 hostNamePositions 同一个坑：
   *  不 reScanTemplateToken 续读，整个文件后面都会被错误分词（实测：不处理时全文件扫出 0 处）。 */
  let templates = 0
  for (let kind = scanner.scan(); kind !== K.EndOfFileToken; kind = scanner.scan()) {
    if (kind === K.TemplateHead) { templates += 1; continue }
    if (kind === K.CloseBraceToken && templates > 0) {
      if (scanner.reScanTemplateToken(false) === K.TemplateTail) templates -= 1
      continue
    }
    if (!current) {
      if (kind === K.StringLiteral) {
        const text = scanner.getTokenValue()
        pending = /^nomi_[a-z0-9_]+$/.test(text) ? { name: text, index: scanner.getTokenPos() } : null
        continue
      }
      if (kind === K.OpenBraceToken && pending) {
        current = { name: pending.name, index: pending.index, keys: [], spread: false }
        pending = null
        depth = 1
        atKeyPosition = true
        continue
      }
      if (kind !== K.CommaToken) pending = null
      continue
    }
    if (kind === K.CloseBraceToken) {
      depth -= 1
      if (depth === 0) { calls.push(current); current = null; continue }
      atKeyPosition = false
      continue
    }
    if (OPEN.has(kind)) { depth += 1; atKeyPosition = false; continue }
    if (CLOSE.has(kind)) { depth -= 1; atKeyPosition = false; continue }
    if (depth !== 1) continue
    if (kind === K.DotDotDotToken) { current.spread = true; atKeyPosition = false; continue }
    if (kind === K.CommaToken) { atKeyPosition = true; continue }
    if (atKeyPosition && (kind === K.Identifier || kind === K.StringLiteral)) {
      const key = kind === K.StringLiteral ? scanner.getTokenValue() : scanner.getTokenText()
      current.keys.push({ key, index: scanner.getTokenPos() })
      atKeyPosition = false
      continue
    }
    atKeyPosition = false
  }
  return calls.filter((call) => !call.spread)
}

export function scanSource(source, { declared, hostDeclared = new Set() }) {
  const references = []
  const hostPositions = hostNamePositions(source)
  const add = (match, kind, catalog) =>
    references.push({
      name: match[2] ?? match[1],
      index: match.index ?? 0,
      kind,
      catalog,
    })
  for (const match of source.matchAll(CALL_FUNCTION)) add(match, 'call', declared)
  for (const match of source.matchAll(NAME_PROPERTY))
    add(match, 'name', hostPositions.has(match.index ?? 0) ? hostDeclared : declared)
  const unique = new Map()
  for (const reference of references) unique.set(`${reference.index}:${reference.name}`, reference)
  return [...unique.values()].sort((a, b) => a.index - b.index)
}

export function scanFile(file, { declared, hostDeclared = new Set() }) {
  // Explicit UTF-8 keeps NUL-containing sources in the scan; grep without -a
  // silently skips those files.
  const source = fs.readFileSync(file, 'utf8')
  return executableUnits(source, file).flatMap(({ source: unit, lineOffset }) =>
    scanSource(unit, { declared, hostDeclared }).map((reference) => ({
      ...reference,
      line: lineOffset + unit.slice(0, reference.index).split('\n').length,
    })),
  )
}
