import type { GenerationPresentation, ProductionGenerationPlan } from '../productionRun/productionRunTypes'
import { currentPresentation, presentationIsOpen } from '../shared/productionGenerationPresentation'

// 回合等付费卡时，「卡关了没有」只问 Run 账本（2026-10-05，替掉进程内转接表 `spendDecisionWaiters`）。
// 纯函数：读和订阅都由调用方给——生产里是 Run 服务与它的变更订阅（`laneDesktopSpend.ts`），测试里是夹具账本。

/**
 * 卡关了之后，交给画布、还在交的那几镜最多再等多久落定（D2 第③步）。回执读结局时，交到一半的镜要么已经交到（在生成）、
 * 要么确定没发出去（没花钱）——不在派发半路上报「在生成」。等满了还在交的照「在交」说（它们已经绑上画布，可能花钱）。
 */
export const SETTLING_GRACE_MS = 15_000

function keyOf(presentation: GenerationPresentation): string {
  return `${presentation.openedAt}#${presentation.fromGate}`
}

/** 这一次出价的身份：开出来那一刻 + 它从哪道门开始算。 */
function openPresentationKey(plan: ProductionGenerationPlan | undefined): string | undefined {
  const presentation = currentPresentation(plan)
  return presentation && presentationIsOpen(plan) ? keyOf(presentation) : undefined
}

/** 回合在等的那一次出价里还有交给画布、没落定的镜。 */
function stillHandingOver(plan: ProductionGenerationPlan | undefined, key: string): boolean {
  const watched = plan?.presentations?.find((presentation) => keyOf(presentation) === key)
  return Boolean(watched?.handOvers?.some((entry) => !entry.settled))
}

/**
 * closed 在账本关卡时兑现，宿主随即撤下「待确认」。settled 等这次交接落定或宽限期结束，
 * 回合这时才读逐镜结局。停止回合也会结束等待、释放订阅。
 * 读和订阅都是同步的，中间插不进一次账本写入。
 * 这一笔读不出来（Run 没了）也算关了：回合随后问逐镜结局，读不到就照实说「结果要去核对」，不在这里干等。
 */
export function watchSpendCardClose(source: Readonly<{
  read(): ProductionGenerationPlan | undefined
  subscribe(listener: (plan: ProductionGenerationPlan | undefined) => void): () => void
  settlingGraceMs?: number
  signal?: AbortSignal
}>): Readonly<{ closed: Promise<void>; settled: Promise<void>; dispose: () => void }> {
  let initial: ProductionGenerationPlan | undefined
  try { initial = source.read() } catch { initial = undefined }
  const presentation = currentPresentation(initial)
  if (!presentation || source.signal?.aborted) {
    return { closed: Promise.resolve(), settled: Promise.resolve(), dispose: () => undefined }
  }
  const key = keyOf(presentation)
  let close!: () => void
  let settle!: () => void
  const closed = new Promise<void>((resolve) => { close = resolve })
  const settled = new Promise<void>((resolve) => { settle = resolve })
  let grace: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    if (grace) clearTimeout(grace)
    unsubscribe()
    source.signal?.removeEventListener('abort', finish)
  }
  const finish = (): void => {
    dispose()
    close()
    settle()
  }
  const update = (plan: ProductionGenerationPlan | undefined): void => {
    if (openPresentationKey(plan) === key) return
    close()
    if (!stillHandingOver(plan, key)) { finish(); return }
    grace ??= setTimeout(finish, source.settlingGraceMs ?? SETTLING_GRACE_MS)
  }
  const unsubscribe = source.subscribe(update)
  source.signal?.addEventListener('abort', finish, { once: true })
  update(initial)
  return { closed, settled, dispose }
}
