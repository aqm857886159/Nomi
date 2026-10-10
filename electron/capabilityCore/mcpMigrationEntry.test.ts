// 结构测试：把宿主配置从 stdio 改成直连（迁移）只能从迁移询问卡的按钮发起。
//
// 「同意」不靠凭据（用户 2026-10-10 拍板方案 B，复盘 docs/plan/2026-10-10-mcp-migration-consent-and-leftovers-direction-check.md），
// 靠三件事：只有登记的主窗口主帧能调迁移 IPC（assertTrustedSender）、主进程在锁里逐个重核宿主资格、以及这里钉死的**唯一入口**：
// - 渲染端：生产代码里调迁移桥 `migrateMcpHosts` 的地方只有询问卡的两个处理函数（「改过去」与「再试一次」）；
// - IPC：迁移通道只在 preload 桥与主进程注册处出现；
// - 主进程：迁移写入函数只被那个 IPC 处理器调用；修复 / 启动修复 / 撤销（mcpConfig、appIntegration）连迁移模块都不 import。
// 复审 ① 最担心的就是「修复 / 切换到这里」按钮绕过同意改传输方式；有人另开入口，这里就红。
import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const MIGRATE_CHANNEL = 'nomi:capability:mcp-migrate'

const filesByRoot = new Map<string, string[]>()
const textByFile = new Map<string, string>()
const read = (file: string) => {
  if (!textByFile.has(file)) textByFile.set(file, fs.readFileSync(file, 'utf8'))
  return textByFile.get(file)!
}

/** 先按纯文本筛出提到 needle 的文件，再做 AST（全仓逐个解析太慢，满载时会顶到超时）。 */
function candidates(roots: string[], needle: string): string[] {
  return roots.flatMap((root) => sourceFiles(root)).filter((file) => read(file).includes(needle))
}

function sourceFiles(root: string): string[] {
  if (filesByRoot.has(root)) return filesByRoot.get(root)!
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !/\.(?:test|spec)\.|\.d\.ts$/.test(entry.name)) out.push(full)
    }
  }
  walk(path.join(repoRoot, root))
  filesByRoot.set(root, out)
  return out
}

const rel = (file: string) => path.relative(repoRoot, file).split(path.sep).join('/')

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

/** 调用点所在的最近一个具名函数（函数声明，或赋给 const 的箭头函数 / 函数表达式）。 */
function enclosingFunctionName(node: ts.Node): string {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
      return current.parent.name.text
    }
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text
  }
  return '<top-level>'
}

function callSites(roots: string[], calleeName: string): { file: string; fn: string }[] {
  const sites: { file: string; fn: string }[] = []
  for (const root of roots) {
    for (const file of candidates([root], calleeName)) {
      const sf = parse(file)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression
          const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null
          if (name === calleeName) sites.push({ file: rel(file), fn: enclosingFunctionName(node) })
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
  }
  return sites.sort((a, b) => `${a.file}:${a.fn}`.localeCompare(`${b.file}:${b.fn}`))
}

/** 代码里（不算注释）以字符串字面量出现过 value 的文件。 */
function filesWithLiteral(roots: string[], value: string): string[] {
  return candidates(roots, value).filter((file) => {
    let hit = false
    const visit = (node: ts.Node) => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === value) hit = true
      if (!hit) ts.forEachChild(node, visit)
    }
    visit(parse(file))
    return hit
  }).map(rel).sort()
}

/** import / export from / 动态 import / require 指向某个模块（按文件名尾段比）的文件。 */
function filesImporting(roots: string[], moduleBase: string): string[] {
  return candidates(roots, moduleBase).filter((file) => {
    let hit = false
    const matches = (spec: ts.Node | undefined) => Boolean(spec && ts.isStringLiteral(spec) && path.posix.basename(spec.text).replace(/\.[cm]?[jt]sx?$/, '') === moduleBase)
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && matches(node.moduleSpecifier)) hit = true
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && matches(node.arguments[0])) hit = true
      if (!hit) ts.forEachChild(node, visit)
    }
    visit(parse(file))
    return hit
  }).map(rel).sort()
}

describe('迁移只能从迁移询问卡的按钮发起', () => {
  it('渲染端：调迁移桥的生产代码只有询问卡的「改过去」与「再试一次」两个处理函数', () => {
    expect(callSites(['src'], 'migrateMcpHosts')).toEqual([
      { file: 'src/ui/onboarding/ConnectAssistantCard.tsx', fn: 'handleMigrate' },
      { file: 'src/ui/onboarding/ConnectAssistantCard.tsx', fn: 'handleRetryMigration' },
    ])
  })

  it('IPC：迁移通道只在 preload 桥与主进程注册处出现', () => {
    expect(filesWithLiteral(['src', 'electron'], MIGRATE_CHANNEL)).toEqual([
      'electron/capabilityCore/mcpProfiles.ts',
      'electron/preload/runtimeBridge.ts',
    ])
  })

  it('主进程：迁移写入函数只被迁移 IPC 的处理器调用；修复、启动修复、撤销不 import 迁移模块', () => {
    expect(callSites(['electron'], 'migrateMcpHostsToHttp')).toEqual([
      { file: 'electron/capabilityCore/mcpProfiles.ts', fn: 'registerCustomMcpProfileIpc' },
    ])
    expect(filesImporting(['electron', 'src'], 'mcpHostMigration')).toEqual(['electron/capabilityCore/mcpProfiles.ts'])
    const handler = fs.readFileSync(path.join(repoRoot, 'electron/capabilityCore/mcpProfiles.ts'), 'utf8')
    const block = handler.slice(handler.indexOf(`'${MIGRATE_CHANNEL}'`), handler.indexOf('})', handler.indexOf(`'${MIGRATE_CHANNEL}'`)))
    expect(block).toContain('assertTrustedSender(event)')
    expect(block).toContain('migrateMcpHostsToHttp(')
  })
})
