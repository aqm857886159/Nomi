import React from 'react'

/**
 * 「这一行还装得下几颗 chip」——**量出来的**，不是按字数估的。
 *
 * 为什么不能估：底栏能用的宽度不是一个常数。卡宽是 `w-max` 算出来的（最大 880px），
 * 而可用区还会被视口和常驻 Agent 面板真实挤窄（`useComposerViewportPlacement` 给的 maxWidth）。
 * 拿「每个字大约几像素」去估，等于在代码里埋一个只在某些字体/语言/缩放下成立的常数——
 * 中文标签、英文界面、系统字号放大各差一截，估错的那次表现为**底栏被裁掉一半**（卡是 overflow-hidden）。
 *
 * 判据（就一句）：**行内容比行本身宽 = 装不下**，于是退掉最后一颗，再量。
 * 退位规则本身（从尾巴退、不重排）在 `primaryParameterChips.planParameterChips` 里，这里只出数字。
 *
 * 为什么这个循环一定会停：退一颗 → 内容变窄 → 要么不再溢出（停），要么继续退到 0（停）。
 * 退位反过来会让卡变窄（`w-max`），而变窄**不**触发重新展开——只有变宽才重来一次，
 * 所以不会出现「退一颗→变窄→又加回来→又溢出」的抖动。
 *
 * 代价（诚实说清）：卡从窄变宽时，只有当宽度**真的变了**才会重新试着摆满。
 * 若可用区变宽而内容没跟着变宽（内容早已小于可用区），这一行会一直保持退位后的样子，
 * 直到换模型 / 换模式让控件集合变化为止。宁可这样，也不要为了「随时补回来」引入抖动。
 */
export function useFittedChipCount(
  ref: React.RefObject<HTMLElement | null>,
  total: number,
  options: { enabled?: boolean } = {},
): number {
  const enabled = options.enabled !== false
  const [visible, setVisible] = React.useState(total)
  // 控件集合换了（换模型 / 换模式 / 换变体）就重新摆满再量一次——上一个模型退过位，
  // 不该让下一个模型继承那个结果。
  React.useEffect(() => { setVisible(total) }, [total])

  const lastWidth = React.useRef(0)
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    const element = ref.current
    if (!enabled || !element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      const grew = width > lastWidth.current + 1
      lastWidth.current = width
      // 变宽 = 可用区多了 → 重新摆满再量；变窄 = 只需再量一次（可能要继续退）。
      if (grew) setVisible(total)
      setTick((value) => value + 1)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, enabled, total])

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    if (visible <= 0) return
    // 1px 容差：亚像素布局下 scrollWidth 会比 clientWidth 大零点几，那不是溢出。
    if (element.scrollWidth > element.clientWidth + 1) setVisible((count) => Math.max(0, count - 1))
  }, [ref, enabled, visible, tick, total])

  return enabled ? Math.min(visible, total) : total
}
