/**
 * [INPUT]: 依赖 react、react-i18next、../../DirectorEditorContext、../../model/directorTypes、
 *          ../../model/cameraLens（LENS_PRESETS / FOCAL_MM_MIN / FOCAL_MM_MAX / focalMmToFov）、../../../../../../utils/cn、../fields/*、./TransformSection
 * [OUTPUT]: 对外提供 CameraInspector：摄影机（机位名称）→ 镜头参数（常用焦段 4×2「NNmm + 用途」+ 焦距微调 12–300mm 滑条 + 垂直 FOV 读数）→ 空间变换 → 射线指示与视锥
 * [POS]: director/panels/inspector 的机位属性；fov 是真相，焦距是派生视图。进 / 出视角只住画中画，rig / 看向没有 UI（只读字段）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../../../utils/cn'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import { FOCAL_MM_MAX, FOCAL_MM_MIN, LENS_PRESETS, focalMmToFov } from '../../model/cameraLens'
import type { DirectorCamera } from '../../model/directorTypes'
import { InspectorCard, SectionHeader, TextField, ToggleField } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'
import { CameraTransformSection } from './TransformSection'

export function CameraInspector({ camera }: { camera: DirectorCamera }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const activePreset = LENS_PRESETS.find((preset) => Math.abs(preset.mm - camera.focalLengthMm) < 1)?.id ?? ''
  const setFocal = (mm: number) => store.getState().setCameraFov(camera.id, focalMmToFov(mm))
  const commit = (patch: Partial<DirectorCamera>) => store.getState().withHistory(() => store.getState().updateCamera(camera.id, patch))
  return (
    <>
      <InspectorCard>
        <SectionHeader title={t('director.inspector.cameraBasics')} />
        <TextField label={t('director.inspector.name')} value={camera.name} onCommit={(name) => commit({ name })} />
      </InspectorCard>
      <InspectorCard>
        <SectionHeader title={t('director.inspector.lens')} />
        {/* 常用焦段 4×2 网格，每格「NNmm」大字 + 用途小字 */}
        <div className="mb-1 text-micro text-nomi-ink-40">{t('director.inspector.lensPresets')}</div>
        <div className="grid grid-cols-4 gap-1" role="listbox" aria-label={t('director.inspector.lensPresets')}>
          {LENS_PRESETS.map((preset) => {
            const active = preset.id === activePreset
            return (
              <button
                key={preset.id}
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  'flex flex-col items-center rounded-nomi-sm border px-1 py-1 transition-colors',
                  active ? 'border-nomi-accent bg-nomi-accent/10 text-nomi-ink' : 'border-nomi-line-soft bg-nomi-ink-05 text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink',
                )}
                onClick={() => {
                  store.getState().saveState()
                  setFocal(preset.mm)
                }}
              >
                <span className="text-caption font-medium leading-tight">{t('director.camera.pipMm', { mm: preset.mm })}</span>
                <span className="text-micro leading-tight text-nomi-ink-40">{t(`director.lens.${preset.id}`)}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex items-center justify-between text-micro text-nomi-ink-40">
          <span>{t('director.inspector.focalLength')}</span>
          <span>{t('director.inspector.verticalFov', { fov: camera.fov.toFixed(1) })}</span>
        </div>
        <SliderNumberField label="" value={camera.focalLengthMm} min={FOCAL_MM_MIN} max={FOCAL_MM_MAX} step={1} unit="mm" onChangeStart={() => store.getState().saveState()} onChange={setFocal} />
      </InspectorCard>
      <CameraTransformSection camera={camera} />
      <InspectorCard>
        <ToggleField label={t('director.inspector.rayHelper')} checked={camera.showRayHelper !== false} onChange={(showRayHelper) => commit({ showRayHelper })} />
      </InspectorCard>
    </>
  )
}
