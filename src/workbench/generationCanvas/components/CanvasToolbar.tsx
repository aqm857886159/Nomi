import { CANVAS_CHROME_LAYERS } from './canvasChromeLayers'
import { useCanvasChromeOcclusion } from './useCanvasChromeOcclusion'
import { CanvasAddPreferenceActions } from './CanvasAddPreferenceActions'
import { useCanvasMenuPreferenceStore } from '../store/canvasMenuPreferenceStore'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { IconPlus, IconRoute } from '../../../vendor/tablerIcons'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { canvasPluginRegistry } from '../plugins/defaultCanvasPluginRegistry'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../design'
import { intentActionLabel, intentIcon, intentLabel, nodeKindLabel, useCanvasAddIntentAction, useLocalFilePicker } from './canvasAddIntentActions'
import {
  canvasFullAddSections,
  canvasMoreAddSections,
  canvasResidentAddIntents,
  type CanvasAddIntentId,
  type CanvasAddIntent,
  type CanvasAddSectionView,
} from './canvasToolbarModel'

// 左缘工具条与右键菜单**同源**：两边都从 canvasToolbarModel 的意图表 derive，永远不会分叉。
// 2026-06-15：左侧栏瘦身为「纯创建节点」——复制/剪切走快捷键(⌘C/⌘X)、批量生成移到选中浮条、
// 发送到时间轴删除(节点可直接拖入时间轴)。
// 2026-09-06「第三档」：9 个平铺 → 5 常驻 + 一个「更多」，每段带名字（§1.5.1 常驻预算 / §1.5.3 分段要有名字）。
// 意图的名字 / 图标 / 执行（建节点或挑本地文件）在 canvasAddIntentActions：左缘、右键菜单、空画布任务卡共用。

/** 一段带名字的菜单（§1.5.3：光加 `w-px` 分隔线不够，段要有名字）。 */
function CanvasAddSectionList({
  sections,
  onPick,
}: {
  sections: readonly CanvasAddSectionView[]
  onPick: (intent: CanvasAddIntent) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = React.useState<CanvasAddIntentId | null>(null)
  const [feedback, setFeedback] = React.useState('')
  return (
    <>
      {sections.map((section) => (
        <div key={section.id} role="group" aria-label={t(section.labelKey)} data-add-section={section.id}>
          <div className="px-2 pt-1.5 pb-1 text-micro font-semibold text-nomi-ink-40">
            {t(section.labelKey)}
          </div>
          {section.intents.map((intent, index) => {
            const Icon = intentIcon(intent)
            return (
              <React.Fragment key={intent.id}>
                <button
                  type="button"
                  data-add-intent={intent.id}
                  {...(intent.kind ? { 'data-node-kind': intent.kind } : {})}
                  className={cn(
                    'inline-flex items-center justify-start gap-1.5',
                    'w-full h-8 min-h-8 px-2 border-0 rounded-nomi',
                    'bg-transparent text-nomi-ink-80 font-[inherit] text-body-sm cursor-pointer',
                    'hover:bg-nomi-ink-05 active:bg-nomi-ink-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-nomi-accent',
                    '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-nomi-ink-60 [&>svg]:stroke-[1.5]',
                  )}
                  role="menuitem"
                  aria-label={intentActionLabel(intent, t)}
                  onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setEditing(intent.id) }}
                  onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); setEditing(intent.id) } }}
                  onClick={() => onPick(intent)}
                >
                  <Icon size={16} stroke={1.5} />
                  <span>{intentLabel(intent, t)}</span>
                </button>
                {editing === intent.id && <CanvasAddPreferenceActions intentId={intent.id} previousIntentId={section.intents[index - 1]?.id} onFeedback={setFeedback} onDone={() => setEditing((current) => current === intent.id ? null : current)} />}
              </React.Fragment>
            )
          })}
        </div>
      ))}
      <CanvasAddPreferenceActions onFeedback={setFeedback} />
      {feedback ? <p role="status" className="m-0 px-2 text-micro text-nomi-danger">{feedback}</p> : null}
    </>
  )
}

