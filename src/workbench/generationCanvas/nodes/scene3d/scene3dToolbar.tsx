import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconBox,
  IconBuildingSkyscraper,
  IconBulb,
  IconCamera,
  IconCar,
  IconChevronRight,
  IconChevronUp,
  IconCylinder,
  IconLamp,
  IconMap2,
  IconMaximize,
  IconMinimize,
  IconPackage,
  IconPlane,
  IconPlus,
  IconSphere,
  IconTrees,
  IconUser,
  IconWall,
  type Icon,
} from '@tabler/icons-react'
import { IconArrowsMove, IconRotate, IconZoomScan } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { type Scene3DGeometry, type Scene3DPropKind, type Scene3DTransformMode } from './scene3dTypes'
import { CROWD_MAX_AXIS, type CrowdAddOptions } from './scene3dConstants'
import { PROP_KINDS } from './scene3dPropSpecs'
import { SCENE_TEMPLATES, type Scene3DSceneTemplate } from './scene3dSceneTemplates'

const PROP_MENU_ICONS: Record<Scene3DPropKind, Icon> = {
  car: IconCar,
  building: IconBuildingSkyscraper,
  tree: IconTrees,
  streetlamp: IconLamp,
  wall: IconWall,
}

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
  onAddProp,
  onAddCrowd,
  onAddCamera,
  onApplySceneTemplate,
  canvasFocusMode,
  onToggleCanvasFocusMode,
}: {
  onAddObject: (kind: Scene3DGeometry | 'mannequin' | 'light') => void
  onAddProp: (kind: Scene3DPropKind) => void
  onAddCrowd: (options: CrowdAddOptions) => void
  onAddCamera: () => void
  onApplySceneTemplate: (template: Scene3DSceneTemplate) => void
  canvasFocusMode: boolean
  onToggleCanvasFocusMode: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [addMenuOpen, setAddMenuOpen] = React.useState(false)
  const [geometryOpen, setGeometryOpen] = React.useState(false)
  const [templatesOpen, setTemplatesOpen] = React.useState(false)
  const [propsOpen, setPropsOpen] = React.useState(false)
  const [characterOpen, setCharacterOpen] = React.useState(false)
  const [crowdPopoverOpen, setCrowdPopoverOpen] = React.useState(false)
  const [crowdRowsValue, setCrowdRowsValue] = React.useState(3)
  const [crowdColumnsValue, setCrowdColumnsValue] = React.useState(3)
  const [crowdSpacingValue, setCrowdSpacingValue] = React.useState(1.2)
  const geometryItems = [
    { kind: 'box' as const, label: t('scene3d.toolbar.geometryKind.box'), icon: IconBox },
    { kind: 'sphere' as const, label: t('scene3d.toolbar.geometryKind.sphere'), icon: IconSphere },
    { kind: 'cylinder' as const, label: t('scene3d.toolbar.geometryKind.cylinder'), icon: IconCylinder },
    { kind: 'plane' as const, label: t('scene3d.toolbar.geometryKind.plane'), icon: IconPlane },
  ]

  const closeAddMenu = React.useCallback(() => {
    setAddMenuOpen(false)
    setGeometryOpen(false)
    setTemplatesOpen(false)
    setPropsOpen(false)
    setCharacterOpen(false)
    setCrowdPopoverOpen(false)
  }, [])

  // 点菜单以外区域收起整组「添加」浮层（含几何/假人/群众子层）。
  React.useEffect(() => {
    if (!addMenuOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeAddMenu()
    }
    // 用 capture 阶段：3D 画布(r3f)会在冒泡阶段 stopPropagation，bubble 监听收不到画布上的点击。
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [addMenuOpen, closeAddMenu])

  const addGeometry = React.useCallback((kind: Scene3DGeometry) => {
    onAddObject(kind)
    closeAddMenu()
  }, [closeAddMenu, onAddObject])
  const addSingleMannequin = React.useCallback(() => {
    onAddObject('mannequin')
    closeAddMenu()
  }, [closeAddMenu, onAddObject])
  const addCrowd = React.useCallback(() => {
    onAddCrowd({
      rows: crowdRowsValue,
      columns: crowdColumnsValue,
      spacing: crowdSpacingValue,
    })
    closeAddMenu()
  }, [closeAddMenu, crowdColumnsValue, crowdRowsValue, crowdSpacingValue, onAddCrowd])

  return (
    <div
      ref={containerRef}
      className={cn(
        'absolute bottom-5 left-1/2 z-[4] max-w-[calc(100%-32px)] -translate-x-1/2',
      )}
      aria-label={t('scene3d.toolbar.addNodeAria')}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {addMenuOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-0 z-[5] grid w-[156px] gap-1 p-[6px]',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="menu"
          aria-label={t('scene3d.toolbar.addNodeAria')}
        >
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              templatesOpen && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={() => {
              setGeometryOpen(false)
              setCharacterOpen(false)
              setCrowdPopoverOpen(false)
              setPropsOpen(false)
              setTemplatesOpen((open) => !open)
            }}
          >
            <IconMap2 size={15} />
            <span className="min-w-0 flex-1">{t('scene3d.toolbar.sceneTemplates')}</span>
            <IconChevronRight size={14} />
          </button>
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              geometryOpen && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={() => {
              setCharacterOpen(false)
              setCrowdPopoverOpen(false)
              setPropsOpen(false)
              setTemplatesOpen(false)
              setGeometryOpen((open) => !open)
            }}
          >
            <IconBox size={15} />
            <span className="min-w-0 flex-1">{t('scene3d.toolbar.geometry')}</span>
            <IconChevronRight size={14} />
          </button>
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              propsOpen && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={() => {
              setGeometryOpen(false)
              setCharacterOpen(false)
              setCrowdPopoverOpen(false)
              setTemplatesOpen(false)
              setPropsOpen((open) => !open)
            }}
          >
            <IconPackage size={15} />
            <span className="min-w-0 flex-1">{t('scene3d.toolbar.props')}</span>
            <IconChevronRight size={14} />
          </button>
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              characterOpen && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={() => {
              setGeometryOpen(false)
              setPropsOpen(false)
              setTemplatesOpen(false)
              if (characterOpen) setCrowdPopoverOpen(false)
              setCharacterOpen((open) => !open)
            }}
          >
            <IconUser size={15} />
            <span className="min-w-0 flex-1">{t('scene3d.toolbar.mannequins')}</span>
            <IconChevronRight size={14} />
          </button>
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={() => {
              closeAddMenu()
              onAddObject('light')
            }}
          >
            <IconBulb size={15} />
            <span className="min-w-0 flex-1">{t('scene3d.toolbar.light')}</span>
          </button>
          <button
            className={cn(
              'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
              'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
              'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            )}
            type="button"
            role="menuitem"
            onClick={() => {
              closeAddMenu()
              onAddCamera()
            }}
          >
            <IconCamera size={15} />
            <span className="min-w-0 flex-1">{t('scene3d.toolbar.camera')}</span>
          </button>
        </div>
      ) : null}
      {addMenuOpen && geometryOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-[164px] z-[6] grid w-[168px] gap-1 p-[6px]',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="menu"
          aria-label={t('scene3d.toolbar.addGeometryAria')}
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
      {addMenuOpen && templatesOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-[164px] z-[6] grid w-[188px] gap-1 p-[6px]',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="menu"
          aria-label={t('scene3d.toolbar.applyTemplateAria')}
        >
          {SCENE_TEMPLATES.map((template) => (
            <button
              key={template}
              className={cn(
                'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
                'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
                'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
              )}
              type="button"
              role="menuitem"
              title={t('scene3d.toolbar.templateHint')}
              onClick={() => {
                onApplySceneTemplate(template)
                closeAddMenu()
              }}
            >
              <IconMap2 size={15} />
              <span>{t(`scene3d.toolbar.template.${template}` as 'scene3d.toolbar.template.street')}</span>
            </button>
          ))}
        </div>
      ) : null}
      {addMenuOpen && propsOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-[164px] z-[6] grid w-[168px] gap-1 p-[6px]',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="menu"
          aria-label={t('scene3d.toolbar.addPropsAria')}
        >
          {PROP_KINDS.map((kind) => {
            const Icon = PROP_MENU_ICONS[kind]
            return (
              <button
                key={kind}
                className={cn(
                  'inline-flex h-8 w-full items-center justify-start gap-2 rounded-nomi px-2',
                  'border-0 bg-transparent text-left text-caption text-[var(--nomi-ink-60)] transition',
                  'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                )}
                type="button"
                role="menuitem"
                onClick={() => {
                  onAddProp(kind)
                  closeAddMenu()
                }}
              >
                <Icon size={15} />
                <span>{t(`scene3d.toolbar.prop.${kind}` as 'scene3d.toolbar.prop.car')}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {addMenuOpen && characterOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+8px)] left-[164px] z-[6] grid w-[168px] gap-1 p-[6px]',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="menu"
          aria-label={t('scene3d.toolbar.addMannequinAria')}
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
            <span>{t('scene3d.toolbar.singleMannequin')}</span>
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
            <span className="min-w-0 flex-1">{t('scene3d.toolbar.crowd')}</span>
            <IconChevronRight size={14} />
          </button>
        </div>
      ) : null}
      {addMenuOpen && characterOpen && crowdPopoverOpen ? (
        <div
          className={cn(
            'absolute bottom-[calc(100%+104px)] left-[164px] z-[7] w-[240px] p-3',
            'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
          )}
          role="dialog"
          aria-label={t('scene3d.toolbar.addCrowdAria')}
        >
          <div className="mb-3 flex items-center justify-between gap-2 text-caption text-[var(--nomi-ink-60)]">
            <span className="font-medium text-[var(--nomi-ink)]">{t('scene3d.toolbar.crowd')}</span>
            <span>{t('scene3d.toolbar.crowdMax', { rows: CROWD_MAX_AXIS, columns: CROWD_MAX_AXIS })}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-micro text-[var(--nomi-ink-60)]">
              {t('scene3d.toolbar.rows')}
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
              {t('scene3d.toolbar.columns')}
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
            {t('scene3d.toolbar.spacing')}
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
              {t('common.cancel')}
            </button>
            <button
              className="h-8 rounded-nomi-sm bg-[var(--nomi-ink)] text-caption text-[var(--nomi-paper)] hover:opacity-90"
              type="button"
              onClick={addCrowd}
            >
              {t('scene3d.toolbar.generate')}
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
        <button
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi py-0 pl-1 pr-2 transition',
            'border-0 bg-transparent text-caption text-[var(--nomi-ink-60)]',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
            addMenuOpen && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
          )}
          type="button"
          title={t('scene3d.toolbar.addNodeAria')}
          data-coach="add-button"
          aria-haspopup="menu"
          aria-expanded={addMenuOpen}
          onClick={() => {
            if (addMenuOpen) closeAddMenu()
            else setAddMenuOpen(true)
          }}
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-nomi-sm bg-[var(--nomi-ink)] text-[var(--nomi-paper)]">
            <IconPlus size={15} />
          </span>
          <span>{t('scene3d.toolbar.add')}</span>
          <IconChevronUp size={13} className={cn('transition', addMenuOpen && 'rotate-180')} />
        </button>
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        {/* 底部「轨迹」钮已删：入口收进右栏整运镜>轨迹（IA 重排一期，同一功能一个家 P1） */}
        <SceneAddButton
          active={canvasFocusMode}
          title={canvasFocusMode ? t('scene3d.toolbar.exitFullscreenCanvas') : t('scene3d.toolbar.fullscreenCanvas')}
          onClick={() => {
            closeAddMenu()
            onToggleCanvasFocusMode()
          }}
        >
          {canvasFocusMode ? <IconMinimize size={15} /> : <IconMaximize size={15} />}
          <span>{canvasFocusMode ? t('scene3d.toolbar.restore') : t('scene3d.toolbar.fullscreen')}</span>
        </SceneAddButton>
      </div>
    </div>
  )
}

/** 视口左上角工具（IA 重排：变换贴近操作对象 + 看全场一键回家；只读态只留看全场）。
 * 速度滑杆已移入接控/录制条（只在真开 WASD 时出现）；XYZ 静态徽标已删（用户 2026-07-20：没用还挡地方）。 */
export function Scene3DViewportToolPill({
  readOnly,
  transformMode,
  onTransformModeChange,
  onFitView,
}: {
  readOnly: boolean
  transformMode: Scene3DTransformMode
  onTransformModeChange: (mode: Scene3DTransformMode) => void
  onFitView: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-[3] flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5 shadow-[var(--nomi-shadow-md)]">
      {!readOnly ? (
        <>
          <PanelButton title={t('scene3d.fullscreen.moveTransformHint')} active={transformMode === 'translate'} onClick={() => onTransformModeChange('translate')}>
            <IconArrowsMove size={15} />
          </PanelButton>
          <PanelButton title={t('scene3d.fullscreen.rotateTransformHint')} active={transformMode === 'rotate'} onClick={() => onTransformModeChange('rotate')}>
            <IconRotate size={15} />
          </PanelButton>
          <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        </>
      ) : null}
      <PanelButton title={t('scene3d.fullscreen.fitViewHint')} onClick={onFitView}>
        <IconZoomScan size={15} />
      </PanelButton>
    </div>
  )
}
