/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design（NomiSegmented / WorkbenchButton）、../../../../../../utils/cn、../../DirectorEditorContext、../../model/directorTypes、
 *          ../../model/ikChains 的 IkHandleKey、../../model/rigs（boneName / jointAxisLabelKey / SemanticBone）、../../scene/ViewportApiContext、
 *          ../fields/FieldPrimitives、../fields/SliderNumberField、./PuppetFigure
 * [OUTPUT]: 对外提供 SkeletonTab：卡头「姿态动力学与骨骼 ｜ 全部复位」→ 分段「IK 动力学手柄 / FK 骨骼微调」→
 *           人偶（状态行 + W / E 芯片 + 右(R)/左(L) 角标）→ IK：「双脚落地 / 镜像姿态」两键 + 已选中手柄卡（复位肢体）或提示；
 *           FK：已选关节卡（重置关节 / 快选 −90 −45 0 45 90 / 三轴 ±180 语义滑条）或提示
 * [POS]: director/panels/inspector 的角色骨骼页：分段即 IK 开关（切 IK 无靶点默认骨盆、切 FK 清靶点）；镜像方向按所选靶点的侧；
 *        滑条 / 快选写 setBoneRotation（写入落点由 store 决定）；双脚吸附走 ViewportApi 到 scene 侧两骨 IK。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSegmented, WorkbenchButton } from '../../../../../../design'
import { cn } from '../../../../../../utils/cn'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject, Vec3 } from '../../model/directorTypes'
import type { IkHandleKey } from '../../model/ikChains'
import { boneName, jointAxisLabelKey, type SemanticBone } from '../../model/rigs'
import { useViewportApi } from '../../scene/ViewportApiContext'
import { InspectorCard, SectionHeader } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'
import { PuppetFigure } from './PuppetFigure'

type Mode = 'ik' | 'fk'
const ZERO: Vec3 = { x: 0, y: 0, z: 0 }
const QUICK_PICKS = [-90, -45, 0, 45, 90]

// 镜像方向 = 所选靶点属于右侧则从右往左，否则从左往右
function mirrorSideOf(key: IkHandleKey | null): 'left' | 'right' {
  return key === 'rightHand' || key === 'rightFoot' || key === 'rightElbowPole' || key === 'rightKneePole' ? 'right' : 'left'
}

