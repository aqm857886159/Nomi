import React from 'react'
import { MANNEQUIN_POSE_PRESETS } from './scene3dConstants'
import { clonePoseValue } from './scene3dMath'
import type { Scene3DObject } from './scene3dTypes'

/**
 * 统一 semantic pose transition（D）：C 键（及任何按键映射的静态动作）与动作库共用同一入口。
 * 「同时更新实时画面 + 录制中打点」二合一——进入某姿势：patch 被操控角色 pose + recordPoseEvent；
 * 恢复：清 pose 回站姿 + recordPoseResume（base 关键帧）。非录制态 record* 自身 no-op，零副作用。
 * 现场看到下蹲、最终 take 也有下蹲关键帧（治「现场蹲、成片站」丢录），不写 crouch 特例（P4 通用）。
 */
export function useScene3DSemanticPose({
  possessId,
  patchObject,
  recordPoseEvent,
  recordPoseResume,
}: {
  possessId: string | null
  patchObject: (id: string, patch: Partial<Scene3DObject>) => void
  recordPoseEvent: (presetId: string) => void
  recordPoseResume: () => void
}): { handlePoseTransition: (presetId: string) => void; handlePoseResume: () => void } {
  const handlePoseTransition = React.useCallback(
    (presetId: string) => {
      if (!possessId) return
      const preset = MANNEQUIN_POSE_PRESETS.find((candidate) => candidate.id === presetId)
      if (preset) patchObject(possessId, { pose: clonePoseValue(preset.pose) })
      recordPoseEvent(presetId)
    },
    [patchObject, possessId, recordPoseEvent],
  )
  const handlePoseResume = React.useCallback(() => {
    if (!possessId) return
    patchObject(possessId, { pose: undefined })
    recordPoseResume()
  }, [patchObject, possessId, recordPoseResume])
  return { handlePoseTransition, handlePoseResume }
}
