import React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  IconBrowser,
  IconBox,
  IconFolderOpen,
  IconFolderShare,
  IconMovie,
  IconPlayerPlay,
  IconPlugConnected,
  IconPlus,
  IconSparkles,
  IconTrash,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { ActionCard, NomiBrand, NomiWordmark, DesignEmptyState, DesignSearchInput } from '../../design'
import { NomiImage } from '../../design/media'
import { ThemeToggleButton } from '../../ui/theme/ThemeToggleButton'
import { WindowControls } from '../../ui/app-shell/WindowControls'
import { AboutNomiPopover } from '../../ui/app-shell/AboutNomiPopover'
import { LanguageMenuButton } from '../../ui/app-shell/LanguageMenuButton'
import { handleWindowTitlebarDoubleClick } from '../../ui/app-shell/windowTitlebarDoubleClick'
import {
  dispatchGlobalAssetPopoverOpen,
  getGlobalAssetPopoverAnchorRect,
} from '../../ui/browser/overlay/globalAssetPopoverEvents'
import { useGlobalBrowserAssetCount } from '../../ui/browser/assets/useGlobalBrowserAssets'
import type { LocalProjectSummary } from './localProjectStore'
import type { ProjectTemplateId } from './projectTemplates'

type Props = {
  onOpenProject: (projectId: string) => void
  onDeleteProject: (project: LocalProjectSummary) => void
  onNewProject: (templateId?: ProjectTemplateId) => void
  onOpenFolder?: () => void
  onRevealProjectFolder?: (projectId: string) => void
  onOpenModelCatalog?: () => void
  /** 看「60 秒预置回放」引导旅途（建示例项目 + 走一遍全流程）；缺省则不渲染该卡 */
  onPlayJourneyTour?: () => void
  /** 旅途是否看过——决定 CTA 文案在「看一遍 / 重看」之间切换 */
  journeyTourSeen?: boolean
  /** 重看开屏动画（首启播完后从这里可主动重播）；缺省则不渲染重看入口 */
  onReplaySplash?: () => void
  /** null = 查询中（不渲染告警）；false 时弱入口隐藏、状态条升权（单一入口互斥） */
  hasTextModel?: boolean | null
  projects: LocalProjectSummary[]
}