export function SkeletonTab({ object }: { object: DirectorObject }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const apiRef = useViewportApi()
  const ikEnabled = useDirectorStore((state) => state.ikModeEnabled)
  const ikTarget = useDirectorStore((state) => state.selection.ikTarget as IkHandleKey | null)
  const boneKey = useDirectorStore((state) => state.selection.boneKey as SemanticBone | null)
  const keyframe = useDirectorStore((state) => {
    const id = state.selection.boneKeyframeId
    if (!id) return null
    for (const clip of object.actionClips ?? []) {
      const found = clip.keyframes?.find((item) => item.id === id)
      if (found) return found
    }
    return null
  })
  const mode: Mode = ikEnabled ? 'ik' : 'fk'
  const rig = object.rig ?? 'mixamo'
  // 选中骨骼关键帧时读那一帧，否则读静止微调
  const rotations = keyframe?.boneRotations ?? object.boneRotations ?? {}
  const jointRotation = (bone: SemanticBone): Vec3 => rotations[boneName(rig, bone)] ?? ZERO
  const setJoint = (bone: SemanticBone, axis: 'x' | 'y' | 'z', value: number) => {
    store.getState().setBoneRotation(object.id, boneName(rig, bone), { ...jointRotation(bone), [axis]: value })
  }
  // 分段切换：切 IK 无靶点默认骨盆、切 FK 清靶点
  const setMode = (next: Mode) => {
    const state = store.getState()
    state.setIkModeEnabled(next === 'ik')
    if (next === 'ik') state.select({ objectId: object.id, boneKey: null, ikTarget: ikTarget ?? 'pelvis' })
    else state.select({ objectId: object.id, ikTarget: null })
  }
  // 重置关节 = 该骨偏移写成 0（不是删键）
  const resetJoint = () => {
    if (!boneKey) return
    store.getState().saveState()
    store.getState().setBoneRotation(object.id, boneName(rig, boneKey), { ...ZERO })
  }
  // 快选 0 = 三轴归零，其它 = 只写 X 轴
  const quickPick = (degrees: number) => {
    if (!boneKey) return
    store.getState().saveState()
    if (degrees === 0) store.getState().setBoneRotation(object.id, boneName(rig, boneKey), { ...ZERO })
    else setJoint(boneKey, 'x', degrees)
  }
  const statusName = mode === 'ik' ? (ikTarget ? t(`director.character.handle.${ikTarget}`) : '') : boneKey ? t(`director.character.joint.${boneKey}`) : ''

  return (
    <>
      <InspectorCard>
        <SectionHeader title={t('director.character.dynamicsTitle')} onReset={() => store.getState().resetAllPose(object.id)} resetLabel={t('director.character.resetAll')} resetHint={t('director.character.resetAllHint')} />
        <NomiSegmented
          ariaLabel={t('director.character.dynamicsTitle')}
          density="compact"
          value={mode}
          options={[
            { value: 'ik', label: t('director.character.modeIk') },
            { value: 'fk', label: t('director.character.modeFk') },
          ]}
          onChange={(value) => setMode(value as Mode)}
        />
        {/* 人偶头：模式点 + 「IK 动力学靶点：X」/「FK 骨骼关节：X」+ W / E 芯片 */}
        <div className="mt-2 flex min-h-7 items-center justify-between gap-2 px-1 text-micro">
          <span className="flex min-w-0 items-center gap-1 truncate">
            <span className={cn('size-2 shrink-0 rounded-full', mode === 'ik' ? 'bg-nomi-warning' : 'bg-workbench-success')} aria-hidden />
            <span className="font-medium text-nomi-ink-60">{mode === 'ik' ? t('director.character.ikTargetLabel') : t('director.character.fkJointLabel')}</span>
            <span className={cn('truncate font-medium', mode === 'ik' ? 'text-nomi-warning' : 'text-workbench-success')}>{statusName || t('director.character.pickIn3d')}</span>
          </span>
          <kbd className="shrink-0 rounded border border-nomi-line bg-nomi-bg px-1.5 py-0.5 font-nomi-mono text-micro text-nomi-ink-40">{mode === 'ik' ? t('director.character.solveTranslate') : t('director.character.rotateEuler')}</kbd>
        </div>
        <div className="relative w-full overflow-hidden rounded-nomi border border-nomi-line-soft bg-nomi-ink-05 px-4 py-2">
          <span className="pointer-events-none absolute left-2.5 top-2.5 rounded border border-nomi-line bg-nomi-bg/60 px-1.5 py-0.5 font-nomi-mono text-micro font-bold tracking-wider text-nomi-ink-40">{t('director.character.sideBadgeRight')}</span>
          <span className="pointer-events-none absolute right-2.5 top-2.5 rounded border border-nomi-line bg-nomi-bg/60 px-1.5 py-0.5 font-nomi-mono text-micro font-bold tracking-wider text-nomi-ink-40">{t('director.character.sideBadgeLeft')}</span>
          <PuppetFigure
            mode={mode}
            selectedHandle={ikTarget}
            selectedJoint={boneKey}
            onPickHandle={(key) => {
              const state = store.getState()
              state.setIkModeEnabled(true)
              state.select({ objectId: object.id, ikTarget: key, boneKey: null })
            }}
            onPickJoint={(bone) => {
              const state = store.getState()
              state.setIkModeEnabled(false)
              state.select({ objectId: object.id, boneKey: bone, ikTarget: null })
            }}
          />
        </div>
        {mode === 'ik' ? (
          <div className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-1.5">
              <WorkbenchButton size="sm" className="justify-center" title={t('director.character.snapFeetHint')} onClick={() => apiRef.current?.snapCharacterFeet(object.id)}>
                {t('director.character.snapFeet')}
              </WorkbenchButton>
              <WorkbenchButton size="sm" className="justify-center" title={t('director.character.mirrorHint')} onClick={() => store.getState().mirrorPose(object.id, mirrorSideOf(ikTarget))}>
                {t('director.character.mirror')}
              </WorkbenchButton>
            </div>
            {ikTarget ? (
              <div className="flex items-center justify-between gap-2 border-t border-nomi-line-soft pt-2 text-caption">
                <span className="min-w-0 truncate">
                  <span className="text-nomi-ink-40">{t('director.character.handleSelected')}</span>
                  <span className="font-medium text-nomi-ink">{t(`director.character.handle.${ikTarget}`)}</span>
                </span>
                <button type="button" className="shrink-0 text-micro text-nomi-ink-40 hover:text-nomi-ink" onClick={() => store.getState().resetLimb(object.id, ikTarget)}>
                  {t('director.character.resetLimb')}
                </button>
              </div>
            ) : (
              <p className="text-micro leading-relaxed text-nomi-ink-40">{t('director.character.ikHint')}</p>
            )}
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {boneKey ? (
              <>
                <div className="flex items-center justify-between gap-2 text-caption">
                  <span className="min-w-0 truncate">
                    <span className="text-nomi-ink-40">{t('director.character.jointSelected')}</span>
                    <span className="font-medium text-nomi-ink">{t(`director.character.joint.${boneKey}`)}</span>
                  </span>
                  <button type="button" className="shrink-0 text-micro text-nomi-ink-40 hover:text-nomi-ink" onClick={resetJoint}>
                    {t('director.character.resetJoint')}
                  </button>
                </div>
                <div className="flex items-center justify-end gap-1.5 text-micro text-nomi-ink-40">
                  <span className="shrink-0 select-none">{t('director.character.quickPick')}</span>
                  <div className="flex gap-1">
                    {QUICK_PICKS.map((degrees) => (
                      <button
                        key={degrees}
                        type="button"
                        className="rounded border border-nomi-line bg-nomi-bg px-1.5 py-0.5 font-nomi-mono text-micro text-nomi-ink-60 hover:bg-workbench-hover"
                        onClick={() => quickPick(degrees)}
                      >
                        {degrees === 0 ? t('director.character.zeroJoint') : t('director.character.quickDegrees', { sign: degrees > 0 ? '+' : '', degrees })}
                      </button>
                    ))}
                  </div>
                </div>
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <SliderNumberField
                    key={axis}
                    label={t(jointAxisLabelKey(boneKey, axis) as 'director.joint.head.x', { defaultValue: axis === 'x' ? t('director.joint.fallback.x') : axis === 'y' ? t('director.joint.fallback.y') : t('director.joint.fallback.z') })}
                    value={jointRotation(boneKey)[axis]}
                    min={-180}
                    max={180}
                    step={1}
                    unit="°"
                    onChangeStart={() => store.getState().saveState()}
                    onChange={(value) => setJoint(boneKey, axis, value)}
                  />
                ))}
              </>
            ) : (
              <p className="text-micro leading-relaxed text-nomi-ink-40">{t('director.character.fkHint')}</p>
            )}
          </div>
        )}
      </InspectorCard>
    </>
  )
}
