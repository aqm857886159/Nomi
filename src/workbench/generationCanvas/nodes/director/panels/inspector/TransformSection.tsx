/**
 * [INPUT]: 依赖 react、react-i18next、../../DirectorEditorContext、../../model/directorTypes、../../model/editLayer、../../scene/viewSettings 的 FREE_CAMERA_HOME、
 *          ../fields/FieldPrimitives（InspectorCard / SectionHeader）、../fields/SliderNumberField
 * [OUTPUT]: 对外提供 ObjectTransformSection（位置 / 朝向 / 缩放）、CameraTransformSection（位置 + 水平 / 俯仰 / 横滚），空间变换卡逐行：
 *           每个量一组「小标题 + ↺」+ 三条滑条（位置 ±100 步 0.1 · 水平 0–360 / 俯仰 ±90 / 横滚 ±180 步 1 · 缩放 0.1–10 步 0.05），经编辑层写回，只读层禁用并解释
 * [POS]: director/panels/inspector 的空间变换分区：与 gizmo 走同一条 write*SpatialTransform 路径；机位位置 ↺ 回自由相机的家 (0, 1.7, 10)、朝向 ↺ 归零。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorCamera, DirectorObject, Vec3 } from '../../model/directorTypes'
import { resolveEditLayer } from '../../model/editLayer'
import { FREE_CAMERA_HOME } from '../../scene/viewSettings'
import { InspectorCard, SectionHeader } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'

type Axis = 'x' | 'y' | 'z'
type AxisRange = { min: number; max: number; step: number; digits?: number }
const POSITION_RANGE: AxisRange = { min: -100, max: 100, step: 0.1, digits: 2 }
const SCALE_RANGE: AxisRange = { min: 0.1, max: 10, step: 0.05, digits: 2 }
// 朝向：x = 俯仰、y = 水平、z = 横滚（显示顺序 水平 / 俯仰 / 横滚）
const ORIENTATION_ORDER: Axis[] = ['y', 'x', 'z']
const ORIENTATION_RANGE: Record<Axis, AxisRange> = {
  y: { min: 0, max: 360, step: 1, digits: 1 },
  x: { min: -90, max: 90, step: 1, digits: 1 },
  z: { min: -180, max: 180, step: 1, digits: 1 },
}

function useEditLayer(entity: DirectorObject | DirectorCamera, isCamera: boolean) {
  return useDirectorStore((state) => resolveEditLayer(entity, { currentTime: state.timeline.currentTime, activeWaypointId: state.selection.activeWaypointId }, isCamera))
}

/** 一组「小标题 + ↺」+ 三条滑条 */
function Vec3Sliders({
  title,
  value,
  order,
  ranges,
  labels,
  unit,
  onReset,
  onChangeStart,
  onChange,
}: {
  title: string
  value: Vec3
  order: Axis[]
  ranges: Record<Axis, AxisRange> | AxisRange
  labels: Record<Axis, string>
  unit?: string
  onReset: () => void
  onChangeStart: () => void
  onChange: (next: Vec3) => void
}): JSX.Element {
  const rangeOf = (axis: Axis): AxisRange => ('min' in ranges ? (ranges as AxisRange) : (ranges as Record<Axis, AxisRange>)[axis])
  return (
    <div className="mt-1">
      <SectionHeader title={title} onReset={onReset} />
      {order.map((axis) => {
        const range = rangeOf(axis)
        return (
          <SliderNumberField
            key={axis}
            label={labels[axis]}
            value={value[axis]}
            min={range.min}
            max={range.max}
            step={range.step}
            digits={range.digits}
            unit={unit}
            onChangeStart={onChangeStart}
            onChange={(next) => onChange({ ...value, [axis]: next })}
          />
        )
      })}
    </div>
  )
}

function EditModeLine({ layer }: { layer: ReturnType<typeof resolveEditLayer> }): JSX.Element {
  const { t } = useTranslation()
  const readonly = layer === 'evaluated-readonly'
  return (
    <div className={`mb-1 text-micro ${readonly ? 'text-nomi-warning' : 'text-nomi-ink-40'}`} data-testid="director-edit-mode">
      {t('director.editor.editMode')}：{layer === 'keyframe' ? t('director.editor.editModeKeyframe') : readonly ? t('director.editor.editModeReadonly') : t('director.editor.editModeRest')}
    </div>
  )
}

