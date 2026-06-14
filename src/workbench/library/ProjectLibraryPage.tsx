import React from 'react'
import { IconArrowRight, IconFolderOpen, IconFolderShare, IconGift, IconMovie, IconPlayerPlay, IconPlugConnected, IconPlus, IconTrash } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { ActionCard, NomiLogoMark } from '../../design'
import { NomiImage } from '../../design/media'
import type { LocalProjectSummary } from './localProjectStore'
import { DEFAULT_TRY_NOW_EXAMPLE, type TryNowExample } from './tryNowExamples'
import type { ProjectTemplateId } from './projectTemplates'

type Props = {
  onOpenProject: (projectId: string) => void
  onDeleteProject: (project: LocalProjectSummary) => void
  onNewProject: (templateId?: ProjectTemplateId) => void
  onOpenFolder?: () => void
  onRevealProjectFolder?: (projectId: string) => void
  onTryExample?: (example: TryNowExample) => void
  onOpenModelCatalog?: () => void
  /** null = 查询中（不渲染告警）；false 时弱入口隐藏、状态条升权（单一入口互斥） */
  hasTextModel?: boolean | null
  projects: LocalProjectSummary[]
}

function formatUpdatedAt(value: number): string {
  if (!Number.isFinite(value)) return ''
  const deltaMs = Math.max(0, Date.now() - value)
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(value).toLocaleDateString('zh-CN')
}

// memo 化：搜索/筛选触发父组件重渲时，urls 未变的封面不重渲（图多时省下整片缩略图重建）。
// urls 每次是新数组引用，故用按值比较的 comparator。
const ThumbnailMosaic = React.memo(function ThumbnailMosaic({ urls }: { urls: string[] }): JSX.Element {
  if (urls.length === 0) {
    // 未生成的项目无封面 → 只放中性占位图标；名称由卡片下方统一显示，缩略图里不再重复（去重）。
    return (
      <div className="absolute inset-0 grid place-items-center bg-nomi-ink-05">
        <IconMovie size={26} stroke={1.2} className="text-nomi-ink-30" aria-hidden />
      </div>
    )
  }
  // 单封面：一个项目用一张代表图（首个产物）。早先 2–4 宫格把不同镜头并排塞进 200px 小卡，
  // 读起来像一张糊在一起的图、看不出是什么项目（用户报「糊在一起」）。改单封面更干净、可识别。
  return <NomiImage className="absolute inset-0 w-full h-full object-cover block" src={urls[0]} alt="" />
}, (prev, next) => (prev.urls[0] || '') === (next.urls[0] || ''))

const SECONDARY_PILL_CLASS = cn(
  'inline-flex items-center gap-1.5 h-8 px-3 rounded-pill cursor-pointer font-inherit',
  'border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-body-sm transition-colors hover:border-nomi-ink-20',
)

// 「打开已有文件夹」弱化：新用户没有现成文件夹，降为无框文字链接，让主线「30 秒体验」+「新建空白」更突出。
const WEAK_LINK_CLASS = cn(
  'inline-flex items-center gap-1.5 h-8 px-1.5 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
  'text-nomi-ink-40 text-body-sm transition-colors hover:text-nomi-ink-60',
)

// 空库 hero 的「文字 → 分镜 → 成品」示意条：一眼说明 app 把文字变成分镜再变成片，
// 同时给空旷的首屏一个视觉锚点。纯占位图形（非真实素材），避免「这是什么项目」的误读。
function StoryboardHintStrip(): JSX.Element {
  const cardClass = 'w-28 shrink-0 bg-nomi-paper border border-nomi-line rounded-nomi-sm px-2.5 py-2.5 text-left'
  const labelClass = 'text-micro text-nomi-ink-40 mb-1.5'
  return (
    <div className="flex items-center gap-2.5" aria-hidden="true">
      <div className={cardClass}>
        <div className={labelClass}>文字稿</div>
        <div className="flex flex-col gap-1">
          <div className="h-0.5 w-full rounded-pill bg-nomi-ink-20" />
          <div className="h-0.5 w-3/4 rounded-pill bg-nomi-ink-20" />
          <div className="h-0.5 w-1/2 rounded-pill bg-nomi-ink-20" />
        </div>
      </div>
      <IconArrowRight size={15} stroke={1.6} className="shrink-0 text-nomi-ink-30" />
      <div className={cardClass}>
        <div className={labelClass}>分镜</div>
        <div className="grid grid-cols-2 gap-0.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-nomi-sm bg-nomi-ink-10" />
          ))}
        </div>
      </div>
      <IconArrowRight size={15} stroke={1.6} className="shrink-0 text-nomi-ink-30" />
      <div className={cardClass}>
        <div className={labelClass}>成品</div>
        <div className="aspect-video rounded-nomi-sm bg-nomi-accent-soft grid place-items-center">
          <span className="grid place-items-center size-5 rounded-pill bg-nomi-accent text-nomi-paper">
            <IconPlayerPlay size={11} stroke={1.8} />
          </span>
        </div>
      </div>
    </div>
  )
}

