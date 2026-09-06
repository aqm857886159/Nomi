import React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '../../../utils/cn'
import { IconPlus, IconRoute, IconUpload } from '../../../vendor/tablerIcons'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { getQuickAddGenerationNodePlugins } from '../nodes/renderRegistry'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { canvasPluginRegistry } from '../plugins/defaultCanvasPluginRegistry'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../design'
import { filterCanvasImportableLocalFiles, importLocalFilesToGenerationCanvas } from './canvasStageDrop'
import {
  canvasFullAddSections,
  canvasMoreAddSections,
  canvasResidentAddIntents,
  type CanvasAddIntent,
  type CanvasAddSectionView,
} from './canvasToolbarModel'

const QUICK_ADD_NODE_ITEMS = getQuickAddGenerationNodePlugins()

// 左缘工具条与右键菜单**同源**：两边都从 canvasToolbarModel 的意图表 derive，永远不会分叉。
// 2026-06-15：左侧栏瘦身为「纯创建节点」——复制/剪切走快捷键(⌘C/⌘X)、批量生成移到选中浮条、
// 发送到时间轴删除(节点可直接拖入时间轴)。
// 2026-09-06「第三档」：9 个平铺 → 5 常驻 + 一个「更多」，每段带名字（§1.5.1 常驻预算 / §1.5.3 分段要有名字）。
const RESIDENT_ADD_INTENTS = canvasResidentAddIntents()
const MORE_ADD_SECTIONS = canvasMoreAddSections()
const FULL_ADD_SECTIONS = canvasFullAddSections()

function nodeKindLabel(kind: GenerationNodeKind, t: TFunction): string {
  if (kind === 'text') return t('canvas.nodeKinds.text')
  if (kind === 'image') return t('canvas.nodeKinds.image')
  if (kind === 'video') return t('canvas.nodeKinds.video')
  if (kind === 'clip') return t('canvas.nodeKinds.clip')
  if (kind === 'audio') return t('canvas.nodeKinds.audio')
  if (kind === 'model3d') return t('canvas.nodeKinds.model3d')
  if (kind === 'whiteboard') return t('canvas.nodeKinds.whiteboard')
  if (kind === 'panorama') return t('canvas.nodeKinds.panorama')
  if (kind === 'scene3d') return t('canvas.nodeKinds.scene3d')
  return kind
}

/** 菜单里这一条写什么字（节点用种类名；导入那条是「文件…」，段名已经说了「导入」）。 */
function intentLabel(intent: CanvasAddIntent, t: TFunction): string {
  return intent.kind ? nodeKindLabel(intent.kind, t) : t('canvas.importFile')
}

/** 无障碍名 / tooltip：脱离段名单独读也说得清「按下去会发生什么」。 */
function intentActionLabel(intent: CanvasAddIntent, t: TFunction): string {
  return intent.kind ? t('canvas.addNode', { type: nodeKindLabel(intent.kind, t) }) : t('canvas.importFileAction')
}

type IntentIcon = (props: { size?: number; stroke?: number }) => JSX.Element

function intentIcon(intent: CanvasAddIntent): IntentIcon {
  if (!intent.kind) return IconUpload as unknown as IntentIcon
  const plugin = QUICK_ADD_NODE_ITEMS.find((item) => item.kind === intent.kind)
  return (plugin?.icon ?? IconPlus) as unknown as IntentIcon
}

/**
 * 「挑本地文件」的共享小钩子：左缘「导入」钮与右键菜单「导入 · 文件…」用的是**同一个**受控
 * `<input type="file">` 形态与同一套过滤，只是落点不同。选完交给调用方决定落在哪一点。
 */
function useLocalFilePicker(onFiles: (files: File[]) => void): { input: JSX.Element; open: () => void } {
  const ref = React.useRef<HTMLInputElement>(null)
  const open = React.useCallback(() => {
    ref.current?.click()
  }, [])
  const input = (
    <input
      ref={ref}
      type="file"
      multiple
      // 画布上只有图片 / 视频有落点（音频的家是素材库 → 时间轴），让选择器自己筛掉，
      // 而不是让用户选完再被静默丢弃。
      accept="image/*,video/*"
      className="hidden"
      aria-hidden="true"
      tabIndex={-1}
      onChange={(event) => {
        const files = filterCanvasImportableLocalFiles(Array.from(event.currentTarget.files || []))
        event.currentTarget.value = ''
        if (files.length) onFiles(files)
      }}
    />
  )
  return { input, open }
}

