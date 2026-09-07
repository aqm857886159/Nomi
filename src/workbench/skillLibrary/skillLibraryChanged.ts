/**
 * 技能库变更信号（2026-09-07）。
 *
 * 为什么需要它：技能列表在渲染层有**两个读者**——侧栏技能库面板（useWorkbenchSkills）和
 * Agent 面板的 `/` 技能菜单（useAgentPanelV4Data）。两者各自在 mount 时调一次
 * `listWorkbenchSkills()`，谁都不知道对方写了盘。于是真机上会出现这一幕（本轮走查实拍）：
 * 左边技能库里那张刚导进来的卡片好好地立着，右边 Agent 的技能菜单里**一个字都没有它**——
 * 用户导进来了，却在 Agent 里用不上，只能靠重启 App 撞见。
 *
 * 根因是「共享状态没有失效信号」，不是哪个组件写错了。所以修在最早的共享边界：
 * 写方（导入/删除）派发一次，所有读者监听同一个事件重读。范式与 `nomi-model-catalog-changed`
 * 完全一致，不另发明一套。
 */

export const SKILL_LIBRARY_CHANGED_EVENT = 'nomi-skill-library-changed'

/** 写完技能盘之后调它一次（导入/删除/AI 写完落盘）。 */
export function notifySkillLibraryChanged(): void {
  window.dispatchEvent(new Event(SKILL_LIBRARY_CHANGED_EVENT))
}

/** 订阅技能库变更；返回退订函数（给 useEffect 直接 return）。 */
export function onSkillLibraryChanged(handler: () => void): () => void {
  window.addEventListener(SKILL_LIBRARY_CHANGED_EVENT, handler)
  return () => window.removeEventListener(SKILL_LIBRARY_CHANGED_EVENT, handler)
}
