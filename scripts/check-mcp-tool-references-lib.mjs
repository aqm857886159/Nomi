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
  for (const match of source.matchAll(NAME_PROPERTY)) {
    const name = match[2] ?? match[1]
    // MCP fixtures often represent tools/call as `{type:"tool", name:"nomi_*"}`.
    // The structural host marker is still useful for non-MCP names, but a name
    // already present in the MCP resolver must be checked against that resolver
    // even when it is nested in a host-style reply object.
    add(match, 'name', declared.has(name) ? declared : (hostPositions.has(match.index ?? 0) ? hostDeclared : declared))
  }
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
