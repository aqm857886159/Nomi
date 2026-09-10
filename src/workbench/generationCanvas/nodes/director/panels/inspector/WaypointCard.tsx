/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton、../../../../../../ui/toast、../../DirectorEditorContext、
 *          ../../model/directorTypes（TimelineEntity / Waypoint）、../../model/timeGrid（DIRECTOR_FPS / secondsToFrame）、../fields/FieldPrimitives、../fields/SliderNumberField
 * [OUTPUT]: 对外提供 WaypointCard（清单 §4.6 I8 单路标：帧、位置、看向目标、水平/俯仰/横滚、删除）
 * [POS]: director/panels/inspector 的路标卡：帧改时走 updateWaypointTime（被相邻路标夹住时拒绝并 toast），数值改动前先快照。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../../../../design'
import { toast } from '../../../../../../ui/toast'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import type { TimelineEntity, Waypoint } from '../../model/directorTypes'
import { DIRECTOR_FPS, secondsToFrame } from '../../model/timeGrid'
import { InspectorCard, SectionHeader, Vec3Fields } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'
import { WaypointAimField } from './WaypointAimField'

export function WaypointCard({ entity, waypoint }: { entity: TimelineEntity; waypoint: Waypoint }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const totalDuration = useDirectorStore((state) => state.timeline.totalDuration)
  const save = () => store.getState().saveState()

  return (
    <InspectorCard>
      <SectionHeader title={t('director.timelineInspector.waypointTitle')} />
      <SliderNumberField
        label={t('director.timelineInspector.waypointFrame')}
        value={waypoint.frameIndex}
        min={0}
        max={secondsToFrame(totalDuration)}
        step={1}
        digits={0}
        onChangeStart={save}
        onChange={(frame) => {
          if (store.getState().updateWaypointTime(entity.id, waypoint.id, frame / DIRECTOR_FPS) === null) toast(t('director.timeline.toast.markerOutsideClip'), 'warning')
        }}
      />
      <Vec3Fields
        label={t('director.timelineInspector.waypointPosition')}
        value={{ x: waypoint.x, y: waypoint.y, z: waypoint.z }}
        onChangeStart={save}
        onChange={(next) => store.getState().updateWaypoint(entity.id, waypoint.id, next)}
      />
      <Vec3Fields
        label={t('director.timelineInspector.waypointAngles')}
        axisLabels={[t('director.timelineInspector.anglePitch'), t('director.timelineInspector.angleYaw'), t('director.timelineInspector.angleRoll')]}
        digits={1}
        value={{ x: waypoint.pitch, y: waypoint.yaw, z: waypoint.roll }}
        onChangeStart={save}
        onChange={(next) => store.getState().updateWaypoint(entity.id, waypoint.id, { pitch: next.x, yaw: next.y, roll: next.z })}
      />
      <WaypointAimField entityId={entity.id} value={waypoint.lookAtObjectId ?? ''} onChange={target => store.getState().aimWaypointsAt(entity.id, [waypoint.id], target || null, true)} />
      <div className="mt-2">
        <WorkbenchButton size="sm" className="text-nomi-danger" onClick={() => store.getState().deleteWaypoints(entity.id, [waypoint.id])}>
          {t('director.timelineInspector.deleteWaypoint')}
        </WorkbenchButton>
      </div>
    </InspectorCard>
  )
}
