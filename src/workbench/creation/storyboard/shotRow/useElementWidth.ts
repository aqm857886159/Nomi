import React from 'react'

/** `padding` = clientWidth（含内边距、不含滚动条）；`content` = 再减掉左右内边距。 */
type ElementWidthBox = 'padding' | 'content'

export function readElementWidth(element: HTMLElement, box: ElementWidthBox): number {
  if (box === 'padding') return element.clientWidth
  const style = getComputedStyle(element)
  return element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
}

/**
 * 量**某一个元素自己**有多宽（一条 ResizeObserver）。
 *
 * 调用方：分镜**行容器**量一次决定整组行走宽档还是窄档（`storyboardRowDensity.useStoryboardRowsDensity`，
 * 表格行区 / 参考卡行区各一次——不是每行一次）；导演台顶栏量自己决定收起哪些按钮（`RefineTopBar`）。
 *
 * 为什么是量、而不是一个容器查询断点：同一个容器宽度下，中文那行装得下、英文那行装不下
 * （`改图` vs `Text-to-image`），一个 CSS 常数表达不了这件事。判据必须带上这一行真正要渲染的
 * 那几个标签，而标签只有 JS 知道。
 *
 * 为什么不会抖：被观察的都是**外框**，而外框的宽度**不取决于它装了什么**——
 * bar 的宽度由提示词列给，行外壳的宽度由编辑器那条 `grid-cols-1` 给；
 * 两者都不会被自己的内容反过来撑宽，所以没有测量—布局的回环。
 * 它被提示词列撑满，提示词列是行网格的 `minmax(0,1fr)`，行网格又被
 * `StoryboardPlanEditor` 那条 `grid-cols-1` 钉在编辑器列宽上（2026-09-17 的根因修）。
 * 所以「挪走一枚胶囊」不会反过来改 bar 的宽度，没有测量—布局的回环。
 * 这也正是 2026-09-06 删掉的那套测量 hook 与这一条的区别：那套量的是内容、改的是行高
 * （一枚胶囊溢出就让整表行高抖），这一条量的是外框、改的是内容。
 *
 * 首帧返回 `null` = 还没量到。调用方此时**一枚都不挪**，按今天的样子渲染；
 * `useLayoutEffect` 在绘制前就能拿到第一个值，所以不会闪。
 *
 * `box = 'content'` 量的是内容宽（再减掉左右内边距）：素材库的滚动容器自带内边距，
 * 列数和卡宽要按卡片真正能占的那一截算（`PromptLibraryPanel` / `SkillLibraryPanel`）。
 */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>, box: ElementWidthBox = 'padding'): number | null {
  const [width, setWidth] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const read = (): void => {
      const next = readElementWidth(element, box)
      setWidth((previous) => (previous !== null && Math.abs(previous - next) < 1 ? previous : next))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, box])

  return width
}
