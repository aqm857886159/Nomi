// 弹窗读屏名字普查（2026-11-13，I-test-tighten-1113）。
//
// 这一类的根：Mantine 把对话框的 aria-labelledby 写死指向标题元素，所以 DesignModal 的 `title` 里放了名字之外的东西
// （副标、封面、按钮、链接）时，读屏会把整块念成名字。外壳给了 `accessibleName` 这个口子（src/design/overlays.tsx）。
// 规则：每个 <DesignModal>，`title` 只要不是纯文字（字符串、t(...) 调用、模板字符串、只包这几样的片段 / 三元），就必须同时传 `accessibleName`。
// 判据按机制：扫 AST，认 DesignModal 的导入别名，title 是变量时顺着同文件里的 const 找到它的初始值。
// 存量清单只许减少：清单里的弹窗已经合规了也红（豁免不许过期还留着）。清单为空是目标。
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = new URL('../', import.meta.url)

type Entry = { rel: string; source: ts.SourceFile }

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
  const walk = (node: ts.Node): void => {
    onNode(node)
    ts.forEachChild(node, walk)
  }
  walk(root)
}

/** 这个文件里 DesignModal 的本地名字（含 `import { DesignModal as X }`）。 */
function designModalLocalNames(entry: Entry): Set<string> {
  const names = new Set<string>()
  for (const statement of entry.source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === 'DesignModal') names.add(element.name.text)
    }
  }
  return names
}

const hasJsx = (node: ts.Node): boolean => {
  let found = false
  visit(node, (child) => {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) found = true
  })
  return found
}

/** 同文件顶层或函数内的 const / let 变量初始值（title={someVar} 时顺着找；找不到按纯文字算）。 */
function localInitializer(source: ts.SourceFile, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined
  visit(source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found = node.initializer
  })
  return found
}

/**
 * title 里「除了纯文字之外」装了什么：返回 undefined = 纯文字；否则返回一句话描述里面有什么元素。
 * 纯文字 = 字符串、模板字符串、t(...) 之类的调用、属性读取、只包这几样的片段 / 三元 / `??`。
 */
function titleExtras(source: ts.SourceFile, title: ts.Node | undefined): string | undefined {
  if (!title) return undefined
  const expression = ts.isJsxExpression(title) ? title.expression : title
  if (!expression) return undefined
  const tags = new Set<string>()
  const collect = (node: ts.Node): void => {
    visit(node, (child) => {
      if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) tags.add(child.tagName.getText(source))
    })
  }
  const inspect = (node: ts.Node, depth: number): void => {
    if (depth > 3) return
    if (ts.isIdentifier(node)) {
      const init = localInitializer(source, node.text)
      if (init && hasJsx(init)) inspect(init, depth + 1)
      return
    }
    if (hasJsx(node)) {
      // 只包文字的片段（<>{t('x')}</>）不算
      if (ts.isJsxFragment(node) || ts.isJsxElement(node)) {
        const children = ts.isJsxFragment(node) ? node.children : node.children
        const onlyText = ts.isJsxFragment(node) && children.every((c) => ts.isJsxText(c) || (ts.isJsxExpression(c) && !(c.expression && hasJsx(c.expression))))
        if (onlyText) return
      }
      collect(node)
    }
  }
  inspect(ts.isParenthesizedExpression(expression) ? expression.expression : expression, 0)
  return tags.size === 0 ? undefined : [...tags].sort().join(' ')
}

type Finding = { rel: string; line: number; extras: string; hasAccessibleName: boolean }

function findings(sources: readonly Entry[]): Finding[] {
  const out: Finding[] = []
  for (const entry of sources) {
    const names = designModalLocalNames(entry)
    if (names.size === 0) continue
    visit(entry.source, (node) => {
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return
      if (!names.has(node.tagName.getText(entry.source))) return
      let title: ts.Node | undefined
      let hasAccessibleName = false
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr)) continue
        const attrName = attr.name.getText(entry.source)
        if (attrName === 'title') title = attr.initializer
        if (attrName === 'accessibleName') hasAccessibleName = true
      }
      const extras = titleExtras(entry.source, title)
      if (extras === undefined) return
      out.push({ rel: entry.rel, line: entry.source.getLineAndCharacterOfPosition(node.getStart()).line + 1, extras, hasAccessibleName })
    })
  }
  return out
}