/** 一段带名字的菜单（§1.5.3：光加 `w-px` 分隔线不够，段要有名字）。 */
function CanvasAddSectionList({
  sections,
  onPick,
}: {
  sections: readonly CanvasAddSectionView[]
  onPick: (intent: CanvasAddIntent) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      {sections.map((section) => (
        <div key={section.id} role="group" aria-label={t(section.labelKey)} data-add-section={section.id}>
          <div className="px-1.5 pt-1 pb-0.5 text-micro font-medium uppercase tracking-wide text-nomi-ink-40">
            {t(section.labelKey)}
          </div>
          {section.intents.map((intent) => {
            const Icon = intentIcon(intent)
            return (
              <button
                type="button"
                key={intent.id}
                data-add-intent={intent.id}
                {...(intent.kind ? { 'data-node-kind': intent.kind } : {})}
                className={cn(
                  'inline-flex items-center justify-start gap-1.5',
                  'w-full h-8 min-h-8 px-2 border-0 rounded-nomi',
                  'bg-transparent text-workbench-ink font-[inherit] text-caption cursor-pointer',
                  'hover:bg-nomi-ink-05',
                  '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-nomi-ink-60 [&>svg]:stroke-[1.8]',
                )}
                role="menuitem"
                aria-label={intentActionLabel(intent, t)}
                onClick={() => onPick(intent)}
              >
                <Icon size={14} stroke={1.6} />
                <span>{intentLabel(intent, t)}</span>
              </button>
            )
          })}
        </div>
      ))}
    </>
  )
}

type NodeAddMenuProps = {
  className?: string
  style?: React.CSSProperties
  /** 只给这几种（拖连线松手的小菜单）：平铺不分段，形态与 2026-06 拍板时一致。 */
  kinds?: GenerationNodeKind[]
  onAddNode: (kind: GenerationNodeKind) => void
  /**
   * 选中的本地文件落在这个菜单的那一点。**不给就整段不出现**——
   * 一个点了什么都不会发生的「导入」比没有更糟（§1.6 C1：可点即有效）。
   */
  onImportFiles?: (files: File[]) => void
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
}

export function NodeAddMenu({
  className,
  style,
  kinds,
  onAddNode,
  onImportFiles,
  onContextMenu,
  onPointerDown,
}: NodeAddMenuProps): JSX.Element {
  const { t } = useTranslation()
  const picker = useLocalFilePicker((files) => onImportFiles?.(files))
  // 受限菜单（连线松手）只列被点名的种类，且不分段——它回答的是「这根线接到什么」，不是「往画布加什么」。
  const sections = React.useMemo<readonly CanvasAddSectionView[]>(() => {
    if (!kinds?.length) {
      if (onImportFiles) return FULL_ADD_SECTIONS
      return FULL_ADD_SECTIONS.flatMap((section) => {
        const intents = section.intents.filter((intent) => intent.kind)
        return intents.length ? [{ ...section, intents }] : []
      })
    }
    const allowed = new Set<GenerationNodeKind>(kinds)
    const intents = FULL_ADD_SECTIONS.flatMap((section) =>
      section.intents.filter((intent) => intent.kind && allowed.has(intent.kind)))
    return [{ id: 'generate', labelKey: '', intents }]
  }, [kinds, onImportFiles])
  const restricted = Boolean(kinds?.length)
  return (
    <div
      className={cn(
        'generation-canvas-v2-toolbar__node-menu',
        'absolute top-0 left-[calc(100%+8px)] grid p-[6px]',
        // 受限小菜单（连线松手）保持 2026-06 拍板时的几何；分段的完整菜单要宽一点装下段名。
        restricted ? 'gap-1 w-[132px]' : 'gap-0.5 w-[148px]',
        'border border-workbench-border rounded-nomi',
        'bg-nomi-paper shadow-workbench-pop',
        className,
      )}
      role="menu"
      aria-label={t('canvas.addNodeMenu')}
      style={style}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
    >
      {restricted ? (
        <CanvasAddSectionListFlat intents={sections[0].intents} onAddNode={onAddNode} />
      ) : (
        <>
          {picker.input}
          <CanvasAddSectionList
            sections={sections}
            onPick={(intent) => {
              if (intent.kind) onAddNode(intent.kind)
              else picker.open()
            }}
          />
        </>
      )}
    </div>
  )
}

