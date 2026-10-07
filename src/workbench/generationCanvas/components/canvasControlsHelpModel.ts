import type { CanvasGestureScheme } from '../../../utils/canvasGesturePreference'
import { platformAltGlyph, platformAltKey, platformModifier, platformShiftKey } from '../../../design/platformShortcut'

export type CanvasControlsHelpSectionId = 'selection' | 'pan' | 'zoom' | 'create' | 'node'

export type CanvasControlsHelpRow = {
  shortcutKey: string
  actionKey: string
  shortcutValues?: CanvasShortcutGlyphs
}

/** 修饰键字形：全部从 `design/platformShortcut` 按平台派生，文案里不写字面量 ⌘ / ⌥ / ⇧。 */
export type CanvasShortcutGlyphs = {
  mod: '⌘' | 'Ctrl'
  /** 拖动类手势用的全称（Mac 键帽印「⌥ Option」）。 */
  alt: '⌥ Option' | 'Alt'
  /** 组合键里的紧凑写法（⌥⇧F）。 */
  opt: '⌥' | 'Alt'
  shift: '⇧' | 'Shift'
}

export type CanvasControlsHelpSection = {
  id: CanvasControlsHelpSectionId
  rows: CanvasControlsHelpRow[]
}

export function canvasControlsHelpSections(
  scheme: CanvasGestureScheme,
  platform: string,
): CanvasControlsHelpSection[] {
  const shortcutValues: CanvasShortcutGlyphs = {
    mod: platformModifier(platform),
    alt: platformAltKey(platform),
    opt: platformAltGlyph(platform),
    shift: platformShiftKey(platform),
  }
  // 平移排第一行：它是默认手势（空白左键拖），其余三个是「压在节点上也要平移」的补充入口。
  const panRows: CanvasControlsHelpRow[] = [
    { shortcutKey: 'blankDrag', actionKey: 'pan' },
    { shortcutKey: 'spaceDrag', actionKey: 'pan' },
    { shortcutKey: 'middleOrRightDrag', actionKey: 'pan' },
  ]
  if (scheme === 'modifier-zoom') {
    panRows.push({ shortcutKey: 'wheelOrTwoFinger', actionKey: 'pan' })
  }

  // 分组对齐 LibTV 的快捷键面板（选择 / 移动画布 / 缩放 / 创作 / 其他）：用户从那边带来的肌肉记忆按组找得到。
  return [
    {
      id: 'selection',
      rows: [
        { shortcutKey: 'shiftDrag', actionKey: 'boxSelect' },
        { shortcutKey: 'shiftClick', actionKey: 'toggleSelection' },
        { shortcutKey: 'blankClick', actionKey: 'clearSelection' },
        { shortcutKey: 'modA', actionKey: 'selectAll', shortcutValues },
      ],
    },
    { id: 'pan', rows: panRows },
    {
      id: 'zoom',
      rows: [
        ...(scheme === 'wheel-zoom'
          ? [{ shortcutKey: 'wheel', actionKey: 'zoom' }]
          : [{ shortcutKey: 'modWheel', actionKey: 'zoom', shortcutValues }]),
        { shortcutKey: 'pinch', actionKey: 'zoom' },
        { shortcutKey: 'modPlusMinus', actionKey: 'zoomStep', shortcutValues },
      ],
    },
    {
      id: 'create',
      rows: [
        { shortcutKey: 'tab', actionKey: 'addNode' },
        { shortcutKey: 'modL', actionKey: 'connect', shortcutValues },
        { shortcutKey: 'modD', actionKey: 'duplicate', shortcutValues },
        // 松手处即副本落点——节点、框、结果堆叠里的单个版本都一样。
        { shortcutKey: 'altDrag', actionKey: 'duplicateDrag', shortcutValues },
        { shortcutKey: 'modG', actionKey: 'group', shortcutValues },
        { shortcutKey: 'modShiftG', actionKey: 'ungroup', shortcutValues },
        { shortcutKey: 'frameKey', actionKey: 'frame' },
        { shortcutKey: 'optShiftF', actionKey: 'tidy', shortcutValues },
      ],
    },
    {
      id: 'node',
      rows: [
        { shortcutKey: 'modCopyPaste', actionKey: 'copyPaste', shortcutValues },
        { shortcutKey: 'modX', actionKey: 'cut', shortcutValues },
        { shortcutKey: 'modZ', actionKey: 'undo', shortcutValues },
        { shortcutKey: 'modShiftZ', actionKey: 'redo', shortcutValues },
        { shortcutKey: 'delete', actionKey: 'deleteSelection' },
        { shortcutKey: 'escape', actionKey: 'cancel' },
      ],
    },
  ]
}
