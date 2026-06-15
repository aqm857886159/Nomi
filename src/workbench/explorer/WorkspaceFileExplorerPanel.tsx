import React from 'react'
import { cn } from '../../utils/cn'
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

export default function WorkspaceFileExplorerPanel({ projectId }: Props): JSX.Element {
  const { items, loading, error, truncated, refresh } = useWorkspaceFiles(projectId)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = React.useState(false)

  const visibleItems = React.useMemo(() => filterNoise(items), [items])

  const handleImportClick = React.useCallback(() => {
    if (!projectId || importing) return
    fileInputRef.current?.click()
  }, [importing, projectId])

  const handleFilesSelected = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const files = Array.from(input.files || [])
    input.value = '' // 允许再次选同一文件
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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-2 py-2 border-b border-nomi-line">
        <span className="text-micro uppercase tracking-wider text-nomi-ink-40">项目文件</span>
        <button
          type="button"
          onClick={refresh}
          className="text-micro px-1.5 py-1 rounded text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-bg"
          aria-label="刷新项目文件"
        >
          刷新
        </button>
      </div>
      {projectId ? (
        <div className="px-2 py-2 border-b border-nomi-line">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesSelected} aria-hidden />
          <button
            type="button"
            onClick={handleImportClick}
            disabled={importing}
            className={cn(
              'w-full px-2 py-1.5 text-caption rounded-md border border-dashed border-nomi-line',
              'text-nomi-ink-50 hover:text-nomi-ink hover:bg-nomi-ink-05',
              importing && 'opacity-60 cursor-wait',
            )}
            title="把本地文件拷贝进项目素材文件夹"
          >
            {importing ? '导入中…' : '+ 导入本地文件'}
          </button>
        </div>
      ) : null}
      <div className="flex-1 min-h-0 overflow-auto px-1.5 py-2">
        {!projectId ? <p className="px-2 py-4 text-caption text-nomi-ink-40">打开项目后显示文件</p> : null}
        {loading ? <p className="px-2 py-4 text-caption text-nomi-ink-40">正在读取项目文件…</p> : null}
        {error ? <p className="px-2 py-4 text-caption text-workbench-danger">{error}</p> : null}
        {!loading && !error && projectId && visibleItems.length === 0 ? (
          <p className="px-2 py-4 text-caption text-nomi-ink-40">这个文件夹还没有可用素材</p>
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
