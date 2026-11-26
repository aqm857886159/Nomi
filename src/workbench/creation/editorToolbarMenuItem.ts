import type { JSX } from 'react'
import type { WorkbenchMenuAction, WorkbenchMenuCheckbox, WorkbenchMenuIcon } from '../../design'
import type { RichTextAction } from '../common/richTextActions'

// 菜单项要的是组件（WorkbenchMenu 统一给图标上尺寸）；格式钮的图标是模块级常量元素，按元素缓存一份组件，免得每次渲染换身份。
const menuIconByElement = new WeakMap<JSX.Element, WorkbenchMenuIcon>()
function menuIconFor(element: JSX.Element): WorkbenchMenuIcon {
  const cached = menuIconByElement.get(element)
  if (cached) return cached
  const Icon: WorkbenchMenuIcon = () => element
  menuIconByElement.set(element, Icon)
  return Icon
}

export function toMenuItem(action: RichTextAction): WorkbenchMenuAction | WorkbenchMenuCheckbox {
  const item = { id: action.id, label: action.label, icon: menuIconFor(action.icon), disabled: action.disabled }
  return typeof action.active === 'boolean'
    ? { ...item, kind: 'checkbox', checked: action.active, onCheckedChange: action.onClick }
    : { ...item, onSelect: action.onClick }
}