/**
 * 「+」点开的菜单 = 「空间」一组（导演台 / 3D 模型 / 全景 / 白板，canvasMoreAddSections 同一份数据）。
 * 底部加节点条最后的「+」和空画布起步行的「更多」**同一个**菜单组件（Claude Design 拍板稿 EmptyStates），不另写一份。
 * 点开 / Esc / 点外面收起；位置由调用方的 className 定。
 */
export function CanvasMoreAddMenu({ onPick, onClose, className }: {
  onPick: (intent: CanvasAddIntent) => void
  onClose: () => void
  className?: string
}): JSX.Element {
  const { t } = useTranslation()
  const preference = useCanvasMenuPreferenceStore((state) => state.preference)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      // 点在触发它的「+」/「更多」上由那颗按钮自己切换，这里只管点到别处。
      if (ref.current?.contains(target) || target?.closest?.('[data-canvas-add-more]')) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      className={cn(
        'generation-canvas-v2-toolbar__more-menu',
        // 提到节点浮条（z-[12]）之上，免得被 composer / 浮条盖住点不到。
        'z-[13] grid gap-0.5 w-[176px] p-[6px]',
        'border border-workbench-border rounded-nomi bg-nomi-paper shadow-workbench-pop',
        className,
      )}
      role="menu"
      aria-label={t('canvas.moreMenu')}
    >
      <CanvasAddSectionList sections={canvasMoreAddSections(preference)} onPick={onPick} />
    </div>
  )
}

