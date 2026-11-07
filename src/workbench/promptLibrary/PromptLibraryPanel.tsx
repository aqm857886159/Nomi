/**
 * 提示词库。放进节点提示词框的那段话的家：我的 + 内置（表情预设、效果——效果 10-24 拍板 Q1 住这里）+ 公开库（各来源）。
 * 唯一主动作「放上画布」（新建对应类型节点 + 带参考图 + 选中，撤销删节点，Q9）；往已有节点里加走节点自己的「提示词预设」。
 * 排版按 2026-10-24 拍板图（docs/design/boards/2026-10-24/PromptLibrary、LibraryDrawers、PromptDetail、LibraryMine、LibraryStates）：
 *   宽页 = 页签同一行「全部 / 图片 / 视频」· 搜索 · 新建；左侧分类三段（我的 / 内置 / 公开库），右侧分组虚拟网格（6 列），首页每组一行 +「全部 N ›」；
 *   抽屉 = 新建在标题行，第一行搜索 +「分类 ▾」（同一颗里管图片 / 视频），2 列。
 * 数据：内置与公开库由主进程聚合（1h 缓存 + 打包快照兜底，只读）；我的库用户级跨项目、可改可删。设计卡 docs/plan/2026-10-23-skill-prompt-library-layout.md。
 */
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconBulb, IconPlus, IconRefresh } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignEmptyState, DesignSearchInput, NomiLoadingMark, NomiSegmented, WorkbenchIconButton } from '../../design'
import { showUndoToast } from '../../utils/showUndoToast'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { applyPromptReferenceImages } from '../generationCanvas/nodes/promptReferenceImages'
import { matchesPromptQuery, type LibraryPrompt, type PromptCategory } from '../api/promptLibraryApi'
import { isBuiltinPromptSourceId } from '../../../electron/shared/contracts/promptLibrary'
import { usePromptLibrary } from './usePromptLibrary'
import { useUserPrompts } from './useUserPrompts'
import { PromptCard } from './PromptCard'
import { UserPromptComposer } from './UserPromptComposer'
import { PromptPreviewOverlay } from './PromptPreviewOverlay'
import { promptDisplayTitle } from './promptDisplay'
import { markLibraryUsed, sortByLibraryUsage, useLibraryUsageVersion } from '../library/libraryDiscovery'
import { libraryGroup } from '../library/libraryGroups'
import {
  LIBRARY_CATEGORY_ALL,
  LIBRARY_SECTION_MINE,
  buildLibrarySections,
  libraryColumns,
  libraryHomeCount,
  libraryNavGroups,
  librarySectionsView,
  type LibraryHost,
} from '../library/libraryLayout'
import { LibraryCategoryMenu, LibraryCategoryNav } from '../library/LibraryCategoryNav'
import { LibrarySectionList, type LibraryGridSpec } from '../library/LibrarySectionList'
import { useElementWidth } from '../creation/storyboard/shotRow/useElementWidth'

/** 卡片排法（量自拍板图）：宽页 4:3 封面 + 18 标题 + 16 meta，列距 12、行距 16、组距 22，最多 6 列；抽屉 2 列、列 / 行距 10。 */
const PROMPT_GRID: Record<LibraryHost, LibraryGridSpec> = {
  page: { minCardWidth: 160, maxColumns: 6, columnGap: 12, rowGap: 16, sectionGap: 22, cardHeight: (width) => width * 0.75 + 41 },
  drawer: { minCardWidth: 112, maxColumns: 4, columnGap: 10, rowGap: 10, sectionGap: 16, cardHeight: (width) => width * 0.75 + 35 },
}

type PromptLibraryContentProps = {
  /** page = 项目库页签（没开项目）；drawer = 项目里左栏抽屉。 */
  host: LibraryHost
  /** 宿主给的工具位：宽页是项目库页签那一行，抽屉是抽屉标题行。 */
  toolbarHost: HTMLElement | null
  className?: string
}

type Selected = { prompt: LibraryPrompt; rect: DOMRect }

