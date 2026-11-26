import path from 'node:path'
import ts from 'typescript'
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DesignModal, type DesignModalProps } from './overlays'

// 设计系统 §3.5「弹窗的高度与滚动」：标题栏和决定栏不滚，中间内容区自己滚；决定栏在任何窗口尺寸下都完整可见。
// 这里守外壳的结构：决定栏是中间滚动区的兄弟（不在滚动区里），三段是一列、只有中间那段会缩会滚。
const render = (props: Partial<DesignModalProps> = {}): string => renderToStaticMarkup(
  <MantineProvider env="test">
    <DesignModal opened onClose={() => undefined} title="title" {...props}>
      <p data-probe-body="">body</p>
    </DesignModal>
  </MantineProvider>,
)

const classTokens = (html: string, marker: string): string[] => {
  const match = html.match(new RegExp(`<[a-z]+[^>]*${marker}[^>]*>`))
  expect(match, `找不到 ${marker}`).not.toBeNull()
  return (match![0].match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/)
}

describe('DesignModal 外壳：高度与滚动归属（§3.5）', () => {
  it('决定栏住在中间滚动区之外，紧跟在它后面', () => {
    const html = render({ actions: <button type="button" data-probe-primary="">ok</button> })
    expect(html).toMatch(/<p data-probe-body="">body<\/p><\/div><div data-design-modal-actions="[^"]*"/)
    expect(html.indexOf('data-probe-primary')).toBeGreaterThan(html.indexOf('data-design-modal-actions'))
  })

  // 名字归外壳（2026-11-22）：title 只收一句文字，外壳把它放进 Modal.Title（Mantine 的 aria-labelledby 固定指向它）；
  // 名字之外的东西（图标、副标、封面、链接）走 header 插槽，摆在名字旁边、不进名字元素。挂载后的真名字由 dialogName.browser.test.ts 核。
  const titleElement = (html: string): string => html.match(/<h2[^>]*mantine-Modal-title[^>]*>([\s\S]*?)<\/h2>/)?.[0] ?? ''

  it('名字元素里只有 title 那一句：不带 aria-label、里面没有别的元素', () => {
    const element = titleElement(render({ title: '技能名' }))
    expect(element, '找不到标题元素').not.toBe('')
    expect(element).not.toMatch(/aria-label=/)
    expect(element.replace(/^<h2[^>]*>/, '').replace(/<\/h2>$/, '')).toBe('技能名')
  })

  it('header 插槽：插槽内容在标题栏里、名字元素外，名字元素被插槽原样摆进去', () => {
    const html = render({ title: '技能名', header: (title) => <div data-probe-slot="">{title}<p data-probe-subtitle="">一长段简介</p></div> })
    const element = titleElement(html)
    expect(element.replace(/^<h2[^>]*>/, '').replace(/<\/h2>$/, '')).toBe('技能名')
    expect(element).not.toContain('data-probe-subtitle')
    const header = html.match(/<header[^>]*mantine-Modal-header[\s\S]*?<\/header>/)?.[0] ?? ''
    expect(header, '找不到标题栏').not.toBe('')
    expect(header).toMatch(/data-probe-slot=""><h2[^>]*mantine-Modal-title[^>]*>技能名<\/h2><p data-probe-subtitle="">/)
  })

  it('不传决定栏就没有决定栏那一行', () => {
    expect(render()).not.toContain('data-design-modal-actions')
  })

  it('三段是一列：整块不滚，中间那段会缩、自己滚，决定栏不缩', () => {
    const html = render({ actions: <button type="button">ok</button> })
    expect(classTokens(html, 'data-design-modal-scroll')).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto']))
    expect(classTokens(html, 'data-design-modal-actions')).toContain('shrink-0')
    expect(classTokens(html, 'mantine-Modal-content')).toEqual(expect.arrayContaining(['flex', 'flex-col', 'overflow-hidden']))
    expect(classTokens(html, 'mantine-Modal-body')).toEqual(expect.arrayContaining(['flex', 'flex-col', 'min-h-0', 'flex-1', 'overflow-hidden']))
  })

  it('默认中间区不成列（内容里自带滚动的段落保持原高）；innerScroll 才成列、把高度分给内容', () => {
    const block = classTokens(render(), 'data-design-modal-scroll')
    expect(block).not.toContain('flex-col')
    expect(render()).toContain('data-design-modal-scroll="block"')
    const inner = render({ innerScroll: true })
    expect(classTokens(inner, 'data-design-modal-scroll')).toEqual(expect.arrayContaining(['flex', 'flex-col', 'min-h-0', 'overflow-y-auto']))
    expect(inner).toContain('data-design-modal-scroll="inner"')
  })
})

