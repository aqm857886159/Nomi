import type { PendingSpendRead } from '../shared/contracts/pendingSpendConfirm'
import type { ProductionRun } from '../productionRun/productionRunTypes'
import { IN_APP_AGENT_ORIGIN_HOST } from '../productionRun/productionPendingSpend'
import { getProductionRunService, subscribeProductionRunChanges } from '../productionRun/productionRunRuntime'
import { watchSpendCardClose } from './laneSpendCardClose'
import { readPendingSpend, subscribeResidentSurfaceLifecycle } from '../capabilityCore/residentSurfaceLifecycle'
import { subscribePolicySpendDecisions } from '../capabilityCore/policySpendDecision'

// 「这个项目有一笔钱在等用户点头」进对话投影（2026-10-05 · 付费卡并进对话投影，B）。
//
// ── 它替掉的是什么 ──
//
// 此前面板每 1.5 秒拉一次 `pendingSpend`：渲染层手上是一份**副本**，什么时候刷新、刷新失败算什么、
// 动作之后要不要补刷，全靠渲染层自己记。14 天里这一带十几个 fix，多半是副本和账本对不上的某一个缝
// （设计卡 docs/plan/2026-10-05-paid-card-in-conversation.md §5）。
//
// 现在事实只在 Run 账本里，这里只做一件事：**账本一变就让对话投影重读一次**，和任务卡同一条路
// （`laneDesktopTasks.ts`）。读口只有 `residentSurfaceLifecycle.readPendingSpend` 一个。
//
// ── 什么时候重读 ──
//
//   · Agent 出价的 Run 变了（`origin.host === "nomi"` 才可能出卡），或此刻卡上那一笔所在的 Run 变了；
//   · 全自动代答收尾（释放不写账本，但代答失败时卡要回到原处）；
//   · 常驻生成面换相（能力核晚于窗口起来，起来那一刻卡要能出现）。
// 同一宏任务里的多次变更合成一次重读：「生成剩下 6 张」一口气写几十条事件，面板只需要最后那一份。
// 空闲时一次都不读（轮询时代是每 1.5 秒把项目里每个 Run 读一遍）。
//
// ── 回合也从这里知道卡关没关（`whenCardCloses`）──
//
// 此前回合靠进程内转接表等结论：卡上四个动作各自在事后手工递一句「关了」。
// 那是同一件事实的第三份副本，而且只认那四个动作——别的路把这次出价关掉（计划被取消……），回合就一直挂着。
// 现在回合直接看账本：**它等的那一次出价不再开着**，就是卡关了；逐镜结局照旧只问宿主（`readPresentationOutcome`）。

export function createDesktopLaneSpend(projectId: string, refresh: () => void) {
  let facts: PendingSpendRead | undefined
  let scheduled = false
  let disposed = false
  const shown = (): ReadonlySet<string> => new Set(facts?.surface === 'ready' ? facts.rows.map((row) => row.runId) : [])
  const invalidate = (): void => {
    if (disposed) return
    facts = undefined
    if (scheduled) return
    scheduled = true
    setImmediate(() => {
      scheduled = false
      if (!disposed) refresh()
    })
  }
  const relevant = (run: ProductionRun): boolean => run.projectId === projectId
    && (run.origin.host === IN_APP_AGENT_ORIGIN_HOST || shown().has(run.runId))
  const unsubscribers = [
    subscribeProductionRunChanges((run) => { if (relevant(run)) invalidate() }),
    subscribePolicySpendDecisions((changedProjectId) => { if (changedProjectId === projectId) invalidate() }),
    subscribeResidentSurfaceLifecycle(invalidate),
  ]
  const whenCardCloses = (operationId: string) => watchSpendCardClose({
    read: () => getProductionRunService().readFull(projectId, operationId).generationPlan,
    subscribe: (listener) => subscribeProductionRunChanges((run) => {
      if (run.projectId === projectId && run.runId === operationId) listener(run.generationPlan)
    }),
  })

  return {
    whenCardCloses,
    /** 对话投影每次发布时取一次；只在上面三种变化之后才真的重读。 */
    resolve: (): PendingSpendRead => {
      facts ??= readPendingSpend(projectId)
      return facts
    },
    dispose: (): void => {
      disposed = true
      for (const unsubscribe of unsubscribers) unsubscribe()
      facts = undefined
    },
  }
}
