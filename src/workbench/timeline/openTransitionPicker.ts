/**
 * 打开某条接缝上的转场选择器。
 *
 * 选择器的开合状态住在 TimelineTransitionMarker 自己身上（它是接缝这个对象的宿主，
 * 合同 §2.4「转场是挂在剪切点上的对象」）。时间轴右键菜单和属性面板都只是**另一个入口**，
 * 不该各自再挂一份 picker——那就是并行版。两个入口都走这一个函数点开同一个标记。
 *
 * 找不到标记就返回 false（片段被滚出视口、接缝不存在），调用方据此决定是否禁用入口，
 * 而不是让用户点了没反应。
 */
export function openTimelineTransitionPicker(fromClipId: string, toClipId: string): boolean {
  const marker = document.querySelector<HTMLElement>(
    `[data-timeline-transition][data-transition-from="${CSS.escape(fromClipId)}"][data-transition-to="${CSS.escape(toClipId)}"]`,
  )
  if (!marker) return false
  marker.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  marker.click()
  return true
}
