/**
 * [INPUT]: 依赖 react、react-i18next、../../DirectorEditorContext、../../model/directorTypes、../fields/*、./TransformSection
 * [OUTPUT]: 对外提供 PrimitiveInspector：名称、材质（颜色/粗糙度/金属度/透明度/线框/平面着色）、辅助物体开关、空间变换；组只有名称与变换
 * [POS]: director/panels/inspector 的几何体/组属性（清单 §4.4 I6）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject } from '../../model/directorTypes'
import { ColorField, InspectorCard, SectionHeader, TextField, ToggleField } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'
import { ObjectTransformSection } from './TransformSection'

export function PrimitiveInspector({ object }: { object: DirectorObject }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const update = (patch: Partial<DirectorObject>) => store.getState().updateObject(object.id, patch)
  const save = () => store.getState().saveState()
  const isGroup = object.type === 'group'
  // 组 / 泼溅 / 用户模型没有可调材质：只留名称 + 变换（泼溅颜色来自数据，模型材质随文件）
  const hasMaterial = !isGroup && object.type !== 'splat' && object.type !== 'model'
  return (
    <>
      <InspectorCard>
        <SectionHeader title={isGroup ? t('director.inspector.groupBasics') : t('director.inspector.objectBasics')} />
        <TextField label={t('director.inspector.name')} value={object.name} onCommit={(name) => store.getState().renameObject(object.id, name)} />
        {hasMaterial ? (
          <>
            <ColorField label={t('director.inspector.materialColor')} value={object.color ?? ''} allowClear onChangeStart={save} onChange={(color) => update({ color: color || undefined })} />
            <SliderNumberField label={t('director.inspector.roughness')} value={object.roughness ?? 0.4} min={0} max={1} step={0.05} onChangeStart={save} onChange={(roughness) => update({ roughness })} />
            <SliderNumberField label={t('director.inspector.metalness')} value={object.metalness ?? 0.1} min={0} max={1} step={0.05} onChangeStart={save} onChange={(metalness) => update({ metalness })} />
            <SliderNumberField label={t('director.inspector.opacity')} value={object.opacity ?? 1} min={0.05} max={1} step={0.05} onChangeStart={save} onChange={(opacity) => update({ opacity })} />
            <ToggleField label={t('director.inspector.wireframe')} checked={object.wireframe ?? false} onChange={(wireframe) => { save(); update({ wireframe }) }} />
            <ToggleField label={t('director.inspector.flatShading')} checked={object.flatShading ?? false} onChange={(flatShading) => { save(); update({ flatShading }) }} />
            <ToggleField label={t('director.inspector.auxiliary')} checked={object.isAuxiliary ?? false} onChange={(isAuxiliary) => { save(); update({ isAuxiliary }) }} hint={t('director.inspector.auxiliaryHint')} />
          </>
        ) : null}
      </InspectorCard>
      <ObjectTransformSection object={object} />
    </>
  )
}
