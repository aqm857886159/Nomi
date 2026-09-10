/**
 * [INPUT]: 依赖 react、./DirectorEditorContext 的 useDirectorStoreApi、./model/hotkeys（DIRECTOR_HOTKEYS / matchesHotkey）
 *          ./model/sceneObjectGraph 的 selectedRoots（克隆只处理多选根，命令统一历史边界）
 * [OUTPUT]: 对外提供 useDirectorHotkeys、isTextTarget、isDirectorKeyboardBlocked：区域感知快捷键与持续导航共用输入归属；多选命令一次操作只入一次撤销
 * [POS]: director 的键盘入口（清单 §5.4 L7 + §8 键位）：S1 接工具 1/2/3、0 归位、F 聚焦、Esc、撤销重做、打组解组、删除、克隆；
 *        时间轴键位由 timeline/useTimelineHotkeys 用同一分发器注册（子组件先注册先收到，返回 false 让位）。
 *        捕获期监听，命中后 preventDefault + stopImmediatePropagation，不让画布与后续分发器收到。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useDirectorStoreApi } from './DirectorEditorContext'
import { DIRECTOR_HOTKEYS, matchesHotkey, type DirectorHotkeyId, type DirectorHotkeyScope } from './model/hotkeys'
import { selectedRoots } from './model/sceneObjectGraph'

// 处理器返回 false = 这次不接管（事件继续给后面注册的分发器 / 浏览器默认）
export type HotkeyHandler = () => boolean | void
export type HotkeyHandlers = Partial<Record<DirectorHotkeyId, HotkeyHandler>>

/** 焦点落在「会吃键盘」的控件上（文本 / 数字输入、下拉、可编辑区）；单选 / 复选 / 滑条 / 按钮不算——点过分段控件后按 Esc / 快捷键照样归编辑器 */
export function isTextTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable) return true
  if (element.tagName !== 'INPUT') return false
  const type = ((element as HTMLInputElement).type || 'text').toLowerCase()
  return !['radio', 'checkbox', 'range', 'button', 'submit'].includes(type)
}

/** 命令与持续漫游共用输入归属；调用方可用 activeElement 在每帧复核。 */
export function isDirectorKeyboardBlocked(event: Pick<KeyboardEvent, 'target' | 'defaultPrevented' | 'isComposing'>): boolean {
  return event.defaultPrevented || event.isComposing || isTextTarget(event.target) || Boolean(document.querySelector('[data-nomi-escape-layer]'))
}

export function useDirectorHotkeys({ scopeRef, handlers }: { scopeRef: React.MutableRefObject<DirectorHotkeyScope>; handlers: HotkeyHandlers }): void {
  const store = useDirectorStoreApi()
  const handlersRef = React.useRef(handlers)
  handlersRef.current = handlers

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isDirectorKeyboardBlocked(event)) return
      const scope = scopeRef.current
      for (const [id, binding] of Object.entries(DIRECTOR_HOTKEYS) as Array<[DirectorHotkeyId, (typeof DIRECTOR_HOTKEYS)[DirectorHotkeyId]]>) {
        if (binding.scope !== 'global' && binding.scope !== scope) continue
        if (!matchesHotkey(event, binding)) continue
        const handler = handlersRef.current[id] ?? defaultHandler(id, store)
        if (!handler) continue
        // 返回 false = 「这次不归我」（如时间轴没选中片段时的 Backspace），让给后面注册的分发器（编辑器级默认处理）
        if (handler() === false) continue
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [scopeRef, store])
}

function defaultHandler(id: DirectorHotkeyId, store: ReturnType<typeof useDirectorStoreApi>): HotkeyHandler | null {
  const state = () => store.getState()
  switch (id) {
    case 'drawPencil':
      return () => state().setDrawMode(state().drawMode === 'pencil' ? null : 'pencil')
    case 'waypoint':
      return () => state().setDrawMode(state().drawMode === 'waypoint' ? null : 'waypoint')
    case 'translate':
      return () => state().setTransformMode('translate')
    case 'rotate':
      return () => state().setTransformMode('rotate')
    case 'scale':
      return () => state().setTransformMode('scale')
    case 'undo':
      return () => state().undo()
    case 'redo':
      return () => state().redo()
    case 'group':
      return () => {
        const ids = state().selection.multiObjectIds
        if (ids.length > 1) state().groupObjects(ids, 'Group')
      }
    case 'ungroup':
      return () => {
        const current = state()
        const ids = current.selection.multiObjectIds.length ? current.selection.multiObjectIds : current.selection.objectId ? [current.selection.objectId] : []
        current.withHistory(() => {
          for (const id of ids) if (current.findObject(id)?.type === 'group') current.ungroupObjects(id)
        })
      }
    case 'deleteSelection':
      return () => {
        const current = state()
        const ids = current.selection.multiObjectIds.length > 1 ? current.selection.multiObjectIds : current.selection.objectId ? [current.selection.objectId] : []
        current.withHistory(() => {
          for (const objectId of ids) current.deleteObject(objectId)
          if (current.selection.cameraId) current.deleteCamera(current.selection.cameraId)
          if (current.selection.lightId) current.deleteLight(current.selection.lightId)
        })
      }
    case 'ikMode':
      return () => {
        const current = state()
        if (!current.isSkeletonEditing || !current.selection.objectId) return false
        current.setIkModeEnabled(true)
        current.select({ boneKey: null, ikTarget: current.selection.ikTarget ?? 'pelvis' })
      }
    case 'fkMode':
      return () => {
        const current = state()
        if (!current.isSkeletonEditing || !current.selection.objectId) return false
        current.setIkModeEnabled(false)
        current.select({ ikTarget: null })
      }
    case 'pasteBackward':
      return () => {
        const current = state()
        const ids = current.selection.multiObjectIds.length ? current.selection.multiObjectIds : current.selection.objectId ? [current.selection.objectId] : []
        current.withHistory(() => {
          const copies = selectedRoots(current.activeScene().objects, ids).map((object) => current.cloneObject(object.id, ' copy')).filter((id): id is string => Boolean(id))
          if (copies.length) current.select({ objectId: copies[0], multiObjectIds: copies })
        })
      }
    default:
      return null
  }
}
