// **词典外科手术**:按键路径从 src/i18n 的 zh/en 两棵树里删掉词条。
//
// 为什么要机器做:词典是「resources.ts 顶层内联命名空间 + locales/*.ts 各自导出的子树」拼起来的,
// 同一个键在 **zh 与 en 两份**里各有一处定义,而键归哪个文件要顺着 resources.ts 的 `ns: zhXxx` 赋值
// 才知道。手删既要跨文件找对地方,又要保证 zh/en 同删(漏一边 → check:i18n-key-parity 直接红),
// 几百条规模下必错。故走 AST:按路径定位、按行删、删完把空掉的父对象一并收走。
//
// 只被 check-i18n-dead-keys.ts 的 --prune 用。删哪些键由那道门岗的 **A 档**判定决定,本模块不做判断——
// 它只负责「给定键路径,准确地删干净」。

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/** 一棵子树的归属:哪个文件、哪个导出常量、挂在整棵键树的哪个前缀下。 */
type Owner = { file: string; identifier: string; basePath: string }

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function findExportedObject(sourceFile: ts.SourceFile, identifier: string): ts.ObjectLiteralExpression | null {
  let found: ts.ObjectLiteralExpression | null = null
  const walk = (node: ts.Node): void => {
    if (
      found === null &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === identifier &&
      node.initializer
    ) {
      let init: ts.Expression = node.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression // 剥 `as const`
      if (ts.isObjectLiteralExpression(init)) found = init
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return found
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(property)) return null
  const { name } = property
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteral(name)) return name.text
  return null
}

/**
 * 顺着 resources.ts 求「命名空间前缀 → 定义它的文件/导出名」。
 * `zhCN` 里 `browserAssets: zhBrowserAssets` 这种赋值,说明整棵 browserAssets.* 住在 locales/browserAssets.ts;
 * 内联的对象字面量则仍归 resources.ts 自己。
 */
function resolveOwners(rootDir: string, rootIdentifier: string): Owner[] {
  const resourcesFile = path.join(rootDir, 'src/i18n/resources.ts')
  const sourceFile = parse(resourcesFile)

  const importedFiles = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    const target = path.join(path.dirname(resourcesFile), `${statement.moduleSpecifier.text}.ts`)
    for (const element of bindings.elements) importedFiles.set(element.name.text, target)
  }

  const owners: Owner[] = [{ file: resourcesFile, identifier: rootIdentifier, basePath: '' }]
  const root = findExportedObject(sourceFile, rootIdentifier)
  if (!root) throw new Error(`resources.ts 里找不到导出常量 ${rootIdentifier}`)

  const walk = (object: ts.ObjectLiteralExpression, prefix: string): void => {
    for (const property of object.properties) {
      const name = propertyName(property)
      if (name === null || !ts.isPropertyAssignment(property)) continue
      const keyPath = prefix ? `${prefix}.${name}` : name
      if (ts.isObjectLiteralExpression(property.initializer)) {
        walk(property.initializer, keyPath)
      } else if (ts.isIdentifier(property.initializer)) {
        const file = importedFiles.get(property.initializer.text)
        if (file) owners.push({ file, identifier: property.initializer.text, basePath: keyPath })
      }
    }
  }
  walk(root, '')
  // 长前缀优先:'libraries.workflow' 这类更具体的归属要盖过 'libraries'。
  return owners.sort((a, b) => b.basePath.length - a.basePath.length)
}

function ownerFor(owners: Owner[], key: string): Owner | undefined {
  return owners.find((owner) => owner.basePath === '' || key === owner.basePath || key.startsWith(`${owner.basePath}.`))
}

function findByPath(object: ts.ObjectLiteralExpression, segments: string[]): ts.PropertyAssignment | null {
  let current: ts.ObjectLiteralExpression = object
  for (let i = 0; i < segments.length; i += 1) {
    const property = current.properties.find((p) => propertyName(p) === segments[i])
    if (!property || !ts.isPropertyAssignment(property)) return null
    if (i === segments.length - 1) return property
    let init: ts.Expression = property.initializer
    while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
    if (!ts.isObjectLiteralExpression(init)) return null
    current = init
  }
  return null
}

/**
 * 一个属性的删除区间:**整行**(含缩进与行尾换行),并吃掉紧跟的逗号。
 * 按行删而不是按节点删,是为了不留下空行与孤立缩进。
 * 紧贴在属性上方、同缩进的 `//` 注释一并带走——那是这条词条的说明,词条没了它就成了悬空注释。
 */
