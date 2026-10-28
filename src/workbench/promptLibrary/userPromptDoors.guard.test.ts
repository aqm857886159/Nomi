/**
 * 「我的库」提示词列表的门岗（源码扫描，按 TypeScript 语法树判，注释和字符串里提到名字不算）。
 *
 * 为什么是一条扫描测试：渲染层这份列表只有一个持有者（promptLibrary/userPromptCache.ts），靠的是
 * 「所有写入都经 promptLibraryApi 的写口，写口写完发布」。这条今天成立，是因为今天恰好没有第二个写入者；
 * 没有任何东西拦着以后有人：
 *   · 在渲染层绕过 API 直接调桥（那次写不会发布，屏上的列表又陈了）；
 *   · 在 API 里加一个新写口却忘了发布；
 *   · 在主进程加第二个写入者（比如 Agent 工具存提示词）——它的写渲染层根本看不见。出现它就红，逼着去加主进程广播。
 * 语法树里写口名字的数量是事实，不是约定，所以直接数。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const API_FILE = 'src/workbench/api/promptLibraryApi.ts'
const BRIDGE_FILE = 'src/desktop/bridge.ts'
const STORE_FILE = 'electron/promptLibrary/userPromptStore.ts'
const IPC_FILE = 'electron/promptLibrary/promptLibraryIpc.ts'
/** 并排安装时启动前整份拷贝这个 JSON，那时渲染层还没有，不算运行期写入者。 */
const SEED_FILE = 'electron/settings/sideBySideInstallSeed.ts'
const STORE_READERS = new Set(['listUserPrompts', 'resetUserPromptCache'])

type Source = { file: string; text: string }

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\.node-test\.[cm]?js$/
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/
const SKIPPED_DIRECTORY = new Set(['node_modules', 'dist', 'dist-electron', 'out', 'release', '__tests__', 'fixtures'])

function walk(directory: string, out: Source[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY.has(entry.name) && !entry.name.startsWith('.')) walk(absolute, out)
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push({ file: path.relative(repoRoot, absolute).split(path.sep).join('/'), text: fs.readFileSync(absolute, 'utf8') })
    }
  }
}

let cachedSources: Source[] | null = null
/** 渲染层和主进程的生产源码（不含测试）。 */
function productionSources(): Source[] {
  if (!cachedSources) {
    const out: Source[] = []
    for (const root of ['src', 'electron']) walk(path.join(repoRoot, root), out)
    cachedSources = out
  }
  return cachedSources
}

function sourceOf(file: string): ts.SourceFile {
  const text = fs.readFileSync(path.join(repoRoot, file), 'utf8')
  return parse(file, text)
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

/** 含其中任一字面量的生产文件（先用文本筛，再交语法树细判）。 */
function filesMentioning(...needles: string[]): Source[] {
  return productionSources().filter(({ text }) => needles.some((needle) => text.includes(needle)))
}

function lineOf(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

function propertyNameText(name: ts.PropertyName | undefined): string | null {
  if (!name) return null
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null
}

/** 桥上「我的库」的方法名（桥类型里 promptLibrary 的 user* 成员）。userList 是读口，其余是写口。 */
function bridgeUserMethods(): { all: string[]; writes: string[] } {
  const source = sourceOf(BRIDGE_FILE)
  const all: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node) && propertyNameText(node.name) === 'promptLibrary' && node.type && ts.isTypeLiteralNode(node.type)) {
      for (const member of node.type.members) {
        const name = ts.isPropertySignature(member) ? propertyNameText(member.name) : null
        if (name && /^user[A-Z]/.test(name)) all.push(name)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { all, writes: all.filter((name) => name !== 'userList') }
}

/** 语法树里对这些成员名的引用：`x.userAdd`、`x['userAdd']`、解构 `{ userAdd }`（调用、传递、取出来都算，不止调用）。 */
function memberReferences(root: ts.Node, source: ts.SourceFile, names: ReadonlySet<string>): Array<{ name: string; line: number }> {
  const found: Array<{ name: string; line: number }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && names.has(node.name.text)) found.push({ name: node.name.text, line: lineOf(node, source) })
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && names.has(node.argumentExpression.text)) {
      found.push({ name: node.argumentExpression.text, line: lineOf(node, source) })
    } else if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name
      if (ts.isIdentifier(key) && names.has(key.text)) found.push({ name: key.text, line: lineOf(node, source) })
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

function callsTo(root: ts.Node, name: string): number {
  let count = 0
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) count += 1
    ts.forEachChild(node, visit)
  }
  visit(root)
  return count
}

