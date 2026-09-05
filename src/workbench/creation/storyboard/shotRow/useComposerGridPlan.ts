import React from 'react'
import { planComposerGrid, type ComposerGridPlan } from './composerGridLayout'

/**
 * 底栏列宽的**共享通道**：各行把自己量到的自然宽度报上来，作用域逐列取最大值、算一份 plan 发回去。
 * 作用域本体（provider 组件）住 `ComposerGridScope.tsx`；契约与 hook 住这里，
 * 组件文件才能只导出组件（react-refresh 规则）。
 */

export type ComposerGridRegistration = { natural: readonly number[]; available: number }

export type ComposerGridScopeApi = {
  report: (id: string, value: ComposerGridRegistration | null) => void
  plan: ComposerGridPlan | null
}

export const ComposerGridContext = React.createContext<ComposerGridScopeApi | null>(null)

/**
 * 报上自己这一行的自然宽度，拿回全表共用的 plan。
 * 没有作用域时就地按自己这一份算——设计实验室单行取景走的正是这条，同一套算法，不走第二条代码路径。
 */
export default function useComposerGridPlan(natural: readonly number[], available: number): ComposerGridPlan | null {
  const scope = React.useContext(ComposerGridContext)
  const id = React.useId()
  const report = scope?.report
  // signature 覆盖了 natural/available 的全部内容；直接依赖数组会因为每帧新引用而无限上报。
  const signature = `${available}|${natural.join(',')}`

  React.useEffect(() => {
    if (!report) return undefined
    if (natural.length === 0 || available <= 0) {
      report(id, null)
      return undefined
    }
    report(id, { natural, available })
    return () => report(id, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, id, signature])

  const local = React.useMemo(
    () => (natural.length === 0 ? null : planComposerGrid(natural, available)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature],
  )
  return scope?.plan ?? local
}
