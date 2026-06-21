// Scene3D 检视面板：左侧场景节点列表 + 右侧属性/姿势编辑。
// 从 Scene3DFullscreen.tsx 抽出，纯展示组件；计算依赖 scene3dMath.ts，常量依赖 scene3dConstants.ts。
import React from 'react'
import { NomiSelect } from '../../../../design'
import {
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconFocusCentered,
  IconSettings,
  IconTrash,
  IconUser,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { Switch } from '../../../../ui/switch'
import {
  SCENE3D_ASPECT_OPTIONS,
  type Scene3DAspectRatio,
  type Scene3DCamera,
  type Scene3DLightType,
  type Scene3DObject,
  type Scene3DSelection,
  type Scene3DState,
  type Scene3DVector3,
} from './scene3dTypes'
import {
  radiansToDegrees,
  degreesToRadians,
  CROWD_MAX_AXIS,
  SCENE3D_LIGHT_BACKGROUND,
  SCENE3D_DARK_BACKGROUND,
  MANNEQUIN_POSE_SECTIONS,
  MANNEQUIN_POSE_MIN_DEG,
  MANNEQUIN_POSE_MAX_DEG,
  MANNEQUIN_POSE_PRESETS,
  type MannequinPoseControl,
  type MannequinPosePreset,
} from './scene3dConstants'
import {
  crowdCount,
  clonePoseValue,
  poseMatchesPreset,
  cameraLookAtRotation,
  roleColorForIndex,
  mannequinRoleLabel,
  updateVectorValue,
  numberInputValue,
} from './scene3dMath'

function VectorInputs({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: Scene3DVector3
  disabled?: boolean
  onChange: (value: Scene3DVector3) => void
}): JSX.Element {
  return (
    <label className="grid gap-1">
      <span className="text-micro text-[var(--nomi-ink-60)]">{label}</span>
      <span className="grid grid-cols-3 gap-1">
        {value.map((part, index) => (
          <input
            key={index}
            className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)] disabled:opacity-50"
            disabled={disabled}
            type="number"
            step="0.1"
            value={numberInputValue(part)}
            onChange={(event) => onChange(updateVectorValue(value, index, Number(event.currentTarget.value)))}
          />
        ))}
      </span>
    </label>
  )
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}): JSX.Element {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : '#808080'
  const displayValue = color.toUpperCase()

  return (
    <div className="grid gap-1">
      <span className="text-micro text-[var(--nomi-ink-60)]">{label}</span>
      <div className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2">
        <label
          className={cn(
            'relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-nomi-sm border border-[var(--nomi-line)]',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-[var(--nomi-accent)]',
          )}
          title={disabled ? undefined : '选择颜色'}
        >
          <span className="absolute inset-0" style={{ backgroundColor: color }} />
          <input
            className="absolute inset-0 size-full cursor-inherit opacity-0"
            disabled={disabled}
            type="color"
            value={color}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </label>
        <input
          aria-label={`${label}值`}
          className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-ink-05)] px-2 font-mono text-caption font-medium uppercase text-[var(--nomi-ink)] outline-none disabled:opacity-50"
          disabled={disabled}
          readOnly
          value={displayValue}
        />
      </div>
    </div>
  )
}