describe('我的库提示词列表 · 写入只有一条路（桥 → promptLibraryApi 写口 → 发布进共享缓存）', () => {
  const methods = bridgeUserMethods()

  it('桥类型里读到了「我的库」的方法（门岗不是空转）：一个读口 userList，和至少 userAdd / userUpdate / userDelete / userRestore 四个写口', () => {
    expect(methods.all).toContain('userList')
    expect(methods.writes).toEqual(expect.arrayContaining(['userAdd', 'userUpdate', 'userDelete', 'userRestore']))
  })

  it('渲染层生产代码里，碰桥上这些写口的只有 promptLibraryApi.ts（别处直接调桥，写完不会发布，抽屉又陈了）', () => {
    const writes = new Set(methods.writes)
    const offenders = filesMentioning(...methods.writes)
      .filter(({ file }) => file.startsWith('src/') && file !== API_FILE)
      .flatMap(({ file, text }) => {
        const source = parse(file, text)
        return memberReferences(source, source, writes).map(({ name, line }) => `${file}:${line} ${name}`)
      })
    expect(offenders, '写「我的库」只能调 promptLibraryApi 的 addUserPrompt / updateUserPrompt / deleteUserPromptWithSnapshot / restoreUserPrompt').toEqual([])
  })

  it('promptLibraryApi 里每个碰桥「我的库」方法的函数（读口 + 写口），收到的整表都经 acceptUserPromptList 发布；且它们确实包括 5 个已知口', () => {
    const source = sourceOf(API_FILE)
    const userMethods = new Set(methods.all)
    const touching: string[] = []
    const withoutPublish: string[] = []
    for (const statement of source.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name) continue
      if (memberReferences(statement, source, userMethods).length === 0) continue
      touching.push(statement.name.text)
      if (callsTo(statement, 'acceptUserPromptList') === 0) withoutPublish.push(statement.name.text)
    }
    expect(touching.sort()).toEqual(expect.arrayContaining(['addUserPrompt', 'deleteUserPromptWithSnapshot', 'fetchUserPrompts', 'restoreUserPrompt', 'updateUserPrompt']))
    expect(withoutPublish, '新增读口 / 写口照样走 acceptUserPromptList（先校验应答再发布），不要自己 map 完就返回').toEqual([])
  })

  it('publishUserPrompts 的调用方只有一个：promptLibraryApi 的 acceptUserPromptList（hook 或别处自己发布，就是第二个持有者）', () => {
    const callers: string[] = []
    for (const { file, text } of filesMentioning('publishUserPrompts')) {
      const source = parse(file, text)
      const visit = (node: ts.Node, enclosing: string): void => {
        const name = ts.isFunctionDeclaration(node) && node.name ? node.name.text : enclosing
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'publishUserPrompts') callers.push(`${file} ${enclosing}`)
        ts.forEachChild(node, (child) => visit(child, name))
      }
      visit(source, '(module)')
    }
    expect(callers).toEqual([`${API_FILE} acceptUserPromptList`])
  })
})

describe('我的库提示词列表 · 主进程里也只有一个写入者（出现第二个，渲染层已挂载的列表就看不见它的写）', () => {
  it('userPromptStore 的写函数（除读口 listUserPrompts 与测试复位之外的全部导出）只有 promptLibraryIpc.ts 在用', () => {
    const store = sourceOf(STORE_FILE)
    const writers = new Set<string>()
    for (const statement of store.statements) {
      const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      if (!exported) continue
      if (ts.isFunctionDeclaration(statement) && statement.name) writers.add(statement.name.text)
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) writers.add(declaration.name.text)
      }
    }
    for (const reader of STORE_READERS) writers.delete(reader)
    expect([...writers].sort()).toEqual(expect.arrayContaining(['addUserPrompt', 'deleteUserPrompt', 'restoreUserPrompt', 'updateUserPrompt']))

    const isStoreSpecifier = (specifier: ts.Expression | undefined): boolean =>
      Boolean(specifier && ts.isStringLiteralLike(specifier) && /(?:^|\/)userPromptStore(?:\.[cm]?[jt]sx?)?$/.test(specifier.text))
    const offenders: string[] = []
    for (const { file, text } of filesMentioning('userPromptStore')) {
      if (file === STORE_FILE || file === IPC_FILE) continue
      const source = parse(file, text)
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && isStoreSpecifier(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
          const bindings = node.importClause?.namedBindings
          const named = bindings && ts.isNamedImports(bindings) ? bindings.elements.filter((element) => !element.isTypeOnly) : null
          // 只读（listUserPrompts）不会让别处的列表变陈；默认 / 命名空间导入看不出用了哪个，一律按写入者算。
          const touchesWrite = !named || Boolean(node.importClause?.name) || named.some((element) => writers.has((element.propertyName ?? element.name).text))
          if (touchesWrite) offenders.push(`${file}:${lineOf(node, source)} import`)
        } else if (ts.isExportDeclaration(node) && isStoreSpecifier(node.moduleSpecifier)) {
          offenders.push(`${file}:${lineOf(node, source)} re-export`)
        } else if (ts.isCallExpression(node) && node.arguments.length > 0 && isStoreSpecifier(node.arguments[0])
          && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          offenders.push(`${file}:${lineOf(node, source)} dynamic import / require`)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(offenders, '主进程要写「我的库」：先在 promptLibraryIpc 以外加广播（技能库同款：写盘后广播、渲染层收到就重读），再改这条门岗').toEqual([])
  })

  it('存盘文件名 prompt-library-user 只出现在 userPromptStore（持有者）和并排安装的启动前拷贝里，别处直接写这个文件就是绕过持有者', () => {
    const holders = filesMentioning('prompt-library-user').map(({ file }) => file).sort()
    expect(holders).toEqual([SEED_FILE, STORE_FILE].sort())
  })
})

describe('我的库提示词列表 · 谁可以强制读盘', () => {
  it('refreshOnOpen（打开时重读一次）只有抽屉 PromptLibraryPanel 用；随点随挂的路径（生成框、/ 菜单）的预算是 0 次读盘，不能开', () => {
    const users = filesMentioning('refreshOnOpen').filter(({ file, text }) => {
      const source = parse(file, text)
      let used = false
      const visit = (node: ts.Node): void => {
        if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && propertyNameText(node.name as ts.PropertyName) === 'refreshOnOpen') used = true
        ts.forEachChild(node, visit)
      }
      visit(source)
      return used
    }).map(({ file }) => file)
    expect(users).toEqual(['src/workbench/promptLibrary/PromptLibraryPanel.tsx'])
  })
})
