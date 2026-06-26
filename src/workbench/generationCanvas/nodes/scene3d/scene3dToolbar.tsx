import React from 'react'
import {
  IconBox,
  IconBulb,
  IconCamera,
  IconChevronRight,
  IconCylinder,
  IconMaximize,
  IconMinimize,
  IconPlane,
  IconPlus,
  IconRoute,
  IconSphere,
  IconUser,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { type Scene3DGeometry } from './scene3dTypes'
import { CROWD_MAX_AXIS, type CrowdAddOptions } from './scene3dConstants'

export function PanelButton({
  children,
  active,
  title,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi-sm border px-2 whitespace-nowrap',
        'border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] text-caption text-[var(--nomi-ink-60)] transition',
        'hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]',
        active && 'border-[var(--nomi-ink)] bg-[var(--nomi-ink)] text-[var(--nomi-paper)] hover:bg-[var(--nomi-ink)] hover:text-[var(--nomi-paper)]',
      )}
      type="button"
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function SceneAddButton({
  children,
  active,
  title,
  onClick,
}: {
  children: React.ReactNode
  active?: boolean
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2',
        'border-0 bg-transparent text-caption text-[var(--nomi-ink-60)] transition',
        'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)] disabled:cursor-not-allowed disabled:opacity-40',
        active && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
      )}
      type="button"
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function CanvasPanelRestoreButton({
  side,
  title,
  onClick,
  children,
}: {
  side: 'left' | 'right'
  title: string
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      className={cn(
        'pointer-events-auto absolute top-4 z-[4] grid size-9 place-items-center rounded-nomi',
        'border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-[var(--nomi-ink-60)] shadow-[var(--nomi-shadow-md)]',
        'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
        side === 'left' ? 'left-4' : 'right-4',
      )}
      type="button"
      title={title}
      onClick={onClick}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  )
}

export function SceneAddToolbar({
  onAddObject,
  onAddCrowd,
  onAddCamera,
  trajectoryMode,
  onToggleTrajectoryMode,
  canvasFocusMode,
  onToggleCanvasFocusMode,
}: {
  onAddObject: (kind: Scene3DGeometry | 'mannequin' | 'light') => void
  onAddCrowd: (options: CrowdAddOptions) => void
  onAddCamera: () => void
  trajectoryMode: boolean
  onToggleTrajectoryMode: () => void
  canvasFocusMode: boolean
  onToggleCanvasFocusMode: () => void
}): JSX.Element {
  const [geometryOpen, setGeometryOpen] = React.useState(false)
  const [characterOpen, setCharacterOpen] = React.useState(false)
  const [crowdPopoverOpen, setCrowdPopoverOpen] = React.useState(false)
  const [crowdRowsValue, setCrowdRowsValue] = React.useState(3)
  const [crowdColumnsValue, setCrowdColumnsValue] = React.useState(3)
  const [crowdSpacingValue, setCrowdSpacingValue] = React.useState(1.2)
  const geometryItems = [
    { kind: 'box' as const, label: '立方体', icon: IconBox },
    { kind: 'sphere' as const, label: '球体', icon: IconSphere },
    { kind: 'cylinder' as const, label: '圆柱体', icon: IconCylinder },
    { kind: 'plane' as const, label: '平面', icon: IconPlane },
  ]

  const addGeometry = React.useCallback((kind: Scene3DGeometry) => {
    onAddObject(kind)
    setGeometryOpen(false)
    setCharacterOpen(false)
    setCrowdPopoverOpen(false)
  }, [onAddObject])
  const addSingleMannequin = React.useCallback(() => {
    onAddObject('mannequin')
    setGeometryOpen(false)
    setCharacterOpen(false)
    setCrowdPopoverOpen(false)
  }, [onAddObject])
  const addCrowd = React.useCallback(() => {
    onAddCrowd({
      rows: crowdRowsValue,
      columns: crowdColumnsValue,
      spacing: crowdSpacingValue,
    })
    setCrowdPopoverOpen(false)
    setCharacterOpen(false)
    setGeometryOpen(false)
  }, [crowdColumnsValue, crowdRowsValue, crowdSpacingValue, onAddCrowd])

  return (
    <div
      className={cn(
        'absolute bottom-5 left-1/2 z-[4] max-w-[calc(100%-32px)] -translate-x-1/2',
      )}
      aria-label="添加 3D 节点"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {geometryOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-10 z-[5] grid w-[168px] gap-1 p-[6px]',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="menu"
          aria-label="添加几何模型"
        >
          {geometryItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.kind}
                className={cn(
                  'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
                  'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
                  'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                )}
                type="button"
                role="menuitem"
                onClick={() => addGeometry(item.kind)}
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {characterOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-[118px] z-[5] grid w-[168px] gap-1 p-[6px]',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="menu"
          aria-label="添加假人"
        >
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={addSingleMannequin}
          >
            <IconUser size={15} />
            <span>单个假人</span>
          </button>
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              crowdPopoverOpen && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={() => setCrowdPopoverOpen((open) => !open)}
          >
            <IconUser size={15} />
            <span className="min-w-0 flex-1">群众</span>
            <IconChevronRight size={14} />
          </button>
        </div>
      ) : null}
      {characterOpen && crowdPopoverOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-[294px] z-[6] w-[240px] p-3',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="dialog"
          aria-label="添加群众"
        >
          <div className="mb-3 flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <span className="font-medium text-[var(--nomi-ink)]">群众</span>
            <span>最多10x10</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-micro text-[var(--nomi-ink-60)]">
              行数
              <input
                className="h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)]"
                max={CROWD_MAX_AXIS}
                min={1}
                type="number"
                value={crowdRowsValue}
                onChange={(event) => setCrowdRowsValue(Number(event.currentTarget.value))}
              />
            </label>
            <label className="grid gap-1 text-micro text-[var(--nomi-ink-60)]">
              列数
              <input
                className="h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)]"
                max={CROWD_MAX_AXIS}
                min={1}
                type="number"
                value={crowdColumnsValue}
                onChange={(event) => setCrowdColumnsValue(Number(event.currentTarget.value))}
              />
            </label>
          </div>
          <label className="mt-2 grid gap-1 text-micro text-[var(--nomi-ink-60)]">
            圆间距
            <input
              className="h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-caption text-[var(--nomi-ink)] outline-none focus:border-[var(--nomi-accent)]"
              max={10}
              min={0.2}
              step={0.1}
              type="number"
              value={crowdSpacingValue}
              onChange={(event) => setCrowdSpacingValue(Number(event.currentTarget.value))}
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="h-8 rounded-nomi-sm bg-[var(--nomi-ink-10)] text-caption text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-20)]"
              type="button"
              onClick={() => setCrowdPopoverOpen(false)}
            >
              取消
            </button>
            <button
              className="h-8 rounded-nomi-sm bg-[var(--nomi-ink)] text-caption text-[var(--nomi-paper)] hover:opacity-90"
              type="button"
              onClick={addCrowd}
            >
              生成
            </button>
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'inline-flex max-w-full items-center gap-1 overflow-x-auto p-[6px]',
          'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
        )}
        role="toolbar"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-nomi bg-[var(--nomi-ink)] text-[var(--nomi-paper)]" title="添加">
          <IconPlus size={17} />
        </span>
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        <SceneAddButton
          active={geometryOpen}
          title="添加几何模型"
          onClick={() => {
            setCharacterOpen(false)
            setCrowdPopoverOpen(false)
            setGeometryOpen((open) => !open)
          }}
        >
          <IconBox size={15} />
          <span>几何模型</span>
        </SceneAddButton>
        <SceneAddButton
          active={characterOpen}
          title="添加假人"
          onClick={() => {
            setGeometryOpen(false)
            if (characterOpen) setCrowdPopoverOpen(false)
            setCharacterOpen((open) => !open)
          }}
        >
          <IconUser size={15} />
          <span>假人</span>
        </SceneAddButton>
        <SceneAddButton title="添加灯光" onClick={() => {
          setGeometryOpen(false)
          setCharacterOpen(false)
          setCrowdPopoverOpen(false)
          onAddObject('light')
        }}><IconBulb size={15} /><span>灯光</span></SceneAddButton>
        <SceneAddButton title="添加拍摄相机" onClick={() => {
          setGeometryOpen(false)
          setCharacterOpen(false)
          setCrowdPopoverOpen(false)
          onAddCamera()
        }}><IconCamera size={15} /><span>相机</span></SceneAddButton>
        <SceneAddButton
          active={trajectoryMode}
          title={trajectoryMode ? '退出轨迹模式' : '进入轨迹模式'}
          onClick={() => {
            setGeometryOpen(false)
            setCharacterOpen(false)
            setCrowdPopoverOpen(false)
            onToggleTrajectoryMode()
          }}
        >
          <IconRoute size={15} />
          <span>轨迹</span>
        </SceneAddButton>
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        <SceneAddButton
          active={canvasFocusMode}
          title={canvasFocusMode ? '退出全屏画布' : '全屏画布'}
          onClick={() => {
            setGeometryOpen(false)
            setCharacterOpen(false)
            setCrowdPopoverOpen(false)
            onToggleCanvasFocusMode()
          }}
        >
          {canvasFocusMode ? <IconMinimize size={15} /> : <IconMaximize size={15} />}
          <span>{canvasFocusMode ? '还原' : '全屏'}</span>
        </SceneAddButton>
      </div>
    </div>
  )
}