export function PromptLibraryContent({ host, toolbarHost, className }: PromptLibraryContentProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const page = host === 'page'
  const [category, setCategory] = React.useState<string>(LIBRARY_CATEGORY_ALL)
  const [type, setType] = React.useState<PromptCategory>('all')
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<Selected | null>(null)
  const [composing, setComposing] = React.useState(false)
  const [editing, setEditing] = React.useState<LibraryPrompt | null>(null)
  const scrollElementRef = React.useRef<HTMLDivElement | null>(null)
  const setScrollElement = React.useCallback((element: HTMLDivElement | null) => { scrollElementRef.current = element }, [])
  const usageVersion = useLibraryUsageVersion()

  const { items, loading, error, reload } = usePromptLibrary(true)
  // 每次打开（挂载）重读一次「我的库」：渲染层写口写完会当场发布，这一读兜住不经它的写入（比如主进程那边写的）。
  const user = useUserPrompts(true, { refreshOnOpen: true })
  // 项目库页上没有打开的项目：「放上画布」会把节点建到一张看不见的画布上（真机 J-02），在页上禁用并说原因（C1）。
  const needsProjectReason = page ? t('libraries.layout.needsProject') : undefined

  const sections = React.useMemo(() => {
    // See ProjectLibraryPage: usageVersion invalidates recency after a use.
    void usageVersion
    const typed = [...user.items, ...items].filter((prompt) => type === 'all' || prompt.promptType === type)
    return buildLibrarySections(
      typed,
      (prompt) => (prompt.origin === 'user'
        ? { segment: 'mine' }
        : { segment: isBuiltinPromptSourceId(prompt.sourceId) ? 'builtin' : 'public', group: libraryGroup(prompt, i18n.language) }),
      { mine: t('libraries.layout.mine'), other: t('libraries.layout.other') },
    ).map((section) => ({
      ...section,
      items: sortByLibraryUsage(section.items, 'prompt', (prompt) => prompt.id, (prompt) => (prompt.updatedAt ? Date.parse(prompt.updatedAt) : undefined)),
    }))
  }, [user.items, items, type, i18n.language, t, usageVersion])
  const navGroups = React.useMemo(() => libraryNavGroups(sections, t('libraries.layout.all')), [sections, t])
  // 选中的分类因为切了「图片 / 视频」而不存在了：回到「全部」，不高亮一个不存在的组。
  React.useEffect(() => {
    if (category !== LIBRARY_CATEGORY_ALL && !sections.some((section) => section.id === category)) setCategory(LIBRARY_CATEGORY_ALL)
  }, [category, sections])

  const spec = PROMPT_GRID[host]
  const width = useElementWidth(scrollElementRef, 'content') ?? 0
  const columns = libraryColumns(width, { minCardWidth: spec.minCardWidth, gap: spec.columnGap, max: spec.maxColumns })
  const trimmedQuery = query.trim()
  const views = React.useMemo(() => librarySectionsView(sections, {
    category,
    match: trimmedQuery ? (prompt) => matchesPromptQuery(prompt, trimmedQuery) : undefined,
    homeCount: libraryHomeCount(columns),
  }), [sections, category, trimmedQuery, columns])

  const handleOpen = React.useCallback((prompt: LibraryPrompt, rect: DOMRect) => setSelected({ prompt, rect }), [])

  // 放上画布（Q9）：总是新建对应类型（图片 / 视频）的节点、带上参考图、选中它；撤销删掉这个节点。不追加到当前选中的节点。
  // 抽屉在创作 / 分镜 / 剪辑里也开得出来：那时画布不在眼前，新节点就建在看不见的地方（与没开项目的 J-02 同一类），
  // 所以放上之后切到生成画布，让用户看见被选中的那个节点（同「放进对话」切到创作）。
  const handleAddToCanvas = React.useCallback((prompt: LibraryPrompt) => {
    const store = useGenerationCanvasStore.getState()
    const kind = prompt.promptType === 'video' ? 'video' : 'image'
    const node = store.addNode({ kind, prompt: prompt.prompt, select: true })
    const workbench = useWorkbenchStore.getState()
    if (workbench.workspaceMode !== 'generation') workbench.setWorkspaceMode('generation')
    // 参考图和建卡是同一个撤销点：建卡那一笔已推过撤销快照，这里不再推（否则 Ctrl+Z 先撤掉参考图、卡还在）。
    const references = applyPromptReferenceImages(node.id, (prompt.referenceImages ?? []).map((reference) => reference.url), {
      updateNode: (nodeId, patch) => useGenerationCanvasStore.getState().updateNode(nodeId, patch, { history: false }),
      latestNode: (nodeId) => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId),
    })
    const added = t('libraries.prompt.sentToCanvas', { kind: kind === 'video' ? t('libraries.prompt.card.video') : t('libraries.prompt.card.image') })
    showUndoToast({
      message: references === 'unsupported' ? `${added} · ${t('generationCommon.composer.promptReferenceUnsupported')}` : added,
      onUndo: () => useGenerationCanvasStore.getState().deleteNode(node.id),
    })
    markLibraryUsed('prompt', prompt.id)
  }, [t])

  const handleNew = React.useCallback(() => {
    setEditing(null)
    setComposing(true)
    setCategory(LIBRARY_SECTION_MINE)
    setQuery('')
  }, [])
  const handleEdit = React.useCallback((prompt: LibraryPrompt) => {
    setSelected(null)
    setComposing(false)
    setEditing(prompt)
  }, [])
  const handleDelete = React.useCallback(async (prompt: LibraryPrompt) => {
    setSelected(null)
    const deleted = await user.remove(prompt.id)
    if (!deleted) return
    showUndoToast({
      message: t('libraries.prompt.removedFromMine', { title: promptDisplayTitle(prompt) }),
      onUndo: () => void user.restore(deleted),
    })
  }, [user, t])

  const search = (
    <DesignSearchInput
      value={query}
      onChange={setQuery}
      placeholder={t('libraries.prompt.searchPlaceholder')}
      ariaLabel={t('libraries.prompt.searchAria')}
      className={page ? 'ml-1 w-[260px] max-w-full flex-none' : 'min-w-0 flex-1'}
    />
  )
  const typeOptions = [
    { value: 'all', label: t('libraries.prompt.category.all') },
    { value: 'image', label: t('libraries.prompt.category.image') },
    { value: 'video', label: t('libraries.prompt.category.video') },
  ]
  const tools = page ? (
    <>
      {/* 设计卡 ★3：分段只用在「图片 / 视频」，按内容宽（fit=content），不再在弹性父级里竖成一根柱子。 */}
      <NomiSegmented
        value={type}
        onChange={(value) => setType(value as PromptCategory)}
        ariaLabel={t('libraries.prompt.categoryAria')}
        density="compact"
        fit="content"
        options={typeOptions}
        className="ml-3 shrink-0 gap-0.5 rounded-pill p-0.5"
        itemClassName="rounded-pill px-3 py-0"
      />
      {search}
      <span className="flex-1" />
      <button
        type="button"
        onClick={handleNew}
        title={t('libraries.prompt.createAria')}
        data-prompt-new
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-pill border-0 bg-nomi-paper pl-2.5 pr-3 text-caption font-medium text-nomi-ink-80 ring-1 ring-nomi-line transition-colors hover:bg-nomi-ink-05 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink"
      >
        <IconPlus size={14} stroke={1.8} className="text-nomi-ink-60" aria-hidden="true" />
        {t('libraries.prompt.create')}
      </button>
    </>
  ) : (
    <WorkbenchIconButton size="sm" icon={<IconPlus />} label={t('libraries.prompt.createAria')} onClick={handleNew} data-prompt-new />
  )

  const composer = composing || editing ? (
    <UserPromptComposer
      key={editing?.id ?? 'new'}
      initial={editing}
      onSubmit={async (draft) => {
        if (editing) await user.update(editing.id, draft)
        else await user.add(draft)
        setComposing(false)
        setEditing(null)
      }}
      onCancel={() => { setComposing(false); setEditing(null) }}
    />
  ) : null

  // 内置与公开库是同一次读取（主进程聚合，公开库离线时用磁盘缓存 / 打包快照兜底）；只有整次读取没回来才走这两种状态。
  // 我的库是另一次读取，照常列在它们上面（LibraryStates 板：只影响那一段）。
  const publicPending = !items.length && category !== LIBRARY_SECTION_MINE
  const status = publicPending && loading ? (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-nomi-ink-40" data-library-loading>
      <NomiLoadingMark size={28} />
      <span className="text-caption">{t('libraries.prompt.fetching')}</span>
    </div>
  ) : publicPending && error ? (
    <div data-library-error title={error}>
      <DesignEmptyState
        title={t('libraries.prompt.fetchFailed')}
        description={t('libraries.prompt.fetchFailedHint')}
        density="inline"
        action={(
          <button type="button" onClick={reload} data-library-retry className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-pill border border-nomi-line bg-transparent px-3 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink">
            <IconRefresh size={14} stroke={1.8} aria-hidden="true" />{t('common.retry')}
          </button>
        )}
      />
    </div>
  ) : null
  const hasRows = views.some((view) => view.items.length > 0)
  const mineEmpty = category === LIBRARY_SECTION_MINE && !trimmedQuery && !composer && !user.items.some((prompt) => type === 'all' || prompt.promptType === type)
  const emptyState = mineEmpty ? (
    <div className="flex min-h-full items-center justify-center" data-library-mine-empty>
      <DesignEmptyState
        icon={<span className="grid size-11 place-items-center rounded-panel bg-nomi-ink-05 text-nomi-ink-40"><IconBulb size={20} stroke={1.5} /></span>}
        title={t('libraries.prompt.noMine')}
        description={t('libraries.prompt.mineEmptyHint')}
      />
    </div>
  ) : !hasRows && !composer && !status ? (
    <div data-library-no-match>
      <DesignEmptyState title={t('libraries.prompt.noMatch')} description={t('libraries.prompt.tryAnotherFilter')} density="inline" />
    </div>
  ) : null

  const renderCard = React.useCallback((prompt: LibraryPrompt) => (
    <PromptCard
      prompt={prompt}
      size={host}
      onOpen={handleOpen}
      onEdit={prompt.origin === 'user' ? handleEdit : undefined}
      onDelete={prompt.origin === 'user' ? (target) => { void handleDelete(target) } : undefined}
    />
  ), [host, handleOpen, handleEdit, handleDelete])
  const keyOf = React.useCallback((prompt: LibraryPrompt) => prompt.id, [])

  const list = (
    <LibrarySectionList
      views={hasRows ? views : []}
      width={width}
      columns={columns}
      spec={spec}
      size={host}
      keyOf={keyOf}
      renderItem={renderCard}
      onShowAll={setCategory}
      showCounts={category !== LIBRARY_CATEGORY_ALL || Boolean(trimmedQuery)}
      scrollRef={setScrollElement}
      footer={status}
      className={page ? 'pb-8 pr-1' : 'px-3 pb-3 pt-1'}
    >
      {emptyState}
    </LibrarySectionList>
  )

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)} data-library-host={host} data-prompt-library>
      {toolbarHost ? createPortal(tools, toolbarHost) : null}
      {page ? null : (
        <div className="flex shrink-0 gap-1.5 px-3 pb-2.5">
          {search}
          <LibraryCategoryMenu
            groups={navGroups}
            value={category}
            onChange={setCategory}
            ariaLabel={t('libraries.prompt.categoryMenuAria')}
            extra={{ label: t('libraries.prompt.categoryAria'), value: type, options: typeOptions, onChange: (value) => setType(value as PromptCategory) }}
          />
        </div>
      )}
      {page ? (
        <div className="flex min-h-0 flex-1 gap-7">
          <LibraryCategoryNav groups={navGroups} value={category} onChange={setCategory} ariaLabel={t('libraries.prompt.categoryNavAria')} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {composer ? <div className="shrink-0 pb-3 pr-1">{composer}</div> : null}
            {list}
          </div>
        </div>
      ) : (
        <>
          {composer ? <div className="shrink-0 px-3 pb-2">{composer}</div> : null}
          {list}
        </>
      )}

      {selected ? (
        <PromptPreviewOverlay
          prompt={selected.prompt}
          originRect={selected.rect}
          onClose={() => setSelected(null)}
          onAddToCanvas={handleAddToCanvas}
          addToCanvasBlockedReason={needsProjectReason}
          onEdit={selected.prompt.origin === 'user' ? handleEdit : undefined}
          onDelete={selected.prompt.origin === 'user' ? (target) => { void handleDelete(target) } : undefined}
        />
      ) : null}
    </div>
  )
}
