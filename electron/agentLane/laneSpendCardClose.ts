import type { ProductionGenerationPlan } from '../productionRun/productionRunTypes'
import { currentPresentation, presentationIsOpen } from '../shared/productionGenerationPresentation'

// 回合等付费卡时，「卡关了没有」只问 Run 账本（2026-10-05，替掉进程内转接表）。
// 纯函数：读和订阅都由调用方给——生产里是 Run 服务与它的变更订阅（`laneDesktopSpend.ts`），测试里是夹具账本。

/** 这一次出价的身份：开出来那一刻 + 它从哪道门开始算（和 `appIntegrationSpendConfirm.openPresentationOf` 同一个键）。 */
function openPresentationKey(plan: ProductionGenerationPlan | undefined): string | undefined {
  const presentation = currentPresentation(plan)
  return presentation && presentationIsOpen(plan) ? `${presentation.openedAt}#${presentation.fromGate}` : undefined
}

/**
 * 回合在等的那一次出价关了没有。调用那一刻它应当开着（刚 present 完）；之后只要账本里这一笔的当前出价
 * 不再是**同一次、开着的**，就兑现。读和订阅都是同步的，中间插不进一次账本写入。
 * 这一笔读不出来（Run 没了）也算关了：回合随后问逐镜结局，读不到就照实说「结果要去核对」，不在这里干等。
 */
export function watchSpendCardClose(source: Readonly<{
  read(): ProductionGenerationPlan | undefined
  subscribe(listener: (plan: ProductionGenerationPlan | undefined) => void): () => void
}>): Readonly<{ closed: Promise<void>; dispose: () => void }> {
  let watching: string | undefined
  try { watching = openPresentationKey(source.read()) } catch { watching = undefined }
  if (!watching) return { closed: Promise.resolve(), dispose: () => undefined }
  let settle!: () => void
  const closed = new Promise<void>((resolve) => { settle = resolve })
  const unsubscribe = source.subscribe((plan) => {
    if (openPresentationKey(plan) === watching) return
    unsubscribe()
    settle()
  })
  return { closed, dispose: unsubscribe }
}
