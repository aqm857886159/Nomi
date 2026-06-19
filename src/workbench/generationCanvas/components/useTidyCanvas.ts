// 「一键整理」交互态（从 GenerationCanvas 抽出，R9/R12 防巨壳）。
// 管整理动作 + 滑入过渡的临时开关：整理瞬间给节点容器开 transform 过渡让节点滑入归位，
// ~600ms 后关掉——**只在整理瞬间开**，否则拖拽时 transform 过渡会让节点迟滞跟手（手感 bug）。
import React from 'react'
import { toast } from '../../../ui/toast'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const TIDY_ANIM_MS = 600

export function useTidyCanvas(categoryId: string): { isTidying: boolean; tidy: (targetAspect: number) => void } {
  const tidyCategory = useGenerationCanvasStore((state) => state.tidyCategory)
  const [isTidying, setIsTidying] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current) }, [])

  const tidy = React.useCallback(
    (targetAspect: number) => {
      setIsTidying(true)
      tidyCategory(categoryId, targetAspect)
      toast('已整理 · ⌘Z 撤销', 'info')
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setIsTidying(false), TIDY_ANIM_MS)
    },
    [categoryId, tidyCategory],
  )

  return { isTidying, tidy }
}
