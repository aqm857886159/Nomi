import React from 'react'
import { IconBrush, IconEraser, IconPointer, IconSquare } from '@tabler/icons-react'
import type { ToolKey } from './lib/canvas'

export const TOOL_ITEMS: Array<{
  key: ToolKey
  labelKey: 'brush' | 'select' | 'eraser' | 'shape'
  icon: React.ReactNode
  disabled?: boolean
}> = [
  { key: 'brush', labelKey: 'brush', icon: <IconBrush size={17} stroke={1.7} /> },
  { key: 'select', labelKey: 'select', icon: <IconPointer size={17} stroke={1.7} /> },
  { key: 'eraser', labelKey: 'eraser', icon: <IconEraser size={17} stroke={1.7} /> },
  { key: 'shape', labelKey: 'shape', icon: <IconSquare size={17} stroke={1.7} />, disabled: true },
]
