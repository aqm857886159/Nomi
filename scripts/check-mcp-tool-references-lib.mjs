import fs from 'node:fs'
import path from 'node:path'

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

function isHostFixture(source, index) {
  const before = source.slice(Math.max(0, index - 240), index)
  return /\btype\s*:\s*['"]tool['"][^}]{0,160}$/.test(before)
}

export function scanSource(source, { declared, hostDeclared = new Set() }) {
  const references = []
  const add = (match, kind, catalog) =>
    references.push({
      name: match[2] ?? match[1],
      index: match.index ?? 0,
      kind,
      catalog,
    })
  for (const match of source.matchAll(CALL_FUNCTION)) add(match, 'call', declared)
  for (const match of source.matchAll(NAME_PROPERTY))
    add(match, 'name', isHostFixture(source, match.index ?? 0) ? hostDeclared : declared)
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
