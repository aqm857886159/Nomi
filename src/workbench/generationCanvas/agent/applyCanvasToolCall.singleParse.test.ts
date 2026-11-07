import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canvasWriteSemanticInputSchema } from '../../../../electron/shared/agentCapabilities/canvasWrite'
import { directorWriteSemanticInputSchema } from '../../../../electron/shared/agentCapabilities/directorWrite'
import { JSON_TEXT_BRANCH_MARKER } from '../../../../electron/shared/agentCapabilities/jsonArgTolerance'

// 2026-11-07：`applyCanvasToolCall` 里 director / patch_shots 两个分支原来各自再 safeParse 一次，失败只抛
// 一句「参数无效」——Zod 说了哪个字段错，这一句全吞了。删掉它的根据是下面两条，缺一条就该把校验搬回来：
//   ① 进这两个分支的唯一生产路是 `applyProposalBatch`，而它唯一的生产调用者 `canvasWriteTarget.ts`
//      交进来的 `effectiveArgs` 就是**同一个 schema** 的 `parsed.data`；
//   ② 这两个 schema 里没有会改值的节点（transform / preprocess / catch / pipe / lazy），parse 对自己的输出是恒等的——
//      第二次 parse 不可能失败，也不可能给出不同的值。refine 只判不改；default 只在缺值时补，第一次的输出里已经有值；
//      trim 这类字符串检查本身恒等。唯一允许的 transform 是「数组的 JSON 文本」那一支（`jsonArgTolerance`）：
//      它解出来的就是结构化那一支的输出，第二次 parse 走结构化那一支，值不变。
const ROOT = path.resolve(__dirname, '../../../..')

function productionSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...productionSources(full))
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

type ZodNode = { _def?: Record<string, unknown> & { typeName?: string; effect?: { type?: string }; schema?: { _def?: { description?: string } } } }
const VALUE_CHANGING = new Set(['ZodCatch', 'ZodPipeline', 'ZodLazy'])

/** 走遍 schema 树，收集会改值（或藏着看不见的子树）的节点类型名。 */
function valueChangingNodes(schema: unknown, seen = new Set<unknown>()): string[] {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return []
  seen.add(schema)
  const def = (schema as ZodNode)._def
  if (!def) return []
  const jsonTextBranch = def.typeName === 'ZodEffects' && def.effect?.type === 'transform'
    && Boolean(def.schema?._def?.description?.startsWith(JSON_TEXT_BRANCH_MARKER))
  const changes = (def.typeName === 'ZodEffects' && def.effect?.type !== 'refinement' && !jsonTextBranch)
    || (def.typeName !== undefined && VALUE_CHANGING.has(def.typeName))
  const found = changes ? [`${def.typeName}${def.effect?.type ? `:${def.effect.type}` : ''}`] : []
  const shape = typeof def.shape === 'function' ? (def.shape as () => Record<string, unknown>)() : undefined
  const children = [...Object.values(def), ...(shape ? Object.values(shape) : [])]
  for (const child of children) {
    if (Array.isArray(child)) for (const item of child) found.push(...valueChangingNodes(item, seen))
    else if (child instanceof Map) for (const item of child.values()) found.push(...valueChangingNodes(item, seen))
    else found.push(...valueChangingNodes(child, seen))
  }
  return found
}

describe('applyCanvasToolCall 不再做第二次校验：等价证明', () => {
  it('① applyProposalBatch 只有 canvasWriteTarget 一个生产调用者；带变量工具名调 applyCanvasToolCall 的只有 proposalTxn', () => {
    const files = productionSources(path.join(ROOT, 'src'))
    const batchCallers = files.filter((file) => /\bapplyProposalBatch\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file)).sort()
    expect(batchCallers).toEqual([
      'src/workbench/generationCanvas/agent/canvasWriteTarget.ts',
      'src/workbench/generationCanvas/agent/proposalTxn.ts',
    ])
    const dynamicCallers = files.filter((file) => /\bawait applyCanvasToolCall\(\s*[a-z]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file))
    expect(dynamicCallers).toEqual(['src/workbench/generationCanvas/agent/proposalTxn.ts'])
    const target = fs.readFileSync(path.join(ROOT, 'src/workbench/generationCanvas/agent/canvasWriteTarget.ts'), 'utf8')
    expect(target).toMatch(/directorWriteSemanticInputSchema\.safeParse\(request\.input\)/)
    expect(target).toMatch(/canvasWriteSemanticInputSchema\.safeParse\(request\.input\)/)
  })

  it('② 两个 schema 里没有会改值的节点，parse 对自己的输出恒等', () => {
    expect(valueChangingNodes(directorWriteSemanticInputSchema)).toEqual([])
    expect(valueChangingNodes(canvasWriteSemanticInputSchema)).toEqual([])
    const sample = { operation: 'patch_shots', select: { kind: 'indexes', indexes: [3, 1] }, patch: { promptAppend: '雨天' } }
    const once = canvasWriteSemanticInputSchema.parse(sample)
    expect(canvasWriteSemanticInputSchema.parse(once)).toEqual(once)
  })
})
