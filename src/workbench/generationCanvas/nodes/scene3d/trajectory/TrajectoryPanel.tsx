import React from 'react'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { cn } from '../../../../../utils/cn'
import { NomiSelect } from '../../../../../design'
import type {
  Scene3DState,
  Scene3DTrajectory,
  Scene3DTrajectoryBinding,
  Scene3DTrajectoryBoundObject,
  Scene3DTrajectoryPoint,
  Scene3DVector3,
} from '../scene3dTypes'

type TrajectoryPanelProps = {
  state: Scene3DState
  activeTrajectoryId: string | null
  activePointId: string | null
  readOnly: boolean
  onAddTrajectory: () => void
  onSelectTrajectory: (trajectoryId: string) => void
  onDeleteTrajectory: (trajectoryId: string) => void
  onPatchTrajectory: (trajectoryId: string, patch: Partial<Scene3DTrajectory>) => void
  onAddPoint: (trajectoryId: string) => void
  onSelectPoint: (trajectoryId: string, pointId: string) => void
  onUpdatePoint: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
  onDeletePoint: (trajectoryId: string, pointId: string) => void
  onBindObject: (trajectoryId: string, objectId: string) => void
  onPatchBinding: (bindingId: string, patch: Partial<Scene3DTrajectoryBinding>) => void
  onPatchBoundObject: (bindingId: string, objectId: string, patch: Partial<Scene3DTrajectoryBoundObject>) => void
  onUnbindObject: (bindingId: string, objectId: string) => void
  onDeleteBinding: (bindingId: string) => void
}

type TrajectoryBindableNode = {
  id: string
  name: string
}

function numberInputValue(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(3))) : '0'
}

function updateVectorValue(value: Scene3DVector3, index: number, nextValue: number): Scene3DVector3 {
  const next: Scene3DVector3 = [...value]
  next[index] = Number.isFinite(nextValue) ? nextValue : value[index]
  return next
}

const POSITION_AXIS_META = [
  { label: 'X', className: 'text-[var(--nomi-axis-x)]' },
  { label: 'Y', className: 'text-[var(--nomi-axis-y)]' },
  { label: 'Z', className: 'text-[var(--nomi-axis-z)]' },
] as const

function nodeName(state: Scene3DState, objectId: string): string {
  return state.objects.find((object) => object.id === objectId)?.name ||
    state.cameras.find((camera) => camera.id === objectId)?.name ||
    objectId
}

function globallyBoundObjectIds(bindings: Scene3DTrajectoryBinding[]): Set<string> {
  return new Set(bindings.flatMap((binding) => binding.objects.map((object) => object.objectId)))
}

