import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canvasWriteSemanticInputSchema } from './canvasWrite'

/**
 * 「新增 canvas write operation 必须在每个分派点登记」。
 *
 * 机制：一个 operation 从模型说出口到真正落地，要穿过 9 个分派点。其中大部分有 TypeScript
 * 穷尽性检查兜底（switch 不写 default、判别联合），**但有 4 处是裸字符串比较或字符串数组**——
 * 漏了它们编译照过、测试照绿，运行时该 operation 静默不生效或被中途拦掉，
 * 而且四处各自的失效样子还不一样（有的报权限、有的当无操作、有的根本到不了渲染层）。
 *
 * 2026-09-03 新增 patch_shots 时实测：漏 surfacePortPreloadBridge 的 allowlist → 调用被桥拦下；
 * 漏 mcpCapabilityProjection 的名单 → MCP 侧看不见；而 mcpCapabilityProjection 里那份名单
 * **在同一个文件里出现了两次**（一份语义两处定义），只补一处也不会有任何提示。
 *
 * 判据：schema 联合里的每个 operation 名，必须在下列每个无编译期保护的文件里出现过。
 * 这是「出现过」级别的弱判据——它证明不了逻辑对，只证明**没有人忘记这个文件**，
 * 而「忘记」正是这一类的失效方式。逻辑对不对由各自的行为测试负责。
 */
const REPO = path.resolve(__dirname, '..', '..', '..')

/**
 * 无编译期保护、且必须**列全**所有 operation 的分派点。
 *
 * 判据只对「完整分派表」成立：桥的 allowlist（少一个就被拦下）、MCP 的 operation 名单
 * （少一个就在 MCP 侧隐身）、闸的写权限映射（少一个就取不到判定）。
 */
const COMPLETE_DISPATCH_TABLES = [
  'electron/surfacePortPreloadBridge.ts',
  'electron/capabilityCore/mcpCapabilityProjection.ts',
  'src/workbench/generationCanvas/agent/gate.ts',
]

/**
 * **排除项，非遗漏**：`projectAgentExecutionCoordinator.ts` 里那处判断的是
 * 「哪些 operation 由渲染层自行处理」，是 opt-in **子集**而不是完整表——
 * 要求它列全会逼人把不该由渲染层处理的 operation 也加进去，那是把门岗变成错误的规范。
 * 它仍然是无编译期保护的裸字符串比较，风险真实存在，但机器判不出「这个新 operation
 * 该不该归渲染层」——那是设计判断。此处明标只能人判（playbook §15 的三种通用处置之一）。
 */
const HUMAN_JUDGEMENT_ONLY = 'electron/projectAgentHost/projectAgentExecutionCoordinator.ts'

/** 从判别联合里取出所有 operation 字面量。 */
function operationNames(): string[] {
  const union = (canvasWriteSemanticInputSchema as unknown as {
    _def: { schema: { _def: { options: Array<{ shape: { operation: { value: string } } }> } } }
  })._def.schema._def.options
  return union.map((option) => option.shape.operation.value)
}

describe('canvas write operation 覆盖', () => {
  const operations = operationNames()

  it('联合里至少有本次关心的这几个 operation（守卫：反射取值没取空）', () => {
    expect(operations).toEqual(expect.arrayContaining(['propose_storyboard_plan', 'patch_shots', 'create_canvas_nodes']))
  })

  it.each(COMPLETE_DISPATCH_TABLES)('%s 登记了全部 operation', (relative) => {
    const source = fs.readFileSync(path.join(REPO, relative), 'utf8')
    const missing = operations.filter((operation) => !source.includes(`"${operation}"`) && !source.includes(`'${operation}'`) && !source.includes(`${operation}:`))
    expect(missing).toEqual([])
  })

  it('人判排除项仍在原处（它搬家了这条注释就该重写）', () => {
    expect(fs.existsSync(path.join(REPO, HUMAN_JUDGEMENT_ONLY))).toBe(true)
  })
})
