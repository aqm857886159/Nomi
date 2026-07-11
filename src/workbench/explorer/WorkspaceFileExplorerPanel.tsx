import React from 'react'
import {
  IconFolderOpen,
  IconList,
  IconRefresh,
  IconSortAscending2,
  IconSortDescending2,
  IconUpload,
} from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignEmptyState } from '../../design'
import { useWorkspaceFiles } from '../workspace/useWorkspaceFiles'
import { importWorkbenchLocalAssetFile } from '../api/assetUploadApi'
import type { WorkspaceFileNode } from '../../../electron/workspace/workspaceFileIndex'
import FileTreeNode from './FileTreeNode'

type Props = {
  projectId: string | null
}

// 对创作者无意义的内部噪音（清单 / 缓存 / 系统文件）。.nomi 已被 electron 侧按
// dotfile 规则隐藏，这里再兜一层，并隐藏迁移残留在顶层的 project.json / cache。
const NOISE_NAMES = new Set(['.nomi', 'project.json', 'cache', '.ds_store', 'thumbs.db'])

const ASSET_PANEL_ICON_BUTTON_CLASS = cn(
  'grid size-8 place-items-center rounded-nomi-sm border-0 bg-transparent',
  'cursor-pointer text-nomi-ink-40 transition-[background,border-color,color] duration-[var(--nomi-transition-fast)]',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

/**
 * 过滤掉内部噪音 + 迁移残留的空壳目录，只留对创作者有意义的真实文件夹内容。
 * 目录在过滤完子节点后若为空 → 视为空壳（如迁移残留的顶层 generated/imported）丢弃。
 */
function filterNoise(nodes: WorkspaceFileNode[]): WorkspaceFileNode[] {
  const out: WorkspaceFileNode[] = []
  for (const node of nodes) {
    if (NOISE_NAMES.has(node.name.toLowerCase())) continue
    if (node.kind === 'directory') {
      const children = filterNoise(node.children || [])
      if (!children.length) continue // 空壳目录
      out.push({ ...node, children })
    } else {
      out.push(node)
    }
  }
  return out
}

function sortWorkspaceFileNodes(nodes: WorkspaceFileNode[], ascending: boolean): WorkspaceFileNode[] {
  return nodes
    .slice()
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      const result = a.name.localeCompare(b.name, 'zh-Hans', { numeric: true, sensitivity: 'base' })
      return ascending ? result : -result
    })
    .map((node) =>
      node.kind === 'directory'
        ? { ...node, children: sortWorkspaceFileNodes(node.children || [], ascending) }
        : node,
    )
}

function isFileDrag(event: React.DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types || []).includes('Files')
}

