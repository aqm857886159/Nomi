// 弹窗外壳上的 data-* 锚点冻结名单（dialogAnchorFreeze.ts）的守门测试。
//
// 扫 src 下全部 .tsx（不含测试与设计实验室）的 AST，认 DesignModal 的导入别名，收三处挂锚点的口子：
// · 直接写在 <DesignModal> 上的 data-* 属性（Mantine 把它落在弹窗根上）；
// · `frozenAnchors={{ … }}` 的键（落在对话框本体上）；
// · `closeButtonProps={{ … }}` 里 data-* 的键（含展开的对象字面量；落在关闭键上）。
// 名单外的一出现就红；名单里的在源码里找不到了也红（迁走了就从名单删一行）——名单只许变短。
import fs from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { FROZEN_DIALOG_ANCHORS } from './dialogAnchorFreeze'

const SRC = new URL('../', import.meta.url)
type Entry = { rel: string; source: ts.SourceFile }
type Hit = { anchor: string; file: string; on: 'root' | 'dialog' | 'close' }

function productionSources(dir: URL, base: string): Entry[] {
  return (fs.readdirSync(dir, { withFileTypes: true }) as fs.Dirent[]).flatMap((entry) => {
    const rel = `${base}/${entry.name}`
    if (entry.isDirectory()) return rel === 'src/devlab' ? [] : productionSources(new URL(`${entry.name}/`, dir), rel)
    if (!/\.tsx$/.test(entry.name) || /\.(?:test|spec)\.tsx$/.test(entry.name)) return []
    const text = fs.readFileSync(new URL(entry.name, dir), 'utf8')
    return [{ rel, source: ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }]
  })
}

function visit(root: ts.Node, onNode: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => { onNode(node); ts.forEachChild(node, walk) }
  walk(root)
}

function designModalLocalNames(entry: Entry): Set<string> {
  const names = new Set<string>()
  for (const statement of entry.source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) if ((element.propertyName ?? element.name).text === 'DesignModal') names.add(element.name.text)
  }
  return names
}

const keyText = (name: ts.PropertyName): string => (ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText())

/** 对象字面量里的键（展开的对象字面量也展开收）。展开的是变量时记一个「看不见」的标记，让测试报出来。 */
function objectKeys(expression: ts.Expression | undefined): string[] {
  if (!expression) return []
  if (ts.isParenthesizedExpression(expression)) return objectKeys(expression.expression)
  if (!ts.isObjectLiteralExpression(expression)) return ['<非对象字面量>']
  return expression.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) return [keyText(property.name)]
    if (ts.isSpreadAssignment(property)) return ts.isObjectLiteralExpression(property.expression) ? objectKeys(property.expression) : [`<展开 ${property.expression.getText()}>`]
    return []
  })
}

function scan(entries: Entry[]): Hit[] {
  const hits: Hit[] = []
  for (const entry of entries) {
    const names = designModalLocalNames(entry)
    if (names.size === 0) continue
    visit(entry.source, (node) => {
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return
      if (!names.has(node.tagName.getText(entry.source))) return
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue
        const name = attribute.name.getText(entry.source)
        const value = attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined
        if (name.startsWith('data-')) hits.push({ anchor: name, file: entry.rel, on: 'root' })
        if (name === 'frozenAnchors') for (const key of objectKeys(value)) hits.push({ anchor: key, file: entry.rel, on: 'dialog' })
        if (name === 'closeButtonProps') for (const key of objectKeys(value)) if (key.startsWith('data-') || key.startsWith('<')) hits.push({ anchor: key, file: entry.rel, on: 'close' })
      }
    })
  }
  return hits
}

const keyOf = (hit: Hit): string => `${hit.anchor} · ${hit.on} · ${hit.file}`

describe('弹窗外壳上的 data-* 锚点只许变少', () => {
  const found = [...new Set(scan(productionSources(SRC, 'src')).map(keyOf))].sort()
  const listed = FROZEN_DIALOG_ANCHORS.map((entry) => keyOf(entry)).sort()

  it('名单按锚点名排好、没有重复', () => {
    const names = FROZEN_DIALOG_ANCHORS.map((entry) => `${entry.anchor} · ${entry.file}`)
    expect(names).toEqual([...new Set(names)].sort())
  })

  it('源码里挂在弹窗外壳上的锚点，一个不多：名单外的新锚点 → 改用角色 + 名字或 testId', () => {
    expect(found.filter((hit) => !listed.includes(hit)), '外壳上出现了名单外的 data-* 锚点（找弹窗用 getByRole(\'dialog\', { name }) 或 testId）').toEqual([])
  })

  it('名单里的一个不少：迁走了就从 dialogAnchorFreeze.ts 删掉那一行', () => {
    expect(listed.filter((entry) => !found.includes(entry)), '名单里这些锚点在源码里已经找不到了').toEqual([])
  })

  it('扫描认得出三处口子（量具自检）', () => {
    const source = (text: string): Entry => ({ rel: 'src/x.tsx', source: ts.createSourceFile('src/x.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) })
    const hits = scan([source(`import { DesignModal as M } from './design'
      const CLOSE = { 'data-a': 'x' }
      export const A = () => <M title="t" data-root-anchor="1" frozenAnchors={{ 'data-spend-confirm-dialog': 'k' }} closeButtonProps={{ 'aria-label': 'x', ...{ 'data-close': '1' }, ...CLOSE }} />`)])
    expect(hits.map(keyOf).sort()).toEqual([
      '<展开 CLOSE> · close · src/x.tsx',
      'data-close · close · src/x.tsx',
      'data-root-anchor · root · src/x.tsx',
      'data-spend-confirm-dialog · dialog · src/x.tsx',
    ])
  })
})