type NodeAddMenuProps = {
  className?: string
  style?: React.CSSProperties
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
  onAddNode,
  onImportFiles,
  onContextMenu,
  onPointerDown,
}: NodeAddMenuProps): JSX.Element {
  const { t } = useTranslation()
  const preference = useCanvasMenuPreferenceStore((state) => state.preference)
  const picker = useLocalFilePicker((files) => onImportFiles?.(files))
  const sections = React.useMemo<readonly CanvasAddSectionView[]>(() => {
    if (onImportFiles) return canvasFullAddSections(preference)
    return canvasFullAddSections(preference).flatMap((section) => {
      const intents = section.intents.filter((intent) => intent.kind)
      return intents.length ? [{ ...section, intents }] : []
    })
  }, [onImportFiles, preference])
  return (
    <div
      className={cn(
        'generation-canvas-v2-toolbar__node-menu',
        'absolute top-0 left-[calc(100%+8px)] grid p-[6px]',
        'gap-0.5 w-[148px]',
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
      {picker.input}
      <CanvasAddSectionList
        sections={sections}
        onPick={(intent) => {
          if (intent.kind) onAddNode(intent.kind)
          else picker.open()
        }}
      />
    </div>
  )
}

type CanvasToolbarProps = {
  // 只给「期望落点」（视口锚换算的画布坐标）；真实 AABB 碰撞避让统一收口在 store.addNode。
  getInsertionPosition: () => { x: number; y: number }
  categoryId?: string
  /**
   * 舞台宽。窄到和左下的缩放簇挤在同一条底边上放不下时（Agent 停靠 + 小窗口），
   * 加节点条整条抬到缩放簇上面一行——宁可高一点，不许两块叠在一起（拍板稿 Main 板只画了 1280 宽的样子）。
   */
  stageWidth?: number
}

/** 加节点条（约 340px）+ 左下缩放簇（约 190px）+ 两边留白放得下的最小舞台宽。 */
export const ADD_BAR_SHARES_BOTTOM_ROW_MIN_STAGE_WIDTH = 820

const TOOLBAR_BUTTON_CLASS = cn(
  'grid size-8 min-h-8 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent p-0 text-nomi-ink-80 cursor-pointer',
  'transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink active:bg-nomi-ink-10',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-nomi-accent',
  'disabled:cursor-not-allowed disabled:opacity-40',
  '[&>svg]:size-[18px]',
)

export default function CanvasToolbar({ getInsertionPosition, categoryId, stageWidth }: CanvasToolbarProps): JSX.Element {
  const { t } = useTranslation()
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const workflowTemplates = useGenerationCanvasStore((state) => state.workflowTemplates)
  const instantiateWorkflowTemplate = useGenerationCanvasStore((state) => state.instantiateWorkflowTemplate)
  const preference = useCanvasMenuPreferenceStore((state) => state.preference)
  React.useEffect(() => { void useCanvasMenuPreferenceStore.getState().load().catch(() => {}) }, [])
  const [moreOpen, setMoreOpen] = React.useState(false)
  const closeMore = React.useCallback(() => setMoreOpen(false), [])

  const addIntent = useCanvasAddIntentAction({ getInsertionPosition, categoryId })

  const handlePick = (intent: CanvasAddIntent) => {
    setMoreOpen(false)
    addIntent.run(intent)
  }

  const dockRef = React.useRef<HTMLDivElement>(null)
  useCanvasChromeOcclusion(dockRef)
  const lifted = stageWidth !== undefined && stageWidth < ADD_BAR_SHARES_BOTTOM_ROW_MIN_STAGE_WIDTH

  return (
    <div
      ref={dockRef}
      style={{ zIndex: CANVAS_CHROME_LAYERS.chromeDock }}
      className={cn(
        'generation-canvas-v2-toolbar',
        // 拍板稿 Main 板：加节点条是内容区底部正中的一条横排（图片 视频 声音 文字 剪辑 | 导入 +），贴着时间轴窄条上沿。
        'absolute left-1/2 inline-flex h-10 items-center gap-0.5 p-1 -translate-x-1/2',
        lifted ? 'bottom-[60px]' : 'bottom-4',
        'border border-workbench-border rounded-nomi',
        'bg-nomi-paper shadow-workbench-md',
        'max-w-[calc(100%-32px)]',
      )}
      // 常驻底部：选择浮条 / 时间轴胶囊得让开这一块（同左下缩放簇）。
      data-canvas-bottom-dock="true"
      aria-label={t('canvas.toolbar')}
    >
      {addIntent.pickerInput}
      <TooltipProvider delayDuration={250} disableHoverableContent>
        {canvasResidentAddIntents(preference).map((intent, index) => {
          const Icon = intentIcon(intent)
          const action = intentActionLabel(intent, t)
          const tip = intent.kind ? t('canvas.nodeName', { type: nodeKindLabel(intent.kind, t) }) : action
          return (
            <React.Fragment key={intent.id}>
              {/* 导入和「生成什么」不是一类：Claude Design 拍板稿里它前面有一道竖线（这里是横线）。 */}
              {intent.id === 'import-file' && index > 0 ? <span className="mx-1 h-[18px] w-px shrink-0 bg-nomi-line" aria-hidden="true" /> : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-add-intent={intent.id}
                    {...(intent.kind ? { 'data-node-kind': intent.kind } : {})}
                    className={TOOLBAR_BUTTON_CLASS}
                    aria-label={action}
                    onClick={() => addIntent.run(intent)}
                  >
                    <Icon size={18} stroke={1.5} />
                    <span className="hidden">{intentLabel(intent, t)}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{tip}</TooltipContent>
              </Tooltip>
            </React.Fragment>
          )
        })}
        {/* 最后一颗「+」：和常驻项同色同尺寸，点开 = 「空间」一组（Claude Design 拍板稿；以前是悬停才出的「更多」）。 */}
        <div className="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-canvas-add-more="true"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-label={t('canvas.moreMenu')}
                className={cn(TOOLBAR_BUTTON_CLASS, moreOpen && 'bg-nomi-ink-10 text-nomi-ink')}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <IconPlus size={18} stroke={1.5} />
              </button>
            </TooltipTrigger>
            {moreOpen ? null : <TooltipContent side="top">{t('canvas.moreMenu')}</TooltipContent>}
          </Tooltip>
          {moreOpen ? <CanvasMoreAddMenu className="absolute bottom-[calc(100%+12px)] right-[-4px]" onPick={handlePick} onClose={closeMore} /> : null}
        </div>
        {workflowTemplates.length ? (
          <>
            <span className="mx-1 h-[18px] w-px shrink-0 bg-nomi-line" aria-hidden="true" />
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
                className={TOOLBAR_BUTTON_CLASS}
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
            <TooltipContent side="top">{t('generationCommon.workflowPlugin.addCheckpoint')}</TooltipContent>
          </Tooltip>
        ) : null}
      </TooltipProvider>
    </div>
  )
}
