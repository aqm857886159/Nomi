/**
 * [INPUT]: 依赖 react、react-i18next、../../DirectorEditorContext、../../model/directorTypes、../fields/*、./TransformSection
 * [OUTPUT]: 对外提供 PrimitiveInspector：名称、材质（颜色/粗糙度/金属度/透明度/线框/平面着色）、辅助物体开关、空间变换；组只有名称、变换，以及组里有角色时的整组「动作」（群众组）
 * [POS]: director/panels/inspector 的几何体/组属性（清单 §4.4 I6）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject } from '../../model/directorTypes'
import { ActionSelectModal } from '../dialogs/ActionSelectModal'
import { ActionPickField } from '../fields/ActionPickField'
import { ColorField, InspectorCard, SectionHeader, TextField, ToggleField } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'
import { ObjectTransformSection } from './TransformSection'

/** 群众组（或任何带角色的组）的整组动作：成员动作一致显示它的名字，不一致显示「—」；选了以后组内所有角色一起换，一次撤销 */
function GroupActionCard({ group }: { group: DirectorObject }): JSX.Element | null {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const [modalOpen, setModalOpen] = React.useState(false)
  const objects = useDirectorStore((state) => state.activeScene().objects)
  const members = React.useMemo(() => {
    const ids = new Set(store.getState().getObjectDescendantIds(group.id))
    return objects.filter((item) => ids.has(item.id) && item.type === 'character')
  }, [group.id, objects, store])
  if (members.length === 0) return null
  const first = members[0].posePreset ?? null
  const mixed = members.some((item) => (item.posePreset ?? null) !== first)
  return (
    <InspectorCard>
      <ActionPickField label={t('director.creation.crowdAction')} actionId={first} mixed={mixed} onOpen={() => setModalOpen(true)} />
      <ActionSelectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialId={first ?? undefined}
        title={t('director.action.crowdModalTitle')}
        confirmLabel={(name) => t('director.action.useNamed', { name })}
        onPick={(entry) => store.getState().applyPosePresetToGroup(group.id, entry.id)}
      />
    </InspectorCard>
  )
}

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
      {isGroup ? <GroupActionCard group={object} /> : null}
      <ObjectTransformSection object={object} />
    </>
  )
}
