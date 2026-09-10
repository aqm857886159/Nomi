/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../utils/cn、../../../../../../vendor/tablerIcons 的 IconCheck、../../DirectorEditorContext、
 *          ../../model/directorTypes 的 DirectorObject、../../model/actionLibrary（ACTION_LIBRARY / resolveActionAlias / T_POSE_ACTION_ID）、../../model/rigs 的 BODY_TYPE_PRESETS、../fields/FieldPrimitives
 * [OUTPUT]: 对外提供 PoseTab：「内置姿态」列表（名字 + 当前项勾选，点 = 换 posePreset 并清微调）+ 提示；「快捷体形」列表（按缩放容差 0.02 判当前项）+ 提示
 * [POS]: director/panels/inspector 的角色姿态页：清单与动作库同一份（T-Pose + 9 个 FBX）；当前项按别名解析，体形当前项按缩放匹配。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../../../utils/cn'
import { IconCheck } from '../../../../../../vendor/tablerIcons'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import { ACTION_LIBRARY, resolveActionAlias, T_POSE_ACTION_ID } from '../../model/actionLibrary'
import type { DirectorObject, Vec3 } from '../../model/directorTypes'
import { BODY_TYPE_PRESETS } from '../../model/rigs'
import { InspectorCard, SectionHeader } from '../fields/FieldPrimitives'

const SCALE_TOLERANCE = 0.02
const scaleMatches = (a: Vec3, b: Vec3): boolean => Math.abs(a.x - b.x) <= SCALE_TOLERANCE && Math.abs(a.y - b.y) <= SCALE_TOLERANCE && Math.abs(a.z - b.z) <= SCALE_TOLERANCE

// 先信 bodyType 字段（且缩放还对得上），否则按缩放找
function activeBodyType(object: DirectorObject): string | null {
  if (object.bodyType) {
    const preset = BODY_TYPE_PRESETS.find((item) => item.id === object.bodyType)
    if (preset && scaleMatches(object.scale, preset.scale)) return preset.id
  }
  return BODY_TYPE_PRESETS.find((item) => scaleMatches(object.scale, item.scale))?.id ?? null
}

function ListButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={cn(
        'flex h-7 items-center justify-between rounded-nomi-sm border px-2 text-left text-caption transition-colors',
        active ? 'border-nomi-accent bg-nomi-accent/10 text-nomi-ink' : 'border-nomi-line-soft bg-nomi-ink-05 text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink',
      )}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
      {active ? <IconCheck size={14} stroke={2} className="ml-1 shrink-0" /> : null}
    </button>
  )
}

export function PoseTab({ object }: { object: DirectorObject }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const activePreset = resolveActionAlias(object.posePreset ?? T_POSE_ACTION_ID)?.id ?? T_POSE_ACTION_ID
  const activeBody = activeBodyType(object)
  return (
    <>
      <InspectorCard>
        <SectionHeader title={t('director.character.posePresets')} />
        <div className="grid grid-cols-2 gap-1" role="listbox" aria-label={t('director.character.posePresets')}>
          {ACTION_LIBRARY.map((entry) => (
            <ListButton key={entry.id} label={t(`director.action.library.${entry.id}`)} active={entry.id === activePreset} onClick={() => store.getState().applyPosePreset(object.id, entry.id)} />
          ))}
        </div>
        <p className="mt-1 text-micro leading-relaxed text-nomi-ink-40">{t('director.character.posePresetsHint')}</p>
      </InspectorCard>
      <InspectorCard>
        <SectionHeader title={t('director.character.bodyTypes')} />
        <div className="grid grid-cols-2 gap-1" role="listbox" aria-label={t('director.character.bodyTypes')}>
          {BODY_TYPE_PRESETS.map((preset) => (
            <ListButton key={preset.id} label={t(`director.bodyType.${preset.id}`)} active={activeBody === preset.id} onClick={() => store.getState().setBodyType(object.id, preset.id)} />
          ))}
        </div>
        <p className="mt-1 text-micro leading-relaxed text-nomi-ink-40">{t('director.character.bodyTypesHint2')}</p>
      </InspectorCard>
    </>
  )
}
