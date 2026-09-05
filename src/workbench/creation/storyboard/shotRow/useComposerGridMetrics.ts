import React from 'react'

/**
 * 量出底栏的两个输入：**每格内容的自然宽度**和**底栏可用宽度**。
 *
 * 两件事都必须真量，不能猜：
 *   - 自然宽度只能从内层 `w-max`（`width: max-content`）节点上读——外层格子被 grid 轨道定宽以后，
 *     读它读到的是轨道宽，把"内容要多宽"这个输入永久丢掉；
 *   - 可用宽度来自底栏自己的内容盒（`clientWidth` 减左右 padding），它由行 grid 的 `1fr` 决定，
 *     与底栏内容无关——所以量→排→量不会互相带动，没有反馈环。
 *
 * 容器变宽变窄（窗口缩放、侧栏开合）要重新判断断点，所以挂 `ResizeObserver`。
 */

export type ComposerGridMetrics = {
  barRef: React.RefCallback<HTMLDivElement>
  slotRef: (index: number) => React.RefCallback<HTMLDivElement>
  natural: number[]
  available: number
}

function contentWidthOf(element: HTMLElement): number {
  const style = getComputedStyle(element)
  const padding = Number.parseFloat(style.paddingLeft || '0') + Number.parseFloat(style.paddingRight || '0')
  return Math.max(0, element.clientWidth - padding)
}

export default function useComposerGridMetrics(slotCount: number): ComposerGridMetrics {
  const barNode = React.useRef<HTMLDivElement | null>(null)
  const slotNodes = React.useRef<(HTMLDivElement | null)[]>([])
  const [natural, setNatural] = React.useState<number[]>([])
  const [available, setAvailable] = React.useState(0)

  const measure = React.useCallback(() => {
    const bar = barNode.current
    if (!bar) return
    const widths = Array.from({ length: slotCount }, (_unused, index) => {
      const node = slotNodes.current[index]
      return node ? Math.ceil(node.getBoundingClientRect().width) : 0
    })
    setNatural((previous) =>
      previous.length === widths.length && previous.every((width, index) => width === widths[index])
        ? previous
        : widths)
    const width = Math.round(contentWidthOf(bar))
    setAvailable((previous) => (previous === width ? previous : width))
  }, [slotCount])

  // 内容换了（换模型/换模式 → 胶囊集合变了）也要重量，所以每次渲染后都跑一遍；
  // 量到的值没变时上面的 setState 会原样返回，不会触发第二轮渲染。
  React.useLayoutEffect(measure)

  const barRef = React.useCallback<React.RefCallback<HTMLDivElement>>((node) => {
    barNode.current = node
  }, [])

  React.useEffect(() => {
    const bar = barNode.current
    if (!bar || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => measure())
    observer.observe(bar)
    return () => observer.disconnect()
  }, [measure])

  const slotRef = React.useCallback(
    (index: number): React.RefCallback<HTMLDivElement> => (node) => {
      slotNodes.current[index] = node
    },
    [],
  )

  return { barRef, slotRef, natural, available }
}
