/**
 * [INPUT]: 依赖 react、react-i18next、../../DirectorEditorContext、../../model/directorTypes、../../model/lights（色温预设 / 快捷朝向）、../fields/*
 * [OUTPUT]: 对外提供 LightInspector：名称；启用/视口可见/锁定；颜色 + 色温预设；强度；聚光锥角与柔化；有效距离；衰减；位置；照射朝向 + 4 快捷朝向
 * [POS]: director/panels/inspector 的灯光属性（清单 §4.3 I5）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorLight } from '../../model/directorTypes'
import { LIGHT_QUICK_ORIENTATIONS, LIGHT_TEMPERATURE_PRESETS } from '../../model/lights'
import { ColorField, InspectorCard, SectionHeader, TextField, ToggleField, Vec3Fields } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'

export function LightInspector({ light }: { light: DirectorLight }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const update = (patch: Partial<DirectorLight>) => store.getState().updateLight(light.id, patch)
  const save = () => store.getState().saveState()
  const commit = (patch: Partial<DirectorLight>) => store.getState().withHistory(() => update(patch))
  return (
    <>
      <InspectorCard>
        <SectionHeader title={t('director.inspector.lightBasics')} />
        <TextField label={t('director.inspector.name')} value={light.name} onCommit={(name) => commit({ name })} />
        <ToggleField label={t('director.inspector.lightEnabled')} checked={light.enabled} onChange={() => store.getState().toggleLightEnabled(light.id)} hint={t('director.inspector.lightEnabledHint')} />
        <ToggleField label={t('director.inspector.lightVisible')} checked={light.visible} onChange={() => store.getState().toggleLightVisible(light.id)} />
        <ToggleField label={t('director.inspector.locked')} checked={light.locked} onChange={() => store.getState().toggleLightLock(light.id)} />
      </InspectorCard>
      <InspectorCard>
        <SectionHeader title={t('director.inspector.lightParams')} />
        <ColorField
          label={t('director.inspector.color')}
          value={light.color}
          presets={LIGHT_TEMPERATURE_PRESETS.map((preset) => ({ id: preset.id, value: preset.color }))}
          onChangeStart={save}
          onChange={(color) => update({ color: color || '#ffffff' })}
        />
        <SliderNumberField label={t('director.inspector.intensity')} value={light.intensity} min={0} max={10} step={0.1} onChangeStart={save} onChange={(intensity) => update({ intensity })} />
        {light.type === 'spot' ? (
          <>
            <SliderNumberField label={t('director.inspector.spotAngle')} value={light.spotAngle ?? 45} min={1} max={90} step={1} unit="°" onChangeStart={save} onChange={(spotAngle) => update({ spotAngle })} />
            <SliderNumberField label={t('director.inspector.spotPenumbra')} value={light.spotPenumbra ?? 0.3} min={0} max={1} step={0.05} onChangeStart={save} onChange={(spotPenumbra) => update({ spotPenumbra })} />
          </>
        ) : null}
        {light.type !== 'directional' ? (
          <>
            <SliderNumberField label={t('director.inspector.lightDistance')} value={light.distance} min={0} max={50} step={0.5} unit="m" onChangeStart={save} onChange={(distance) => update({ distance })} />
            <SliderNumberField label={t('director.inspector.lightDecay')} value={light.decay} min={0} max={4} step={0.1} onChangeStart={save} onChange={(decay) => update({ decay })} />
          </>
        ) : null}
        <ToggleField label={t('director.inspector.castShadow')} checked={light.castShadow} onChange={(castShadow) => commit({ castShadow })} />
      </InspectorCard>
      <InspectorCard>
        <SectionHeader title={t('director.inspector.lightPose')} />
        <Vec3Fields label={t('director.inspector.position')} value={light.position} onChangeStart={save} onChange={(position) => store.getState().writeLightSpatialTransform(light.id, position)} />
        {light.type !== 'point' ? (
          <>
            <SliderNumberField label={t('director.inspector.yaw')} value={light.yaw} min={-180} max={180} step={1} unit="°" onChangeStart={save} onChange={(yaw) => store.getState().writeLightSpatialTransform(light.id, undefined, { yaw })} />
            <SliderNumberField label={t('director.inspector.pitch')} value={light.pitch} min={-90} max={90} step={1} unit="°" onChangeStart={save} onChange={(pitch) => store.getState().writeLightSpatialTransform(light.id, undefined, { pitch })} />
            <div className="mt-1 flex flex-wrap gap-1">
              {LIGHT_QUICK_ORIENTATIONS.map((preset) => (
                <button key={preset.id} type="button" className="rounded-nomi-sm border border-nomi-line px-2 py-0.5 text-micro text-nomi-ink-80 hover:bg-workbench-hover" onClick={() => { save(); store.getState().writeLightSpatialTransform(light.id, undefined, { yaw: preset.yaw, pitch: preset.pitch }) }}>
                  {t(`director.lightOrientation.${preset.id}`)}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </InspectorCard>
    </>
  )
}
