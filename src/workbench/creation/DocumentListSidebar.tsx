import React, { type JSX } from 'react'
import { workspacePanelFrame, workspacePanelHeader } from '../WorkspacePanelFrame'
import { CreationResourceTreeToggle } from './CreationResourceTreeToggle'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconDotsVertical,
  IconFileText,
  IconMovie,
  IconPlus,
} from '@tabler/icons-react'
import { confirmDialog, WorkbenchIconButton } from '../../design'
import { SwipeToDeleteRow } from '../../design/SwipeToDeleteRow'
import { showUndoToast } from '../../utils/showUndoToast'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { materializedShotIds } from './storyboard/exec/storyboardNodeBinding'
import { useGenerationViewStore } from '../generation/list/generationViewStore'

type EditingTarget = { kind: 'document' | 'storyboard'; id: string } | null
type ResourceMenu = {
  target: NonNullable<EditingTarget>
  documentId: string
  x: number
  y: number
} | null

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
  const addWorkbenchDocument = useWorkbenchStore((state) => state.addWorkbenchDocument)
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
  const [menu, setMenu] = React.useState<ResourceMenu>(null)
  const settledRef = React.useRef(false)

  React.useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])

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

  // 点一份「分镜方案」= 生成页列表、只看这份分镜（2026-10-08 拍板：分镜和画布是同一份镜头，一个组件一个地方）。
  // 方案专属的编辑（视觉锚、分场、时长、加删镜头、还没落画布的镜）在第二步账本合一之前仍住在分镜编辑器里，
  // 入口是 ⋯ 菜单「编辑分镜方案」，新建 / 复制出来的方案直接进编辑器。
  const selectStoryboard = (id: string, documentId: string) => {
    setActiveStoryboardId(id, documentId)
    setExpanded((current) => ({ ...current, [documentId]: true }))
    useGenerationViewStore.getState().openListFiltered({ documentId, designId: id })
    setWorkspaceMode('generation')
  }

  const editStoryboard = (id: string, documentId: string) => {
    setActiveStoryboardId(id, documentId)
    setWorkspaceMode('storyboard')
    setExpanded((current) => ({ ...current, [documentId]: true }))
  }

  const createDesignForDocument = (documentId: string) => {
    const design = addStoryboardDesign({ initiator: 'user', documentId })
    if (design) editStoryboard(design.id, documentId)
  }

  const openMenu = React.useCallback((
    target: NonNullable<EditingTarget>,
    documentId: string,
    point: { x: number; y: number },
  ) => {
    const menuWidth = 176
    const menuHeight = target.kind === 'storyboard' ? 152 : 88
    setMenu({
      target,
      documentId,
      x: Math.max(8, Math.min(point.x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(point.y, window.innerHeight - menuHeight - 8)),
    })
  }, [])

  const openMenuFromButton = React.useCallback((
    event: React.MouseEvent<HTMLButtonElement>,
    target: NonNullable<EditingTarget>,
    documentId: string,
  ) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    openMenu(target, documentId, { x: rect.right - 176, y: rect.bottom + 4 })
  }, [openMenu])

  const renderMenu = () => {
    if (!menu) return null
    const menuTarget = menu.target
    const buttonClass = 'w-full px-2.5 py-1.5 text-left text-caption text-nomi-ink-80 hover:bg-nomi-ink-05 disabled:cursor-not-allowed disabled:text-nomi-ink-40'
    const dangerClass = 'w-full px-2.5 py-1.5 text-left text-caption text-workbench-danger hover:bg-workbench-danger-soft disabled:cursor-not-allowed disabled:text-nomi-ink-40'
    const close = () => setMenu(null)
    return createPortal(
      <div
        role="menu"
        className="fixed z-50 min-w-[176px] overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-paper py-1 shadow-workbench-pop"
        style={{ left: menu.x, top: menu.y }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
        data-creation-resource-menu={menuTarget.kind}
      >
        {menuTarget.kind === 'storyboard' ? (
          <button
            type="button"
            role="menuitem"
            className={buttonClass}
            data-resource-action="edit-storyboard"
            onClick={() => {
              close()
              editStoryboard(menuTarget.id, menu.documentId)
            }}
          >
            {t('generationList.editStoryboardPlan')}
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          className={buttonClass}
          data-resource-action="rename"
          onClick={() => {
            const title = menuTarget.kind === 'document'
              ? documents.find((document) => document.id === menuTarget.id)?.title
              : designsByDocumentId[menu.documentId]?.find((design) => design.id === menuTarget.id)?.title
            close()
            if (title !== undefined) beginRename(menuTarget, title)
          }}
        >
          {t('creationAi.documentList.rename')}
        </button>
        {menuTarget.kind === 'storyboard' ? (
          <button
            type="button"
            role="menuitem"
            className={buttonClass}
            data-resource-action="duplicate"
            onClick={() => {
              const copy = duplicateStoryboardDesign(menuTarget.id, menu.documentId)
              close()
              if (copy) editStoryboard(copy.id, menu.documentId)
            }}
          >
            {t('creationAi.documentList.duplicateStoryboard')}
          </button>
        ) : null}
        <div className="my-0.5 h-px bg-nomi-line" />
        <button
          type="button"
          role="menuitem"
          className={dangerClass}
          data-resource-action="delete"
          disabled={menuTarget.kind === 'document' && documents.length <= 1}
          title={menuTarget.kind === 'document' && documents.length <= 1 ? t('creationAi.documentList.keepOneDocument') : undefined}
          onClick={() => {
            close()
            if (menuTarget.kind === 'document') {
              const title = documents.find((document) => document.id === menuTarget.id)?.title || t('runtime.project.untitled')
              void onDeleteDocument(menuTarget.id, title)
            } else {
              onDeleteStoryboard(menuTarget.id, menu.documentId)
            }
          }}
        >
          {menuTarget.kind === 'document' ? t('creationAi.documentList.delete') : t('creationAi.documentList.deleteStoryboard')}
        </button>
      </div>,
      document.body,
    )
  }

  return (
    <aside
      className={cn('flex h-full w-[240px] shrink-0 flex-col', workspacePanelFrame)}
      aria-label={t('creationAi.documentList.aria')}
      data-creation-resource-tree="true"
    >
      <div className={cn('flex shrink-0 items-center justify-between gap-1', workspacePanelHeader)}>
        <div className="min-w-0">
          <div className="truncate text-body-sm font-semibold text-nomi-ink">{t('creationAi.documentList.title')}</div>
          <div className="text-micro text-nomi-ink-40">{t('creationAi.documentList.count', { count: documents.length })}</div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <WorkbenchIconButton
            icon={<IconPlus size={16} stroke={1.6} />}
            label={t('creationAi.documentList.newDocumentAria')}
            onClick={addWorkbenchDocument}
          />
          <CreationResourceTreeToggle placement="column" />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label={t('creationAi.documentList.aria')}>
        {documents.length === 0 ? (
          <div className="px-2 py-3 text-caption text-nomi-ink-40">{t('creationAi.documentList.empty')}</div>
        ) : documents.map((doc) => {
          const designs = designsByDocumentId[doc.id] ?? []
          const isExpanded = expanded[doc.id] !== false
          const documentActive = doc.id === activeDocumentId && activeStoryboardId === null
          const documentEditing = editing?.kind === 'document' && editing.id === doc.id
          return (
            <div key={doc.id} className="mb-1">
              <div
                className={cn(
                  'group relative flex min-h-10 w-full items-center gap-1 rounded-nomi-sm border border-transparent px-1 py-1.5',
                  documentActive ? 'bg-nomi-accent-soft text-nomi-accent' : 'text-nomi-ink-80 hover:bg-nomi-ink-05',
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
                    className="min-w-0 flex-1 border-b border-nomi-accent/50 bg-transparent text-caption text-nomi-ink outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => selectDocument(doc.id)}
                    onDoubleClick={() => beginRename({ kind: 'document', id: doc.id }, doc.title)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      openMenu({ kind: 'document', id: doc.id }, doc.id, { x: event.clientX, y: event.clientY })
                    }}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left text-caption leading-tight',
                      'cursor-pointer',
                      documentActive ? 'text-nomi-accent' : 'text-nomi-ink-80',
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
                <WorkbenchIconButton
                  icon={<IconDotsVertical size={15} stroke={1.5} />}
                  label={t('creationAi.documentList.moreActions')}
                  className="absolute right-1 size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  data-resource-menu-trigger="document"
                  onClick={(event) => openMenuFromButton(event, { kind: 'document', id: doc.id }, doc.id)}
                />
              </div>

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
                      // 行外面包一层手势壳：hover/聚焦时轻推探头露出删除区，点它即删；
                      // 行聚焦时 Delete/Backspace 也删。删除区的宽度按 240px 侧栏给，
                      // 不用组件的默认值（那是给一屏宽的列表行定的，会吃掉半行标题）。
                      <SwipeToDeleteRow
                        key={design.id}
                        label={title}
                        deleteLabel={t('creationAi.documentList.deleteStoryboard')}
                        deletedAnnouncement={t('creationAi.documentList.storyboardDeleted', { title })}
                        // 这两个数是量出来的，不是抄的：方案行住在 240px 侧栏里、还要再缩进
                        // 一层，可用宽只有 ~190px。行往左推多少，左端就有多少被裁掉——
                        // 推 36px 时那颗片型图标整个没了（真机截图上看得很清楚），
                        // 行看起来像坏了，而不是像让开了。推 28px 时图标还在，
                        // 而删除区仍给到 56px：图标永远居中在**已经露出来的那一段**里
                        //（`exposed`），所以探头只露一半也照样看得见、点得到。
                        actionWidth={56}
                        hoverPeek={28}
                        onDelete={() => onDeleteStoryboard(design.id, doc.id)}
                        className="mb-0.5"
                      >
                      <div
                        className={cn(
                          'group/design relative flex min-h-10 w-full items-center gap-1 rounded-nomi-sm border border-transparent px-2 py-1.5',
                          designActive ? 'bg-nomi-accent-soft text-nomi-accent' : 'text-nomi-ink-80 hover:bg-nomi-ink-05',
                        )}
                        data-storyboard-row={design.id}
                        data-storyboard-status={stale ? 'stale' : committedNow ? 'committed' : 'draft'}
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
                            className="min-w-0 flex-1 border-b border-nomi-accent/50 bg-transparent text-caption text-nomi-ink outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => selectStoryboard(design.id, doc.id)}
                            onDoubleClick={() => beginRename({ kind: 'storyboard', id: design.id }, design.title)}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              openMenu({ kind: 'storyboard', id: design.id }, doc.id, { x: event.clientX, y: event.clientY })
                            }}
                            className={cn(
                              'flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left text-caption leading-tight',
                              designActive ? 'text-nomi-accent' : 'text-nomi-ink-80',
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
                                'grid size-4 shrink-0 place-items-center transition-opacity group-hover/design:opacity-0 group-focus-within/design:opacity-0',
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
                        <WorkbenchIconButton
                          icon={<IconDotsVertical size={15} stroke={1.5} />}
                          label={t('creationAi.documentList.moreActions')}
                          className="absolute right-1 size-7 opacity-0 group-hover/design:opacity-100 group-focus-within/design:opacity-100 focus-visible:opacity-100"
                          data-resource-menu-trigger="storyboard"
                          onClick={(event) => openMenuFromButton(event, { kind: 'storyboard', id: design.id }, doc.id)}
                        />
                      </div>
                      </SwipeToDeleteRow>
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
      {renderMenu()}
    </aside>
  )
}