function formatUpdatedAt(value: number, t: TFunction, locale: string): string {
  if (!Number.isFinite(value)) return ''
  const deltaMs = Math.max(0, Date.now() - value)
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return t('library.justNow')
  if (minutes < 60) return t('library.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('library.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('library.daysAgo', { count: days })
  return new Date(value).toLocaleDateString(locale)
}

function localizedProjectName(name: string, t: TFunction): string {
  const trimmed = name.trim()
  const match = trimmed.match(/^(?:未命名项目|Untitled project)(?:\s+(.+))?$/i)
  if (!match) return name
  return match[1] ? t('runtime.project.untitledWithTime', { time: match[1] }) : t('runtime.project.untitled')
}

// memo 化：搜索/筛选触发父组件重渲时，urls 未变的封面不重渲（图多时省下整片缩略图重建）。
// urls 每次是新数组引用，故用按值比较的 comparator。
const ThumbnailMosaic = React.memo(
  function ThumbnailMosaic({ urls }: { urls: string[] }): JSX.Element {
    if (urls.length === 0) {
      // 未生成的项目无封面 → 只放中性占位图标；名称由卡片下方统一显示，缩略图里不再重复（去重）。
      return (
        <div className="absolute inset-0 grid place-items-center bg-nomi-ink-05">
          <IconMovie size={26} stroke={1.5} className="text-nomi-ink-30" aria-hidden />
        </div>
      )
    }
    // 单封面：一个项目用一张代表图（首个产物）。早先 2–4 宫格把不同镜头并排塞进 200px 小卡，
    // 读起来像一张糊在一起的图、看不出是什么项目（用户报「糊在一起」）。改单封面更干净、可识别。
    return <NomiImage className="absolute inset-0 w-full h-full object-cover block" src={urls[0]} alt="" />
  },
  (prev, next) => (prev.urls[0] || '') === (next.urls[0] || ''),
)

export default function ProjectLibraryPage({
  onOpenProject,
  onDeleteProject,
  onNewProject,
  onOpenFolder,
  onRevealProjectFolder,
  onOpenModelCatalog,
  onPlayJourneyTour,
  journeyTourSeen = false,
  onReplaySplash,
  hasTextModel = null,
  projects,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation()
  const [aboutOpen, setAboutOpen] = React.useState(false)
  const aboutButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const [query, setQuery] = React.useState('')
  const [sourceFilter, setSourceFilter] = React.useState<'all' | 'native' | 'folder'>('all')
  const assetCount = useGlobalBrowserAssetCount()
  const normalizedQuery = query.trim().toLowerCase()
  const searchedProjects = normalizedQuery
    ? projects.filter((project) => localizedProjectName(project.name, t).toLowerCase().includes(normalizedQuery))
    : projects
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
  const sourceOptions: Array<{ id: 'all' | 'native' | 'folder'; label: string; count: number }> = [
    { id: 'all', label: t('library.all'), count: sourceCounts.all },
    { id: 'native', label: t('library.local'), count: sourceCounts.native },
    { id: 'folder', label: t('library.folders'), count: sourceCounts.folder },
  ]
  const textModelMissing = hasTextModel === false
  // 单一入口互斥：缺文本模型时弱入口隐藏，模型入口 = 状态条（有项目）/ 主 CTA 自动带入（空库）
  const showModelEntry = Boolean(onOpenModelCatalog) && !textModelMissing
  // Windows：库窗也 frame:false，需自绘标题栏才能拖动/关窗。mac/Linux：原生 chrome，右上操作留在 header 原位。
  const isWindows = window.nomiDesktop?.platform === 'win32'
  const openBrowser = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('nomi-open-browser'))
  }, [])

  const libraryTopActions = (
    <div className="app-no-drag flex items-center gap-1">
      {onReplaySplash ? (
        <button
          type="button"
          onClick={onReplaySplash}
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-2 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
            'text-caption text-nomi-ink-60 transition-colors hover:text-nomi-ink',
          )}
          data-replay-splash="true"
          aria-label={t('library.replaySplash')}
        >
          <IconSparkles size={14} stroke={1.8} aria-hidden="true" />
          {t('library.watchNomi')}
        </button>
      ) : null}
      {showModelEntry ? (
        <button
          type="button"
          onClick={onOpenModelCatalog}
          className={cn(
            'inline-flex items-center gap-1.5 h-7 px-2 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
            'text-caption text-nomi-ink-60 transition-colors hover:text-nomi-ink',
          )}
          aria-label={t('appBar.modelAccess')}
        >
          <IconPlugConnected size={14} stroke={1.8} aria-hidden="true" />
          {t('appBar.modelAccess')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={openBrowser}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-2 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
          'text-caption text-nomi-ink-60 transition-colors hover:text-nomi-ink',
        )}
        aria-label={t('appBar.openBrowser')}
      >
        <IconBrowser size={14} stroke={1.8} aria-hidden="true" />
        {t('appBar.browser')}
      </button>
      <button
        type="button"
        onClick={(event) => {
          dispatchGlobalAssetPopoverOpen(true, getGlobalAssetPopoverAnchorRect(event.currentTarget))
        }}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 px-2 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
          'text-caption text-nomi-ink-60 transition-colors hover:text-nomi-ink',
        )}
        aria-label={t('appBar.openAssetBox')}
        title={t('appBar.assetBox')}
      >
        <IconBox size={14} stroke={1.7} aria-hidden="true" />
        {t('appBar.assetBox')}
        {assetCount > 0 ? (
          <span
            className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-pill bg-nomi-accent-soft px-1.5 text-micro font-semibold leading-none text-nomi-accent"
            aria-label={t('appBar.assetCount', { count: assetCount })}
          >
            {assetCount > 99 ? '99+' : assetCount}
          </span>
        ) : null}
      </button>
      <LanguageMenuButton className="size-7" />
      <ThemeToggleButton className="size-7 rounded-pill" />
    </div>
  )

  return (
    <div className="nomi-library-page flex flex-col h-screen overflow-hidden bg-nomi-bg text-nomi-ink font-nomi-sans text-body-sm leading-normal antialiased">
      {isWindows ? (
        <div
          className="nomi-library-page__windowbar app-drag relative shrink-0 flex items-center gap-2 h-8 w-full bg-nomi-bg pl-3"
          onDoubleClick={handleWindowTitlebarDoubleClick}
        >
          <button
            ref={aboutButtonRef}
            type="button"
            className={cn(
              'app-no-drag relative z-[2] inline-flex h-full items-center pr-2 border-0 bg-transparent cursor-pointer',
              'text-nomi-ink transition-[opacity] duration-[var(--nomi-transition-fast)] hover:opacity-80',
            )}
            aria-label={t('appBar.aboutAndUpdate')}
            aria-haspopup="dialog"
            aria-expanded={aboutOpen}
            onClick={() => setAboutOpen((open) => !open)}
          >
            <NomiBrand markSize={18} wordSize={14} />
          </button>
          <div
            className="app-drag relative z-[1] h-full min-w-0 flex-1"
            data-window-drag-region="true"
            aria-hidden="true"
          />
          <div className="relative z-[2]">{libraryTopActions}</div>
          <WindowControls className="relative z-[2]" />
        </div>
      ) : null}
      {aboutOpen ? <AboutNomiPopover anchorEl={aboutButtonRef.current} onClose={() => setAboutOpen(false)} /> : null}
      <main className="nomi-library-page__main flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-14 pt-[60px] pb-20 flex flex-col gap-5">
        {/* ── Header：左上 logo→关于菜单（同画布；Windows 移到自绘标题栏）＋ 大标题去 logo 只留字标 ── */}
        <section className="shrink-0 flex items-start justify-between gap-6 mb-1">
          <div className="flex items-center gap-3 min-w-0">
            {!isWindows ? (
              <>
                <button
                  ref={aboutButtonRef}
                  type="button"
                  className={cn(
                    'inline-flex items-center border-0 bg-transparent p-0 cursor-pointer',
                    'transition-[opacity] duration-[var(--nomi-transition-fast)] hover:opacity-80',
                  )}
                  aria-label={t('appBar.aboutAndUpdate')}
                  aria-haspopup="dialog"
                  aria-expanded={aboutOpen}
                  onClick={() => setAboutOpen((open) => !open)}
                >
                  <NomiBrand markSize={22} wordSize={16} />
                </button>
                <span className="w-px h-6 bg-nomi-line" aria-hidden="true" />
              </>
            ) : null}
            <h1 className="flex items-center gap-3 font-nomi-display text-display font-normal tracking-[-0.022em] text-nomi-ink leading-none m-0">
              <NomiWordmark /> {t('appBar.projectLibrary')}
            </h1>
          </div>
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
                <div className="mt-0.5 text-caption text-nomi-ink-60">{t('library.textModelMissingHint')}</div>
              </div>
              <button
                type="button"
                onClick={onOpenModelCatalog}
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
          <div className="shrink-0 flex items-center justify-between gap-4 flex-wrap">
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
            <DesignSearchInput
              size="md"
              className="w-[280px]"
              placeholder={t('library.searchPlaceholder')}
              value={query}
              onChange={setQuery}
            />
          </div>

          {filteredProjects.length === 0 ? (
            // 审计 A10：库非空但「搜索 × 来源 tab」过滤后为空——给空态与出路（统一空态组件）。
            <DesignEmptyState
              density="inline"
              title={
                normalizedQuery ? t('library.noMatchNamed', { query: query.trim() }) : t('library.noProjectsInCategory')
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
              const displayName = localizedProjectName(project.name, t)
              return (
                <div
                  key={project.id}
                  data-project-card="true"
                  className={cn(
                    'group bg-nomi-paper border border-nomi-line rounded-nomi-lg overflow-hidden text-left',
                    'transition-[box-shadow,transform,border-color] duration-150',
                    project.missing
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer hover:shadow-nomi-md hover:border-nomi-ink-20 hover:-translate-y-0.5 active:translate-y-0 active:shadow-none',
                  )}
                  role={project.missing ? undefined : 'button'}
                  tabIndex={project.missing ? undefined : 0}
                  onClick={project.missing ? undefined : () => onOpenProject(project.id)}
                  onKeyDown={project.missing ? undefined : (e) => e.key === 'Enter' && onOpenProject(project.id)}
                >
                  <div
                    className="aspect-video relative overflow-hidden bg-nomi-ink-05"
                    style={urls.length === 0 && project.thumbStyle ? { background: project.thumbStyle } : undefined}
                  >
                    <ThumbnailMosaic urls={urls} />
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
                        aria-label={t('library.deleteNamedProject', { name: displayName })}
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
                            onOpenProject(project.id)
                          }}
                        >
                          {t('library.continueCreating')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="px-3 pt-2.5 pb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <div className="min-w-0">
                      <div className="text-body-sm font-medium text-nomi-ink truncate mb-0.5">{displayName}</div>
                      <div className="text-micro text-nomi-ink-40">
                        {formatUpdatedAt(project.updatedAt, t, i18n.resolvedLanguage || 'zh-CN')}
                      </div>
                    </div>
                    {onRevealProjectFolder && project.rootPath ? (
                      <button
                        type="button"
                        aria-label={t('library.openProjectFolder', { name: displayName })}
                        title={t('library.revealProjectFolder')}
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
