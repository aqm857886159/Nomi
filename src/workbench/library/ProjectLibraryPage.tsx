import React from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { getAppLocale } from '../../i18n'
import {
  IconBrowser,
  IconAlertTriangle,
  IconCircleCheck,
  IconFolderOpen,
  IconFolderShare,
  IconInfoCircle,
  IconMovie,
  IconPlayerPlay,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { ActionCard, NomiLogoMark, NomiWordmark, DesignEmptyState } from '../../design'
import { NomiImage } from '../../design/media'
import { WindowControls } from '../../ui/app-shell/WindowControls'
import { handleWindowTitlebarDoubleClick } from '../../ui/app-shell/windowTitlebarDoubleClick'
import type { LocalProjectSummary } from './localProjectStore'
import type { ProjectTemplateId } from './projectTemplates'
import { markLibraryUsed, sortByLibraryUsage, useLibraryUsageVersion } from './libraryDiscovery'
import { filterProjectLibraryItems } from './libraryAdapters'
import { LibraryDiscoveryToolbar } from './LibraryDiscoveryToolbar'
import { getDesktopBridge } from '../../desktop/bridge'
import type { WorkspaceSyncInspection } from '../../../electron/shared/workspaceSyncContracts'

type Props = {
  onOpenProject: (projectId: string) => void
  onDeleteProject: (project: LocalProjectSummary) => void
  /** 列表页双击项目名改名（不用点进项目）；缺省则名字不可编辑。 */
  onRenameProject?: (projectId: string, name: string) => void
  onNewProject: (templateId?: ProjectTemplateId) => void
  onOpenFolder?: () => void
  onRevealProjectFolder?: (projectId: string) => void
  onOpenModelCatalog?: () => void
  /** 打开集中设置页（顶栏齿轮）；缺省则不渲染齿轮入口。 */
  onOpenSettings?: () => void
  /** 看「60 秒预置回放」引导旅途（建示例项目 + 走一遍全流程）；缺省则不渲染该卡 */
  onPlayJourneyTour?: () => void
  /** 旅途是否看过——决定 CTA 文案在「看一遍 / 重看」之间切换 */
  journeyTourSeen?: boolean
  /** 重看开屏动画（首启播完后从这里可主动重播）；缺省则不渲染重看入口 */
  /** null = 查询中（不渲染告警）；false 时弱入口隐藏、状态条升权（单一入口互斥） */
  hasTextModel?: boolean | null
  projects: LocalProjectSummary[]
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
  projects,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const [sourceFilter, setSourceFilter] = React.useState<'all' | 'native' | 'folder'>('all')
  const usageVersion = useLibraryUsageVersion()
  const normalizedQuery = query.trim()
  // 双击项目名进入 inline 编辑：editingId 记哪张卡在编辑、editValue 是输入中的名字。
  const [editingId, setEditingId] = React.useState('')
  const [editValue, setEditValue] = React.useState('')
  const [syncInspectionByProject, setSyncInspectionByProject] = React.useState<Record<string, WorkspaceSyncInspection>>({})
  const [openSyncProjectId, setOpenSyncProjectId] = React.useState<string | null>(null)
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
    try {
      const inspection = await api({ projectId, adopt: true })
      setSyncInspectionByProject((current) => ({ ...current, [projectId]: inspection }))
      if (inspection.status === 'ready') setOpenSyncProjectId(null)
    } catch {
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
    if (status && status !== 'ready') {
      setOpenSyncProjectId(projectId)
      return
    }
    onOpenProject(projectId)
    markLibraryUsed('project', projectId)
  }, [onOpenProject, syncInspectionByProject])
  // 单一入口互斥：缺文本模型时弱入口隐藏，模型入口 = 状态条（有项目）/ 主 CTA 自动带入（空库）
  const showModelEntry = Boolean(onOpenModelCatalog) && !textModelMissing
  // Windows：库窗也 frame:false，需自绘标题栏才能拖动/关窗。mac/Linux：原生 chrome，右上操作留在 header 原位。
  const isWindows = window.nomiDesktop?.platform === 'win32'
  const openBrowser = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('nomi-open-browser'))
  }, [])

  // 弱入口 6 → 3（§1.5）：「看看 Nomi」（重放开屏动画）归位到设置「关于」——它和主卡
  // 「重看一遍引导」是两个不同功能却名字撞车（后者会建 demo 项目回放整条流水线），
  // 搬走后主卡独占「引导」语义；语言/外观归位到设置「通用」。剩下=模型 · 浏览器 · 设置。
  const libraryTopActions = (
    <div className="app-no-drag flex items-center gap-1">
      {showModelEntry ? (
        <button
          type="button"
          onClick={onOpenModelCatalog}
          data-testid="open-model-settings"
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-2 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
            'text-caption text-nomi-ink-60 transition-colors hover:text-nomi-ink',
          )}
          aria-label={t('library.models')}
        >
          <IconPlugConnected size={14} stroke={1.8} aria-hidden="true" />
          {t('library.models')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={openBrowser}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-2 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
          'text-caption text-nomi-ink-60 transition-colors hover:text-nomi-ink',
        )}
        aria-label={t('library.openBrowser')}
      >
        <IconBrowser size={14} stroke={1.8} aria-hidden="true" />
        {t('library.browser')}
      </button>
      {onOpenSettings ? (
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t('settings.title')}
          title={t('settings.title')}
          className={cn(
            'size-7 rounded-pill grid place-items-center border-0 bg-transparent cursor-pointer',
            'text-nomi-ink-60 transition-colors hover:text-nomi-ink',
          )}
        >
          <IconSettings size={15} stroke={1.8} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )

  return (
    <div className="nomi-library-page flex flex-col h-screen overflow-hidden bg-nomi-bg text-nomi-ink font-nomi-sans text-body-sm leading-normal antialiased">
      {isWindows ? (
        <div
          className="nomi-library-page__windowbar app-drag relative shrink-0 flex items-center gap-2 h-8 w-full bg-nomi-bg pl-3"
          onDoubleClick={handleWindowTitlebarDoubleClick}
        >
          <div
            className="app-drag relative z-[1] h-full min-w-0 flex-1"
            data-window-drag-region="true"
            aria-hidden="true"
          />
          <div className="relative z-[2]">{libraryTopActions}</div>
          <WindowControls className="relative z-[2]" />
        </div>
      ) : null}
      <main className="nomi-library-page__main flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-14 pt-[60px] pb-20 flex flex-col gap-5">
        {/* ── Header：品牌 + 右上弱入口（模型接入；Windows 时移到自绘标题栏） ── */}
        <section className="shrink-0 flex items-start justify-between gap-6 mb-1">
          <h1 className="flex items-center gap-3 font-nomi-display text-display font-normal tracking-[-0.022em] text-nomi-ink leading-none m-0">
            <NomiLogoMark size={28} />
            <span>
              <NomiWordmark /> {t('library.wordmarkSuffix')}
            </span>
          </h1>
          {!isWindows ? libraryTopActions : null}
        </section>

        {/* 进来直接落项目库：空库与有项目走同一套布局（新建空白/打开文件夹 + 最近项目，空库显空态）。
            产品理念交给开屏动画 + 顶栏「上手」引导，不再来一整屏介绍页。 */}
        <>
          {/* ── 主入口：动作卡片（O2 拍板，尺寸/形态/位置三重区隔） ── */}
          <section className="shrink-0 flex items-center gap-3" aria-label={t('library.startProject')}>
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

          {/* ── 缺文本模型 → 状态条升权（模型接入的唯一入口形态） ── */}
          {textModelMissing && onOpenModelCatalog ? (
            <section
              className={cn(
                'shrink-0 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3',
                'border border-nomi-line rounded-nomi bg-nomi-paper shadow-nomi-sm',
              )}
              aria-label={t('library.modelStatus')}
              data-model-banner="true"
            >
              <div>
                <div className="text-body-sm font-semibold text-nomi-ink">{t('library.textModelMissing')}</div>
                <div className="mt-0.5 text-caption text-nomi-ink-60">
                  {t('library.textModelMissingHint')}
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenModelCatalog}
                data-testid="open-model-settings"
                className={cn(
                  'inline-flex items-center h-8 px-4 rounded-pill border-0 cursor-pointer font-inherit',
                  'bg-nomi-ink text-nomi-paper text-body-sm font-medium transition-colors hover:bg-nomi-accent',
                )}
              >
                {t('library.connectTextModel')}
              </button>
            </section>
          ) : null}

          {/* ── 最近项目：标题 + 来源筛选（名词，与动作动词区隔）｜搜索同行 ── */}
          <LibraryDiscoveryToolbar
            query={query}
            onQueryChange={setQuery}
            placeholder={t('library.searchPlaceholder')}
            ariaLabel={t('library.searchPlaceholder')}
            searchSize="md"
            searchClassName="w-[280px] max-w-full flex-none"
            leading={(
              <div className="inline-flex items-center gap-8 flex-wrap">
                <h2 className="m-0 text-caption font-medium text-nomi-ink-60">{t('library.recentProjects')}</h2>
                <div
                  className="inline-flex items-center gap-1 p-1 rounded-full border border-nomi-line bg-nomi-paper"
                  aria-label={t('library.sourceFilter')}
                >
                  {sourceOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={sourceFilter === option.id}
                      onClick={() => setSourceFilter(option.id)}
                      className={cn(
                        'h-7 px-3 rounded-full border-0 bg-transparent text-caption font-medium font-inherit cursor-pointer',
                        'text-nomi-ink-60 transition-[background,color] duration-150',
                        sourceFilter === option.id && 'bg-nomi-ink-10 text-nomi-ink',
                        option.count === 0 && 'text-nomi-ink-30',
                      )}
                    >
                      {option.label} {option.count}
                    </button>
                  ))}
                </div>
              </div>
            )}
          />

          {filteredProjects.length === 0 ? (
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
          <div className="shrink-0 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
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
                    'group relative bg-nomi-paper border border-nomi-line rounded-nomi-lg overflow-visible text-left',
                    'transition-[box-shadow,transform,border-color] duration-150',
                    project.missing
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer hover:shadow-nomi-md hover:border-nomi-ink-20 hover:-translate-y-0.5 active:translate-y-0 active:shadow-none',
                  )}
                  role={project.missing ? undefined : 'button'}
                  tabIndex={project.missing ? undefined : 0}
                  onClick={project.missing ? undefined : () => openProject(project.id)}
                  onKeyDown={project.missing ? undefined : (e) => e.key === 'Enter' && openProject(project.id)}
                >
                  <div
                    className="aspect-video relative overflow-hidden bg-nomi-ink-05"
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
                  <div className="px-3 pt-2.5 pb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
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
                            'text-body-sm font-medium text-nomi-ink truncate mb-0.5',
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
                        {project.rootPath && syncInspectionByProject[project.id] ? (() => {
                          const inspection = syncInspectionByProject[project.id]
                          const ready = inspection.status === 'ready'
                          const missing = inspection.status === 'missing-assets'
                          const label = ready
                            ? t('library.syncReady')
                            : inspection.status === 'external-change'
                              ? t('library.syncExternalChange')
                              : missing
                                ? t('library.syncMissingAssets', { count: inspection.missingAssetCount })
                                : t('library.syncCorrupt')
                          const tone = ready ? 'text-workbench-success' : missing ? 'text-nomi-warning' : 'text-workbench-danger'
                          const Icon = ready ? IconCircleCheck : missing ? IconInfoCircle : IconAlertTriangle
                          return (
                            <button
                              type="button"
                              data-sync-status={inspection.status}
                              aria-label={label}
                              title={label}
                              className={cn('inline-flex max-w-[12rem] items-center gap-1 border-0 bg-transparent p-0 font-inherit text-micro cursor-pointer truncate', tone)}
                              onClick={(event) => {
                                event.stopPropagation()
                                setOpenSyncProjectId((current) => current === project.id ? null : project.id)
                              }}
                            >
                              <Icon size={12} stroke={1.8} aria-hidden="true" />
                              <span className="truncate">{label}</span>
                            </button>
                          )
                        })() : null}
                      </div>
                      {openSyncProjectId === project.id && project.rootPath && syncInspectionByProject[project.id] ? (() => {
                        const inspection = syncInspectionByProject[project.id]
                        const ready = inspection.status === 'ready'
                        const title = ready ? t('library.syncDetailsReady') : inspection.status === 'external-change' ? t('library.syncDetailsExternal') : inspection.status === 'missing-assets' ? t('library.syncDetailsMissing') : t('library.syncDetailsCorrupt')
                        const copy = ready ? t('library.syncDetailsReadyHint') : inspection.status === 'external-change' ? t('library.syncDetailsExternalHint') : inspection.status === 'missing-assets' ? t('library.syncDetailsMissingHint', { count: inspection.missingAssetCount }) : t('library.syncDetailsCorruptHint')
                        return (
                          <div
                            role="dialog"
                            aria-label={title}
                            data-sync-popover
                            className="absolute right-2 top-full z-20 mt-1 w-64 rounded-nomi border border-nomi-line bg-nomi-paper p-3 shadow-nomi-lg"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="text-caption font-medium text-nomi-ink">{title}</div>
                            <div className="mt-1 text-micro leading-relaxed text-nomi-ink-60">{copy}</div>
                            <div className="mt-2 truncate rounded-nomi-sm bg-nomi-ink-05 px-2 py-1.5 font-mono text-micro text-nomi-ink-60" title={project.rootPath}>{project.rootPath}</div>
                            <div className="mt-3 flex items-center gap-2">
                              {!ready ? (
                                <button
                                  type="button"
                                  className="inline-flex h-7 items-center rounded-nomi-sm border-0 bg-nomi-ink px-2.5 text-micro font-medium text-nomi-paper cursor-pointer hover:bg-nomi-accent"
                                  onClick={() => { void recheckSync(project.id) }}
                                >
                                  <IconRefresh size={13} stroke={1.8} className="mr-1" aria-hidden="true" />
                                  {t('library.syncRecheck')}
                                </button>
                              ) : null}
                              {onRevealProjectFolder ? (
                                <button
                                  type="button"
                                  className="inline-flex h-7 items-center rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5 text-micro text-nomi-ink cursor-pointer hover:bg-nomi-ink-05"
                                  onClick={() => onRevealProjectFolder(project.id)}
                                >
                                  {t('library.syncOpenFolder')}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })() : null}
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
      </main>
    </div>
  )
}