/** 受限小菜单的平铺渲染（无段名）。 */
function CanvasAddSectionListFlat({
  intents,
  onAddNode,
}: {
  intents: readonly CanvasAddIntent[]
  onAddNode: (kind: GenerationNodeKind) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      {intents.map((intent) => {
        const Icon = intentIcon(intent)
        const kind = intent.kind
        if (!kind) return null
        return (
          <button
            type="button"
            key={intent.id}
            data-node-kind={kind}
            className={cn(
              'inline-flex items-center justify-start gap-1.5',
              'w-full h-8 min-h-8 px-2 border-0 rounded-nomi',
              'bg-workbench-surface-solid text-workbench-ink font-[inherit] text-caption cursor-pointer',
              'hover:bg-nomi-ink-05',
              '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-nomi-ink-60 [&>svg]:stroke-[1.8]',
            )}
            role="menuitem"
            aria-label={t('canvas.addNode', { type: nodeKindLabel(kind, t) })}
            onClick={() => onAddNode(kind)}
          >
            <Icon size={14} stroke={1.6} />
            <span>{nodeKindLabel(kind, t)}</span>
          </button>
        )
      })}
    </>
  )
}

type CanvasToolbarProps = {
  // 只给「期望落点」（视口锚换算的画布坐标）；真实 AABB 碰撞避让统一收口在 store.addNode。
  getInsertionPosition: () => { x: number; y: number }
  categoryId?: string
}

/** hover 展开的延迟：短到顺手、长到不会「路过就弹」。 */
const MORE_MENU_HOVER_DELAY_MS = 200

