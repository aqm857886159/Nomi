/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton、../../DirectorEditorContext、../../model/directorTypes（TimelineEntity / Waypoint）、../fields/FieldPrimitives
 * [OUTPUT]: 对外提供 BatchWaypointsCard（清单 §4.6 I8：范围、逐帧看向、独立俯仰/横滚微调和复位、批量删除）
 * [POS]: director/panels/inspector 的多选路标卡；同一批次经共享动作一次写入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton, confirmDialog } from '../../../../../../design'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { TimelineEntity, Waypoint } from '../../model/directorTypes'
import { InspectorCard, SectionHeader } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'
import { WaypointAimField } from './WaypointAimField'

export function BatchWaypointsCard({ entity, waypoints }: { entity: TimelineEntity; waypoints: Waypoint[] }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const [target, setTarget] = React.useState('')
  const frames = waypoints.map((waypoint) => waypoint.frameIndex)
  const ids = waypoints.map(point => point.id)
  const deleteSelected = async () => {
    const accepted = await confirmDialog({ title: t('director.timelineInspector.batchDeleteTitle'), message: t('director.timelineInspector.batchDeleteMessage', { count: ids.length }), confirmLabel: t('director.timelineInspector.batchDelete'), danger: true })
    if (accepted) store.getState().deleteWaypoints(entity.id, ids)
  }
  return (
    <InspectorCard>
      <SectionHeader title={t('director.timelineInspector.batchTitle', { count: waypoints.length })} />
      <div className="py-1 font-nomi-mono text-caption text-nomi-ink-60">{t('director.timelineInspector.batchRange', { from: Math.min(...frames), to: Math.max(...frames) })}</div>
      <WaypointAimField entityId={entity.id} value={target} onChange={value => { setTarget(value); store.getState().aimWaypointsAt(entity.id, ids, value || null) }} />
      {(['pitch', 'roll'] as const).map(axis => (
        <div key={axis}>
          <SectionHeader title={t(axis === 'pitch' ? 'director.timelineInspector.batchPitch' : 'director.timelineInspector.batchRoll')} onReset={() => store.getState().updateWaypointAngles(entity.id, ids, { [axis]: 0 })} />
          <SliderNumberField label={t(axis === 'pitch' ? 'director.timelineInspector.anglePitch' : 'director.timelineInspector.angleRoll')} value={waypoints[0]?.[axis] ?? 0} min={axis === 'pitch' ? -90 : -180} max={axis === 'pitch' ? 90 : 180} step={1} unit="°" onChangeStart={() => store.getState().saveState()} onChange={value => store.getState().updateWaypointAngles(entity.id, ids, { [axis]: value }, false)} />
        </div>
      ))}
      <div className="mt-1 flex flex-wrap gap-1">
        <WorkbenchButton size="sm" className="text-nomi-danger" onClick={() => void deleteSelected()}>
          {t('director.timelineInspector.batchDelete')}
        </WorkbenchButton>
      </div>
    </InspectorCard>
  )
}
