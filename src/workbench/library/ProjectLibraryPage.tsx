import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { getAppLocale } from '../../i18n'
import {
  IconAlertTriangle,
  IconFolderOpen,
  IconFolderShare,
  IconMovie,
  IconPlayerPlay,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { ActionCard, DesignEmptyState, NomiSkeleton } from '../../design'
import { NomiImage } from '../../design/media'
import { ShellFrame } from '../../ui/app-shell/shell/ShellFrame'
import { ShellTopBar } from '../../ui/app-shell/shell/ShellTopBar'
import { lazyWithChunkBoundary } from '../../ui/chunkBoundary'
import { useLocalProjects } from './localProjectStore'
import type { LocalProjectSummary } from './localProjectStore'
import type { ProjectTemplateId } from './projectTemplates'
import { markLibraryUsed, sortByLibraryUsage, useLibraryUsageVersion } from './libraryDiscovery'
import { filterProjectLibraryItems } from './libraryAdapters'
import { LibraryDiscoveryToolbar } from './LibraryDiscoveryToolbar'
import { getDesktopBridge } from '../../desktop/bridge'
import ProjectSyncBadge from './ProjectSyncBadge'
import { syncStatusBlocksOpen } from './projectSyncFace'
import type { WorkspaceSyncInspection } from '../../../electron/shared/workspaceSyncContracts'

const SkillLibraryContent = lazyWithChunkBoundary('i18n:sidebar.skillLibrary', () =>
  import('../skillLibrary/SkillLibraryPanel').then((module) => ({ default: module.SkillLibraryContent })))
const PromptLibraryContent = lazyWithChunkBoundary('i18n:sidebar.promptLibrary', () =>
  import('../promptLibrary/PromptLibraryPanel').then((module) => ({ default: module.PromptLibraryContent })))

/** 项目库左上页签（10-08 外壳拍板稿 Library 板）：项目库不放左栏，Skill / 提示词在这里是页签，进项目后在左栏抽屉里。 */
type LibraryTab = 'projects' | 'skills' | 'prompts'

type Props = {
  projectFeedback?: { projectId: string | null; message: string } | null
  onOpenProject: (projectId: string) => void
  onDeleteProject: (project: LocalProjectSummary) => void
  /** 列表页双击项目名改名（不用点进项目）；缺省则名字不可编辑。 */
  onRenameProject?: (projectId: string, name: string) => void
  onNewProject: (templateId?: ProjectTemplateId) => void
  onOpenFolder?: () => void
  onRevealProjectFolder?: (projectId: string) => void
  onOpenModelCatalog?: () => void
  /**
   * 项目库页顶部的一次性通知位（10-08 Library 板）：热修横幅、「已更新到 x.y.z」卡由更新提醒线
   * （I-update 的 HotfixBanner / UpdatedCard）从这里摆进来；本页只管位置，不判断出不出。没有就不占位。
   */
  notices?: React.ReactNode
  /** 打开集中设置页（顶栏齿轮）；缺省则不渲染齿轮入口。 */
  onOpenSettings?: () => void
  /** 看「60 秒预置回放」引导旅途（建示例项目 + 走一遍全流程）；缺省则不渲染该卡 */
  onPlayJourneyTour?: () => void
  /** 旅途是否看过——决定 CTA 文案在「看一遍 / 重看」之间切换 */
  journeyTourSeen?: boolean
  /** 重看开屏动画（首启播完后从这里可主动重播）；缺省则不渲染重看入口 */
  /** null = 查询中（不渲染告警）；false 时弱入口隐藏、状态条升权（单一入口互斥） */
  hasTextModel?: boolean | null
}

function formatUpdatedAt(value: number): string {
  if (!Number.isFinite(value)) return ''
  const deltaMs = Math.max(0, Date.now() - value)
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return i18n.t('library.relativeJustNow')
  if (minutes < 60) return i18n.t('library.relativeMinutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return i18n.t('library.relativeHoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return i18n.t('library.relativeDaysAgo', { count: days })
  return new Date(value).toLocaleDateString(getAppLocale())
}

function CoverPlaceholder(): JSX.Element {
  // 无封面的中性占位；名称由卡片下方统一显示，缩略图里不再重复（去重）。
  return (
    <div className="absolute inset-0 grid place-items-center bg-nomi-ink-05">
      <IconMovie size={26} stroke={1.5} className="text-nomi-ink-30" aria-hidden />
    </div>
  )
}

// 视频封面：无任何可 <img> 渲染封面时（纯导入视频素材项目）用 <video> 首帧当封面。
// #t=0.1 媒体片段强制解出首帧（preload="metadata" 单独不保证 paint）；失败降级为中性占位
//（不是「加载失败」文案——那是图片语境的 NomiImage 兜底）。调用方用 key={url} 换源清失败态。
function CoverVideo({ url }: { url: string }): JSX.Element {
  const [failed, setFailed] = React.useState(false)
  if (failed) return <CoverPlaceholder />
  return (
    <video
      src={`${url}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      disablePictureInPicture
      tabIndex={-1}
      aria-hidden
      className="absolute inset-0 w-full h-full object-cover block pointer-events-none"
      onError={() => setFailed(true)}
    />
  )
}

// memo 化：搜索/筛选触发父组件重渲时，封面源未变的卡不重渲（图多时省下整片缩略图重建）。
// urls 每次是新数组引用，故用按值比较的 comparator。
const ThumbnailMosaic = React.memo(
  function ThumbnailMosaic({ urls, videoUrl }: { urls: string[]; videoUrl?: string }): JSX.Element {
    if (urls.length === 0) {
      if (videoUrl) return <CoverVideo key={videoUrl} url={videoUrl} />
      return <CoverPlaceholder />
    }
    // 单封面：一个项目用一张代表图（首个产物）。早先 2–4 宫格把不同镜头并排塞进 200px 小卡，
    // 读起来像一张糊在一起的图、看不出是什么项目（用户报「糊在一起」）。改单封面更干净、可识别。
    return <NomiImage className="absolute inset-0 w-full h-full object-cover block" src={urls[0]} alt="" />
  },
  (prev, next) => (prev.urls[0] || '') === (next.urls[0] || '') && (prev.videoUrl || '') === (next.videoUrl || ''),
)

export default function ProjectLibraryPage({
  projectFeedback,
  onOpenProject,
  onDeleteProject,
  onRenameProject,
  onNewProject,
  onOpenFolder,
  onRevealProjectFolder,
  onOpenModelCatalog,
  onOpenSettings,
  onPlayJourneyTour,
  journeyTourSeen = false,
  hasTextModel = null,
  notices = null,
}: Props): JSX.Element {
  const { t } = useTranslation()
  // 项目列表由本页自己读：它是这份数据的唯一消费者，外壳不该当数据管道（R9）。
  // `useLocalProjects` 是单一 SWR key，外壳侧的 `refreshProjects` 与这里共享同一份缓存，不是第二个真相源。
  const { projects, projectsError, projectsLoading, refreshProjects: onRetryLoadProjects } = useLocalProjects()
  const [query, setQuery] = React.useState('')
  const [sourceFilter, setSourceFilter] = React.useState<'all' | 'native' | 'folder'>('all')
  const usageVersion = useLibraryUsageVersion()
  const normalizedQuery = query.trim()
  // 双击项目名进入 inline 编辑：editingId 记哪张卡在编辑、editValue 是输入中的名字。
  const [editingId, setEditingId] = React.useState('')
  const [editValue, setEditValue] = React.useState('')
  const [syncInspectionByProject, setSyncInspectionByProject] = React.useState<Record<string, WorkspaceSyncInspection>>({})
  const [openSyncProjectId, setOpenSyncProjectId] = React.useState<string | null>(null)
  // 「重新检查」这一下自己失败了（≠ 检查跑完发现还没就绪）。不记它的话，两种情况在界面上
  // 长得一模一样：弹层原样不动——用户会以为检查跑过了、文件夹还是坏的。
  const [syncRecheckFailedId, setSyncRecheckFailedId] = React.useState<string | null>(null)
  const beginRename = (project: LocalProjectSummary): void => {
    if (!onRenameProject || project.missing) return
    setEditingId(project.id)
    setEditValue(project.name)
  }
  const commitRename = (projectId: string, originalName: string): void => {
    const next = editValue.trim()
    if (next && next !== originalName) onRenameProject?.(projectId, next)
    setEditingId('')
  }
  const searchedProjects = React.useMemo(() => {
    // The usage hook is a renderer invalidation signal; keep it in this memo's
    // dependency list so a just-opened project moves without another action.
    void usageVersion
    const sorted = sortByLibraryUsage(
      projects,
      'project',
      (project) => project.id,
      (project) => project.updatedAt,
    )
    return filterProjectLibraryItems(sorted, query)
  }, [projects, query, usageVersion])
  const sourceCounts = React.useMemo(
    () => ({
      all: searchedProjects.length,
      native: searchedProjects.filter((project) => project.source !== 'folder').length,
      folder: searchedProjects.filter((project) => project.source === 'folder').length,
    }),
    [searchedProjects],
  )
  const filteredProjects =
    sourceFilter === 'all'
      ? searchedProjects
      : searchedProjects.filter((project) =>
          sourceFilter === 'folder' ? project.source === 'folder' : project.source !== 'folder',
        )
  const inspectSyncProjects = React.useCallback(async (): Promise<void> => {
    const api = getDesktopBridge()?.workspace?.syncInspect
    if (!api) return
    const entries = await Promise.all(
      projects.filter((project) => Boolean(project.rootPath)).map(async (project) => {
        try {
          const inspection = await api({ projectId: project.id })
          return [project.id, inspection] as const
        } catch {
          // 有意静默：这是**后台批量探测**（挂在 mount + window focus 上，用户没点任何东西），
          // 产出的只是卡片上的同步告警徽标——一个可选增强。探不到就退回「不显示徽标」，
          // 也就是探测能力上线前的行为，界面不会因此显示**错误的**同步状态。
          // 反例见下面的 recheckSync：那条是用户亲手点的，失败必须出声。
          return null
        }
      }),
    )
    setSyncInspectionByProject(Object.fromEntries(entries.filter((entry): entry is readonly [string, WorkspaceSyncInspection] => entry !== null)))
  }, [projects])

  React.useEffect(() => {
    void inspectSyncProjects()
    window.addEventListener('focus', inspectSyncProjects)
    return () => window.removeEventListener('focus', inspectSyncProjects)
  }, [inspectSyncProjects])

  const recheckSync = React.useCallback(async (projectId: string): Promise<void> => {
    const api = getDesktopBridge()?.workspace?.syncInspect
    if (!api) return
    setSyncRecheckFailedId(null)
    try {
      const inspection = await api({ projectId, adopt: true })
      setSyncInspectionByProject((current) => ({ ...current, [projectId]: inspection }))
      if (inspection.status === 'ready') setOpenSyncProjectId(null)
    } catch {
      // 用户点的「重新检查」——不能静默：弹层原样不动会被读成「检查跑完了，还是坏的」。
      setSyncRecheckFailedId(projectId)
      setOpenSyncProjectId(projectId)
    }
  }, [])
  const sourceOptions: Array<{ id: 'all' | 'native' | 'folder'; label: string; count: number }> = [
    { id: 'all', label: t('library.all'), count: sourceCounts.all },
    { id: 'native', label: t('library.local'), count: sourceCounts.native },
    { id: 'folder', label: t('library.folders'), count: sourceCounts.folder },
  ]
  const textModelMissing = hasTextModel === false
  const openProject = React.useCallback((projectId: string): void => {
    const status = syncInspectionByProject[projectId]?.status
    if (status && syncStatusBlocksOpen(status)) {
      setOpenSyncProjectId(projectId)
      return
    }
    onOpenProject(projectId)
    markLibraryUsed('project', projectId)
  }, [onOpenProject, syncInspectionByProject])
  // 10-08 外壳重设计：模型接入 / 浏览器 / 设置都在 40px 合一顶栏或设置里；这里只剩「缺文本模型」那条提示条。
  const [tab, setTab] = React.useState<LibraryTab>('projects')
  // 第一次打开（没有项目、没在读、没读错、没在搜）= LibraryEmpty 板：三张大动作卡；有项目后收成右上两颗按钮。
  const firstRun = !projectsError && !projectsLoading && projects.length === 0
  const tabs: Array<{ id: LibraryTab; label: string }> = [
    { id: 'projects', label: t('appShell.library.tabProjects') },
    { id: 'skills', label: t('appShell.library.tabSkills') },
    { id: 'prompts', label: t('appShell.library.tabPrompts') },
  ]
  const actionCards = (
    <section className="flex flex-wrap items-stretch justify-center gap-4" aria-label={t('library.startProject')}>
      <ActionCard
        variant="primary"
        icon={<IconPlus size={18} stroke={1.8} />}
        title={t('library.newBlankProject')}
        description={t('library.newBlankProjectDescription')}
        onClick={() => onNewProject()}
      />
      {onOpenFolder ? (
        <ActionCard
          icon={<IconFolderOpen size={18} stroke={1.6} />}
          title={t('library.openFolder')}
          description={t('library.openFolderDescription')}
          onClick={onOpenFolder}
        />
      ) : null}
      {onPlayJourneyTour ? (
        <ActionCard
          icon={<IconPlayerPlay size={18} stroke={1.6} />}
          title={journeyTourSeen ? t('library.replayGuide') : t('library.watchHow')}
          description={t('library.watchNomiDescription')}
          onClick={onPlayJourneyTour}
        />
      ) : null}
    </section>
  )
  // ── 缺文本模型 → 提示条（模型接入在项目库的唯一入口形态；生成失败卡仍可直达设置 › 模型接入） ──
  const modelBanner = textModelMissing && onOpenModelCatalog ? (
    <section
      className="flex min-h-11 items-center gap-2.5 rounded-panel bg-nomi-info-soft py-1.5 pl-3.5 pr-2 text-body-sm text-nomi-info-ink ring-1 ring-inset ring-nomi-info-edge"
      aria-label={t('library.modelStatus')}
      data-model-banner="true"
    >
      <IconPlugConnected size={16} stroke={1.5} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t('library.textModelMissing')}</span>
        <span className="ml-1.5 text-nomi-info-ink/80">{t('library.textModelMissingHint')}</span>
      </span>
      <button
        type="button"
        onClick={onOpenModelCatalog}
        data-testid="open-model-settings"
        className="h-7 shrink-0 rounded-pill border-0 bg-nomi-paper px-3 text-caption font-medium text-nomi-info-ink ring-1 ring-nomi-info-edge transition-colors hover:bg-nomi-info-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent"
      >
        {t('library.connectTextModel')}
      </button>
    </section>
  ) : null

  const page = (
    <div className="nomi-library-page flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-panel bg-nomi-paper font-nomi-sans text-body-sm leading-normal text-nomi-ink antialiased ring-1 ring-nomi-line-soft" data-library-tab={tab}>
      <main className="nomi-library-page__main flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-8 pb-12 pt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {notices ? <div className="flex shrink-0 flex-col gap-3" data-library-notices>{notices}</div> : null}
        {projectFeedback?.message && !filteredProjects.some((project) => project.id === projectFeedback.projectId) ? <p role="alert" className="m-0 text-caption text-nomi-danger">{projectFeedback.message}</p> : null}
        {/* ── 页签行：项目 · Skill · 提示词；项目页签有项目时同一行是筛选、搜索与右上两颗按钮 ── */}
        <section className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-baseline gap-5" role="tablist" aria-label={t('appShell.library.tabsAria')}>
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                data-library-tab-button={item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  'h-8 border-0 bg-transparent p-0 text-title font-semibold transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nomi-accent',
                  tab === item.id ? 'text-nomi-ink' : 'text-nomi-ink-40 hover:text-nomi-ink-80',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tab === 'projects' && !firstRun ? (
            <>
              <div
                className="ml-1 inline-flex h-7 items-center gap-0.5 rounded-pill bg-nomi-ink-05 p-0.5"
                aria-label={t('library.sourceFilter')}
              >
                {sourceOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={sourceFilter === option.id}
                    onClick={() => setSourceFilter(option.id)}
                    className={cn(
                      'inline-flex h-6 items-center gap-1 rounded-pill border-0 bg-transparent px-2.5 text-caption font-inherit cursor-pointer',
                      'text-nomi-ink-60 transition-[background,color,box-shadow] duration-150 hover:text-nomi-ink',
                      sourceFilter === option.id && 'bg-nomi-paper font-medium text-nomi-ink shadow-nomi-sm',
                    )}
                  >
                    {option.label}
                    <span className="tabular-nums text-nomi-ink-40">{option.count}</span>
                  </button>
                ))}
              </div>
              <LibraryDiscoveryToolbar
                query={query}
                onQueryChange={setQuery}
                placeholder={t('library.searchPlaceholder')}
                ariaLabel={t('library.searchPlaceholder')}
                searchSize="sm"
                className="min-w-0 flex-none"
                searchClassName="w-[200px] max-w-full flex-none"
              />
              <span className="flex-1" />
              <div className="flex shrink-0 items-center gap-2">
                {onPlayJourneyTour ? (
                  // 「看一遍怎么做」在 Library 板上只画在空库；有项目后它原来是第三张动作卡——功能不丢，收成一颗文字按钮（设计卡对账：有意不同）。
                  <button
                    type="button"
                    onClick={onPlayJourneyTour}
                    className="inline-flex h-7 items-center gap-1.5 rounded-pill border-0 bg-transparent px-2.5 text-caption text-nomi-ink-60 transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink"
                    data-library-tour
                  >
                    <IconPlayerPlay size={14} stroke={1.5} aria-hidden="true" />
                    {journeyTourSeen ? t('library.replayGuide') : t('library.watchHow')}
                  </button>
                ) : null}
                {onOpenFolder ? (
                  <button
                    type="button"
                    onClick={onOpenFolder}
                    className="inline-flex h-7 items-center gap-1.5 rounded-pill border-0 bg-nomi-paper px-3 text-caption font-medium text-nomi-ink-80 ring-1 ring-nomi-line transition-colors hover:bg-nomi-ink-05 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent"
                    data-library-open-folder
                  >
                    <IconFolderOpen size={14} stroke={1.5} className="text-nomi-ink-60" aria-hidden="true" />
                    {t('appShell.library.openFolder')}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onNewProject()}
                  className="inline-flex h-7 items-center gap-1 rounded-pill border-0 bg-nomi-ink pl-2.5 pr-3.5 text-caption font-medium text-nomi-paper transition-colors hover:bg-nomi-ink-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nomi-accent"
                  data-library-new-project
                >
                  <IconPlus size={14} stroke={1.8} aria-hidden="true" />
                  {t('appShell.library.newProject')}
                </button>
              </div>
            </>
          ) : null}
        </section>

        {tab === 'skills' ? (
          <React.Suspense fallback={null}>
            <SkillLibraryContent active showHeader={false} className="min-h-0 flex-1" />
          </React.Suspense>
        ) : tab === 'prompts' ? (
          <React.Suspense fallback={null}>
            <PromptLibraryContent active showHeader={false} className="min-h-0 flex-1" />
          </React.Suspense>
        ) : firstRun ? (
          // LibraryEmpty 板：第一次打开 = 三张大动作卡（设计系统：起始页 / 空状态用 ActionCard）。
          <section className="mx-auto flex w-full max-w-[880px] flex-col items-center gap-5 pt-4" data-library-first-run>
            <div className="text-center">
              <h1 className="m-0 text-h2 font-semibold text-nomi-ink">{t('library.startProject')}</h1>
              <p className="m-0 mt-1.5 text-body-sm text-nomi-ink-60">{t('appShell.library.startSubtitle')}</p>
            </div>
            {actionCards}
            {modelBanner ? <div className="w-full">{modelBanner}</div> : null}
          </section>
        ) : (
        <>
          {modelBanner}

          {/* 四态顺序不能变：error → loading → empty。读取失败时 projects 是 fallback []，
              先判空态就会把「读不到」渲染成首启空库引导屏（用户读作「我的项目全没了」）。 */}
          {projectsError ? (
            <div data-testid="library-load-error">
            <DesignEmptyState
              density="inline"
              icon={<IconAlertTriangle size={30} stroke={1.6} className="text-nomi-danger" aria-hidden="true" />}
              title={t('library.loadFailedTitle')}
              description={
                <>
                  <div>{t('library.loadFailedDescription')}</div>
                  {projectsError.message ? (
                    <div className="mt-1 text-micro text-nomi-ink-30 break-words">
                      {t('library.loadFailedReason', { reason: projectsError.message })}
                    </div>
                  ) : null}
                </>
              }
              action={
                onRetryLoadProjects ? (
                  <button
                    type="button"
                    data-testid="library-load-retry"
                    className="inline-flex h-8 items-center gap-1.5 px-4 rounded-pill border-0 bg-nomi-ink text-nomi-paper text-body-sm font-medium font-inherit cursor-pointer transition-colors hover:bg-nomi-accent"
                    onClick={onRetryLoadProjects}
                  >
                    <IconRefresh size={14} stroke={1.8} aria-hidden="true" />
                    {t('library.retryLoad')}
                  </button>
                ) : undefined
              }
            />
            </div>
          ) : projectsLoading ? (
            // 首屏读取中：骨架屏占位（统一组件 NomiSkeleton），别拿空态文案顶——
            // 「还没有项目」在数据还没到的时候是一句假话。
            <div
              className="shrink-0 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
              data-testid="library-loading"
              aria-label={t('library.loadingProjects')}
            >
              {[0, 1, 2, 3].map((slot) => (
                <NomiSkeleton key={slot} className="h-32" />
              ))}
            </div>
          ) : filteredProjects.length === 0 ? (
            // 审计 A10：库非空但「搜索 × 来源 tab」过滤后为空——给空态与出路（统一空态组件）。
            <DesignEmptyState
              density="inline"
              title={
                normalizedQuery
                  ? t('library.noMatchNamed', { query: query.trim() })
                  : sourceFilter !== 'all'
                    ? t('library.noProjectsInSource')
                    : // 首次空库（无搜索、来源=全部、零项目）：给行动指引指向正上方的「新建空白项目」卡，
                      // 别用「这个分类下还没有项目」的系统腔（首屏没有分类概念，2026-08-25 走查 F1）。
                      t('library.firstEmpty')
              }
              action={
                normalizedQuery ? (
                  <button
                    type="button"
                    className="inline-flex h-7 items-center px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-caption text-nomi-ink-80 cursor-pointer hover:bg-nomi-ink-05"
                    onClick={() => setQuery('')}
                  >
                    {t('library.clearSearch')}
                  </button>
                ) : undefined
              }
            />
          ) : null}
          <div className="shrink-0 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6 min-[1200px]:grid-cols-[repeat(auto-fill,248px)]">
            {filteredProjects.map((project) => {
              const urls = project.thumbnailUrls || (project.thumbnail ? [project.thumbnail] : [])
              return (
                <div
                  key={project.id}
                  data-project-card="true"
                  // 卡片顺序是「最近用过」派生量（libraryDiscovery.sortByLibraryUsage），同一秒内
                  // 建的两个项目排序就是掷硬币。走查必须按**身份**点项目，不能按位置（`.first()`），
                  // 所以身份要在 DOM 上拿得到——这条 data 属性就是那个锚点。
                  data-project-id={project.id}
                  className={cn(
                    'group relative overflow-visible rounded-panel text-left',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-nomi-accent',
                    project.missing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                  )}
                  role={project.missing ? undefined : 'button'}
                  tabIndex={project.missing ? undefined : 0}
                  onClick={project.missing ? undefined : () => openProject(project.id)}
                  onKeyDown={project.missing ? undefined : (e) => e.key === 'Enter' && openProject(project.id)}
                >
                  {projectFeedback?.projectId === project.id && projectFeedback.message ? <p role="alert" className="m-0 px-3 py-2 text-caption text-nomi-danger">{projectFeedback.message}</p> : null}
                  <div
                    className={cn(
                      'aspect-video relative overflow-hidden rounded-panel bg-nomi-ink-05 ring-1 ring-inset ring-nomi-line-soft',
                      'transition-[box-shadow,transform] duration-150',
                      !project.missing && 'group-hover:-translate-y-0.5 group-hover:shadow-nomi-md',
                    )}
                    style={urls.length === 0 && project.thumbStyle ? { background: project.thumbStyle } : undefined}
                  >
                    <ThumbnailMosaic urls={urls} videoUrl={project.coverVideoUrl} />
                    <div
                      className={cn(
                        'absolute inset-0 bg-nomi-scrim opacity-0 transition-opacity duration-150',
                        'flex items-center justify-center z-[2]',
                        'group-hover:opacity-100',
                      )}
                    >
                      <button
                        className={cn(
                          'absolute top-[9px] right-[9px] size-8 rounded-nomi-sm border-none',
                          'bg-workbench-danger-soft text-workbench-danger grid place-items-center cursor-pointer',
                          'transition-[background,color] duration-150',
                          'hover:bg-workbench-danger hover:text-nomi-paper',
                        )}
                        type="button"
                        aria-label={t('library.deleteNamedProject', { name: project.name })}
                        title={t('library.deleteProject')}
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteProject(project)
                        }}
                      >
                        <IconTrash size={14} stroke={1.8} />
                      </button>
                      {project.missing ? (
                        <span className="h-8 px-3 rounded-nomi-sm text-caption font-medium text-nomi-paper/80 flex items-center">
                          {t('library.folderUnavailable')}
                        </span>
                      ) : (
                        <button
                          className={cn(
                            'h-8 px-3 rounded-nomi-sm border-none',
                            'bg-nomi-paper/90 text-nomi-ink font-inherit text-caption font-medium cursor-pointer',
                            'transition-colors duration-150 hover:bg-nomi-paper',
                          )}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            openProject(project.id)
                          }}
                        >
                          {t('library.continueCreating')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="pt-2.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <div className="min-w-0">
                      {editingId === project.id ? (
                        <input
                          type="text"
                          className={cn(
                            'w-full text-body-sm font-medium text-nomi-ink mb-0.5 outline-none',
                            'bg-nomi-paper border border-nomi-accent rounded-nomi-sm px-1.5 py-0.5',
                          )}
                          value={editValue}
                          autoFocus
                          aria-label={t('library.renameProject', { name: project.name })}
                          onChange={(e) => setEditValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') commitRename(project.id, project.name)
                            else if (e.key === 'Escape') setEditingId('')
                          }}
                          onBlur={() => commitRename(project.id, project.name)}
                        />
                      ) : (
                        <div
                          className={cn(
                            'text-body-sm font-semibold text-nomi-ink truncate mb-0.5',
                            onRenameProject && !project.missing && 'cursor-text',
                          )}
                          title={onRenameProject && !project.missing ? t('library.renameHint') : undefined}
                          // 名字区单击不打开项目（留给双击改名）；缩略图/「继续创作」仍单击打开。
                          onClick={onRenameProject && !project.missing ? (e) => e.stopPropagation() : undefined}
                          onDoubleClick={
                            onRenameProject && !project.missing
                              ? (e) => {
                                  e.stopPropagation()
                                  beginRename(project)
                                }
                              : undefined
                          }
                        >
                          {project.name}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-micro text-nomi-ink-40">
                        <span>{formatUpdatedAt(project.updatedAt)}</span>
                        {project.rootPath && syncInspectionByProject[project.id] ? (
                          <ProjectSyncBadge
                            inspection={syncInspectionByProject[project.id]}
                            rootPath={project.rootPath}
                            open={openSyncProjectId === project.id}
                            onToggle={() => setOpenSyncProjectId((current) => current === project.id ? null : project.id)}
                            onClose={() => setOpenSyncProjectId(null)}
                            onRecheck={() => { void recheckSync(project.id) }}
                            {...(onRevealProjectFolder ? { onOpenFolder: () => onRevealProjectFolder(project.id) } : {})}
                            recheckFailed={syncRecheckFailedId === project.id}
                          />
                        ) : null}
                      </div>
                    </div>
                    {onRevealProjectFolder && project.rootPath ? (
                      <button
                        type="button"
                        aria-label={t('library.openProjectFolder', { name: project.name })}
                        title={t('library.revealProjectFolderTitle')}
                        onClick={(e) => {
                          e.stopPropagation()
                          onRevealProjectFolder(project.id)
                        }}
                        className={cn(
                          'shrink-0 size-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper',
                          'grid place-items-center text-nomi-ink-60 cursor-pointer',
                          // 低频动作 hover/聚焦才显，不在每张卡常驻一颗带框按钮
                          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                          'transition-[background,border-color,color,opacity] duration-150',
                          'hover:bg-nomi-ink-05 hover:border-nomi-ink-20 hover:text-nomi-accent',
                        )}
                      >
                        <IconFolderShare size={15} stroke={1.6} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </>
        )}
      </main>
    </div>
  )
  // 10-08 外壳重设计：项目库与项目内同一条 40px 顶栏；项目库不放左栏（Skill / 提示词在上面的页签里）。
  return (
    <div className="h-screen w-full bg-nomi-chrome">
      <ShellFrame topBar={<ShellTopBar workspaceMode={null} onOpenSettings={onOpenSettings} />}>
        {page}
      </ShellFrame>
    </div>
  )
}