/** 今天主线上 title 不是纯文字、又没给 accessibleName 的弹窗（只许减少；补一处就从这里删一行）。文件 → 个数。 */
const MISSING_ACCESSIBLE_NAME_BASELINE: Record<string, number> = {
  'src/ui/app-shell/UpdateDialog.tsx': 1, // 图标 + 标题 + 副标（title 里除了名字还有副标文字）
  'src/ui/onboarding/CustomCallEditor.tsx': 1, // 标题 + 目标名两段文字（title={title}，title 在同文件上方是 span 套 span）
  'src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx': 1, // 图标 NomiLogoMark + 标题文字
  'src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx': 1, // 图标 + 标题 + 代理人提示行（title={header}）
}

const SOURCES = productionSources(SRC, 'src')

describe('弹窗读屏名字普查：title 不是纯文字就必须给 accessibleName', () => {
  it('每个 title 装了别的东西的 DesignModal 都传了 accessibleName（存量显式冻结，只许减少）', () => {
    const missing = findings(SOURCES).filter((f) => !f.hasAccessibleName)
    const counts: Record<string, number> = {}
    for (const f of missing) counts[f.rel] = (counts[f.rel] ?? 0) + 1
    const detail = missing.map((f) => `${f.rel}:${f.line}（title 里有 ${f.extras}）`)
    expect(counts, `这些弹窗的 title 里除了名字还放了别的元素，读屏会整块念成名字：给 DesignModal 加 accessibleName。\n${detail.join('\n')}`).toEqual(MISSING_ACCESSIBLE_NAME_BASELINE)
  })

  it('普查扫得到东西：已知三处（技能详情 / 手册 / 提示词提取设置）都被认出 title 带元素、且传了 accessibleName', () => {
    const covered = new Set(findings(SOURCES).filter((f) => f.hasAccessibleName).map((f) => path.posix.basename(f.rel)))
    for (const file of ['SkillDetail.tsx', 'HandbookPanel.tsx', 'BrowserPromptExtractionSettingsModal.tsx']) expect(covered.has(file), file).toBe(true)
  })

  describe('判据本身（造例子）', () => {
    const run = (code: string) => findings([{ rel: 'src/x.tsx', source: ts.createSourceFile('x.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }])
    const head = "import { DesignModal } from '../design'\n"
    it('纯文字不算：字符串、t()、模板字符串、三元、只包文字的片段', () => {
      expect(run(`${head}const A = () => <DesignModal title="x" />`)).toEqual([])
      expect(run(`${head}const A = () => <DesignModal title={t('a.b')} />`)).toEqual([])
      expect(run(`${head}const A = () => <DesignModal title={\`a\${n}\`} />`)).toEqual([])
      expect(run(`${head}const A = () => <DesignModal title={ok ? t('a') : t('b')} />`)).toEqual([])
      expect(run(`${head}const A = () => <DesignModal title={<>{t('a')}</>} />`)).toEqual([])
    })
    it('整块元素没给 accessibleName → 认出；给了 → 认出但标记已给', () => {
      const bad = run(`${head}const A = () => <DesignModal title={<div>名字<button>关</button></div>} />`)
      expect(bad).toHaveLength(1)
      expect(bad[0]).toMatchObject({ hasAccessibleName: false, extras: expect.stringContaining('button') })
      expect(run(`${head}const A = () => <DesignModal title={<div>名字<button>关</button></div>} accessibleName="名字" />`)[0]?.hasAccessibleName).toBe(true)
    })
    it('title 是变量、变量初始值是元素 → 也认；换了本地名字的导入也认', () => {
      expect(run(`${head}const A = () => { const head = <div><img src="x" />名字</div>; return <DesignModal title={head} /> }`)).toHaveLength(1)
      expect(run(`import { DesignModal as M } from '../design'\nconst A = () => <M title={<span><a href="x">名</a></span>} />`)).toHaveLength(1)
    })
  })
})
