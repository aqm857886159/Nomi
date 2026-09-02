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
type Owner = {
  file: string
  identifier: string
  /** 这棵子树挂在整份键树的哪个前缀下。 */
  basePath: string
  /** 它在自己模块导出对象内部的路径(`...zhScene3d.coach` 这种带路径的展开才非空)。 */
  sourcePath: string
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

/** 剥掉包在对象字面量外面的类型外衣,拿到里面真正的对象。
 *  `en` 是 `{…} satisfies TranslationShape<typeof zhCN>`——少剥一层就整棵找不到。 */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
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
      const init = unwrap(node.initializer)
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
 * 指向某个 locale 模块的引用 → (导出名, 模块内路径)。四种写法同一套解析:
 *   `ns: zhFoo` / `...zhFoo` → (zhFoo, '')   ·   `ns: zhFoo.bar` / `...zhFoo.bar` → (zhFoo, 'bar')
 * 不是这两种形状则 null。
 */
function moduleTarget(expression: ts.Expression): { identifier: string; sourcePath: string } | null {
  const expr = unwrap(expression)
  if (ts.isIdentifier(expr)) return { identifier: expr.text, sourcePath: '' }
  if (!ts.isPropertyAccessExpression(expr)) return null
  const segments: string[] = []
  let current: ts.Expression = expr
  while (ts.isPropertyAccessExpression(current)) {
    segments.unshift(current.name.text)
    current = current.expression
  }
  return ts.isIdentifier(current) ? { identifier: current.text, sourcePath: segments.join('.') } : null
}

/**
 * 顺着 resources.ts 求「命名空间前缀 → 定义它的文件/导出名/模块内路径」。
 * 三种拼法都要认:
 *   · `browserAssets: zhBrowserAssets`——整棵 browserAssets.* 住在 locales/browserAssets.ts;
 *   · 内联对象字面量——仍归 resources.ts 自己;
 *   · **展开合并**——`scene3d: { ...zhScene3d, coach: { ...zhScene3d.coach, ...zhScene3dJourney.coach } }`。
 *     这种一个键可能被**多个模块**同时定义(后展开的覆盖先展开的),故 owner 是**多对一**:
 *     要删干净必须从每一个定义它的模块里都删掉,只删一处的话键会从另一处活回来。
 *     2026-09-01 踩过:漏了这条,scene3d 的 66 个键被静默跳过、prune 却报成功。
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

  const owners: Owner[] = [{ file: resourcesFile, identifier: rootIdentifier, basePath: '', sourcePath: '' }]
  const root = findExportedObject(sourceFile, rootIdentifier)
  if (!root) throw new Error(`resources.ts 里找不到导出常量 ${rootIdentifier}`)

  const addOwner = (target: { identifier: string; sourcePath: string } | null, basePath: string): void => {
    if (!target) return
    const file = importedFiles.get(target.identifier)
    if (file) owners.push({ file, identifier: target.identifier, basePath, sourcePath: target.sourcePath })
  }

  const walk = (object: ts.ObjectLiteralExpression, prefix: string): void => {
    for (const element of object.properties) {
      if (ts.isSpreadAssignment(element)) {
        addOwner(moduleTarget(element.expression), prefix)
        continue
      }
      const name = propertyName(element)
      if (name === null || !ts.isPropertyAssignment(element)) continue
      const keyPath = prefix ? `${prefix}.${name}` : name
      const init = unwrap(element.initializer)
      // `export: zhScene3dJourney.export` 这种「属性直接指到模块内某棵子树」与展开同源,走同一套解析。
      if (ts.isObjectLiteralExpression(init)) walk(init, keyPath)
      else addOwner(moduleTarget(init), keyPath)
    }
  }
  walk(root, '')
  return owners
}

/** 覆盖某个键的**全部** owner——展开合并下一个键可能有好几个定义处,少删一处它就活回来。 */
function ownersFor(owners: Owner[], key: string): Owner[] {
  return owners.filter((owner) => owner.basePath === '' || key === owner.basePath || key.startsWith(`${owner.basePath}.`))
}

/** 全局键路径 → 该 owner 模块内部的路径。 */
function inModulePath(owner: Owner, key: string): string {
  const relative = owner.basePath === '' ? key : key.slice(owner.basePath.length + 1)
  return owner.sourcePath ? `${owner.sourcePath}.${relative}` : relative
}

function findByPath(object: ts.ObjectLiteralExpression, segments: string[]): ts.PropertyAssignment | null {
  let current: ts.ObjectLiteralExpression = object
  for (let i = 0; i < segments.length; i += 1) {
    const property = current.properties.find((p) => propertyName(p) === segments[i])
    if (!property || !ts.isPropertyAssignment(property)) return null
    if (i === segments.length - 1) return property
    const init = unwrap(property.initializer)
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

/** 一轮删除:把一批**模块内路径**从某个文件的某个导出常量里删掉。返回真正删掉的那些路径。 */
function pruneFromFile(file: string, identifier: string, modulePaths: string[]): string[] {
  const sourceFile = parse(file)
  const root = findExportedObject(sourceFile, identifier)
  if (!root) return []
  const text = sourceFile.getFullText()

  const spans: { start: number; end: number }[] = []
  const removed: string[] = []
  for (const modulePath of modulePaths) {
    const property = findByPath(root, modulePath.split('.'))
    if (!property) continue
    spans.push(deletionSpan(text, property, sourceFile))
    removed.push(modulePath)
  }
  if (removed.length > 0) fs.writeFileSync(file, applySpans(text, spans), 'utf8')
  return removed
}

/** 找出「删空了的父对象」——`foo: {}`,连同它一起收走,不留空壳命名空间。返回模块内路径。 */
function findEmptyObjectPaths(file: string, identifier: string): string[] {
  const sourceFile = parse(file)
  const root = findExportedObject(sourceFile, identifier)
  if (!root) return []
  const empty: string[] = []
  const walk = (object: ts.ObjectLiteralExpression, prefix: string): void => {
    for (const property of object.properties) {
      const name = propertyName(property)
      if (name === null || !ts.isPropertyAssignment(property)) continue
      const keyPath = prefix ? `${prefix}.${name}` : name
      const init = unwrap(property.initializer)
      if (!ts.isObjectLiteralExpression(init)) continue
      if (init.properties.length === 0) empty.push(keyPath)
      else walk(init, keyPath)
    }
  }
  walk(root, '')
  return empty
}

export type PruneResult = { file: string; identifier: string; removed: number }
export type PruneReport = {
  results: PruneResult[]
  /** 一处都没删到的键。绝不静默吞掉——静默跳过会让 prune 报成功而键还在(踩过 scene3d 那 66 条)。 */
  unresolved: string[]
}

/**
 * 从 zh/en 两棵树里删掉 `keys`,并把因此空掉的父对象一并收走(做到不动点)。
 * zh 与 en 用**同一份 keys**驱动,故天然保持 parity 对称。
 */
export function pruneDictionaryKeys(rootDir: string, keys: string[]): PruneReport {
  const results = new Map<string, PruneResult>()

  // 先把两棵树的归属全解析、全校验一遍,再动手写。
  // 否则「zh 删完了、en 解析失败」会留下半改的词典(parity 直接红)——
  // 2026-09-01 实测踩过一次:en 是 `{…} satisfies …`,少剥一层就整棵找不到,当场删歪 310 行。
  const layout = ['zhCN', 'en'].map((rootIdentifier) => ({
    rootIdentifier,
    owners: resolveOwners(rootDir, rootIdentifier),
  }))
  for (const { rootIdentifier, owners } of layout) {
    for (const owner of owners) {
      if (!findExportedObject(parse(owner.file), owner.identifier)) {
        throw new Error(`${owner.file} 里找不到导出常量 ${owner.identifier}(${rootIdentifier} 树),已中止,未改任何文件`)
      }
    }
  }

  const deletedSomewhere = new Set<string>()

  for (const { owners } of layout) {
    // 一个键可能落在多个 owner(展开合并)——每处都要删。按 (文件,导出名) 归并,同一处的重复目标去重。
    const targets = new Map<string, { owner: Owner; paths: Map<string, string> }>()
    for (const key of keys) {
      for (const owner of ownersFor(owners, key)) {
        const id = `${owner.file}::${owner.identifier}`
        const entry = targets.get(id) ?? { owner, paths: new Map<string, string>() }
        entry.paths.set(inModulePath(owner, key), key)
        targets.set(id, entry)
      }
    }

    for (const [id, { owner, paths }] of targets) {
      const removed = pruneFromFile(owner.file, owner.identifier, [...paths.keys()])
      for (const modulePath of removed) {
        const key = paths.get(modulePath)
        if (key) deletedSomewhere.add(key)
      }
      const existing = results.get(id)
      if (existing) existing.removed += removed.length
      else results.set(id, { file: owner.file, identifier: owner.identifier, removed: removed.length })
    }

    // 空壳收尾:删到不动点(删空 a.b.c 可能让 a.b 也空掉)。
    const files = new Map<string, Owner>()
    for (const owner of owners) files.set(`${owner.file}::${owner.identifier}`, owner)
    for (let pass = 0; pass < 10; pass += 1) {
      let collapsed = 0
      for (const owner of files.values()) {
        const empties = findEmptyObjectPaths(owner.file, owner.identifier)
        if (empties.length === 0) continue
        collapsed += pruneFromFile(owner.file, owner.identifier, empties).length
      }
      if (collapsed === 0) break
    }
  }

  return {
    results: [...results.values()].filter((r) => r.removed > 0).sort((a, b) => a.file.localeCompare(b.file, 'en')),
    unresolved: keys.filter((key) => !deletedSomewhere.has(key)),
  }
}
