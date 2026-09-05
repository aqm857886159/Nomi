import React from 'react'
import { COMPOSER_GRID_SLOTS } from './composerBarModel'
import { planComposerGrid } from './composerGridLayout'
import { ComposerGridContext, type ComposerGridRegistration, type ComposerGridScopeApi } from './useComposerGridPlan'

/**
 * 底栏列宽的**共享作用域**（合同 v6 §2.3「所有行同一断点换行」）。
 *
 * 为什么需要它：每行的底栏各画各的 grid，`max-content` 只看得见自己那一行的内容——
 * 于是第 1 行的「模式」比第 2 行宽 20px，两行的「画幅」就错开 20px。表格最高的价值是
 * "扫一列看全片"，列错开就等于把这个价值扣掉。所以列宽必须**跨行取最大值**，
 * 换行断点也必须**全表共用一个**：一行换、别行不换，就再也对不齐了。
 *
 * 它只做三件事：收各行报上来的自然宽度 → 逐列取最大 → 算出一份 plan 发回给所有行。
 */

function sameRegistration(a: ComposerGridRegistration | undefined, b: ComposerGridRegistration): boolean {
  if (!a || a.available !== b.available || a.natural.length !== b.natural.length) return false
  return a.natural.every((width, index) => width === b.natural[index])
}

export default function StoryboardComposerGridScope({ children }: { children: React.ReactNode }): JSX.Element {
  const [entries, setEntries] = React.useState<ReadonlyMap<string, ComposerGridRegistration>>(() => new Map())

  const report = React.useCallback((id: string, value: ComposerGridRegistration | null) => {
    setEntries((previous) => {
      if (!value) {
        if (!previous.has(id)) return previous
        const next = new Map(previous)
        next.delete(id)
        return next
      }
      if (sameRegistration(previous.get(id), value)) return previous
      const next = new Map(previous)
      next.set(id, value)
      return next
    })
  }, [])

  const plan = React.useMemo(() => {
    const registrations = [...entries.values()]
    if (registrations.length === 0) return null
    const columns = COMPOSER_GRID_SLOTS.map((_slot, index) =>
      Math.max(...registrations.map((entry) => entry.natural[index] ?? 0)))
    // 可用宽度取**最小**的那一行：按最宽的算，最窄那行就又被压出截断。
    const available = Math.min(...registrations.map((entry) => entry.available))
    return planComposerGrid(columns, available)
  }, [entries])

  const api = React.useMemo<ComposerGridScopeApi>(() => ({ report, plan }), [report, plan])
  return <ComposerGridContext.Provider value={api}>{children}</ComposerGridContext.Provider>
}
