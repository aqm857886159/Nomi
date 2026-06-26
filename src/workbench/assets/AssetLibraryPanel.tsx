/**
 * 素材库面板（真实库）。
 *
 * 「素材库」从前只是个上传按钮（名不副实）。这里把它做成真正的库：
 * 右侧浮动抽屉，复用 useAssetPool（画布节点 + 项目文件去重合流，单一真相源），
 * 块复用 AssetThumb（形态自明：图=缩略图、视频=播放三角、音频=波形）。
 *
 * 挂载/关闭仿 OnboardingFloatingPanel：Mantine Portal 固定面板 + Escape / 点外关闭。
 * v1 范围：浏览 + 分段筛选 + 搜索 + 上传。拖到画布 / 删除留 v1.1（pool 合并源，删哪个源要单独想）。
 */
import React from 'react'
import { Portal } from '@mantine/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { IconPhoto, IconPlus, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { useAssetPool } from './useAssetPool'
import { filterAssets, type AssetKind, type AssetRef } from './assetTypes'
import { ASSET_LIBRARY_DRAG_MIME, serializeAssetLibraryDrag } from './assetLibraryDrag'
import { importAudioFilesToLibrary, isAudioFile } from './importAudioToLibrary'
import { AssetThumb } from './AssetTile'
import { DesignEmptyState, DesignSearchInput } from '../../design'

const GRID_COLS = 3
const ESTIMATED_ROW_HEIGHT = 121

const PANEL_WIDTH = 380
const TOP_OFFSET = 64
const RIGHT_OFFSET = 12

// 通配 + 显式扩展名一起列：macOS/Chromium 对纯 `video/*`/`audio/*` 通配常因 MIME 映射不到而把
// .mp4/.mov/.mp3 灰掉（MDN 推荐补显式扩展名）。覆盖素材库三类（图/视频/音频）的常见格式。
const UPLOAD_ACCEPT = [
  'image/*', 'video/*', 'audio/*',
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp4', '.mov', '.m4v', '.webm',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
].join(',')

type FilterValue = 'all' | AssetKind

const FILTER_OPTIONS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
]

const KIND_LABEL: Record<AssetKind, string> = {
  image: '图',
  video: '视频',
  audio: '音频',
}

// 单个素材格。memo 化：父组件（搜索/筛选/滚动）重渲时，未变的格子不重建（图多更省）。
const AssetGridCell = React.memo(function AssetGridCell({ asset }: { asset: AssetRef }): JSX.Element {
  // 三类都可拖：图片/视频 → 画布建素材节点；音频 → 时间轴音频轨（drop 端按 kind 各自处理）。
  const draggable = true
  const handleDragStart = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData(ASSET_LIBRARY_DRAG_MIME, serializeAssetLibraryDrag({
      kind: asset.kind,
      name: asset.name,
      renderUrl: asset.renderUrl,
      origin: asset.origin,
    }))
    event.dataTransfer.effectAllowed = 'copy'
  }, [asset.kind, asset.name, asset.renderUrl, asset.origin])
  const dragHint = asset.kind === 'audio' ? '拖到时间轴音频轨' : '拖到画布'
  return (
    <div
      draggable={draggable}
      onDragStart={handleDragStart}
      className={cn(
        'relative aspect-square rounded-nomi-sm border border-nomi-line overflow-hidden bg-nomi-ink-05',
        'flex items-center justify-center',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
      title={`${asset.name} · ${dragHint}`}
    >
      <AssetThumb asset={asset} />
      <span className={cn(
        'absolute top-1 left-1 px-1.5 py-px rounded-full text-micro leading-none',
        'bg-[oklch(0.2_0.01_80/0.55)] text-nomi-paper backdrop-blur-sm',
      )}>
        {KIND_LABEL[asset.kind]}
      </span>
      <span className={cn(
        'absolute left-0 right-0 bottom-0 px-1.5 pt-2.5 pb-1 text-micro text-nomi-paper',
        'bg-gradient-to-t from-[oklch(0_0_0/0.6)] to-transparent',
        'whitespace-nowrap overflow-hidden text-ellipsis',
      )}>
        {asset.name}
      </span>
    </div>
  )
})

type Props = {
  opened: boolean
  onClose: () => void
  projectId: string | null
}

