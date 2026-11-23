import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCopy,
  IconFileText,
  IconMovie,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react'
import { confirmDialog, WORKBENCH_MENU_TRIGGER_OPEN_CLASS, WorkbenchContextMenu, WorkbenchIconButton, type WorkbenchMenuNode } from '../../design'
import { showUndoToast } from '../../utils/showUndoToast'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { materializedShotIds } from './storyboard/exec/storyboardNodeBinding'

type EditingTarget = { kind: 'document' | 'storyboard'; id: string } | null

/** 资源右键菜单的皮肤（文稿行与分镜方案行共用；行本身是触发器，菜单开着时行带打开态）。 */
const RESOURCE_MENU_SKIN = {
  className: 'min-w-[176px] rounded-nomi-sm py-1 px-0 gap-0',
  itemClassName: 'min-h-0 rounded-none px-2.5 py-1.5 text-nomi-ink-80',
  separatorClassName: 'my-0.5 mx-0',
} as const

/**
 * 行内动作：≤3 个就直接摆图标（带 hover 名字），不藏进「⋯」（设计系统 §1.8 规则 2 补充，用户 2026-10-10）。
 * 悬停 / 聚焦 / 当前项时露出；右键菜单仍留着给习惯右键的人，两处走同一组处理函数。
 */
function RowActions({ kind, id, active, deleteDisabledReason, onRename, onDuplicate, onDelete, hoverGroup }: {
  kind: 'document' | 'storyboard'
  id: string
  active: boolean
  deleteDisabledReason?: string
  onRename: () => void
  onDuplicate?: () => void
  onDelete: () => void
  hoverGroup: string
}): JSX.Element {
  const { t } = useTranslation()
  const stop = (event: React.SyntheticEvent) => event.stopPropagation()
  return (
    <div
      className={cn(
        'absolute right-1 top-1/2 z-[1] flex -translate-y-1/2 items-center rounded-nomi-sm bg-[inherit] opacity-0',
        hoverGroup,
        active && 'opacity-100',
      )}
      data-resource-actions={kind}
      onPointerDown={stop}
    >
      <WorkbenchIconButton
        size="sm"
        className="size-6"
        icon={<IconPencil size={15} stroke={1.5} />}
        label={t('creationAi.documentList.rename')}
        data-resource-action="rename"
        data-resource-target={id}
        onClick={(event) => { event.stopPropagation(); onRename() }}
      />
      {onDuplicate ? (
        <WorkbenchIconButton
          size="sm"
          className="size-6"
          icon={<IconCopy size={15} stroke={1.5} />}
          label={t('creationAi.documentList.duplicateStoryboard')}
          data-resource-action="duplicate"
          data-resource-target={id}
          onClick={(event) => { event.stopPropagation(); onDuplicate() }}
        />
      ) : null}
      <WorkbenchIconButton
        size="sm"
        icon={<IconTrash size={15} stroke={1.5} />}
        label={kind === 'document' ? t('creationAi.documentList.delete') : t('creationAi.documentList.deleteStoryboard')}
        title={deleteDisabledReason}
        disabled={Boolean(deleteDisabledReason)}
        data-resource-action="delete"
        data-resource-target={id}
        className="size-6 hover:text-workbench-danger"
        onClick={(event) => { event.stopPropagation(); onDelete() }}
      />
    </div>
  )
}

/**
 * 创作内容树（原稿 + 各自的分镜方案）。10-08 外壳重设计起住在左栏「文稿」抽屉里——
 * 抽屉自带标题、外框与「新建文稿」，这里只画树本身。
 */
