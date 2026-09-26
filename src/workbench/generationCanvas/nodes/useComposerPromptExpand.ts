import React from 'react'

/**
 * 提示词框右上角「展开」的状态（2026-09-25 用户拍板，参考 LibTV 提示词框右上角的展开图标）。
 *
 * 只在**收起时装不下**才给这颗钮：提示词短的时候它什么都展开不了，放着就是一颗点了没反应的控件
 * （§1.6 C1）。装不装得下只看滚动口自己——`scrollHeight > clientHeight`，由 ResizeObserver 在
 * 滚动口或内容尺寸变化时重判，不轮询、不量别的元素。展开态恒给钮（用来收起）。
 *
 * 展开是这一次选中的会话态，不落盘：换一个节点、取消选中再选中都回到收起，免得下次一选中就是一面墙。
 */
export function useComposerPromptExpand() {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [overflowing, setOverflowing] = React.useState(false)

  React.useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || typeof ResizeObserver === 'undefined') return
    const measure = () => setOverflowing(scroller.scrollHeight > scroller.clientHeight + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    for (const child of Array.from(scroller.children)) observer.observe(child)
    measure()
    return () => observer.disconnect()
  }, [expanded])

  const toggle = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    setExpanded((value) => !value)
  }, [])

  return { scrollRef, expanded, canToggle: expanded || overflowing, toggle }
}