export function AssetLibraryPanel({ opened, onClose, projectId }: Props): JSX.Element | null {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const uploadInputRef = React.useRef<HTMLInputElement>(null)
  const [filter, setFilter] = React.useState<FilterValue>('all')
  const [query, setQuery] = React.useState('')

  const { assets, refresh } = useAssetPool(projectId)

  const visible = React.useMemo(
    () => filterAssets(assets, { query, accept: filter === 'all' ? undefined : [filter] }),
    [assets, query, filter],
  )

  // 虚拟化：按行渲染，只挂当前视口内的格子（图多时不再一次性渲染上百个 DOM 节点）。
  //
  // 根因坑（实测定位）：滚动容器用 flex-1 取高度，面板刚打开时它高度还是 0，虚拟器此刻
  // 测到 scrollRect={0,0} → range=null → 一个格子都不挂；之后 flex 撑到 258px，但用对象
  // useRef 时「ref 挂载/尺寸变化不会触发 React 重渲」，虚拟器没机会重算，于是一直空白
  // （直到搜索等无关操作偶然触发重渲才恢复）。
  // 解法：滚动元素用「callback-ref 写进 state」——元素挂载那一刻就强制一次重渲，虚拟器
  // 立刻拿到带高度的元素重算。useState 的 setter 引用稳定，不会反复 detach/attach。
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null)
  const rowCount = Math.ceil(visible.length / GRID_COLS)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 3,
  })

  // ESC 关闭
  React.useEffect(() => {
    if (!opened) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, onClose])

  // 点击外部关闭（避开 Mantine 浮层 / 文件对话框）
  React.useEffect(() => {
    if (!opened) return
    const handler = (e: MouseEvent) => {
      if (!panelRef.current) return
      const target = e.target as Element | null
      if (!target) return
      if (panelRef.current.contains(target)) return
      if (target.closest(
        '.mantine-Modal-root, .mantine-Modal-overlay, .mantine-Modal-content,' +
        '.mantine-Drawer-root, .mantine-Drawer-overlay,' +
        '.mantine-Popover-dropdown, .mantine-Menu-dropdown, .mantine-Tooltip-tooltip,' +
        '[role="dialog"]'
      )) return
      onClose()
    }
    const id = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', handler)
    })
    return () => {
      window.cancelAnimationFrame(id)
      window.removeEventListener('mousedown', handler)
    }
  }, [opened, onClose])

  const handleUploadFiles = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const all = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    // 图/视频走画布节点导入（可拖到画布）；音频没有画布节点，落项目文件源进库（音频 tab）。
    const mediaFiles = all.filter((file) => (file.type || '').startsWith('image/') || (file.type || '').startsWith('video/'))
    const audioFiles = all.filter((file) => isAudioFile(file))
    if (mediaFiles.length) {
      void import('../generationCanvas/adapters/assetImportAdapter')
        .then(({ importLocalMediaFilesToGenerationCanvas }) => {
          void importLocalMediaFilesToGenerationCanvas(mediaFiles, { basePosition: { x: 120, y: 90 } })
        })
        .catch((error) => {
          console.error('asset library upload failed', error)
        })
    }
    if (audioFiles.length) {
      void importAudioFilesToLibrary(audioFiles, { projectId })
        .then(() => refresh())
        .catch((error) => {
          console.error('asset library audio upload failed', error)
        })
    }
  }, [projectId, refresh])

  if (!opened) return null

  const isEmpty = visible.length === 0

  return (
    <Portal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="素材库"
        className={cn(
          'fixed flex flex-col overflow-hidden',
          'bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-lg',
        )}
        style={{
          top: TOP_OFFSET,
          right: RIGHT_OFFSET,
          width: PANEL_WIDTH,
          maxHeight: `calc(100vh - ${TOP_OFFSET + 16}px)`,
          zIndex: 4000,
          animation: 'nomi-panel-pop 140ms cubic-bezier(.2, .7, .3, 1)',
        }}
      >
        {/* 头部 */}
        <div className={cn('flex items-center gap-2 px-4 pt-3.5 pb-3 border-b border-nomi-line')}>
          <b className={cn('text-title font-bold text-nomi-ink')}>素材库</b>
          <span className={cn('text-caption text-nomi-ink-40')}>· {assets.length}</span>
          <span className={cn('flex-1')} />
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-3 rounded-full cursor-pointer',
              'bg-nomi-ink text-nomi-paper text-caption font-semibold border-0',
              'transition-[background] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-80',
            )}
            aria-label="上传素材"
            onClick={() => uploadInputRef.current?.click()}
          >
            <IconPlus size={13} stroke={2} />
            上传
          </button>
          <button
            type="button"
            className={cn(
              'w-7 h-7 grid place-items-center rounded-nomi-sm cursor-pointer border-0 bg-transparent',
              'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05',
              'transition-[background,color] duration-[var(--nomi-transition-fast)]',
            )}
            aria-label="关闭素材库"
            onClick={onClose}
          >
            <IconX size={16} stroke={2} />
          </button>
          <input
            ref={uploadInputRef}
            className={cn('absolute w-px h-px overflow-hidden opacity-0 pointer-events-none')}
            type="file"
            accept={UPLOAD_ACCEPT}
            multiple
            aria-label="素材文件选择器"
            onChange={handleUploadFiles}
          />
        </div>

        {/* 工具行：筛选 + 搜索 */}
        <div className={cn('flex items-center gap-2 px-3 py-2.5')}>
          <div className={cn('shrink-0 inline-flex bg-nomi-ink-05 rounded-full p-0.5')} role="tablist" aria-label="素材类型筛选">
            {FILTER_OPTIONS.map((option) => {
              const active = filter === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-caption cursor-pointer border-0 bg-transparent whitespace-nowrap',
                    'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                    active
                      ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm'
                      : 'text-nomi-ink-60 hover:text-nomi-ink',
                  )}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <DesignSearchInput className="flex-1" placeholder="搜索素材…" ariaLabel="搜索素材" value={query} onChange={setQuery} />
        </div>

        {/* 网格 / 空态 */}
        <div ref={setScrollEl} className={cn('flex-1 overflow-y-auto px-3.5 pb-4')}>
          {isEmpty ? (
            <DesignEmptyState
              density="inline"
              icon={<IconPhoto size={34} stroke={1.4} className="text-nomi-ink-30" />}
              title={assets.length === 0 ? '还没有素材' : '没有匹配的素材'}
              description={
                assets.length === 0
                  ? '点「上传」导入图片、视频或音频，或在生成区生成后会自动出现在这里。'
                  : '换个筛选或搜索词试试。'
              }
            />
          ) : (
            <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const start = virtualRow.index * GRID_COLS
                const rowAssets = visible.slice(start, start + GRID_COLS)
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    className={cn('grid grid-cols-3 gap-2.5 pb-2.5')}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {rowAssets.map((asset) => (
                      <AssetGridCell key={asset.id} asset={asset} />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <style>{`
          @keyframes nomi-panel-pop {
            from { opacity: 0; transform: translateY(-4px) scale(0.985); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </Portal>
  )
}
