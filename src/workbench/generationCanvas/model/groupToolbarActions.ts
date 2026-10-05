import type { GroupArrangeMode } from './groupArrange'

export const GROUP_TOOLBAR_ARRANGE_MODES: readonly GroupArrangeMode[] = ['grid', 'horizontal', 'vertical']

export function isGroupToolbarArrangeMode(value: string): value is GroupArrangeMode {
  return GROUP_TOOLBAR_ARRANGE_MODES.includes(value as GroupArrangeMode)
}
