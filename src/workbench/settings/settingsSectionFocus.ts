import { tabbable } from 'tabbable'

/**
 * 设置深链（`nomi-open-settings` 带 `section`）把焦点落进那一节。
 *
 * 那一节归别的组件渲染，什么时候挂出来设置对话框说了不算：「模型」页是懒加载的，第一次打开设置时那一节要等分块
 * 下载完才出现（2026-10-27 走查实测约 0.35 秒；进过设置之后也要晚两三帧）。以前对话框在自己的状态变化那一刻试一次，
 * 那一节还不在，焦点就一直留在对话框后面的页面上——而且不报错（docs/fixes/2026-10-27-agent-composer-focus.root-cause.json）。
 * 所以每帧试一次，焦点真的进了那一节才算数（不是「调过 focus 了」）；试满 SECTION_FOCUS_FRAME_BUDGET 帧就放弃。
 *
 * 落在哪个控件：这一节自己声明的首要控件（`data-settings-section-focus`，比如 TikHub 那一节的 Key 输入框——没配 key 的人
 * 被带来就是为了填它）；没声明就是这一节第一个 Tab 得到的控件（tabbable，不手写标签列表）。
 */

/** 约 2 秒（60fps）：盖住第一次打开设置时懒加载那一下；再久说明那一节根本不会出现，别再等。 */
export const SECTION_FOCUS_FRAME_BUDGET = 120

/** 一节里声明「深链进来时光标放这儿」的属性（同 `data-model-settings-autofocus` 的做法：页面自己说，不让别人猜）。 */
export const SECTION_FOCUS_TARGET_ATTRIBUTE = 'data-settings-section-focus'

export function focusSettingsSectionWhenReady({
  dialog,
  section,
  frames = SECTION_FOCUS_FRAME_BUDGET,
}: {
  /** 设置对话框本身：焦点已经在它里面（那一节已经拿到，或人自己点了别处）就不再动。 */
  dialog: () => HTMLElement | null
  /** 深链指向的那一节；还没挂出来时返回 null。 */
  section: () => HTMLElement | null
  frames?: number
}): () => void {
  let attempts = 0
  let frame = 0
  let scrolled = false
  const attempt = (): void => {
    const host = dialog()
    const active = document.activeElement
    if (host && active && active !== host && host.contains(active)) return
    const target = section()
    if (target) {
      if (!scrolled) {
        target.scrollIntoView({ block: 'center' })
        scrolled = true
      }
      const control = target.querySelector<HTMLElement>(`[${SECTION_FOCUS_TARGET_ATTRIBUTE}]`) ?? tabbable(target)[0]
      control?.focus({ preventScroll: true })
      if (target.contains(document.activeElement)) return
    }
    attempts += 1
    if (attempts < frames) frame = requestAnimationFrame(attempt)
  }
  frame = requestAnimationFrame(attempt)
  return () => cancelAnimationFrame(frame)
}
