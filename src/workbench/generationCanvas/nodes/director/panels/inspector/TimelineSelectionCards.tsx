/**
 * [INPUT]: 依赖 react、../../DirectorEditorContext 的 useDirectorStore、../../model/directorTypes（TimelineEntity / isDirectorCamera）、./WaypointCard、./BatchWaypointsCard、
 *          ./TrajectoryClipInspector、./CloseupClipInspector、./ActionClipInspector、./LookAtClipInspector、./BoneKeyframeInspector
 * [OUTPUT]: 对外提供 useTimelineSelectionCard：按当前选择态（优先级：批量路标 → 单路标 → 片段）给出「标题 + 唯一一张卡」，检查器只显示它
 * [POS]: director/panels/inspector 的时间轴选择分发：ContextInspector 先问这里，有就整块换掉实体检查器（选片段时看不到实体属性）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useDirectorStore } from '../../DirectorEditorContext'
import { isDirectorCamera, type TimelineEntity } from '../../model/directorTypes'
import { ActionClipInspector } from './ActionClipInspector'
import { BatchWaypointsCard } from './BatchWaypointsCard'
import { BoneKeyframeInspector } from './BoneKeyframeInspector'
import { CloseupClipInspector } from './CloseupClipInspector'
import { LookAtClipInspector } from './LookAtClipInspector'
import { TrajectoryClipInspector } from './TrajectoryClipInspector'
import { WaypointCard } from './WaypointCard'

export type TimelineSelectionCard = { title: string; node: React.ReactNode }

/**
 * 检查器分发：时间轴上选中了片段 / 关键帧时，检查器**只**显示那一张卡（标题也换成它的），不再叠在实体检查器上方。
 * 返回 null = 没有时间轴层面的选择，交回实体检查器。
 */
export function useTimelineSelectionCard(entity: TimelineEntity | null): TimelineSelectionCard | null {
  const { t } = useTranslation()
  const selection = useDirectorStore((state) => state.selection)
  if (!entity) return null
  const waypoints = entity.motionTrajectory ?? []
  const selectedWaypoints = waypoints.filter((waypoint) => selection.selectedWaypointIds.includes(waypoint.id))
  const active = waypoints.find((waypoint) => waypoint.id === selection.activeWaypointId)
  const clip = selection.clipType === 'trajectory' && selection.clipId ? entity.trajectoryClips?.find((item) => item.id === selection.clipId) : undefined
  const closeup = selection.clipType === 'closeup' && selection.clipId && isDirectorCamera(entity) ? entity.closeupClips?.find((item) => item.id === selection.clipId) : undefined
  const character = !isDirectorCamera(entity) && entity.type === 'character' ? entity : null
  const actionClip = character && selection.clipType === 'action' && selection.clipId ? character.actionClips?.find((item) => item.id === selection.clipId) : undefined
  const lookAtClip = character && selection.clipType === 'lookat' && selection.clipId ? character.lookAtClips?.find((item) => item.id === selection.clipId) : undefined
  const boneKeyframe = character && selection.boneKeyframeId ? character.actionClips?.flatMap((item) => item.keyframes ?? []).find((item) => item.id === selection.boneKeyframeId) : undefined
  // 优先级：批量路标 → 单路标 → 片段（骨骼关键帧归动作片段家族）
  if (selectedWaypoints.length > 1) return { title: t('director.inspector.selectionTitle.batchWaypoints', { count: selectedWaypoints.length }), node: <BatchWaypointsCard entity={entity} waypoints={selectedWaypoints} /> }
  if (active) return { title: t('director.inspector.selectionTitle.waypoint', { frame: active.frameIndex }), node: <WaypointCard entity={entity} waypoint={active} /> }
  if (clip) return { title: t('director.inspector.selectionTitle.trajectoryClip'), node: <TrajectoryClipInspector entity={entity} clip={clip} /> }
  if (closeup && isDirectorCamera(entity)) return { title: t('director.inspector.selectionTitle.closeupClip'), node: <CloseupClipInspector camera={entity} clip={closeup} /> }
  if (character && boneKeyframe) return { title: t('director.inspector.selectionTitle.boneKeyframe'), node: <BoneKeyframeInspector object={character} keyframe={boneKeyframe} /> }
  if (character && actionClip) return { title: t('director.inspector.selectionTitle.actionClip'), node: <ActionClipInspector object={character} clip={actionClip} /> }
  if (character && lookAtClip) return { title: t('director.inspector.selectionTitle.lookAtClip'), node: <LookAtClipInspector object={character} clip={lookAtClip} /> }
  return null
}
