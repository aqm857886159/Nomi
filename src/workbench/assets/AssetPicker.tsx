import React from 'react'
import { IconSearch, IconUpload } from '@tabler/icons-react'
import { NomiLoadingMark } from '../../design'
import { cn } from '../../utils/cn'
import { AssetThumb } from './AssetTile'
import { useAssetPool } from './useAssetPool'
import { filterAssets, type AssetKind, type AssetRef } from './assetTypes'

// 统一选择器(P0.3,样张 v4 态④)。定位 = **快速取**(搜索 + 最近),不是全量浏览器。
// 三来源一套:画布行 + 项目素材最近网格(可滚) + 上传;另说明拖入/连线两条画布捷径。
// 想翻全部 → 「浏览全部」去素材面板。消费 useAssetPool(一处真相源),不自存素材。

type AssetPickerProps = {
  projectId: string | null
  /** 限定可选种类(如单图槽传 ['image']);不传 = 图/视频/音频都可。 */
  accept?: AssetKind[]
  onPick: (asset: AssetRef) => void
  onUpload: (file: File) => void
  /** 传了才显示「浏览全部 →」(去素材面板)。 */
  onBrowseAll?: () => void
  /** 已到上限的类型:这些类型的项灰显(点击仍由 onPick→handleArrayAdd 出「最多 N 个」toast)。 */
  atLimitKinds?: AssetKind[]
  uploading?: boolean
  className?: string
}

const ACCEPT_ATTR: Record<AssetKind, string> = { image: 'image/*', video: 'video/*', audio: 'audio/*' }

function PickerItem({ asset, onPick, dimmed }: { asset: AssetRef; onPick: (asset: AssetRef) => void; dimmed?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      aria-label={asset.name}
      onClick={() => onPick(asset)}
      title={dimmed ? '已到该类型上限' : undefined}
      className={cn(
        'relative w-12 h-12 rounded-nomi-sm overflow-hidden border border-nomi-line bg-nomi-ink-05 flex items-center justify-center cursor-pointer hover:outline hover:outline-2 hover:outline-offset-1 hover:outline-nomi-accent',
        dimmed && 'opacity-40',
      )}
    >
      <AssetThumb asset={asset} playSize={18} />
    </button>
  )
}

export default function AssetPicker({ projectId, accept, onPick, onUpload, onBrowseAll, atLimitKinds, uploading, className }: AssetPickerProps): JSX.Element {
  const isDimmed = (kind: AssetKind) => Boolean(atLimitKinds?.includes(kind))
  const { assets, loading } = useAssetPool(projectId)
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => filterAssets(assets, { query, accept }), [assets, query, accept])
  const canvasAssets = filtered.filter((a) => a.source === 'canvas')
  const projectAssets = filtered.filter((a) => a.source === 'project')

  const acceptAttr = (accept && accept.length ? accept : (['image', 'video', 'audio'] as AssetKind[]))
    .map((kind) => ACCEPT_ATTR[kind])
    .join(',')

  return (
    <div
      data-testid="asset-picker"
      className={cn('flex flex-col gap-[10px] w-[300px] max-w-[300px] max-h-[70vh] overflow-y-auto p-[10px] rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md', className)}
      // picker 自己接管拖入：否则 drop 冒泡到画布 stage → importLocalMediaFilesToGenerationCanvas 另建独立节点，
      // 而不是填进当前节点的输入槽（提示语已写「或把文件拖进来」却无 onDrop = bug）。
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation() }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const file = event.dataTransfer.files?.[0]
        if (file) onUpload(file)
      }}
    >
      <label className={cn('flex items-center gap-[6px] h-[30px] px-[8px] rounded-nomi-sm border border-nomi-line bg-nomi-ink-05')}>
        <IconSearch size={13} stroke={2} className={cn('text-nomi-ink-40 shrink-0')} />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索素材名…"
          aria-label="搜索素材名"
          className={cn('flex-1 min-w-0 bg-transparent border-0 outline-none text-xs text-nomi-ink placeholder:text-nomi-ink-40')}
        />
      </label>

      {canvasAssets.length ? (
        <div className={cn('flex flex-col gap-[6px]')}>
          <span className={cn('text-nomi-ink-40 text-micro')}>画布</span>
          {/* 画布:单行横滚(样张 .pkRow),不换行——否则几十张图堆叠把 picker 撑到溢出视口 */}
          <div className={cn('flex gap-[6px] overflow-x-auto pb-[2px]')}>
            {canvasAssets.map((asset) => <div key={asset.id} className={cn('shrink-0')}><PickerItem asset={asset} onPick={onPick} dimmed={isDimmed(asset.kind)} /></div>)}
          </div>
        </div>
      ) : null}

      {projectAssets.length ? (
        <div className={cn('flex flex-col gap-[6px]')}>
          <div className={cn('flex items-baseline justify-between')}>
            <span className={cn('text-nomi-ink-40 text-micro')}>项目素材 · 最近</span>
            {onBrowseAll ? (
              <button type="button" onClick={onBrowseAll} className={cn('text-nomi-accent text-micro cursor-pointer')}>浏览全部 →</button>
            ) : null}
          </div>
          <div className={cn('grid grid-cols-[repeat(5,48px)] gap-[6px] max-h-[108px] overflow-auto pb-[2px]')}>
            {projectAssets.map((asset) => <PickerItem key={asset.id} asset={asset} onPick={onPick} dimmed={isDimmed(asset.kind)} />)}
          </div>
        </div>
      ) : null}

      {/* pending 规范 #3:素材异步加载期给 skeleton,不再直接显示空态文字「还没有素材」 */}
      {loading && !canvasAssets.length && !projectAssets.length ? (
        <div className={cn('grid grid-cols-[repeat(5,48px)] gap-[6px] py-[6px]')} aria-label="素材加载中">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className={cn('size-12 rounded-nomi-sm bg-nomi-ink-10 animate-pulse motion-reduce:animate-none')} />
          ))}
        </div>
      ) : !canvasAssets.length && !projectAssets.length ? (
        <div className={cn('text-nomi-ink-40 text-micro text-center py-[6px]')}>
          {query ? '没有匹配的素材' : '还没有素材,上传或拖入开始'}
        </div>
      ) : null}

      <label className={cn('relative flex items-center justify-center gap-[6px] h-[34px] rounded-nomi-sm border border-dashed border-nomi-ink-20 bg-nomi-paper text-nomi-ink-60 text-xs cursor-pointer hover:border-nomi-accent hover:text-nomi-accent')}>
        {/* pending 规范 #1:上传中统一品牌转圈(对齐 AttachmentRail),不再纯文字 */}
        {uploading ? <NomiLoadingMark size={15} label="上传中" /> : <IconUpload size={15} stroke={2} />}
        {uploading ? '上传中…' : '上传本地文件'}
        <input
          type="file"
          accept={acceptAttr}
          aria-label="上传本地文件"
          disabled={uploading}
          className={cn('absolute w-px h-px opacity-0 overflow-hidden')}
          onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onUpload(file); event.currentTarget.value = '' }}
        />
      </label>

      <div className={cn('text-nomi-ink-40 text-micro text-center')}>或把文件拖进来 · 从卡片拉条线 · 从素材面板拖到节点</div>
    </div>
  )
}