export default function WorkspaceFileExplorerPanel({ projectId }: Props): JSX.Element {
  const { items, loading, error, truncated, refresh } = useWorkspaceFiles(projectId)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const dragDepthRef = React.useRef(0)
  const [importing, setImporting] = React.useState(false)
  const [sortAscending, setSortAscending] = React.useState(true)
  const [dropActive, setDropActive] = React.useState(false)

  const visibleItems = React.useMemo(
    () => sortWorkspaceFileNodes(filterNoise(items), sortAscending),
    [items, sortAscending],
  )

  const handleImportClick = React.useCallback(() => {
    if (!projectId || importing) return
    fileInputRef.current?.click()
  }, [importing, projectId])

  const importFiles = React.useCallback(async (files: File[]) => {
    if (!projectId || !files.length) return
    setImporting(true)
    try {
      for (const file of files) {
        await importWorkbenchLocalAssetFile(file, file.name, { projectId })
      }
    } catch (importError) {
      console.error('[workspace-files] import failed', importError)
    } finally {
      setImporting(false)
      refresh()
    }
  }, [projectId, refresh])

  const handleFilesSelected = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const files = Array.from(input.files || [])
    input.value = '' // 允许再次选同一文件
    void importFiles(files)
  }, [importFiles])

  const handleDropZoneDragEnter = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!projectId || !isFileDrag(event)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDropActive(true)
  }, [projectId])

  const handleDropZoneDragOver = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!projectId || !isFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!dropActive) setDropActive(true)
  }, [dropActive, projectId])

  const handleDropZoneDragLeave = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!projectId || !isFileDrag(event)) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDropActive(false)
  }, [projectId])

  const handleDropZoneDrop = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!projectId || !isFileDrag(event)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setDropActive(false)
    const files = Array.from(event.dataTransfer.files || [])
    void importFiles(files)
  }, [importFiles, projectId])

  return (
    <div className="flex h-full min-h-0 flex-col bg-nomi-paper">
      <header className="flex h-12 shrink-0 items-center border-b border-nomi-line-soft px-3">
        <h2 className="m-0 min-w-0 flex-1 truncate text-body-sm font-bold leading-none text-nomi-ink">
          素材
        </h2>
        <div className="ml-2 flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={cn(ASSET_PANEL_ICON_BUTTON_CLASS, 'bg-nomi-ink-05 text-nomi-ink')}
            aria-label="列表视图"
            aria-pressed="true"
            title="列表视图"
          >
            <IconList size={17} stroke={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={ASSET_PANEL_ICON_BUTTON_CLASS}
            onClick={() => setSortAscending((value) => !value)}
            aria-label="排序素材"
            aria-pressed={!sortAscending}
            title={sortAscending ? '升序排列' : '降序排列'}
          >
            {sortAscending ? (
              <IconSortAscending2 size={17} stroke={1.8} aria-hidden="true" />
            ) : (
              <IconSortDescending2 size={17} stroke={1.8} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={refresh}
            className={ASSET_PANEL_ICON_BUTTON_CLASS}
            aria-label="刷新项目文件"
            title="刷新项目文件"
          >
            <IconRefresh size={17} stroke={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleImportClick}
            disabled={!projectId || importing}
            className={ASSET_PANEL_ICON_BUTTON_CLASS}
            aria-label="导入素材"
            title="导入素材"
          >
            <IconUpload size={17} stroke={1.8} aria-hidden="true" />
          </button>
        </div>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesSelected} aria-hidden />
      </header>
      {projectId ? (
        <div className="shrink-0 px-3 pt-3">
          <button
            type="button"
            onClick={handleImportClick}
            disabled={importing}
            className={cn(
              'flex h-[118px] w-full flex-col items-center justify-center rounded-nomi border border-dashed border-nomi-line',
              'bg-nomi-ink-05/55 px-4 text-center text-nomi-ink-40',
              'transition-[background,border-color,color,box-shadow] duration-[var(--nomi-transition-fast)]',
              'hover:bg-nomi-ink-05 hover:text-nomi-ink-60',
              dropActive && 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent',
              importing && 'opacity-60 cursor-wait',
            )}
            title="把本地文件拷贝进项目素材文件夹"
            onDragEnter={handleDropZoneDragEnter}
            onDragOver={handleDropZoneDragOver}
            onDragLeave={handleDropZoneDragLeave}
            onDrop={handleDropZoneDrop}
          >
            <IconUpload size={30} stroke={1.6} aria-hidden="true" />
            <span className="mt-2 text-caption font-semibold leading-tight">
              {importing ? '正在导入' : '导入素材'}
            </span>
            <span className="mt-1 text-micro leading-tight text-nomi-ink-40">
              图片、视频、音频
            </span>
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto px-2.5 py-3">
        {!projectId ? <p className="px-2 py-4 text-caption text-nomi-ink-40">打开项目后显示文件</p> : null}
        {loading ? <p className="px-2 py-4 text-caption text-nomi-ink-40">正在读取项目文件…</p> : null}
        {error ? <p className="px-2 py-4 text-caption text-workbench-danger">{error}</p> : null}
        {!loading && !error && projectId && visibleItems.length === 0 ? (
          <DesignEmptyState
            density="inline"
            icon={<IconFolderOpen size={32} stroke={1.5} className="text-nomi-ink-30" />}
            title="还没有文件"
            description="点上方「导入本地文件」，或把文件拖进来。"
          />
        ) : null}
        {!loading && !error ? (
          <div className={cn('flex flex-col gap-0.5')}>
            {visibleItems.map((node) => <FileTreeNode key={node.id} node={node} projectId={projectId || ''} />)}
          </div>
        ) : null}
        {truncated ? <p className="px-2 py-2 text-micro text-nomi-ink-40">文件较多，已显示前 500 个</p> : null}
      </div>
    </div>
  )
}