export default function CanvasToolbar({ getInsertionPosition, categoryId }: CanvasToolbarProps): JSX.Element {
  const { t } = useTranslation()
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const workflowTemplates = useGenerationCanvasStore((state) => state.workflowTemplates)
  const instantiateWorkflowTemplate = useGenerationCanvasStore((state) => state.instantiateWorkflowTemplate)
  const [moreOpen, setMoreOpen] = React.useState(false)
  const hoverTimerRef = React.useRef<number | null>(null)

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current === null) return
    window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
  }, [])
  React.useEffect(() => clearHoverTimer, [clearHoverTimer])

  const handleAddNode = (kind: GenerationNodeKind) => {
    addNode({ kind, position: getInsertionPosition(), categoryId })
  }

  // 「导入」= 系统文件选择器 → **画布现有那条本地文件路径**（拖进画布走的同一条：
  // importLocalMediaFilesToGenerationCanvas，复制进项目 + 上传 + 建 asset 节点）。
  // 这里不另建 asset 节点，也不另起一套提示（P1：无并行版）。
  const picker = useLocalFilePicker((files) => {
    void importLocalFilesToGenerationCanvas(files, { basePosition: getInsertionPosition(), categoryId })
  })

  const handlePick = (intent: CanvasAddIntent) => {
    setMoreOpen(false)
    if (intent.kind) handleAddNode(intent.kind)
    else picker.open()
  }

  return (
    <div
      className={cn(
        'generation-canvas-v2-toolbar',
        'absolute top-1/2 left-4 z-[8] inline-flex flex-col items-center gap-1 p-[6px]',
        'border border-workbench-border rounded-nomi',
        'bg-nomi-paper shadow-workbench-md -translate-y-1/2',
        'max-h-[calc(100%-32px)]',
      )}
      aria-label={t('canvas.toolbar')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setMoreOpen(false)
      }}
    >
      {picker.input}
      <TooltipProvider delayDuration={250} disableHoverableContent>
        {RESIDENT_ADD_INTENTS.map((intent) => {
          const Icon = intentIcon(intent)
          const action = intentActionLabel(intent, t)
          const tip = intent.kind ? t('canvas.nodeName', { type: nodeKindLabel(intent.kind, t) }) : action
          return (
            <Tooltip key={intent.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-add-intent={intent.id}
                  {...(intent.kind ? { 'data-node-kind': intent.kind } : {})}
                  className={cn(
                    'grid size-8 min-h-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent p-0 text-nomi-ink-60 cursor-pointer',
                    'transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink',
                    '[&>svg]:size-[18px] [&>svg]:stroke-[1.8]',
                  )}
                  aria-label={action}
                  onClick={() => (intent.kind ? handleAddNode(intent.kind) : picker.open())}
                >
                  <Icon size={18} stroke={1.6} />
                  <span className="hidden">{intentLabel(intent, t)}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{tip}</TooltipContent>
            </Tooltip>
          )
        })}
        {MORE_ADD_SECTIONS.length ? (
          <>
            <span className="my-0.5 h-px w-5 shrink-0 bg-nomi-line" aria-hidden="true" />
            <div
              className="relative"
              onPointerEnter={() => {
                clearHoverTimer()
                hoverTimerRef.current = window.setTimeout(() => setMoreOpen(true), MORE_MENU_HOVER_DELAY_MS)
              }}
              onPointerLeave={() => {
                clearHoverTimer()
                setMoreOpen(false)
              }}
            >
              <button
                type="button"
                data-canvas-add-more="true"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-label={t('canvas.moreMenu')}
                className={cn(
                  'grid size-8 min-h-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent p-0 cursor-pointer',
                  // 灰一档：它不是第 6 个常驻功能，是「还有什么」的入口。
                  'text-nomi-ink-40 transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink',
                  moreOpen && 'bg-nomi-ink-05 text-nomi-ink',
                  '[&>svg]:size-[18px] [&>svg]:stroke-[1.8]',
                )}
                onClick={() => {
                  clearHoverTimer()
                  setMoreOpen((open) => !open)
                }}
              >
                <IconPlus size={18} stroke={1.6} />
              </button>
              {moreOpen ? (
                <div
                  className={cn(
                    'generation-canvas-v2-toolbar__more-menu',
                    'absolute bottom-0 left-[calc(100%+8px)] z-[9] grid gap-0.5 w-[148px] p-[6px]',
                    'border border-workbench-border rounded-nomi bg-nomi-paper shadow-workbench-pop',
                  )}
                  role="menu"
                  aria-label={t('canvas.moreMenu')}
                >
                  <CanvasAddSectionList sections={MORE_ADD_SECTIONS} onPick={handlePick} />
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {workflowTemplates.length ? (
          <>
            <span className="my-0.5 h-px w-5 shrink-0 bg-nomi-line" aria-hidden="true" />
            <label className="relative grid size-8 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05" title={t('generationCommon.selection.workflowMenu')}>
              <IconRoute size={18} stroke={1.6} />
              <select
                aria-label={t('generationCommon.selection.workflowMenu')}
                className="absolute inset-0 size-8 cursor-pointer opacity-0"
                value=""
                onChange={(event) => {
                  if (event.target.value) instantiateWorkflowTemplate(event.target.value, getInsertionPosition())
                  event.currentTarget.value = ''
                }}
              >
                <option value="">{t('generationCommon.selection.workflowMenu')}</option>
                {workflowTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
          </>
        ) : null}
        {canvasPluginRegistry.isEnabled() && canvasPluginRegistry.resolve('nomi.workflow/checkpoint') ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-plugin-type="nomi.workflow/checkpoint"
                className="grid size-8 min-h-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent p-0 text-nomi-ink-60 cursor-pointer transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink"
                aria-label={t('generationCommon.workflowPlugin.addCheckpoint')}
                onClick={() => addNode({
                  kind: 'text',
                  typeId: 'nomi.workflow/checkpoint',
                  title: t('generationCommon.workflowPlugin.checkpointTitle'),
                  size: { width: 280, height: 190 },
                  pluginState: {
                    pluginId: 'nomi.workflow',
                    pluginVersion: '1.0.0',
                    typeId: 'nomi.workflow/checkpoint',
                    schemaVersion: 1,
                    state: { checked: false },
                  },
                  position: getInsertionPosition(),
                  categoryId,
                })}
              >
                <IconRoute size={18} stroke={1.6} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('generationCommon.workflowPlugin.addCheckpoint')}</TooltipContent>
          </Tooltip>
        ) : null}
      </TooltipProvider>
    </div>
  )
}
