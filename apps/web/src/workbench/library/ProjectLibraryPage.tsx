import './library.css'
import { NomiLogoMark } from '../../design'
import type { LocalProjectSummary } from './localProjectStore'

type Props = {
  onOpenProject: (projectId: string) => void
  onNewProject: () => void
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

function ThumbnailMosaic({ urls }: { urls: string[] }): JSX.Element {
  if (urls.length === 0) {
    return <div className="lib-thumb__empty" />
  }
  if (urls.length === 1) {
    return <img className="lib-thumb__img lib-thumb__img--full" src={urls[0]} alt="" />
  }
  const cells = urls.slice(0, 4)
  return (
    <div className={`lib-thumb__grid lib-thumb__grid--${cells.length}`}>
      {cells.map((url, i) => (
        <img key={i} className="lib-thumb__cell" src={url} alt="" />
      ))}
    </div>
  )
}

export default function ProjectLibraryPage({ onOpenProject, onNewProject, projects }: Props): JSX.Element {
  return (
    <div className="lib-shell">
      <main className="lib-main">

        {/* ── Header ── */}
        <section className="lib-hero">
          <h1 className="lib-hero__title">
            <NomiLogoMark size={28} />
            <span>No<span className="lib-hero__accent">m</span>i 项目库</span>
          </h1>
          <p className="lib-hero__sub">新建一个项目，开始把你的创意变成作品。</p>
        </section>

        {/* ── Search ── */}
        <div className="lib-search">
          <svg className="lib-search__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            className="lib-search__input"
            type="search"
            placeholder="搜索项目名称…"
            aria-label="搜索项目"
          />
        </div>

        {/* ── Grid ── */}
        <div className="lib-grid">

          {/* New project — first card, plain solid style */}
          <button className="lib-card lib-card--new" type="button" onClick={onNewProject}>
            <div className="lib-card__thumb lib-card--new__thumb">
              <div className="lib-card--new__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              </div>
            </div>
            <div className="lib-card__body">
              <div className="lib-card__name">新建项目</div>
            </div>
          </button>

          {projects.map((project) => {
            const urls = project.thumbnailUrls || (project.thumbnail ? [project.thumbnail] : [])
            return (
              <div
                key={project.id}
                className="lib-card"
                role="button"
                tabIndex={0}
                onClick={() => onOpenProject(project.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpenProject(project.id)}
              >
                <div
                  className="lib-card__thumb"
                  style={urls.length === 0 && project.thumbStyle ? { background: project.thumbStyle } : undefined}
                >
                  <ThumbnailMosaic urls={urls} />
                  <div className="lib-card__overlay">
                    <button
                      className="lib-card__cta"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpenProject(project.id) }}
                    >
                      继续创作
                    </button>
                  </div>
                </div>
                <div className="lib-card__body">
                  <div className="lib-card__name">{project.name}</div>
                  <div className="lib-card__time">{formatUpdatedAt(project.updatedAt)}</div>
                </div>
              </div>
            )
          })}
        </div>

      </main>
    </div>
  )
}