function TrajectoryPointRow({
  trajectory,
  point,
  active,
  readOnly,
  onSelectPoint,
  onUpdatePoint,
  onDeletePoint,
}: {
  trajectory: Scene3DTrajectory
  point: Scene3DTrajectoryPoint
  active: boolean
  readOnly: boolean
  onSelectPoint: (trajectoryId: string, pointId: string) => void
  onUpdatePoint: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
  onDeletePoint: (trajectoryId: string, pointId: string) => void
}): JSX.Element {
  return (
    <div
      className={cn(
        'grid gap-2 rounded-nomi-sm border p-2',
        active ? 'border-[var(--nomi-ink)] bg-[var(--nomi-ink-05)]' : 'border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)]',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          className="min-w-0 truncate text-left text-caption font-medium text-[var(--nomi-ink)]"
          type="button"
          onClick={() => onSelectPoint(trajectory.id, point.id)}
        >
          控制点
        </button>
        <button
          className="grid size-7 place-items-center rounded-nomi-sm text-[var(--nomi-ink-40)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--workbench-danger)] disabled:opacity-40"
          disabled={readOnly || trajectory.points.length <= 2}
          type="button"
          title="删除控制点"
          onClick={() => onDeletePoint(trajectory.id, point.id)}
        >
          <IconTrash size={14} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {point.position.map((part, index) => (
          <label key={index} className="grid min-w-0 gap-1">
            <span className={cn('text-micro font-semibold leading-none', POSITION_AXIS_META[index]?.className)}>
              {POSITION_AXIS_META[index]?.label}
            </span>
            <input
              className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)] disabled:opacity-50"
              disabled={readOnly}
              step="0.1"
              type="number"
              value={numberInputValue(part)}
              onChange={(event) => onUpdatePoint(trajectory.id, point.id, updateVectorValue(point.position, index, Number(event.currentTarget.value)))}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

function TrajectoryBindingCard({
  state,
  trajectory,
  binding,
  active,
  readOnly,
  availableNodes,
  onSelectTrajectory,
  onBindObject,
  onPatchBinding,
  onPatchBoundObject,
  onUnbindObject,
  onDeleteBinding,
}: {
  state: Scene3DState
  trajectory: Scene3DTrajectory
  binding?: Scene3DTrajectoryBinding
  active: boolean
  readOnly: boolean
  availableNodes: TrajectoryBindableNode[]
  onSelectTrajectory: (trajectoryId: string) => void
  onBindObject: (trajectoryId: string, objectId: string) => void
  onPatchBinding: (bindingId: string, patch: Partial<Scene3DTrajectoryBinding>) => void
  onPatchBoundObject: (bindingId: string, objectId: string, patch: Partial<Scene3DTrajectoryBoundObject>) => void
  onUnbindObject: (bindingId: string, objectId: string) => void
  onDeleteBinding: (bindingId: string) => void
}): JSX.Element {
  return (
    <div className={cn(
      'grid gap-2 rounded-nomi-sm border p-2',
      active ? 'border-[var(--nomi-ink)] bg-[var(--nomi-ink-05)]' : 'border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)]',
    )}>
      <button className="flex min-w-0 items-center gap-2 text-left" type="button" onClick={() => onSelectTrajectory(trajectory.id)}>
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: trajectory.color }} />
        <span className="min-w-0 flex-1 truncate text-caption font-medium text-[var(--nomi-ink)]">{trajectory.name}</span>
        <span className="shrink-0 text-micro text-[var(--nomi-ink-40)]">{binding?.objects.length ?? 0}节点</span>
      </button>

      {binding ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="text-micro text-[var(--nomi-ink-60)]">开始</span>
              <input
                className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                disabled={readOnly}
                min={0}
                step={0.1}
                type="number"
                value={numberInputValue(binding.startTime)}
                onChange={(event) => onPatchBinding(binding.id, { startTime: Math.max(0, Number(event.currentTarget.value)) })}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-micro text-[var(--nomi-ink-60)]">结束</span>
              <input
                className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                disabled={readOnly}
                min={0.1}
                step={0.1}
                type="number"
                value={numberInputValue(binding.endTime)}
                onChange={(event) => onPatchBinding(binding.id, { endTime: Math.max(binding.startTime + 0.001, Number(event.currentTarget.value)) })}
              />
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-micro text-[var(--nomi-ink-60)]">方向</span>
            <NomiSelect
              ariaLabel="方向"
              disabled={readOnly}
              value={binding.direction}
              options={[
                { value: 'forward', label: 'Forward' },
                { value: 'reverse', label: 'Reverse' },
              ]}
              onChange={(value) => onPatchBinding(binding.id, { direction: value as Scene3DTrajectoryBinding['direction'] })}
            />
          </label>
          {binding.objects.map((boundObject) => (
            <div key={boundObject.objectId} className="grid grid-cols-[minmax(0,1fr)_72px_28px] items-end gap-1">
              <div className="min-w-0 truncate rounded-nomi-sm bg-[var(--nomi-ink-05)] px-2 py-2 text-caption text-[var(--nomi-ink)]">
                {nodeName(state, boundObject.objectId)}
              </div>
              <label className="grid gap-1">
                <span className="text-micro text-[var(--nomi-ink-40)]">Offset</span>
                <input
                  className="h-8 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-1.5 text-caption text-[var(--nomi-ink)] outline-none"
                  disabled={readOnly}
                  max={0.999}
                  min={-0.999}
                  step={0.05}
                  type="number"
                  value={numberInputValue(boundObject.offsetRatio)}
                  onChange={(event) => onPatchBoundObject(binding.id, boundObject.objectId, {
                    offsetRatio: Math.min(0.999, Math.max(-0.999, Number(event.currentTarget.value))),
                  })}
                />
              </label>
              <button
                className="grid size-7 place-items-center rounded-nomi-sm text-[var(--nomi-ink-40)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--workbench-danger)] disabled:opacity-40"
                disabled={readOnly}
                type="button"
                title="解绑节点"
                onClick={() => onUnbindObject(binding.id, boundObject.objectId)}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
          <NomiSelect
            ariaLabel="添加绑定节点"
            placeholder="添加绑定节点"
            disabled={readOnly || availableNodes.length === 0}
            value=""
            options={availableNodes.map((node) => ({ value: node.id, label: node.name }))}
            onChange={(objectId) => {
              if (objectId) onBindObject(trajectory.id, objectId)
            }}
          />
          <button
            className="h-7 rounded-nomi-sm bg-[var(--nomi-ink-05)] text-micro text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--workbench-danger)] disabled:opacity-40"
            disabled={readOnly}
            type="button"
            onClick={() => onDeleteBinding(binding.id)}
          >
            删除绑定
          </button>
        </>
      ) : (
        <NomiSelect
          ariaLabel="选择节点创建绑定"
          placeholder="选择节点创建绑定"
          disabled={readOnly || availableNodes.length === 0}
          value=""
          options={availableNodes.map((node) => ({ value: node.id, label: node.name }))}
          onChange={(objectId) => {
            if (objectId) onBindObject(trajectory.id, objectId)
          }}
        />
      )}
    </div>
  )
}

export function TrajectoryPanel({
  state,
  activeTrajectoryId,
  activePointId,
  readOnly,
  onAddTrajectory,
  onSelectTrajectory,
  onDeleteTrajectory,
  onPatchTrajectory,
  onAddPoint,
  onSelectPoint,
  onUpdatePoint,
  onDeletePoint,
  onBindObject,
  onPatchBinding,
  onPatchBoundObject,
  onUnbindObject,
  onDeleteBinding,
}: TrajectoryPanelProps): JSX.Element {
  const activeTrajectory = activeTrajectoryId
    ? state.trajectories.find((trajectory) => trajectory.id === activeTrajectoryId)
    : undefined
  const bindingByTrajectoryId = React.useMemo(
    () => new Map(
      state.trajectoryBindings
        .filter((binding) => binding.objects.length > 0)
        .map((binding) => [binding.trajectoryId, binding]),
    ),
    [state.trajectoryBindings],
  )
  const activeBinding = activeTrajectory ? bindingByTrajectoryId.get(activeTrajectory.id) : undefined
  const allBoundObjectIds = React.useMemo(() => globallyBoundObjectIds(state.trajectoryBindings), [state.trajectoryBindings])
  const availableNodes = React.useMemo<TrajectoryBindableNode[]>(() => [
    ...state.objects
      .filter((object) => object.type !== 'light' && !allBoundObjectIds.has(object.id))
      .map((object) => ({ id: object.id, name: object.name })),
    ...state.cameras
      .filter((camera) => !allBoundObjectIds.has(camera.id))
      .map((camera) => ({ id: camera.id, name: camera.name })),
  ], [allBoundObjectIds, state.cameras, state.objects])

  return (
    <section className="min-h-0 flex-1 overflow-auto bg-[var(--nomi-paper)] px-3 py-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-caption font-medium text-[var(--nomi-ink)]">轨迹属性</div>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-nomi-sm bg-[var(--nomi-ink)] px-2 text-caption text-[var(--nomi-paper)] hover:opacity-90 disabled:opacity-40"
          disabled={readOnly}
          type="button"
          onClick={onAddTrajectory}
        >
          <IconPlus size={14} />
          <span>新建</span>
        </button>
      </div>

      {!activeTrajectory ? (
        <div className="rounded-nomi-sm border border-dashed border-[var(--nomi-line)] px-3 py-4 text-center text-caption text-[var(--nomi-ink-40)]">
          请选择一条轨迹
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex min-w-0 items-center gap-2 rounded-nomi-sm bg-[var(--nomi-ink-05)] px-2 py-2">
            <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: activeTrajectory.color }} />
            <span className="min-w-0 flex-1 truncate text-caption font-medium text-[var(--nomi-ink)]">{activeTrajectory.name}</span>
            <span className="text-micro text-[var(--nomi-ink-40)]">{activeTrajectory.points.length}点 · {activeBinding?.objects.length ?? 0}节点</span>
          </div>

          <label className="grid gap-1">
            <span className="text-micro text-[var(--nomi-ink-60)]">名称</span>
            <input
              className="h-8 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)] disabled:opacity-50"
              disabled={readOnly}
              value={activeTrajectory.name}
              onChange={(event) => onPatchTrajectory(activeTrajectory.id, { name: event.currentTarget.value })}
            />
          </label>

          <div className="grid grid-cols-[32px_minmax(0,1fr)] items-end gap-2">
            <label className="grid gap-1">
              <span className="text-micro text-[var(--nomi-ink-60)]">颜色</span>
              <input
                className="size-8 cursor-pointer rounded-nomi-sm border border-[var(--nomi-line)] bg-transparent p-0 disabled:opacity-50"
                disabled={readOnly}
                type="color"
                value={activeTrajectory.color}
                onChange={(event) => onPatchTrajectory(activeTrajectory.id, { color: event.currentTarget.value })}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-micro text-[var(--nomi-ink-60)]">张力</span>
              <input
                className="h-8 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                disabled={readOnly}
                max={1}
                min={0}
                step={0.05}
                type="number"
                value={numberInputValue(activeTrajectory.tension)}
                onChange={(event) => onPatchTrajectory(activeTrajectory.id, { tension: Math.min(1, Math.max(0, Number(event.currentTarget.value))) })}
              />
            </label>
          </div>

          <label className="flex items-center justify-between gap-2 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 py-2 text-caption text-[var(--nomi-ink-60)]">
            <span>闭合轨迹</span>
            <input
              checked={activeTrajectory.closed}
              disabled={readOnly}
              type="checkbox"
              onChange={(event) => onPatchTrajectory(activeTrajectory.id, { closed: event.currentTarget.checked })}
            />
          </label>

          <div className="grid gap-2">
            <div className="text-caption font-medium text-[var(--nomi-ink)]">当前轨迹绑定</div>
            <TrajectoryBindingCard
              state={state}
              trajectory={activeTrajectory}
              binding={activeBinding}
              active
              readOnly={readOnly}
              availableNodes={availableNodes}
              onSelectTrajectory={onSelectTrajectory}
              onBindObject={onBindObject}
              onPatchBinding={onPatchBinding}
              onPatchBoundObject={onPatchBoundObject}
              onUnbindObject={onUnbindObject}
              onDeleteBinding={onDeleteBinding}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-caption font-medium text-[var(--nomi-ink)]">控制点</div>
              <button
                className="inline-flex h-7 items-center gap-1 rounded-nomi-sm bg-[var(--nomi-ink-05)] px-2 text-micro text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)] disabled:opacity-40"
                disabled={readOnly}
                type="button"
                onClick={() => onAddPoint(activeTrajectory.id)}
              >
                <IconPlus size={13} />
                <span>追加点</span>
              </button>
            </div>
            {activeTrajectory.points.map((point) => (
              <TrajectoryPointRow
                key={point.id}
                trajectory={activeTrajectory}
                point={point}
                active={point.id === activePointId}
                readOnly={readOnly}
                onSelectPoint={onSelectPoint}
                onUpdatePoint={onUpdatePoint}
                onDeletePoint={onDeletePoint}
              />
            ))}
          </div>

          <button
            className="h-8 rounded-nomi-sm bg-[var(--workbench-danger-soft)] text-caption text-[var(--workbench-danger)] hover:opacity-90 disabled:opacity-40"
            disabled={readOnly}
            type="button"
            onClick={() => onDeleteTrajectory(activeTrajectory.id)}
          >
            删除轨迹
          </button>
        </div>
      )}
    </section>
  )
}