export function SceneObjectList({
  objects,
  cameras,
  selection,
  readOnly,
  onSelect,
  onFocus,
  onObjectPatch,
  onCameraPatch,
  onDelete,
}: {
  objects: Scene3DObject[]
  cameras: Scene3DCamera[]
  selection: Scene3DSelection
  readOnly: boolean
  onSelect: (selection: Scene3DSelection) => void
  onFocus: (id: string) => void
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
  onCameraPatch: (id: string, patch: Partial<Scene3DCamera>) => void
  onDelete: (selection: Exclude<Scene3DSelection, null>) => void
}): JSX.Element {
  const [renaming, setRenaming] = React.useState<string>('')
  const [expandedCrowds, setExpandedCrowds] = React.useState<Record<string, boolean>>({})
  const rows = React.useMemo(() => {
    let roleIndex = 0
    const objectRows = objects.map((object) => {
      const roleStartIndex = object.type === 'mannequin' || object.type === 'mannequinCrowd'
        ? roleIndex
        : undefined
      if (object.type === 'mannequin') roleIndex += 1
      if (object.type === 'mannequinCrowd') roleIndex += crowdCount(object)
      return {
        id: object.id,
        type: 'object' as const,
        name: object.name,
        visible: object.visible,
        object,
        roleStartIndex,
      }
    })
    return [
      ...objectRows,
      ...cameras.map((camera) => ({
        id: camera.id,
        type: 'camera' as const,
        name: camera.name,
        visible: camera.visible,
        camera,
        roleStartIndex: undefined,
      })),
    ]
  }, [cameras, objects])

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--nomi-paper)]">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <h3 className="m-0 text-caption font-medium text-[var(--nomi-ink)]">场景节点</h3>
        <span className="text-micro text-[var(--nomi-ink-60)]">{rows.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {rows.map((row) => {
          const selected = selection?.type === row.type && selection.id === row.id
          const rowObject = row.type === 'object' ? row.object : undefined
          const isCrowd = rowObject?.type === 'mannequinCrowd'
          const crowdExpanded = isCrowd ? expandedCrowds[row.id] ?? true : false
          return (
            <React.Fragment key={row.id}>
              <div
                className={cn(
                  'group grid grid-cols-[22px_24px_minmax(0,1fr)_28px_28px] items-center gap-1 rounded-nomi-sm px-1 py-1',
                  'text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)]',
                  selected && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
                )}
                onDoubleClick={() => {
                  if (!readOnly) setRenaming(row.id)
                  onFocus(row.id)
                }}
              >
                {isCrowd ? (
                  <button
                    className="grid size-6 place-items-center rounded-nomi-sm text-[var(--nomi-ink-45)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]"
                    type="button"
                    title={crowdExpanded ? '收起群众' : '展开群众'}
                    onClick={() => setExpandedCrowds((current) => ({ ...current, [row.id]: !crowdExpanded }))}
                  >
                    {crowdExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </button>
                ) : (
                  <span aria-hidden="true" className="size-6" />
                )}
                <button
                  className="grid size-6 place-items-center rounded-nomi-sm text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]"
                  type="button"
                  title="聚焦"
                  onClick={() => onFocus(row.id)}
                >
                  <IconFocusCentered size={14} />
                </button>
                {renaming === row.id ? (
                  <input
                    autoFocus
                    className="h-7 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                    defaultValue={row.name}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim()
                      if (name) {
                        if (row.type === 'object') onObjectPatch(row.id, { name })
                        else onCameraPatch(row.id, { name })
                      }
                      setRenaming('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') setRenaming('')
                    }}
                  />
                ) : (
                  <button
                    className="min-w-0 truncate bg-transparent p-0 text-left text-caption text-inherit"
                    type="button"
                    onClick={() => onSelect({ type: row.type, id: row.id })}
                  >
                    {row.name}
                  </button>
                )}
                <button
                  className="grid size-7 place-items-center rounded-nomi-sm text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)] disabled:opacity-40"
                  disabled={readOnly}
                  type="button"
                  title={row.visible ? '隐藏' : '显示'}
                  onClick={() => {
                    if (row.type === 'object') onObjectPatch(row.id, { visible: !row.visible })
                    else onCameraPatch(row.id, { visible: !row.visible })
                  }}
                >
                  {row.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                </button>
                <button
                  className="grid size-7 place-items-center rounded-nomi-sm text-[var(--nomi-ink-45)] hover:bg-[var(--workbench-danger-soft)] hover:text-[var(--workbench-danger)] disabled:opacity-40"
                  disabled={readOnly}
                  type="button"
                  title="删除"
                  onClick={() => onDelete({ type: row.type, id: row.id })}
                >
                  <IconTrash size={14} />
                </button>
              </div>
              {isCrowd && crowdExpanded ? (
                <div className="mb-1 grid gap-0.5 pl-[22px]">
                  {Array.from({ length: rowObject ? crowdCount(rowObject) : 0 }, (_, index) => {
                    const roleIndex = (row.roleStartIndex ?? 0) + index
                    const roleColor = roleColorForIndex(roleIndex)
                    return (
                      <button
                        key={`${row.id}-member-${index}`}
                        className={cn(
                          'grid grid-cols-[24px_minmax(0,1fr)_56px] items-center gap-1 rounded-nomi-sm px-1 py-1',
                          'text-left text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                          selected && 'text-[var(--nomi-ink)]',
                        )}
                        type="button"
                        title="群众成员不可单独调整"
                        onClick={() => onSelect({ type: 'object', id: row.id })}
                      >
                        <span className="grid size-6 place-items-center rounded-nomi-sm text-[var(--nomi-ink-45)]">
                          <IconUser size={13} />
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="size-2 shrink-0 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: roleColor }}
                          />
                          <span className="min-w-0 truncate text-caption">{mannequinRoleLabel(roleIndex)}</span>
                        </span>
                        <span className="justify-self-end rounded-nomi-sm bg-[var(--nomi-ink-05)] px-1.5 py-0.5 text-micro text-[var(--nomi-ink-45)]">
                          只读
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </React.Fragment>
          )
        })}
      </div>
    </section>
  )
}

type SceneObjectInspectorTab = 'properties' | 'pose'

function mannequinPoseControlValue(control: MannequinPoseControl, pose?: Record<string, Scene3DVector3>): number {
  const rotation = pose?.[control.bone] || [0, 0, 0]
  const scale = control.valueScale || 1
  return Number((control.standingValue + radiansToDegrees(rotation[control.axisIndex]) / scale).toFixed(1))
}

function MannequinPosePanel({
  object,
  readOnly,
  onObjectPatch,
}: {
  object: Scene3DObject
  readOnly: boolean
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
}): JSX.Element {
  const updatePoseControl = React.useCallback((control: MannequinPoseControl, degrees: number) => {
    const currentRotation = object.pose?.[control.bone] || [0, 0, 0]
    const scale = control.valueScale || 1
    const offsetDegrees = (degrees - control.standingValue) * scale
    const nextRotation = updateVectorValue(currentRotation, control.axisIndex, degreesToRadians(offsetDegrees))
    onObjectPatch(object.id, {
      pose: {
        ...(object.pose || {}),
        [control.bone]: nextRotation,
      },
    })
  }, [object.id, object.pose, onObjectPatch])

  const applyPosePreset = React.useCallback((preset: MannequinPosePreset) => {
    onObjectPatch(object.id, { pose: clonePoseValue(preset.pose) })
  }, [object.id, onObjectPatch])

  const activePosePresetId = MANNEQUIN_POSE_PRESETS.find((preset) => poseMatchesPreset(object.pose, preset))?.id

  const renderControl = (control: MannequinPoseControl): JSX.Element => {
    const value = mannequinPoseControlValue(control, object.pose)
    const min = control.min ?? MANNEQUIN_POSE_MIN_DEG
    const max = control.max ?? MANNEQUIN_POSE_MAX_DEG
    return (
      <label key={`${control.bone}-${control.axisIndex}-${control.label}`} className="grid grid-cols-[42px_1fr_58px] items-center gap-2 text-caption text-[var(--nomi-ink-60)]">
        <span>{control.label}</span>
        <input
          className="h-1.5 w-full accent-[var(--nomi-ink)] disabled:opacity-50"
          disabled={readOnly}
          max={max}
          min={min}
          step={1}
          type="range"
          value={value}
          onChange={(event) => updatePoseControl(control, Number(event.currentTarget.value))}
        />
        <input
          className="h-7 w-full rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-center font-mono text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-ink-35)] disabled:opacity-50"
          disabled={readOnly}
          max={max}
          min={min}
          step={1}
          type="number"
          value={value}
          onChange={(event) => updatePoseControl(control, Number(event.currentTarget.value))}
        />
      </label>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 py-2 text-micro leading-5 text-[var(--nomi-ink-60)]">
        <div className="font-medium text-[var(--nomi-ink)]">姿势调节</div>
        <div>默认值为站立参数，调整会实时映射到模型骨骼。</div>
      </div>
      <div className="grid gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2">
        <div className="text-caption font-medium text-[var(--nomi-ink)]">姿势预设</div>
        <div className="grid grid-cols-4 gap-1.5">
          {MANNEQUIN_POSE_PRESETS.map((preset) => {
            const active = activePosePresetId === preset.id
            return (
              <button
                key={preset.id}
                className={cn(
                  'h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-1 text-caption text-[var(--nomi-ink-70)] transition',
                  'hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)] disabled:cursor-not-allowed disabled:opacity-40',
                  active && 'border-[var(--nomi-ink)] bg-[var(--nomi-ink)] text-[var(--nomi-paper)] hover:bg-[var(--nomi-ink)] hover:text-[var(--nomi-paper)]',
                )}
                disabled={readOnly}
                type="button"
                onClick={() => applyPosePreset(preset)}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid gap-3">
        {MANNEQUIN_POSE_SECTIONS.map((section) => (
          <div key={section.title} className="grid gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2">
            <div className="text-caption font-medium text-[var(--nomi-ink)]">{section.title}</div>
            {section.controls ? (
              <div className="grid gap-2">{section.controls.map(renderControl)}</div>
            ) : (
              <div className="grid gap-3">
                {section.groups.map((group) => (
                  <div key={group.title} className="grid gap-2">
                    <div className="w-fit rounded-nomi-sm bg-[var(--nomi-ink-08)] px-1.5 py-0.5 text-micro font-medium text-[var(--nomi-ink-70)]">
                      {group.title}
                    </div>
                    <div className="grid gap-2">{group.controls.map(renderControl)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function PropertyPanel({
  state,
  selection,
  readOnly,
  onObjectPatch,
  onCameraPatch,
  onEnvironmentPatch,
}: {
  state: Scene3DState
  selection: Scene3DSelection
  readOnly: boolean
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
  onCameraPatch: (id: string, patch: Partial<Scene3DCamera>) => void
  onEnvironmentPatch: (patch: Partial<Scene3DState['environment']>) => void
}): JSX.Element {
  const selectedObject = selection?.type === 'object'
    ? state.objects.find((object) => object.id === selection.id)
    : undefined
  const selectedCamera = selection?.type === 'camera'
    ? state.cameras.find((camera) => camera.id === selection.id)
    : undefined
  const [objectInspectorTab, setObjectInspectorTab] = React.useState<SceneObjectInspectorTab>('properties')
  const selectedObjectHasPose = selectedObject?.type === 'mannequin' || selectedObject?.type === 'mannequinCrowd'

  React.useEffect(() => {
    setObjectInspectorTab('properties')
  }, [selectedObject?.id])

  React.useEffect(() => {
    if (!selectedObjectHasPose) setObjectInspectorTab('properties')
  }, [selectedObjectHasPose])

  return (
    <section className="min-h-0 flex-1 overflow-auto bg-[var(--nomi-paper)] px-3 py-3">
      <div className="mb-3 flex items-center gap-2 text-caption font-medium text-[var(--nomi-ink)]">
        <IconSettings size={15} />
        属性
      </div>
      {selectedObject ? (
        <div className="grid gap-3">
          {selectedObjectHasPose ? (
            <div className="grid grid-cols-2 gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] p-1">
              {([
                ['properties', '属性'],
                ['pose', '姿势'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  className={cn(
                    'h-7 rounded-nomi-sm text-caption text-[var(--nomi-ink-60)] transition hover:bg-[var(--nomi-paper)] hover:text-[var(--nomi-ink)]',
                    objectInspectorTab === tab && 'bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-sm',
                  )}
                  type="button"
                  onClick={() => setObjectInspectorTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {selectedObjectHasPose && objectInspectorTab === 'pose' ? (
            <MannequinPosePanel object={selectedObject} readOnly={readOnly} onObjectPatch={onObjectPatch} />
          ) : (
            <>
          <label className="grid gap-1">
            <span className="text-micro text-[var(--nomi-ink-60)]">名称</span>
            <input
              className="h-8 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)] disabled:opacity-50"
              disabled={readOnly}
              value={selectedObject.name}
              onChange={(event) => onObjectPatch(selectedObject.id, { name: event.currentTarget.value })}
            />
          </label>
          <VectorInputs label="位置 XYZ" value={selectedObject.position} disabled={readOnly} onChange={(position) => onObjectPatch(selectedObject.id, { position })} />
          <VectorInputs label="旋转 XYZ" value={selectedObject.rotation} disabled={readOnly} onChange={(rotation) => onObjectPatch(selectedObject.id, { rotation })} />
          <VectorInputs label="缩放 XYZ" value={selectedObject.scale} disabled={readOnly} onChange={(scale) => onObjectPatch(selectedObject.id, { scale })} />
          {selectedObject.type === 'mannequinCrowd' ? (
            <div className="grid grid-cols-3 gap-2">
              {([
                ['crowdRows', '行数', 1, CROWD_MAX_AXIS, 1],
                ['crowdColumns', '列数', 1, CROWD_MAX_AXIS, 1],
                ['crowdSpacing', '圆间距', 0.2, 10, 0.1],
              ] as const).map(([field, label, min, max, step]) => (
                <label key={field} className="grid gap-1">
                  <span className="text-micro text-[var(--nomi-ink-60)]">{label}</span>
                  <input
                    className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                    disabled={readOnly}
                    max={max}
                    min={min}
                    step={step}
                    type="number"
                    value={selectedObject[field] ?? (field === 'crowdSpacing' ? 1.2 : 1)}
                    onChange={(event) => {
                      const value = Number(event.currentTarget.value)
                      if (field === 'crowdSpacing') onObjectPatch(selectedObject.id, { crowdSpacing: Math.min(10, Math.max(0.2, value)) })
                      else onObjectPatch(selectedObject.id, { [field]: Math.min(CROWD_MAX_AXIS, Math.max(1, Math.round(value))) })
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
          {(selectedObject.type === 'mesh' || selectedObject.type === 'mannequin') ? (
            <ColorField
              label="颜色"
              value={selectedObject.color || '#808080'}
              disabled={readOnly}
              onChange={(color) => onObjectPatch(selectedObject.id, { color })}
            />
          ) : null}
          {selectedObject.type === 'light' ? (
            <>
              <label className="grid gap-1">
                <span className="text-micro text-[var(--nomi-ink-60)]">灯光类型</span>
                <NomiSelect ariaLabel="灯光类型" className="w-full justify-between" disabled={readOnly}
                  value={selectedObject.lightType || 'point'}
                  options={[{ value: 'point', label: 'Point' }, { value: 'directional', label: 'Directional' }, { value: 'spot', label: 'Spot' }]}
                  onChange={(value) => onObjectPatch(selectedObject.id, { lightType: value as Scene3DLightType })} />
              </label>
              <label className="grid gap-1">
                <span className="text-micro text-[var(--nomi-ink-60)]">强度</span>
                <input
                  className="h-8 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                  disabled={readOnly}
                  min={0}
                  step={0.1}
                  type="number"
                  value={selectedObject.lightIntensity ?? 2}
                  onChange={(event) => onObjectPatch(selectedObject.id, { lightIntensity: Number(event.currentTarget.value) })}
                />
              </label>
              <ColorField
                label="灯光颜色"
                value={selectedObject.lightColor || '#ffffff'}
                disabled={readOnly}
                onChange={(lightColor) => onObjectPatch(selectedObject.id, { lightColor })}
              />
            </>
          ) : null}
            </>
          )}
        </div>
      ) : selectedCamera ? (
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-micro text-[var(--nomi-ink-60)]">名称</span>
            <input
              className="h-8 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)] disabled:opacity-50"
              disabled={readOnly}
              value={selectedCamera.name}
              onChange={(event) => onCameraPatch(selectedCamera.id, { name: event.currentTarget.value })}
            />
          </label>
          <VectorInputs
            label="相机位置 XYZ"
            value={selectedCamera.position}
            disabled={readOnly}
            onChange={(position) => onCameraPatch(selectedCamera.id, {
              position,
              rotation: cameraLookAtRotation(position, selectedCamera.target),
            })}
          />
          <VectorInputs
            label="拍摄目标 XYZ"
            value={selectedCamera.target}
            disabled={readOnly}
            onChange={(target) => onCameraPatch(selectedCamera.id, {
              target,
              rotation: cameraLookAtRotation(selectedCamera.position, target),
            })}
          />
          <label className="grid gap-1">
            <span className="text-micro text-[var(--nomi-ink-60)]">画幅比例</span>
            <NomiSelect ariaLabel="画幅比例" className="w-full justify-between" disabled={readOnly}
              value={selectedCamera.aspectRatio} options={SCENE3D_ASPECT_OPTIONS.map((option) => ({ value: option, label: option }))}
              onChange={(value) => onCameraPatch(selectedCamera.id, { aspectRatio: value as Scene3DAspectRatio })} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['fov', 'near', 'far'] as const).map((field) => (
              <label key={field} className="grid gap-1">
                <span className="text-micro text-[var(--nomi-ink-60)]">{field.toUpperCase()}</span>
                <input
                  className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                  disabled={readOnly}
                  min={field === 'fov' ? 12 : 0.01}
                  step={field === 'fov' ? 1 : 0.1}
                  type="number"
                  value={selectedCamera[field]}
                  onChange={(event) => onCameraPatch(selectedCamera.id, { [field]: Number(event.currentTarget.value) })}
                />
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <label htmlFor="scene3d-dark-mode">场景暗色</label>
            <Switch
              id="scene3d-dark-mode"
              checked={state.environment.darkMode}
              disabled={readOnly}
              onCheckedChange={(darkMode) => onEnvironmentPatch({
                darkMode,
                backgroundColor: darkMode ? SCENE3D_DARK_BACKGROUND : SCENE3D_LIGHT_BACKGROUND,
              })}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <label htmlFor="scene3d-show-grid">网格地面</label>
            <Switch
              id="scene3d-show-grid"
              checked={state.environment.showGrid}
              disabled={readOnly}
              onCheckedChange={(checked) => onEnvironmentPatch({ showGrid: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <label htmlFor="scene3d-show-axes">坐标轴</label>
            <Switch
              id="scene3d-show-axes"
              checked={state.environment.showAxes}
              disabled={readOnly}
              onCheckedChange={(checked) => onEnvironmentPatch({ showAxes: checked })}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <label htmlFor="scene3d-show-sky">天空背景</label>
            <Switch
              id="scene3d-show-sky"
              checked={state.environment.showSky}
              disabled={readOnly}
              onCheckedChange={(checked) => onEnvironmentPatch({ showSky: checked })}
            />
          </div>
          <ColorField
            label="背景颜色"
            value={state.environment.backgroundColor}
            disabled={readOnly}
            onChange={(backgroundColor) => onEnvironmentPatch({ backgroundColor })}
          />
        </div>
      )}
    </section>
  )
}