export function ObjectTransformSection({ object }: { object: DirectorObject }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const layer = useEditLayer(object, false)
  const evaluated = useDirectorStore((state) => state.evaluatedPoses[object.id] ?? null)
  const readonly = layer === 'evaluated-readonly'
  const position = evaluated?.position ?? object.position
  const rotation = evaluated?.rotation ?? object.rotation
  const write = (patch: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }) => {
    store.getState().writeObjectSpatialTransform(object.id, patch)
  }
  const reset = (patch: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }) => {
    store.getState().saveState()
    write(patch)
  }
  const axisLabels = { x: 'X', y: 'Y', z: 'Z' }
  const orientationLabels = { x: t('director.inspector.pitch'), y: t('director.inspector.yaw'), z: t('director.inspector.roll') }
  return (
    <InspectorCard className={readonly ? 'opacity-70' : ''}>
      <SectionHeader title={t('director.inspector.transform')} />
      <EditModeLine layer={layer} />
      <fieldset disabled={readonly}>
        <Vec3Sliders title={t('director.inspector.position')} value={position} order={['x', 'y', 'z']} ranges={POSITION_RANGE} labels={axisLabels} onReset={() => reset({ position: { x: 0, y: 0, z: 0 } })} onChangeStart={() => store.getState().saveState()} onChange={(next) => write({ position: next })} />
        <Vec3Sliders title={t('director.inspector.rotation')} value={rotation} order={ORIENTATION_ORDER} ranges={ORIENTATION_RANGE} labels={orientationLabels} onReset={() => reset({ rotation: { x: 0, y: 0, z: 0 } })} onChangeStart={() => store.getState().saveState()} onChange={(next) => write({ rotation: next })} />
        <Vec3Sliders title={t('director.inspector.scale')} value={object.scale} order={['x', 'y', 'z']} ranges={SCALE_RANGE} labels={axisLabels} onReset={() => reset({ scale: { x: 1, y: 1, z: 1 } })} onChangeStart={() => store.getState().saveState()} onChange={(next) => write({ scale: next })} />
      </fieldset>
    </InspectorCard>
  )
}

export function CameraTransformSection({ camera }: { camera: DirectorCamera }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const layer = useEditLayer(camera, true)
  const evaluated = useDirectorStore((state) => state.evaluatedPoses[camera.id] ?? null)
  const readonly = layer === 'evaluated-readonly'
  const position = evaluated?.position ?? camera.position
  const rotation = evaluated?.rotation ?? { x: camera.pitch, y: camera.yaw, z: camera.roll }
  const write = (patch: { position?: Vec3; rotation?: Vec3 }) => {
    store.getState().writeCameraSpatialTransform(camera.id, patch)
  }
  const reset = (patch: { position?: Vec3; rotation?: Vec3 }) => {
    store.getState().saveState()
    write(patch)
  }
  return (
    <InspectorCard className={readonly ? 'opacity-70' : ''}>
      <SectionHeader title={t('director.inspector.transform')} />
      <EditModeLine layer={layer} />
      <fieldset disabled={readonly}>
        <Vec3Sliders title={t('director.inspector.position')} value={position} order={['x', 'y', 'z']} ranges={POSITION_RANGE} labels={{ x: 'X', y: 'Y', z: 'Z' }} onReset={() => reset({ position: { ...FREE_CAMERA_HOME.position } })} onChangeStart={() => store.getState().saveState()} onChange={(next) => write({ position: next })} />
        <Vec3Sliders
          title={t('director.inspector.rotation')}
          value={rotation}
          order={ORIENTATION_ORDER}
          ranges={ORIENTATION_RANGE}
          labels={{ x: t('director.inspector.pitch'), y: t('director.inspector.yaw'), z: t('director.inspector.roll') }}
          onReset={() => reset({ rotation: { x: 0, y: 0, z: 0 } })}
          onChangeStart={() => store.getState().saveState()}
          onChange={(next) => write({ rotation: next })}
        />
      </fieldset>
    </InspectorCard>
  )
}
