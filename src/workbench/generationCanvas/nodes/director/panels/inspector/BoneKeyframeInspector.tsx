/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton、../../DirectorEditorContext、../../model/directorTypes（DirectorObject / BoneKeyframe）
 * [OUTPUT]: 对外提供 BoneKeyframeInspector（清单 §4.7 I12：帧读数、提示去骨骼页改数值、删除）
 * [POS]: director/panels/inspector 的骨骼关键帧卡：选中关键帧时骨骼页的把手 / 滑条都写进这一帧（storeCharacterActions.rotationTarget）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../../../../design'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { BoneKeyframe, DirectorObject } from '../../model/directorTypes'

export function BoneKeyframeInspector({ object, keyframe }: { object: DirectorObject; keyframe: BoneKeyframe }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  return (
    <div className="rounded-nomi border border-nomi-line-soft bg-nomi-paper p-2">
      <div className="flex items-center justify-between gap-2 text-caption">
        <span className="font-semibold text-nomi-ink">{t('director.boneKeyframe.title')}</span>
        <span className="font-nomi-mono text-nomi-ink-60">{t('director.boneKeyframe.frame', { frame: keyframe.frame })}</span>
      </div>
      <div className="py-1 text-caption text-nomi-ink-40">{t('director.boneKeyframe.editHint', { count: Object.keys(keyframe.boneRotations).length })}</div>
      <WorkbenchButton size="sm" className="mt-1 text-nomi-danger" onClick={() => store.getState().deleteBoneKeyframe(object.id, keyframe.id)}>
        {t('director.boneKeyframe.delete')}
      </WorkbenchButton>
    </div>
  )
}
