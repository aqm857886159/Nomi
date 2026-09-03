import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// 结构不变量：bare-Node MCP launcher 的传递 import 闭包里**一个 electron 值导入都不能有**。
//
// 为什么这条必须钉死（2026-08-18 真实 ship 事故）：mcpNodeLauncher 在打包后以 ELECTRON_RUN_AS_NODE=1
// 跑在 app.asar 里的裸 Node 上——那里**没有** electron 模块。任何被它 require 到的模块只要在顶层
// `require('electron')`，加载期就 MODULE_NOT_FOUND，整条 MCP 客户端当场死。dev/vitest 下 electron 能从
// node_modules 解析出来，所以本机永远不报——只有打包 smoke（tests/ux/packaged-mcp-smoke.e2e.mjs）会炸，
// 且直到 CI 才发现。de2e0fa6e8（T4 locale）就是这样让 mcpNodeLauncher→i18n.ts→`require('electron')` 破了这条
// 不变量却无人拦。此测试把「闭包 electron-free」从人肉 review 提升为编译前就红的结构门。
//
// 关键分辨（决定这测试对不对）：**只跟值边（value edge）**。`import type {...} from 'electron'` /
// `export type ...` / `import { type A } from 'x'`（全 type 绑定）在 tsc 编译后被抹掉，**不进运行时 require
// 闭包**，因此既不该跟进去、electron 的 type-only 导入也**允许**。只有会留到 .js 里的值导入才算数——这正是
// 打包后真正被加载的那张图。（反例：productionRunControl.ts 用 `import type { ProductionRunRepository }` 引到
// runtimePaths→`import { app } from 'electron'`，但那条边是 type-only、编译即消失，故不在裸 Node 闭包内。）

const here = path.dirname(fileURLToPath(import.meta.url))
const LAUNCHER = path.join(here, 'mcpNodeLauncher.ts')

/** 把相对 import 说明符解析成真实 .ts 源文件（.ts / .tsx / index.ts），非相对（裸包）返回 null。 */
function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

type Edge = { spec: string; typeOnly: boolean }

/**
 * 从一段 TS 源里抽出所有 `import ... from 'x'` 与 `export ... from 'x'`（re-export 是值边），并判定每条是否
 * type-only（编译期抹除）。判定覆盖三种 type-only 形态：
 *   ① `import type ... from 'x'`  ② `export type ... from 'x'`  ③ `import { type A, type B } from 'x'`（全 type 绑定）。
 * 注：`import { type A, B } from 'x'` 里有 B 是值绑定 → 整条算值边（会留到 .js）。
 */
function parseEdges(src: string): Edge[] {
  const edges: Edge[] = []
  const re = /^\s*(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(src)) !== null) {
    const leadingType = Boolean(match[1])
    const clause = match[2]
    const spec = match[3]
    let typeOnly = leadingType
    if (!typeOnly) {
      const braced = clause.trim()
      if (braced.startsWith('{') && braced.includes('type ')) {
        const inner = braced.replace(/^\{/, '').replace(/\}[^}]*$/, '')
        const parts = inner.split(',').map((p) => p.trim()).filter(Boolean)
        typeOnly = parts.length > 0 && parts.every((p) => p.startsWith('type '))
      }
    }
    edges.push({ spec, typeOnly })
  }
  return edges
}

/**
 * 从 launcher 出发按**值边**遍历相对 import 闭包，收集每个「值导入了 electron」的模块以及最短引入链。
 * 只跟值边 ⇒ 遍历到的就是打包后真正 require 的那张图；type-only 边跳过（编译即消失）。
 */
function findElectronValueImports(entry: string): { file: string; chain: string[] }[] {
  const visited = new Set<string>()
  const offenders: { file: string; chain: string[] }[] = []
  const rel = (f: string) => path.relative(path.resolve(here, '../..'), f)

  const walk = (file: string, chain: string[]): void => {
    if (visited.has(file)) return
    visited.add(file)
    const edges = parseEdges(fs.readFileSync(file, 'utf8'))
    for (const edge of edges) {
      if (edge.spec === 'electron' && !edge.typeOnly) {
        offenders.push({ file, chain: [...chain, rel(file)] })
      }
      if (edge.typeOnly) continue // type-only 边编译期抹除 → 不进运行时闭包，不跟
      const resolved = resolveRelative(file, edge.spec)
      if (resolved) walk(resolved, [...chain, rel(file)])
    }
  }

  walk(entry, [])
  return offenders
}

describe('mcpNodeLauncher 值导入闭包 —— electron-free 结构不变量', () => {
  it('launcher 传递闭包（仅值边）里没有任何模块值导入 electron', () => {
    const offenders = findElectronValueImports(LAUNCHER)
    const detail = offenders
      .map((o) => `  · ${o.file} 值导入了 'electron'（引入链：${o.chain.join(' → ')}）`)
      .join('\n')
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `bare-Node MCP launcher 的运行时 import 闭包出现了 electron 值导入，打包后会 MODULE_NOT_FOUND：\n${detail}\n` +
            `修法：把这些模块里被 launcher 用到的纯逻辑抽到零 electron 顶层导入的模块（见 electron/desktopLocale.ts 的做法），` +
            `或把仅取类型的导入改成 \`import type\`。`,
    ).toEqual([])
  })

  // 打包态生成门确认必须可用：mcpNodeLauncher 必须向 createMcpProtocol 传 confirmGenerationInNomi。
  // 缺失 → 打包态 nomi_operation_gate 恒返回 human_approval_required（开发态不复现，因 mcpStdioServer 有它）。
  // 这条结构断言阻止该回归静默进入打包产物（2026-09-03 首发修复）。
  it('launcher 的 createMcpProtocol 调用包含 confirmGenerationInNomi 字段', () => {
    const src = fs.readFileSync(LAUNCHER, 'utf8')
    expect(
      src.includes('confirmGenerationInNomi'),
      'mcpNodeLauncher 的 createMcpProtocol 调用缺少 confirmGenerationInNomi。' +
      '缺失会导致打包态 nomi_operation_gate 恒返回 human_approval_required（开发态不复现）。' +
      '修法：向 createMcpProtocol 传入 confirmGenerationInNomi，通过 callViaRpc 把挑战令牌转给 GUI 进程。',
    ).toBe(true)
  })
})
