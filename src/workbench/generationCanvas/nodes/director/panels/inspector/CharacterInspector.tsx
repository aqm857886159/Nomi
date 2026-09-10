/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 NomiSegmented、../../DirectorEditorContext、../../model/directorTypes、../fields/FieldPrimitives、
 *          ./TransformSection、./PoseTab、./SkeletonTab
 * [OUTPUT]: 对外提供 CharacterInspector：基础 / 姿态 / 骨骼 三页签（清单 §4.1 I1–I3）
 * [POS]: director/panels/inspector 的角色属性：基础页（名称、颜色预设、空间变换）住这里，姿态页与骨骼页各自成文件；页签状态本地记忆。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSegmented } from '../../../../../../design'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject } from '../../model/directorTypes'
import { ColorField, InspectorCard, SectionHeader, TextField } from '../fields/FieldPrimitives'
import { CrowdMatrixCard } from './CrowdMatrixCard'
import { PoseTab } from './PoseTab'
import { SkeletonTab } from './SkeletonTab'
import { ObjectTransformSection } from './TransformSection'

type CharacterTab = 'basics' | 'pose' | 'skeleton'

export function CharacterInspector({ object }: { object: DirectorObject }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const [tab, setTab] = React.useState<CharacterTab>('basics')
  // 骨骼页 = 骨骼聚焦：进页把手 / 骨骼球显示、IK 模式默认选骨盆；离页 / 卸载即清
  React.useEffect(() => {
    if (tab !== 'skeleton') return undefined
    const state = store.getState()
    state.setSkeletonEditing(true)
    if (state.ikModeEnabled && !state.selection.ikTarget && !state.selection.boneKey) state.select({ ikTarget: 'pelvis' })
    return () => {
      const current = store.getState()
      current.setSkeletonEditing(false)
      current.select({ ikTarget: null, boneKey: null })
    }
  }, [store, tab])
  return (
    <>
      <NomiSegmented
        ariaLabel={t('director.inspector.characterTitle', { name: object.name })}
        density="compact"
        className="sticky top-0 z-10 bg-nomi-paper"
        value={tab}
        options={[
          { value: 'basics', label: t('director.character.tabBasics') },
          { value: 'pose', label: t('director.character.tabPose') },
          { value: 'skeleton', label: t('director.character.tabSkeleton') },
        ]}
        onChange={(value) => setTab(value as CharacterTab)}
      />
      {tab === 'basics' ? (
        <>
          <InspectorCard>
            <SectionHeader title={t('director.inspector.characterBasics')} />
            <TextField label={t('director.inspector.name')} value={object.name} onCommit={(name) => store.getState().renameObject(object.id, name)} />
            <ColorField
              label={t('director.inspector.color')}
              value={object.color ?? ''}
              onChangeStart={() => store.getState().saveState()}
              onChange={(color) => store.getState().updateObject(object.id, { color })}
            />
          </InspectorCard>
          <ObjectTransformSection object={object} />
          <CrowdMatrixCard object={object} />
        </>
      ) : null}
      {tab === 'pose' ? <PoseTab object={object} /> : null}
      {tab === 'skeleton' ? <SkeletonTab object={object} /> : null}
    </>
  )
}
