// 回合等付费卡：「卡关了没有」只看账本里**这一次出价**（2026-10-05，替掉转接表）。
import { describe, expect, it } from 'vitest'
import type { GenerationPresentation, ProductionGenerationPlan } from '../productionRun/productionRunTypes'
import { watchSpendCardClose } from './laneSpendCardClose'

const open = (openedAt = 't1', fromGate = 0): GenerationPresentation => ({ shotIds: ['shot-1'], openedAt, fromGate })
const plan = (...presentations: GenerationPresentation[]) => ({ presentations } as unknown as ProductionGenerationPlan)
const closed = (presentation: GenerationPresentation, by: 'resolved' | 'user_closed' | 'stopped' = 'resolved'): GenerationPresentation =>
  ({ ...presentation, closed: { at: 't9', by } })

function ledger(initial: ProductionGenerationPlan | undefined) {
  let current = initial
  const listeners = new Set<(value: ProductionGenerationPlan | undefined) => void>()
  return {
    source: { read: () => current, subscribe: (listener: (value: ProductionGenerationPlan | undefined) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    write: (next: ProductionGenerationPlan | undefined) => { current = next; for (const listener of [...listeners]) listener(next) },
    listeners,
  }
}
const settled = async (promise: Promise<void>) => Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10))])

describe('watchSpendCardClose', () => {
  it('同一次出价还开着（换报价、去掉一镜都只是改它）→ 不醒；它关了 → 醒，并退订', async () => {
    const card = open()
    const book = ledger(plan(card))
    const watch = watchSpendCardClose(book.source)
    book.write(plan({ ...card, removed: [{ shotId: 'shot-2', at: 't2' }] }))
    expect(await settled(watch.closed)).toBe(false)
    book.write(plan(closed(card, 'user_closed')))
    expect(await settled(watch.closed)).toBe(true)
    expect(book.listeners.size).toBe(0)
  })

  it('关掉又被重新出价（新的一次出价）→ 也算这一次关了：回合等的是那一次，不是这一份计划', async () => {
    const card = open('t1', 0)
    const book = ledger(plan(card))
    const watch = watchSpendCardClose(book.source)
    book.write(plan(closed(card), open('t5', 1)))
    expect(await settled(watch.closed)).toBe(true)
  })

  it('开始看的那一刻已经关了 / 读不出来 → 立刻醒（用户手快，结论已经在账本里）', async () => {
    expect(await settled(watchSpendCardClose(ledger(plan(closed(open()))).source).closed)).toBe(true)
    expect(await settled(watchSpendCardClose(ledger(undefined).source).closed)).toBe(true)
    expect(await settled(watchSpendCardClose({ read: () => { throw new Error('run gone') }, subscribe: () => () => undefined }).closed)).toBe(true)
  })

  it('不看了（回合被停 / 打了字）→ 退订，之后关卡不再惊动它', async () => {
    const card = open()
    const book = ledger(plan(card))
    const watch = watchSpendCardClose(book.source)
    watch.dispose()
    expect(book.listeners.size).toBe(0)
  })
})