function deletionSpan(text: string, property: ts.PropertyAssignment, sourceFile: ts.SourceFile): { start: number; end: number } {
  let end = property.getEnd()
  while (end < text.length && text[end] !== ',' && text[end] !== '\n') end += 1
  if (text[end] === ',') end += 1
  while (end < text.length && text[end] !== '\n') end += 1
  if (end < text.length) end += 1 // 含换行

  const startLine = sourceFile.getLineAndCharacterOfPosition(property.getStart(sourceFile)).line
  let start = ts.getPositionOfLineAndCharacter(sourceFile, startLine, 0)

  // 上方连续的纯 `//` 注释行:属于这条词条的说明,一起删。
  let line = startLine - 1
  while (line >= 0) {
    const lineStart = ts.getPositionOfLineAndCharacter(sourceFile, line, 0)
    const lineEnd = text.indexOf('\n', lineStart)
    const content = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim()
    if (!content.startsWith('//')) break
    start = lineStart
    line -= 1
  }
  return { start, end }
}

/** 把一批区间从文本里删掉(倒序,避免前面的删除影响后面的偏移)。 */
function applySpans(text: string, spans: { start: number; end: number }[]): string {
  const sorted = [...spans].sort((a, b) => b.start - a.start)
  let output = text
  let lastStart = Number.POSITIVE_INFINITY
  for (const span of sorted) {
    if (span.end > lastStart) continue // 区间重叠(父子同时命中)——父的那次已经把子删掉了
    output = output.slice(0, span.start) + output.slice(span.end)
    lastStart = span.start
  }
  return output
}

/** 一轮删除:把命中的键从某个文件的某个导出常量里删掉。返回删掉的键数。 */
function pruneFromFile(file: string, identifier: string, basePath: string, keys: string[]): number {
  const sourceFile = parse(file)
  const root = findExportedObject(sourceFile, identifier)
  if (!root) return 0
  const text = sourceFile.getFullText()

  const spans: { start: number; end: number }[] = []
  let removed = 0
  for (const key of keys) {
    const relative = basePath === '' ? key : key.slice(basePath.length + 1)
    const property = findByPath(root, relative.split('.'))
    if (!property) continue
    spans.push(deletionSpan(text, property, sourceFile))
    removed += 1
  }
  if (removed > 0) fs.writeFileSync(file, applySpans(text, spans), 'utf8')
  return removed
}

/** 找出「删空了的父对象」——`foo: {}`,连同它一起收走,不留空壳命名空间。 */
function findEmptyObjectPaths(file: string, identifier: string, basePath: string): string[] {
  const sourceFile = parse(file)
  const root = findExportedObject(sourceFile, identifier)
  if (!root) return []
  const empty: string[] = []
  const walk = (object: ts.ObjectLiteralExpression, prefix: string): void => {
    for (const property of object.properties) {
      const name = propertyName(property)
      if (name === null || !ts.isPropertyAssignment(property)) continue
      const keyPath = prefix ? `${prefix}.${name}` : name
      if (!ts.isObjectLiteralExpression(property.initializer)) continue
      if (property.initializer.properties.length === 0) empty.push(basePath ? `${basePath}.${keyPath}` : keyPath)
      else walk(property.initializer, keyPath)
    }
  }
  walk(root, '')
  return empty
}

export type PruneResult = { file: string; identifier: string; removed: number }

/**
 * 从 zh/en 两棵树里删掉 `keys`,并把因此空掉的父对象一并收走(做到不动点)。
 * zh 与 en 用**同一份 keys**驱动,故天然保持 parity 对称。
 */
export function pruneDictionaryKeys(rootDir: string, keys: string[]): PruneResult[] {
  const results = new Map<string, PruneResult>()

  for (const rootIdentifier of ['zhCN', 'en']) {
    const owners = resolveOwners(rootDir, rootIdentifier)

    const grouped = new Map<Owner, string[]>()
    for (const key of keys) {
      const owner = ownerFor(owners, key)
      if (!owner) continue
      const list = grouped.get(owner)
      if (list) list.push(key)
      else grouped.set(owner, [key])
    }

    for (const [owner, ownedKeys] of grouped) {
      const removed = pruneFromFile(owner.file, owner.identifier, owner.basePath, ownedKeys)
      const id = `${owner.file}::${owner.identifier}`
      const existing = results.get(id)
      if (existing) existing.removed += removed
      else results.set(id, { file: owner.file, identifier: owner.identifier, removed })
    }

    // 空壳收尾:删到不动点(删空 a.b.c 可能让 a.b 也空掉)。
    for (let pass = 0; pass < 10; pass += 1) {
      let collapsed = 0
      for (const owner of owners) {
        const empties = findEmptyObjectPaths(owner.file, owner.identifier, owner.basePath)
        if (empties.length === 0) continue
        collapsed += pruneFromFile(owner.file, owner.identifier, owner.basePath, empties)
      }
      if (collapsed === 0) break
    }
  }

  return [...results.values()].sort((a, b) => a.file.localeCompare(b.file, 'en'))
}
