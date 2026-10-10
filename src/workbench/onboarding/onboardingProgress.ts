// 上手 4 步的进度（顶栏设置钮上的点 + 设置「通用」里那块清单共用这一份）。说明见 OnboardingChecklist.tsx 文件头。
import React from 'react'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { selectStableCanvasNodes } from '../generationCanvas/store/canvasNodeProjection'
import { useHasTextModel } from '../library/useHasTextModel'
import { useJourneyTourActive } from './journeyTourActivity'
import {
  type ChecklistStep,
  type ChecklistState,
  readChecklist,
  markChecklistStep,
  isChecklistDismissed,
  markChecklistDismissed,
  isChecklistExpired,
} from './onboardingState'

const ALL_KEYS: ChecklistStep[] = ['model', 'storyboard', 'generated', 'exported']
/** 两处（顶栏的点、设置里的清单）各挂一个 hook；一处「不再提示」靠这条事件让另一处同一刻对齐。 */
const ONBOARDING_SYNC_EVENT = 'nomi-onboarding-checklist-sync'

export type OnboardingProgress = {
  effective: ChecklistState
  doneCount: number
  total: number
  nextKey: ChecklistStep | null
  /** 清单还该不该出现（没做完、没关掉、没过期、引导旅途没在演）。 */
  active: boolean
  dismiss: () => void
}

export function useOnboardingProgress(): OnboardingProgress {
  // 清单只看 nodes.length>0 与「有没有 success 节点」，不读 position → 位置稳定投影（suspect #1）。
  const nodes = useGenerationCanvasStore(selectStableCanvasNodes)
  const { hasTextModel: textModelReady } = useHasTextModel()
  // 引导旅途进行时让位：清单是被动进度，tour 在演同一条流程。
  const journeyTourActive = useJourneyTourActive()
  const live = React.useMemo<ChecklistState>(
    () => ({
      model: textModelReady === true,
      storyboard: nodes.length > 0,
      generated: nodes.some((node) => node.status === 'success'),
      exported: false, // 导出 fire-and-forget 无 live 源，只走 TimelinePreview 持久标记
    }),
    [textModelReady, nodes],
  )
  const [persisted, setPersisted] = React.useState<ChecklistState>(() => readChecklist())
  const [dismissed, setDismissed] = React.useState<boolean>(() => isChecklistDismissed())

  // live 新达成 → 落盘 + 刷新；跨组件写盘（导出）靠 storage/focus 回读。
  React.useEffect(() => {
    let changed = false
    for (const key of ALL_KEYS) {
      if (live[key] && !persisted[key]) {
        markChecklistStep(key)
        changed = true
      }
    }
    if (changed) setPersisted(readChecklist())
  }, [live, persisted])

  React.useEffect(() => {
    const sync = () => {
      setPersisted(readChecklist())
      setDismissed(isChecklistDismissed())
    }
    window.addEventListener('storage', sync)
    window.addEventListener('focus', sync)
    window.addEventListener(ONBOARDING_SYNC_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener(ONBOARDING_SYNC_EVENT, sync)
    }
  }, [])

  const effective = React.useMemo<ChecklistState>(
    () => ({
      model: persisted.model || live.model,
      storyboard: persisted.storyboard || live.storyboard,
      generated: persisted.generated || live.generated,
      exported: persisted.exported || live.exported,
    }),
    [persisted, live],
  )
  const doneCount = ALL_KEYS.filter((key) => effective[key]).length
  const allDone = doneCount === ALL_KEYS.length

  // 首次显示落时间戳；满 2 天仍未完成 → 自动永久关闭（写持久标记，不再回来）。
  React.useEffect(() => {
    if (dismissed || allDone) return
    if (isChecklistExpired(Date.now())) {
      markChecklistDismissed()
      setDismissed(true)
    }
  }, [dismissed, allDone])

  const dismiss = React.useCallback(() => {
    markChecklistDismissed()
    setDismissed(true)
    // 设置里点「不再提示」→ 顶栏那个点同一刻消失（两处各挂一个 hook，靠这条事件对齐）。
    window.dispatchEvent(new Event(ONBOARDING_SYNC_EVENT))
  }, [])

  return {
    effective,
    doneCount,
    total: ALL_KEYS.length,
    nextKey: ALL_KEYS.find((key) => !effective[key]) ?? null,
    active: !allDone && !dismissed && !journeyTourActive,
    dismiss,
  }
}
