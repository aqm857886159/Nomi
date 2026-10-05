// A5 事件旁路（plan 2026-08-11-mcp-conversation-native-p0）：execute 是全部持久化事件的
// 单一必经点——包一层向监听者（系统通知等）广播。钩子吞错，绝不影响制作主流程。
// 从 productionRunService 抽出（R9 分层：持久化装饰器不属于业务编排层）。

import type { ProductionRunRepository } from './productionRunRepository'
import type { ProductionRun, RunEvent } from './productionRunTypes'

export function withEventTap(
  repository: ProductionRunRepository,
  onEvents?: (events: RunEvent[], run: ProductionRun) => void,
): ProductionRunRepository {
  if (!onEvents) return repository
  return {
    ...repository,
    execute: (projectId, runId, runCommand) => {
      const result = repository.execute(projectId, runId, runCommand)
      try { onEvents(result.events, result.run) } catch { /* 通知钩子不许影响制作 */ }
      return result
    },
    // 一次落盘的一串命令：每一条的事件照样按顺序广播，监听者看到的与逐条执行相同。
    executeBatch: (projectId, runId, expectedRevision, commands) => {
      const results = repository.executeBatch(projectId, runId, expectedRevision, commands)
      for (const result of results) {
        try { onEvents(result.events, result.run) } catch { /* 通知钩子不许影响制作 */ }
      }
      return results
    },
  }
}
