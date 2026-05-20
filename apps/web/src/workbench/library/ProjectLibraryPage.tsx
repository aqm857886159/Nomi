import './library.css'
import React from 'react'
import { NomiLogoMark } from '../../design'
import type { LocalProjectSummary } from './localProjectStore'
import { deleteLocalProject, renameLocalProject } from './localProjectStore'

type Props = {
  onOpenProject: (projectId: string) => void
  onNewProject: () => void
  projects: LocalProjectSummary[]
  onProjectsChanged?: () => void
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

type CardMenuProps = {
  projectId: string
  projectName: string
  onRename: () => void
  onDelete: () => void
}

function CardMenu({ onRename, onDelete }: CardMenuProps): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="lib-card__menu" onClick={(e) => e.stopPropagation()}>
      <button
        className="lib-card__menu-btn"
        type="button"
        aria-label="更多操作"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
      >
        ···
      </button>
      {open && (
        <div className="lib-card__dropdown">
          <button
            className="lib-card__dropdown-item"
            type="button"
            onClick={() => { setOpen(false); onRename() }}
          >
            重命名
          </button>
          <button
            className="lib-card__dropdown-item lib-card__dropdown-item--danger"
            type="button"
            onClick={() => { setOpen(false); onDelete() }}
          >
            删除项目
          </button>
        </div>
      )}
    </div>
  )
}

export default function ProjectLibraryPage({ onOpenProject, onNewProject, projects, onProjectsChanged }: Props): JSX.Element {
  const [searchQuery, setSearchQuery] = React.useState('')
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState('')

  const filtered = searchQuery.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : projects

  function handleDelete(project: LocalProjectSummary): void {
    if (!window.confirm(`确认删除项目「${project.name}」？此操作不可恢复。`)) return
    deleteLocalProject(project.id)
    onProjectsChanged?.()
  }

  function startRename(project: LocalProjectSummary): void {
    setRenamingId(project.id)
    setRenameValue(project.name)
  }

  function commitRename(projectId: string): void {
    const name = renameValue.trim() || '未命名项目'
    renameLocalProject(projectId, name)
    setRenamingId(null)
    onProjectsChanged?.()
  }

  function cancelRename(): void {
    setRenamingId(null)
  }

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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
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

          {filtered.map((project) => {
            const urls = project.thumbnailUrls || (project.thumbnail ? [project.thumbnail] : [])
            const isRenaming = renamingId === project.id
            return (
              <div
                key={project.id}
                className="lib-card"
                role="button"
                tabIndex={0}
                onClick={() => !isRenaming && onOpenProject(project.id)}
                onKeyDown={(e) => e.key === 'Enter' && !isRenaming && onOpenProject(project.id)}
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
                  <CardMenu
                    projectId={project.id}
                    projectName={project.name}
                    onRename={() => startRename(project)}
                    onDelete={() => handleDelete(project)}
                  />
                </div>
                <div className="lib-card__body">
                  {isRenaming ? (
                    <input
                      className="lib-card__rename-input"
                      value={renameValue}
                      autoFocus
                      aria-label="项目名称"
                      onChange={(e) => setRenameValue(e.currentTarget.value)}
                      onBlur={() => commitRename(project.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(project.id)
                        if (e.key === 'Escape') cancelRename()
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="lib-card__name">{project.name}</div>
                  )}
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
