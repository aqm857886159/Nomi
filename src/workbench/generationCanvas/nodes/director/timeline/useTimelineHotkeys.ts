/**
 * [INPUT]: 依赖 react、../DirectorEditorContext 的 useDirectorStoreApi、../CameraRecorderContext 的 useCameraRecorder、../useDirectorHotkeys、../model/hotkeys 的 DirectorHotkeyScope、./timelineCommands
 * [OUTPUT]: 对外提供 useTimelineHotkeys：把时间轴作用域 + 全局的传输/编辑键位接到命令层
 * [POS]: director/timeline 的快捷键绑定（清单 §5.4）：与编辑器级分发器并存——这里先注册（子组件 effect 先跑），
 *        没选中片段/路标时返回 false 让 Backspace / Cmd+D 落回编辑器默认（删实体 / 克隆实体）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useCameraRecorder } from '../CameraRecorderContext'
import { useDirectorStoreApi } from '../DirectorEditorContext'
import type { DirectorHotkeyScope } from '../model/hotkeys'
import { useDirectorHotkeys } from '../useDirectorHotkeys'
import {
  copySelectedClip,
  cutSelectedClip,
  deleteTimelineSelection,
  duplicateSelectedAfter,
  insertKeyframeAtPlayhead,
  jumpSplitPoint,
  NEED_CLIP_SELECTION,
  pasteClipboardAtPlayhead,
  splitSelectedAtPlayhead,
  stepFrames,
  togglePlay,
  type CommandResult,
} from './timelineCommands'

export function useTimelineHotkeys({ scopeRef, onReject }: { scopeRef: React.MutableRefObject<DirectorHotkeyScope>; onReject: (reasonKey: string) => void }): void {
  const store = useDirectorStoreApi()
  const recorder = useCameraRecorder()
  const recorderRef = React.useRef(recorder)
  recorderRef.current = recorder
  const onRejectRef = React.useRef(onReject)
  onRejectRef.current = onReject

  const consume = React.useCallback((result: CommandResult): boolean => {
    if (!result.ok && result.reasonKey) onRejectRef.current(result.reasonKey)
    return true
  }, [])

  useDirectorHotkeys({
    scopeRef,
    handlers: {
      // 录制运镜中 Space = 完成录制（播放/暂停/停止录制同一键）
      togglePlay: () => {
        if (recorderRef.current.active) {
          recorderRef.current.stop()
          return
        }
        togglePlay(store)
      },
      insertKeyframe: () => consume(insertKeyframeAtPlayhead(store)),
      prevFrame: () => stepFrames(store, -1),
      nextFrame: () => stepFrames(store, 1),
      prev10Frames: () => stepFrames(store, -10),
      next10Frames: () => stepFrames(store, 10),
      prevSplitPoint: () => jumpSplitPoint(store, 'prev'),
      nextSplitPoint: () => jumpSplitPoint(store, 'next'),
      copy: () => consume(copySelectedClip(store)),
      paste: () => consume(pasteClipboardAtPlayhead(store)),
      cutLeft: () => consume(cutSelectedClip(store, 'left')),
      cutRight: () => consume(cutSelectedClip(store, 'right')),
      splitClip: () => consume(splitSelectedAtPlayhead(store)),
      // 没选片段时让给编辑器默认：Cmd+D 克隆实体 / Backspace 删实体
      pasteBackward: () => {
        const result = duplicateSelectedAfter(store)
        if (!result.ok && result.reasonKey === NEED_CLIP_SELECTION) return false
        return consume(result)
      },
      deleteSelection: () => (deleteTimelineSelection(store).ok ? true : false),
    },
  })
}
