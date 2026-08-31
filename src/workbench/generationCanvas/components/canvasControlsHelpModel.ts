import type { CanvasGestureScheme } from './canvasGesturePreference'
import { isMacCanvasPlatform } from './canvasPointerGestureModel'

export type CanvasControlsHelpSectionId = 'selection' | 'pan' | 'zoom' | 'node'

export type CanvasControlsHelpRow = {
  shortcutKey: string
  actionKey: string
  shortcutValues?: { mod: '⌘' | 'Ctrl' }
}

export type CanvasControlsHelpSection = {
  id: CanvasControlsHelpSectionId
  rows: CanvasControlsHelpRow[]
}

export function platformModifier(platform: string): '⌘' | 'Ctrl' {
  return isMacCanvasPlatform(platform) ? '⌘' : 'Ctrl'
}

export function canvasControlsHelpSections(
  scheme: CanvasGestureScheme,
  platform: string,
): CanvasControlsHelpSection[] {
  const shortcutValues = { mod: platformModifier(platform) }
  // 平移排第一行：它是默认手势（空白左键拖），其余三个是「压在节点上也要平移」的补充入口。
  const panRows: CanvasControlsHelpRow[] = [
    { shortcutKey: 'blankDrag', actionKey: 'pan' },
    { shortcutKey: 'spaceDrag', actionKey: 'pan' },
    { shortcutKey: 'middleOrRightDrag', actionKey: 'pan' },
  ]
  if (scheme === 'modifier-zoom') {
    panRows.push({ shortcutKey: 'wheelOrTwoFinger', actionKey: 'pan' })
  }

  return [
    {
      id: 'selection',
      rows: [
        { shortcutKey: 'shiftDrag', actionKey: 'boxSelect' },
        { shortcutKey: 'shiftClick', actionKey: 'toggleSelection' },
        { shortcutKey: 'blankClick', actionKey: 'clearSelection' },
      ],
    },
    { id: 'pan', rows: panRows },
    {
      id: 'zoom',
      rows: scheme === 'wheel-zoom'
        ? [
            { shortcutKey: 'wheel', actionKey: 'zoom' },
            { shortcutKey: 'pinch', actionKey: 'zoom' },
          ]
        : [
            { shortcutKey: 'modWheel', actionKey: 'zoom', shortcutValues },
            { shortcutKey: 'pinch', actionKey: 'zoom' },
          ],
    },
    {
      id: 'node',
      rows: [
        { shortcutKey: 'modA', actionKey: 'selectAll', shortcutValues },
        { shortcutKey: 'modCopyPaste', actionKey: 'copyPaste', shortcutValues },
        { shortcutKey: 'delete', actionKey: 'deleteSelection' },
        { shortcutKey: 'escape', actionKey: 'cancel' },
      ],
    },
  ]
}