// 只沿名字走：classNames.title / header，以及 header(name) 中包住 name 的祖先。
// 同一组件里的模型名、作者、副标、正文允许有各自的省略策略。
it('DesignModal 调用方不能把标题限制为单行', () => {
  const files = ts.sys.readDirectory('src', ['.tsx', '.jsx'], ['**/*.test.*', '**/*.spec.*'])
    .filter(file => ts.sys.readFile(file)?.includes('DesignModal'))
  const program = ts.createProgram(files, { jsx: ts.JsxEmit.Preserve, allowJs: true, types: [], skipLibCheck: true, moduleResolution: ts.ModuleResolutionKind.Bundler })
  const checker = program.getTypeChecker()
  const violations = new Set<string>()
  const visited = new Set<ts.Node>()
  const children = (node: ts.Node, visit: (child: ts.Node) => void) => ts.forEachChild(node, visit)
  function declaration(node: ts.Node) {
    let symbol = checker.getSymbolAtLocation(node)
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
    return symbol?.valueDeclaration
  }
  function scanClasses(node: ts.Node) {
    if (visited.has(node)) return
    visited.add(node)
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const token = node.text.match(/(?:^|[\s:!])(truncate|whitespace-nowrap|text-ellipsis|line-clamp-1)(?=\s|$)/)?.[1]
      if (token) violations.add(`${path.relative(process.cwd(), node.getSourceFile().fileName)}: ${token}`)
    } else if (ts.isIdentifier(node)) {
      const def = declaration(node)
      if (def && (ts.isVariableDeclaration(def) || ts.isPropertyAssignment(def)) && def.initializer) scanClasses(def.initializer)
    } else children(node, scanClasses)
  }
  function scanClassMap(node: ts.Node) {
    if (ts.isShorthandPropertyAssignment(node)) {
      const def = checker.getShorthandAssignmentValueSymbol(node)?.valueDeclaration
      if (['title', 'header'].includes(node.name.text) && def && ts.isVariableDeclaration(def) && def.initializer) scanClasses(def.initializer)
    } else if (ts.isPropertyAssignment(node)) {
      if (['title', 'header'].includes(node.name.getText().replace(/['"]/g, ''))) scanClasses(node.initializer)
    } else if (ts.isIdentifier(node)) {
      const def = declaration(node)
      if (def && ts.isVariableDeclaration(def) && def.initializer) scanClassMap(def.initializer)
    } else children(node, scanClassMap)
  }
  function scanSlot(fn: ts.FunctionLikeDeclaration, binding: ts.Node) {
    const name = checker.getSymbolAtLocation(binding)
    if (!name || !fn.body || visited.has(binding)) return
    visited.add(binding)
    function findName(node: ts.Node) {
      if (node !== binding && ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === name) {
        for (let parent = node.parent; parent && parent !== fn; parent = parent.parent) {
          if (ts.isVariableDeclaration(parent)) scanSlot(fn, parent.name)
          if (ts.isJsxAttribute(parent)) {
            // 例如 header={(name) => <CustomCallTitle name={name} /> }：继续检查组件中摆放 name 的那一格。
            const tag = parent.parent.parent
            if (!ts.isJsxOpeningElement(tag) && !ts.isJsxSelfClosingElement(tag)) continue
            const propName = parent.name.getText()
            const component = declaration(tag.tagName)
            if (component && ts.isFunctionDeclaration(component)) {
              const props = component.parameters[0]?.name
              if (props && ts.isObjectBindingPattern(props)) {
                const prop = props.elements.find(p => (p.propertyName ?? p.name).getText() === propName)
                if (prop) scanSlot(component, prop.name)
              }
            }
          }
          if (ts.isJsxElement(parent)) {
            for (const attr of parent.openingElement.attributes.properties) {
              if (ts.isJsxAttribute(attr) && attr.name.getText() === 'className' && attr.initializer) scanClasses(attr.initializer)
            }
          }
        }
      }
      children(node, findName)
    }
    findName(fn.body)
  }
  function scanModal(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const def = declaration(node.tagName)
      if (!def || !ts.isFunctionDeclaration(def) || def.name?.text !== 'DesignModal') return
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer || !ts.isJsxExpression(attr.initializer)) continue
        const value = attr.initializer.expression
        if (!value) continue
        if (attr.name.getText() === 'classNames') scanClassMap(value)
        if (attr.name.getText() === 'header') {
          const def = declaration(value)
          const fn = def && ts.isVariableDeclaration(def) ? def.initializer : def ?? value
          if (fn && (ts.isArrowFunction(fn) || ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.parameters[0]) scanSlot(fn, fn.parameters[0].name)
        }
      }
    }
    children(node, scanModal)
  }
  for (const file of files) {
    const source = program.getSourceFile(file)
    if (source) scanModal(source)
  }
  expect([...violations].sort()).toEqual([])
})
