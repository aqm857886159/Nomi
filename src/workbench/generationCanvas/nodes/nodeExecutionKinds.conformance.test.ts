// 插件注册表上的 `executionKind` 与中立层词表 `NODE_EXECUTION_KIND_BY_NODE_KIND` 必须逐字一致（双向）。
//
// 主进程的 Agent 工具面按中立层词表拒绝「用 arrange_canvas 造生成类节点」；渲染层按插件表决定节点能不能跑。
// 两边说的必须是同一件事，否则模型被拒的那种节点用户手动却能跑（或反过来）。
import { describe, expect, it } from 'vitest'

import { NODE_EXECUTION_KIND_BY_NODE_KIND } from '../../../../electron/shared/canvas/nodeExecutionKinds'
import { GENERATION_NODE_PLUGINS } from './registry'

describe('generation node execution kinds · one vocabulary', () => {
  it('every plugin with an executionKind matches the shared table, and the table names no unknown kind', () => {
    const fromPlugins = Object.fromEntries(
      GENERATION_NODE_PLUGINS.flatMap((plugin) => {
        if (!('executionKind' in plugin) || !plugin.executionKind) return []
        const executionKind = plugin.executionKind
        return [[plugin.kind, executionKind]]
      }),
    )
    expect(fromPlugins).toEqual(NODE_EXECUTION_KIND_BY_NODE_KIND)
    const kinds = new Set(GENERATION_NODE_PLUGINS.map((plugin) => plugin.kind as string))
    for (const kind of Object.keys(NODE_EXECUTION_KIND_BY_NODE_KIND)) expect(kinds.has(kind), kind).toBe(true)
  })
})