export default function ProjectLibraryPage({ onOpenProject, onDeleteProject, onNewProject, onOpenFolder, onRevealProjectFolder, onTryExample, onOpenModelCatalog, hasTextModel = null, projects }: Props): JSX.Element {
  const [query, setQuery] = React.useState('')
  const [sourceFilter, setSourceFilter] = React.useState<'all' | 'native' | 'folder'>('all')
  const normalizedQuery = query.trim().toLowerCase()
  const searchedProjects = normalizedQuery
    ? projects.filter((project) => project.name.toLowerCase().includes(normalizedQuery))
    : projects
  const sourceCounts = React.useMemo(() => ({
    all: searchedProjects.length,
    native: searchedProjects.filter((project) => project.source !== 'folder').length,
    folder: searchedProjects.filter((project) => project.source === 'folder').length,
  }), [searchedProjects])
  const filteredProjects = sourceFilter === 'all'
    ? searchedProjects
    : searchedProjects.filter((project) => (
      sourceFilter === 'folder' ? project.source === 'folder' : project.source !== 'folder'
    ))
  const sourceOptions: Array<{ id: 'all' | 'native' | 'folder'; label: string; count: number }> = [
    { id: 'all', label: '全部', count: sourceCounts.all },
    { id: 'native', label: '本地新建', count: sourceCounts.native },
    { id: 'folder', label: '外部文件夹', count: sourceCounts.folder },
  ]
  const isEmptyLibrary = projects.length === 0
  const textModelMissing = hasTextModel === false
  // 单一入口互斥：缺文本模型时弱入口隐藏，模型入口 = 状态条（有项目）/ 主 CTA 自动带入（空库）
  const showModelEntry = Boolean(onOpenModelCatalog) && !textModelMissing

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-nomi-bg text-nomi-ink font-nomi-sans text-[13px] leading-normal antialiased">
      <main className="flex-1 overflow-y-auto px-14 pt-[60px] pb-20 flex flex-col gap-5">

        {/* ── Header：品牌 + 右上弱入口（模型接入） ── */}
        <section className="shrink-0 flex items-start justify-between gap-6 mb-1">
          <h1 className="flex items-center gap-[11px] font-nomi-display text-[28px] font-normal tracking-[-0.022em] text-nomi-ink leading-none m-0">
            <NomiLogoMark size={28} />
            <span>No<span className="text-nomi-accent">m</span>i 项目库</span>
          </h1>
          {showModelEntry ? (
            <button
              type="button"
              onClick={onOpenModelCatalog}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2 rounded-pill border-0 bg-transparent cursor-pointer font-inherit',
                'text-caption text-nomi-ink-60 transition-colors hover:text-nomi-ink',
              )}
              aria-label="模型接入"
            >
              <IconPlugConnected size={14} stroke={1.6} aria-hidden="true" />
              模型接入
            </button>
          ) : null}
        </section>

        {isEmptyLibrary ? (
          /* ── 空库 = 引导态：单主线「30 秒体验」，库非空后此态永久消失 ── */
          <section className="flex-1 grid place-items-center py-12" aria-label="开始使用">
            <div className="max-w-[480px] flex flex-col items-center gap-4 text-center">
              <h2 data-hero-title="true" className="m-0 font-nomi-display text-h1 font-medium tracking-[-0.018em] text-nomi-ink">
                把一段文字，变成可生成的分镜
              </h2>
              <p className="m-0 text-body-sm text-nomi-ink-60">用一个示例项目，30 秒走完 创作 → 生成 → 预览。</p>
              <StoryboardHintStrip />
              {onTryExample ? (
                <div className="flex items-center gap-2.5 mt-1.5">
                  <button
                    type="button"
                    data-try-now-hero-cta="true"
                    onClick={() => onTryExample(DEFAULT_TRY_NOW_EXAMPLE)}
                    className={cn(
                      'inline-flex items-center gap-2 h-9 px-5 rounded-pill border-0 cursor-pointer font-inherit',
                      'bg-nomi-ink text-nomi-paper text-body font-medium transition-colors hover:bg-nomi-accent',
                    )}
                  >
                    <IconPlayerPlay size={15} stroke={1.8} aria-hidden="true" />
                    30 秒体验
                  </button>
                  <span
                    className="inline-flex items-center gap-1 h-6 px-2.5 rounded-pill bg-nomi-accent-soft text-nomi-accent text-caption font-medium"
                    data-free-badge="true"
                  >
                    <IconGift size={13} stroke={1.6} aria-hidden="true" />
                    免费 · 无需绑卡
                  </span>
                </div>
              ) : null}
              {textModelMissing ? (
                <p className="m-0 text-caption text-nomi-ink-40" data-model-hint="true">
                  体验时引导你连接 AI 服务（用你自己的 Key，Nomi 不另收费）。
                </p>
              ) : null}
              <div className="w-full grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-micro text-nomi-ink-30" aria-hidden="true">
                <span className="h-px bg-nomi-line" />
                <span>或</span>
                <span className="h-px bg-nomi-line" />
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onNewProject()} className={SECONDARY_PILL_CLASS}>
                  <IconPlus size={15} stroke={1.8} aria-hidden="true" />
                  新建空白项目
                </button>
                {onOpenFolder ? (
                  <button type="button" onClick={onOpenFolder} className={WEAK_LINK_CLASS}>
                    <IconFolderOpen size={15} stroke={1.6} aria-hidden="true" />
                    打开已有文件夹
                  </button>
                ) : null}
              </div>
              <p className="m-0 text-caption text-nomi-ink-40">项目保存在本地：新建到 Nomi Projects，或直接绑定你已有的文件夹。</p>
            </div>
          </section>
        ) : (
          <>
            {/* ── 主入口：动作卡片（O2 拍板，尺寸/形态/位置三重区隔） ── */}
            <section className="shrink-0 flex items-center gap-3" aria-label="开始一个项目">
              <ActionCard
                variant="primary"
                icon={<IconPlus size={18} stroke={1.8} />}
                title="新建空白项目"
                description="从一段文字或想法开始"
                onClick={() => onNewProject()}
              />
              {onOpenFolder ? (
                <ActionCard
                  icon={<IconFolderOpen size={18} stroke={1.6} />}
                  title="打开已有文件夹"
                  description="把素材文件夹变成项目"
                  onClick={onOpenFolder}
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
                aria-label="模型状态"
                data-model-banner="true"
              >
                <div>
                  <div className="text-[13px] font-semibold text-nomi-ink">文本模型未接入</div>
                  <div className="mt-0.5 text-caption text-nomi-ink-60">写故事、拆镜头都需要它；图片 / 视频模型可以等到生成前再接。</div>
                </div>
                <button
                  type="button"
                  onClick={onOpenModelCatalog}
                  className={cn(
                    'inline-flex items-center h-8 px-4 rounded-pill border-0 cursor-pointer font-inherit',
                    'bg-nomi-ink text-nomi-paper text-[13px] font-medium transition-colors hover:bg-nomi-accent',
                  )}
                >
                  接入文本模型
                </button>
              </section>
            ) : null}

            {/* ── 最近项目：标题 + 来源筛选（名词，与动作动词区隔）｜搜索同行 ── */}
            <div className="shrink-0 flex items-center justify-between gap-4 flex-wrap">
              <div className="inline-flex items-center gap-8 flex-wrap">
                <h2 className="m-0 text-caption font-medium text-nomi-ink-60">最近项目</h2>
                <div className="inline-flex items-center gap-1 p-1 rounded-full border border-nomi-line bg-nomi-paper" aria-label="筛选项目来源">
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
              <div className={cn(
                'flex items-center gap-2 h-9 w-[280px] px-3',
                'border border-nomi-line rounded-nomi-sm bg-nomi-paper',
                'transition-[border-color,box-shadow] duration-150',
                'focus-within:border-[color-mix(in_oklch,var(--nomi-accent)_50%,transparent)]',
                'focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--nomi-accent)_10%,transparent)]',
              )}>
                <svg className="shrink-0 text-[var(--nomi-ink-30)]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  className="flex-1 border-none bg-transparent font-inherit text-[13px] text-nomi-ink outline-none placeholder:text-[var(--nomi-ink-30)] [&::-webkit-search-cancel-button]:hidden"
                  type="search"
                  placeholder="搜索项目"
                  aria-label="搜索项目"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            {filteredProjects.length === 0 ? (
              // 审计 A10：库非空但「搜索 × 来源 tab」过滤后为空——给空态与出路，
              // 不再渲染纯空白 grid（唯一的旧空态只判整库空）。
              <div className="flex flex-col items-center gap-2 py-12 text-center" data-library-filter-empty="true">
                <span className="text-caption text-nomi-ink-60">
                  {normalizedQuery ? `没有匹配「${query.trim()}」的项目` : '这个分类下还没有项目'}
                </span>
                {normalizedQuery ? (
                  <button
                    type="button"
                    className="inline-flex h-7 items-center px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-caption text-nomi-ink-80 cursor-pointer hover:bg-nomi-ink-05"
                    onClick={() => setQuery('')}
                  >
                    清除搜索
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="shrink-0 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-[14px]">
              {filteredProjects.map((project) => {
                const urls = project.thumbnailUrls || (project.thumbnail ? [project.thumbnail] : [])
                return (
                  <div
                    key={project.id}
                    data-project-card="true"
                    className={cn(
                      'group bg-nomi-paper border border-nomi-line rounded-nomi-lg overflow-hidden text-left',
                      'transition-[box-shadow,transform,border-color] duration-150',
                      project.missing
                        ? 'opacity-50 cursor-not-allowed'
                        : 'cursor-pointer hover:shadow-nomi-md hover:border-[var(--nomi-ink-20)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none',
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
                      <div className={cn(
                        'absolute inset-0 bg-[oklch(0.12_0.01_80/0.3)] opacity-0 transition-opacity duration-150',
                        'flex items-center justify-center z-[2]',
                        'group-hover:opacity-100',
                      )}>
                        <button
                          className={cn(
                            'absolute top-[9px] right-[9px] w-[30px] h-[30px] rounded-nomi-sm border-none',
                            'bg-white/90 text-[#b42318] grid place-items-center cursor-pointer',
                            'transition-[background,color] duration-150',
                            'hover:bg-[#b42318] hover:text-white',
                          )}
                          type="button"
                          aria-label={`删除项目 ${project.name}`}
                          title="删除项目"
                          onClick={(e) => { e.stopPropagation(); onDeleteProject(project) }}
                        >
                          <IconTrash size={14} stroke={1.8} />
                        </button>
                        {project.missing ? (
                          <span className="h-[30px] px-[14px] rounded-nomi-sm text-caption font-medium text-white/80 flex items-center">
                            文件夹暂不可用
                          </span>
                        ) : (
                          <button
                            className={cn(
                              'h-[30px] px-[14px] rounded-nomi-sm border-none',
                              'bg-white/90 text-nomi-ink font-inherit text-caption font-medium cursor-pointer',
                              'transition-colors duration-150 hover:bg-white',
                            )}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenProject(project.id) }}
                          >
                            继续创作
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="px-[13px] pt-[10px] pb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-nomi-ink truncate mb-0.5">{project.name}</div>
                        <div className="text-micro text-nomi-ink-40">{formatUpdatedAt(project.updatedAt)}</div>
                      </div>
                      {onRevealProjectFolder && project.rootPath ? (
                        <button
                          type="button"
                          aria-label={`打开项目文件夹 ${project.name}`}
                          title="在访达中显示项目文件夹"
                          onClick={(e) => { e.stopPropagation(); onRevealProjectFolder(project.id) }}
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
}