export default function DocumentListSidebar(): JSX.Element {
  const { t } = useTranslation()
  const documents = useWorkbenchStore((state) => state.workbenchDocuments)
  const activeDocumentId = useWorkbenchStore((state) => state.activeDocumentId)
  const activeStoryboardId = useWorkbenchStore((state) => state.activeStoryboardId)
  const canvasNodes = useGenerationCanvasStore((state) => state.nodes)
  const designsByDocumentId = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId)
  const setActiveDocumentId = useWorkbenchStore((state) => state.setActiveDocumentId)
  const setActiveStoryboardId = useWorkbenchStore((state) => state.setActiveStoryboardId)
  const setWorkspaceMode = useWorkbenchStore((state) => state.setWorkspaceMode)
  const deleteWorkbenchDocument = useWorkbenchStore((state) => state.deleteWorkbenchDocument)
  const renameWorkbenchDocument = useWorkbenchStore((state) => state.renameWorkbenchDocument)
  const addStoryboardDesign = useWorkbenchStore((state) => state.addStoryboardDesign)
  const duplicateStoryboardDesign = useWorkbenchStore((state) => state.duplicateStoryboardDesign)
  const renameStoryboardDesign = useWorkbenchStore((state) => state.renameStoryboardDesign)
  const deleteStoryboardDesign = useWorkbenchStore((state) => state.deleteStoryboardDesign)
  const restoreStoryboardDesign = useWorkbenchStore((state) => state.restoreStoryboardDesign)
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [editing, setEditing] = React.useState<EditingTarget>(null)
  const [draftTitle, setDraftTitle] = React.useState('')
  const settledRef = React.useRef(false)

  const beginRename = React.useCallback((target: NonNullable<EditingTarget>, title: string) => {
    settledRef.current = false
    setEditing(target)
    setDraftTitle(title)
  }, [])

  const commitRename = React.useCallback(() => {
    if (!editing || settledRef.current) return
    settledRef.current = true
    if (editing.kind === 'document') renameWorkbenchDocument(editing.id, draftTitle)
    else renameStoryboardDesign(editing.id, draftTitle)
    setEditing(null)
  }, [draftTitle, editing, renameStoryboardDesign, renameWorkbenchDocument])

  const cancelRename = React.useCallback(() => {
    settledRef.current = true
    setEditing(null)
  }, [])

  const onDeleteDocument = React.useCallback(async (id: string, title: string) => {
    const confirmed = await confirmDialog({
      title: t('creationAi.documentList.deleteTitle'),
      message: t('creationAi.documentList.deleteMessage', { title }),
      confirmLabel: t('creationAi.documentList.deleteConfirm'),
      danger: true,
    })
    if (confirmed) deleteWorkbenchDocument(id)
  }, [deleteWorkbenchDocument, t])

  /**
   * 删一条方案。**不弹确认**（2026-09-21 改）——删除是一个手势，不是一道题。
   *
   * 原来是「⋮ → 删除方案 → 模态确认」三步，而这件事本来就撤得回来：确认弹窗拦得住手滑，
   * 代价是对**每一次**删除都收一遍税；撤销只对真的手滑那一次收税（Spectrum 的
   * Swipe to Delete 那篇文档的读法，也是用户 09-21「有个删除 icon 就行」的意思）。
   *
   * 撤销接的是仓库现成的 owner `showUndoToast`（今天 8 个调用方共用同一只 toast 容器），
   * 不新造一颗撤销药丸。它是**先做后撤**的模型，所以这里必须先把「它原来排第几」记下来
   * ——`restoreStoryboardDesign` 靠它放回原位；放回队尾的话用户点完撤销还得重新找一遍。
   *
   * `isUndoable` 那条判据不是形式主义：toast 挂着的这几秒里，模型、另一条 lane、
   * 另一个会话都可能往同一份表里写。同 id 已经回来了就别再插一遍
   * （`restoreStoryboardDesign` 自己也挡一道，两头都挡是因为这笔数据会落盘）。
   */
  const onDeleteStoryboard = React.useCallback((id: string, documentId: string) => {
    const designs = useWorkbenchStore.getState().storyboardDesignsByDocumentId[documentId] ?? []
    const index = designs.findIndex((design) => design.id === id)
    const removed = designs[index]
    if (!removed) return
    deleteStoryboardDesign(id, documentId)
    showUndoToast({
      message: t('creationAi.documentList.storyboardDeleted', { title: removed.title || t('storyboardEditor.planCard.defaultTitle') }),
      onUndo: () => restoreStoryboardDesign(removed, documentId, index),
      isUndoable: () => !(useWorkbenchStore.getState().storyboardDesignsByDocumentId[documentId] ?? []).some((design) => design.id === id),
    })
  }, [deleteStoryboardDesign, restoreStoryboardDesign, t])

  // 点原稿 = 回到剧本编辑器。模式必须一起切回 creation：在分镜页只清 activeStoryboardId
  // 的话，StoryboardWorkspace 的「没有激活方案就自动选第一个」会立刻把用户弹回方案里。
  const selectDocument = (id: string) => {
    setActiveDocumentId(id)
    setActiveStoryboardId(null)
    setWorkspaceMode('creation')
  }

  // 点一份「分镜方案」= 留在创作页打开这份方案（2026-10-08 22:40Z C3：方案视图做好前先开现役的方案编辑器）。
  const selectStoryboard = (id: string, documentId: string) => {
    setActiveStoryboardId(id, documentId)
    setWorkspaceMode('storyboard')
    setExpanded((current) => ({ ...current, [documentId]: true }))
  }

  const createDesignForDocument = (documentId: string) => {
    const design = addStoryboardDesign({ initiator: 'user', documentId })
    if (design) selectStoryboard(design.id, documentId)
  }

  // 菜单项只在右键打开那一刻才拼（WorkbenchContextMenu 惰性调用），读到的是打开时的文稿 / 方案。
  const buildMenuItems = (menuTarget: NonNullable<EditingTarget>, documentId: string): WorkbenchMenuNode[] => {
    const deleteDisabled = menuTarget.kind === 'document' && documents.length <= 1
    return [
      {
        id: 'rename',
        label: t('creationAi.documentList.rename'),
        dataAttributes: { 'data-resource-action': 'rename' },
        onSelect: () => {
          const title = menuTarget.kind === 'document'
            ? documents.find((document) => document.id === menuTarget.id)?.title
            : designsByDocumentId[documentId]?.find((design) => design.id === menuTarget.id)?.title
          if (title !== undefined) beginRename(menuTarget, title)
        },
      },
      ...(menuTarget.kind === 'storyboard'
        ? [{
            id: 'duplicate',
            label: t('creationAi.documentList.duplicateStoryboard'),
            dataAttributes: { 'data-resource-action': 'duplicate' },
            onSelect: () => {
              const copy = duplicateStoryboardDesign(menuTarget.id, documentId)
              if (copy) selectStoryboard(copy.id, documentId)
            },
          } satisfies WorkbenchMenuNode]
        : []),
      { kind: 'separator', id: 'sep-delete' },
      {
        id: 'delete',
        label: menuTarget.kind === 'document' ? t('creationAi.documentList.delete') : t('creationAi.documentList.deleteStoryboard'),
        danger: true,
        disabled: deleteDisabled,
        disabledReason: deleteDisabled ? t('creationAi.documentList.keepOneDocument') : undefined,
        dataAttributes: { 'data-resource-action': 'delete' },
        onSelect: () => {
          if (menuTarget.kind === 'document') {
            const title = documents.find((document) => document.id === menuTarget.id)?.title || t('runtime.project.untitled')
            void onDeleteDocument(menuTarget.id, title)
          } else {
            onDeleteStoryboard(menuTarget.id, documentId)
          }
        },
      },
    ]
  }

  return (
    <aside
      className="flex min-h-0 flex-1 flex-col"
      aria-label={t('creationAi.documentList.aria')}
      data-creation-resource-tree="true"
    >
      <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label={t('creationAi.documentList.aria')}>
        {documents.length === 0 ? (
          <div className="px-2 py-3 text-caption text-nomi-ink-40">{t('creationAi.documentList.empty')}</div>
        ) : documents.map((doc) => {
          const designs = designsByDocumentId[doc.id] ?? []
          const isExpanded = expanded[doc.id] !== false
          const documentActive = doc.id === activeDocumentId && activeStoryboardId === null
          const documentEditing = editing?.kind === 'document' && editing.id === doc.id
          return (
            <div key={doc.id} className="mb-1">
              <WorkbenchContextMenu
                {...RESOURCE_MENU_SKIN}
                disabled={documentEditing}
                ariaLabel={t('creationAi.documentList.aria')}
                contentData={{ 'data-creation-resource-menu': 'document' }}
                items={() => buildMenuItems({ kind: 'document', id: doc.id }, doc.id)}
              >
                <div
                  className={cn(
                    'group relative flex min-h-10 w-full items-center gap-1 rounded-nomi-sm border border-transparent px-1 py-1.5',
                    documentActive ? 'bg-nomi-accent-soft text-nomi-ink' : cn('text-nomi-ink-80 hover:bg-nomi-ink-05 focus-within:bg-nomi-ink-05', WORKBENCH_MENU_TRIGGER_OPEN_CLASS),
                  )}
                  data-document-row={doc.id}
                >
                  <button
                    type="button"
                    className="grid size-6 shrink-0 place-items-center rounded-nomi-sm bg-transparent text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                    aria-label={isExpanded ? t('creationAi.documentList.collapse') : t('creationAi.documentList.expand')}
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded((current) => ({ ...current, [doc.id]: !isExpanded }))}
                  >
                    {isExpanded ? <IconChevronDown size={15} stroke={1.6} /> : <IconChevronRight size={15} stroke={1.6} />}
                  </button>
                  {documentEditing ? (
                    <input
                      autoFocus
                      value={draftTitle}
                      aria-label={t('creationAi.documentList.renameAria')}
                      onChange={(event) => setDraftTitle(event.currentTarget.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename()
                        if (event.key === 'Escape') cancelRename()
                      }}
                      onBlur={commitRename}
                      className="min-w-0 flex-1 border-b border-nomi-ink-40 bg-transparent text-caption text-nomi-ink outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => selectDocument(doc.id)}
                      onDoubleClick={() => beginRename({ kind: 'document', id: doc.id }, doc.title)}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left text-caption leading-tight',
                        'cursor-pointer',
                        documentActive ? 'text-nomi-ink' : 'text-nomi-ink-80',
                        // 行内图标露出时给它们让位（2 个图标 = 48px），标题不被盖住。
                        documentActive ? 'pr-[52px]' : 'group-hover:pr-[52px] group-focus-within:pr-[52px]',
                      )}
                      data-document-id={doc.id}
                      data-active={documentActive ? 'true' : 'false'}
                      aria-current={documentActive ? 'page' : undefined}
                      title={doc.title || t('runtime.project.untitled')}
                    >
                      <IconFileText size={16} stroke={1.5} className="shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 break-words leading-snug line-clamp-2" data-document-title="true">{doc.title || t('runtime.project.untitled')}</span>
                      <span className="ml-auto shrink-0 text-micro tabular-nums text-nomi-ink-40 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                        {designs.length || ''}
                      </span>
                    </button>
                  )}
                  <RowActions
                    kind="document"
                    id={doc.id}
                    active={documentActive}
                    hoverGroup="group-hover:opacity-100 group-focus-within:opacity-100"
                    deleteDisabledReason={documents.length <= 1 ? t('creationAi.documentList.keepOneDocument') : undefined}
                    onRename={() => beginRename({ kind: 'document', id: doc.id }, doc.title)}
                    onDelete={() => void onDeleteDocument(doc.id, doc.title || t('runtime.project.untitled'))}
                  />
                </div>
              </WorkbenchContextMenu>

              {isExpanded ? (
                <div className="ml-5 border-l border-nomi-line/70 pl-2">
                  {designs.map((design) => {
                    const designActive = design.id === activeStoryboardId
                    const stale = doc.updatedAt > design.sourceDocumentUpdatedAt
                    const designEditing = editing?.kind === 'storyboard' && editing.id === design.id
                    // v5 committed 语义 derive：至少一镜已建节点（旧项目回退存量标记）。
                    const committedNow = design.committed || materializedShotIds(canvasNodes, design.id).size > 0
                    const statusLabel = stale ? t('storyboardEditor.planCard.stale') : committedNow ? t('storyboardEditor.planCard.committed') : t('storyboardEditor.planCard.draft')
                    const title = design.title || t('storyboardEditor.planCard.defaultTitle')
                    return (
                      <WorkbenchContextMenu
                        key={design.id}
                        {...RESOURCE_MENU_SKIN}
                        disabled={designEditing}
                        ariaLabel={t('creationAi.documentList.aria')}
                        contentData={{ 'data-creation-resource-menu': 'storyboard' }}
                        items={() => buildMenuItems({ kind: 'storyboard', id: design.id }, doc.id)}
                      >
                        <div
                          className={cn(
                            'group/design relative flex min-h-10 w-full items-center gap-1 rounded-nomi-sm border border-transparent px-2 py-1.5',
                            designActive ? 'bg-nomi-accent-soft text-nomi-ink' : cn('text-nomi-ink-80 hover:bg-nomi-ink-05 focus-within:bg-nomi-ink-05', WORKBENCH_MENU_TRIGGER_OPEN_CLASS),
                          )}
                          data-storyboard-row={design.id}
                          data-storyboard-status={stale ? 'stale' : committedNow ? 'committed' : 'draft'}
                          // 行聚焦时 Delete / Backspace 也删（原来 SwipeToDeleteRow 带的键盘入口，换成图标后不丢）；
                          // 正在改名的输入框里按退格是删字，不是删方案。
                          onKeyDown={(event) => {
                            if (event.key !== 'Delete' && event.key !== 'Backspace') return
                            if ((event.target as HTMLElement).closest('input, textarea')) return
                            event.preventDefault()
                            onDeleteStoryboard(design.id, doc.id)
                          }}
                        >
                          {designEditing ? (
                            <input
                              autoFocus
                              value={draftTitle}
                              aria-label={t('storyboardEditor.titleAria')}
                              onChange={(event) => setDraftTitle(event.currentTarget.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') commitRename()
                                if (event.key === 'Escape') cancelRename()
                              }}
                              onBlur={commitRename}
                              className="min-w-0 flex-1 border-b border-nomi-ink-40 bg-transparent text-caption text-nomi-ink outline-none"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => selectStoryboard(design.id, doc.id)}
                              onDoubleClick={() => beginRename({ kind: 'storyboard', id: design.id }, design.title)}
                              className={cn(
                                'flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left text-caption leading-tight',
                                designActive ? 'text-nomi-ink' : 'text-nomi-ink-80',
                                // 3 个图标 = 72px，露出时给它们让位。
                                designActive ? 'pr-[76px]' : 'group-hover/design:pr-[76px] group-focus-within/design:pr-[76px]',
                              )}
                              data-storyboard-id={design.id}
                              data-document-id={doc.id}
                              data-active={designActive ? 'true' : 'false'}
                              aria-current={designActive ? 'page' : undefined}
                              aria-label={`${title}, ${statusLabel}`}
                              title={`${title} · ${statusLabel}`}
                            >
                              <IconMovie size={16} stroke={1.5} className="shrink-0" aria-hidden />
                              <span className="min-w-0 flex-1 break-words leading-snug line-clamp-2" data-storyboard-title="true">{title}</span>
                              <span
                                className={cn(
                                  // 行内图标露出（悬停 / 聚焦 / 当前项）时状态点让出位置：抽屉只有 ~190px，三个图标 + 状态点 + 标题挤不下。
                                  'grid size-4 shrink-0 place-items-center group-hover/design:hidden group-focus-within/design:hidden',
                                  designActive && 'hidden',
                                  stale ? 'text-nomi-warning' : design.committed ? 'text-workbench-success' : 'text-nomi-ink-40',
                                )}
                                title={statusLabel}
                                data-storyboard-status-indicator="true"
                                aria-hidden="true"
                              >
                                {stale ? <IconAlertTriangle size={13} stroke={1.8} /> : design.committed
                                  ? <IconCircleCheck size={13} stroke={1.8} />
                                  : <span className="size-1.5 rounded-full bg-current" />}
                              </span>
                            </button>
                          )}
                          <RowActions
                            kind="storyboard"
                            id={design.id}
                            active={designActive}
                            hoverGroup="group-hover/design:opacity-100 group-focus-within/design:opacity-100"
                            onRename={() => beginRename({ kind: 'storyboard', id: design.id }, design.title)}
                            onDuplicate={() => {
                              const copy = duplicateStoryboardDesign(design.id, doc.id)
                              if (copy) selectStoryboard(copy.id, doc.id)
                            }}
                            onDelete={() => onDeleteStoryboard(design.id, doc.id)}
                          />
                        </div>
                      </WorkbenchContextMenu>
                    )
                  })}
                  <button
                    type="button"
                    className="mt-0.5 flex w-full items-center gap-2 rounded-nomi-sm px-2 py-1.5 text-left text-caption text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink-80"
                    onClick={() => createDesignForDocument(doc.id)}
                    data-add-storyboard={doc.id}
                  >
                    <IconPlus size={14} stroke={1.5} aria-hidden />
                    <span>{t('creationAi.documentList.newStoryboard')}</span>
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
