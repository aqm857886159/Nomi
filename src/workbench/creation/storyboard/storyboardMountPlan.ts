import React from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { PlanShot } from '../../generationCanvas/agent/storyboardPlan'
import { shouldReduceMotion } from '../../../design/motion'

/**
 * 窗口化列表里，每一项这一帧挂「完整行」还是「轻量占位」。
 *
 * 为什么要分：完整的镜头行带 TipTap 编辑器、画布同款参数区、参考条，挂一行要几十毫秒。快速滚动时
 * 每一帧都有行进出视口，全挂完整行 = 滚动中不停建 / 拆编辑器，一串长任务（V-1210 首轮实测：100 次滚轮 96 个长任务）。
 * 规则（都只看这一帧的输入，纯函数）：
 *   - 已经是完整行的项，只要还挂着就一直是完整行（不降级：编辑器不会在用户眼前被拆掉）；
 *   - 钉住的项（焦点所在、正在拖）、组头：完整；
 *   - 滚动中新进来的镜头行：轻量占位；
 *   - 不在滚动时第一次进来的（打开方案、窗口变化、增删镜头）：直接完整；
 *   - 停下以后，占位按「视口里的先、缓冲区的后」每次升级 `budget` 个，调用方每帧再算一次，直到没有占位。
 */
export type MountPlanInput = {
  /** 这一帧挂着的项（虚拟列表给的顺序），带是否在视口内（不含缓冲）。 */
  items: readonly { key: string; kind: 'head' | 'shot'; inViewport: boolean }[]
  isScrolling: boolean
  /** 上一帧已是完整行 / 占位的项。 */
  previousFull: ReadonlySet<string>
  previousLight: ReadonlySet<string>
  pinned: ReadonlySet<string>
  /** 停下后每帧最多升级几个占位。 */
  budget?: number
}

type MountPlan = { full: Set<string>; light: Set<string> }

export function planItemMounts({ items, isScrolling, previousFull, previousLight, pinned, budget = 1 }: MountPlanInput): MountPlan {
  const full = new Set<string>()
  const light = new Set<string>()
  const waiting: { key: string; inViewport: boolean }[] = []
  for (const item of items) {
    if (item.kind === 'head' || previousFull.has(item.key) || pinned.has(item.key)) full.add(item.key)
    else if (!isScrolling && !previousLight.has(item.key)) full.add(item.key)
    else waiting.push(item)
  }
  let remaining = isScrolling ? 0 : budget
  const ordered = [...waiting.filter((item) => item.inViewport), ...waiting.filter((item) => !item.inViewport)]
  for (const item of ordered) {
    if (remaining > 0) { full.add(item.key); remaining -= 1 }
    else light.add(item.key)
  }
  return { full, light }
}

type Options = {
  tableRef: React.RefObject<HTMLDivElement | null>
  scrollRef: React.RefObject<HTMLElement | null> | undefined
  virtualizer: Virtualizer<HTMLElement, Element>
  mountedSignature: string
  shotKeyOf: (shot: PlanShot) => string
  itemIndexOfKey: (key: string) => number
  promptEditorOf: (row: HTMLElement) => HTMLElement | null
}

export function useStoryboardRowFocus({ tableRef, scrollRef, virtualizer, mountedSignature, shotKeyOf, itemIndexOfKey, promptEditorOf }: Options) {
  // 「聚焦第 N 镜」：先让那一项进视口（它可能还没挂），挂上之后再给焦点。
  // `nativeScroll`：聚焦时让浏览器把它滚进视口（键盘上下移）；否则视口已经由虚拟列表摆好（定位到某一镜，居中）。
  // `prompt`：焦点进这一镜的提示词编辑器（光标放末尾），否则落在行上。
  const [pendingFocus, setPendingFocus] = React.useState<{ itemKey: string; nativeScroll: boolean; prompt?: boolean; reveal?: boolean } | null>(null)
  const itemElementOf = React.useCallback((itemKey: string): HTMLElement | null =>
    tableRef.current?.querySelector<HTMLElement>(`[data-storyboard-item="${CSS.escape(itemKey)}"]`) ?? null, [tableRef])
  /** 交给虚拟列表按下标滚。续写时对齐行首，让短窗口也先露出提示词。 */
  const revealRow = (shot: PlanShot, target: 'row' | 'prompt'): boolean => {
    const itemKey = shotKeyOf(shot)
    const itemIndex = itemIndexOfKey(itemKey)
    if (itemIndex < 0) return false
    const prompt = target === 'prompt'
    const smooth = prompt && !shouldReduceMotion()
    virtualizer.scrollToIndex(itemIndex, { align: prompt ? 'start' : 'center', behavior: smooth ? 'smooth' : 'auto' })
    setPendingFocus({ itemKey, nativeScroll: false, prompt, reveal: prompt })
    return true
  }
  // 挂着哪几项一变（滚到了、那一行挂上了）就再找一次。
  React.useLayoutEffect(() => {
    if (pendingFocus === null) return
    const row = itemElementOf(pendingFocus.itemKey)?.querySelector<HTMLElement>('[data-storyboard-row]')
    if (!row) return
    // Finish against the mounted geometry before focus can scroll the editor's selection into view.
    const scroll = scrollRef?.current
    if (pendingFocus.reveal && scroll) {
      const viewport = scroll.getBoundingClientRect()
      const bounds = row.getBoundingClientRect()
      if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
        virtualizer.scrollToOffset(scroll.scrollTop + bounds.top - viewport.top, { behavior: 'instant' })
      }
    }
    const editable = pendingFocus.prompt ? promptEditorOf(row) : null
    if (editable) {
      editable.focus({ preventScroll: true })
      // 光标放到末尾（ProseMirror 跟随 DOM 选区）。
      const range = document.createRange()
      range.selectNodeContents(editable)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    } else row.focus({ preventScroll: !pendingFocus.nativeScroll })
    setPendingFocus(null)
  }, [itemElementOf, mountedSignature, pendingFocus, promptEditorOf, scrollRef, virtualizer])
  return { itemElementOf, pendingFocus, setPendingFocus, revealRow }
}
