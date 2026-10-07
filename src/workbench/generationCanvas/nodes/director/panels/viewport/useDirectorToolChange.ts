/**
 * [INPUT]: 依赖 react、../../DirectorEditorContext、../../model/directorStore 的 TransformMode
 * [OUTPUT]: 对外提供 useDirectorToolChange(onCancelCreation)：切视口工具的唯一写法（选择 / 移动 / 旋转 / 缩放 / 画线 / 逐点）
 * [POS]: director/panels/viewport 的工具切换。顶栏工具簇（ViewportToolbar）与精修属性卡头的「画线 / 逐点」都走这里：
 *        先取消角色 / 方块创建模式；画线 / 逐点是模式不是 gizmo 工具，进模式时关 gizmo；其余工具退出画线模式。两处各写一遍就会漂。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useDirectorStore } from '../../DirectorEditorContext'
import type { TransformMode } from '../../model/directorStore'

export function useDirectorToolChange(onCancelCreation?: () => void): (value: string) => void {
  const setTransformMode = useDirectorStore((state) => state.setTransformMode)
  const setDrawMode = useDirectorStore((state) => state.setDrawMode)
  return React.useCallback((value: string) => {
    onCancelCreation?.()
    if (value === 'drawPencil' || value === 'waypoint') {
      setTransformMode(null)
      setDrawMode(value === 'drawPencil' ? 'pencil' : 'waypoint')
      return
    }
    setDrawMode(null)
    setTransformMode(value === 'select' ? null : (value as TransformMode))
  }, [onCancelCreation, setDrawMode, setTransformMode])
}
