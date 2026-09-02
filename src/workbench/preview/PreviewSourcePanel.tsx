import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronLeft, IconMovie, IconPhoto } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignEmptyState } from '../../design'
import { lazyWithChunkBoundary } from '../../ui/chunkBoundary'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'
import { encodeTimelineGenerationNodeDragPayload, TIMELINE_GENERATION_NODE_DRAG_MIME } from '../timeline/timelineDragPayload'
import { addGenerationNodeToTimelineEnd } from '../timeline/addNodeToTimelineEnd'
import { useFilmstrip } from '../../media/useFilmstrip'
import { NomiImage } from '../../design/media'
import { selectCanvasShotSourcesFromStore, type CanvasShotSource } from './canvasShotSources'

const AssetLibraryContent = lazyWithChunkBoundary('i18n:sidebar.assetLibrary', () =>
  import('../assets/AssetLibraryPanel').then((module) => ({ default: module.AssetLibraryContent })),
)

/**
 * 剪辑页左侧素材来源栏（用户拍板方案 B 修正版）。
 *
 * 治的是：剪辑页两头够不着——够不着画布（生成的镜头）也够不着素材库（导入素材/配乐），
 * 而叠加层还写着「拖音频到此当配乐」这条无源提示。
 *
 * 两个来源、两种取法，都复用既有链路（时间轴那侧零改动）：
 *  - 「镜头」= 画布已出片节点，拖动发的是生成页节点把手同一条消息，点击=贴片尾。
 *  - 「素材」= 素材库本体（compact + includeAudio），拖拽 payload 它自带。
 * 可折叠：收起后播放器回全宽，兼顾审片。
 */
function ShotCover({ source }: { source: CanvasShotSource }): JSX.Element {
  // 视频缺封面时复用胶片条缓存取第 1 格（与素材库封面同一份缓存，不重复抽）
  const filmstrip = useFilmstrip(source.mediaType === 'video' && !source.thumbnailUrl ? source.url : '')
  const staticSrc = source.thumbnailUrl || (source.mediaType === 'image' ? source.url : '')
  if (staticSrc) {
    return <NomiImage className="absolute inset-0 h-full w-full object-cover" src={staticSrc} alt="" />
  }
  if (filmstrip?.status === 'ready') {
    return (
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${JSON.stringify(filmstrip.url)})`,
          backgroundSize: `${filmstrip.tiles * 100}% 100%`,
          backgroundPosition: 'left center',
          backgroundRepeat: 'no-repeat',
        }}
        aria-hidden="true"
      />
    )
  }
  return <div className="absolute inset-0 bg-nomi-ink-05" aria-hidden="true" />
}

function ShotGrid(): JSX.Element {
  const { t } = useTranslation()
  // 镜头栏按 result/shotIndex 派生已出片镜头；无号镜头（参考卡/首帧图/非分镜产物）按真实
  // position.y/x 排序 → 必须读真节点，不能喂位置无关投影（S3 F1：投影冻结旧位置 → 拖动后
  // 顺序不更新）。selectCanvasShotSourcesFromStore 读真 state.nodes 但按输出稳定 memo：位置无
  // 关的拖动帧产出同一列表引用 → 面板不重渲（保住 S3 画布外零重渲）；真发生重排才发新引用。
  const sources = useGenerationCanvasStore(selectCanvasShotSourcesFromStore)

  if (sources.length === 0) {
    return (
      <DesignEmptyState
        density="inline"
        icon={<IconMovie size={30} stroke={1.4} className="text-nomi-ink-30" />}
        title={t('previewSource.shots.emptyTitle')}
        description={t('previewSource.shots.emptyDescription')}
      />
    )
  }

  return (
    <div className="grid grid-cols-2 gap-1.5 p-2">
      {sources.map((source) => (
        <button
          key={source.nodeId}
          type="button"
          draggable
          // 走查靠 nodeId 定位这张卡：它的可见文字只有角标序号，名字只活在 aria-label/title 里，
          // 按文字找必然落空（拖拽腿曾因此从未真正跑到过）。按翻译串找又会随文案漂。
          data-testid="preview-source-shot"
          data-node-id={source.nodeId}
          className={cn(
            'group relative aspect-video overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05',
            'cursor-grab p-0 text-left active:cursor-grabbing',
            'hover:border-nomi-accent',
          )}
          title={t('previewSource.shots.itemHint', { name: source.label })}
          aria-label={t('previewSource.shots.itemHint', { name: source.label })}
          onDragStart={(event) => {
            const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === source.nodeId)
            if (!node) return
            event.dataTransfer.effectAllowed = 'copy'
            event.dataTransfer.setData(TIMELINE_GENERATION_NODE_DRAG_MIME, encodeTimelineGenerationNodeDragPayload(node))
          }}
          onClick={() => {
            const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === source.nodeId)
            if (node) void addGenerationNodeToTimelineEnd(node)
          }}
        >
          <ShotCover source={source} />
          {source.shotIndex != null ? (
            <span
              className={cn(
                'absolute left-1 top-1 rounded-nomi-sm px-1 py-px',
                'bg-[color-mix(in_oklch,var(--nomi-ink)_62%,transparent)] text-nomi-paper',
                'text-micro font-medium tabular-nums backdrop-blur-[6px]',
              )}
            >
              {source.shotIndex}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

export default function PreviewSourcePanel(): JSX.Element {
  const { t } = useTranslation()
  const collapsed = useWorkbenchStore((state) => state.previewSourcePanelCollapsed)
  const setCollapsed = useWorkbenchStore((state) => state.setPreviewSourcePanelCollapsed)
  const [tab, setTab] = React.useState<'shots' | 'assets'>('shots')
  const projectId = getActiveWorkbenchProjectId()

  if (collapsed) {
    // 收起态照抄侧栏 rail 的既定做法（2026-07-12 方案 A）：图标下带微字。
    // 只留一个箭头的话「一列孤图标认不出这是素材库」——那正是 rail 当初要治的毛病。
    return (
      <button
        type="button"
        className={cn(
          'workbench-preview-source workbench-preview-source--collapsed',
          'flex w-11 flex-none cursor-pointer flex-col items-center gap-0.5 border-0 border-r border-[var(--workbench-border)]',
          'bg-[var(--workbench-surface)] pt-2.5 text-[var(--workbench-muted)]',
          'transition-[color,background] duration-[var(--nomi-transition-fast)]',
          'hover:bg-nomi-ink-05 hover:text-[var(--workbench-ink)]',
        )}
        aria-label={t('previewSource.expand')}
        title={t('previewSource.expand')}
        onClick={() => setCollapsed(false)}
      >
        <IconPhoto size={17} stroke={1.7} aria-hidden="true" />
        <span className="text-micro leading-none">{t('previewSource.railLabel')}</span>
      </button>
    )
  }

  return (
    <aside
      className={cn(
        'workbench-preview-source',
        'flex w-[var(--workbench-preview-source-width)] flex-none flex-col overflow-hidden',
        'border-r border-[var(--workbench-border)] bg-[var(--workbench-surface)]',
      )}
      aria-label={t('previewSource.aria')}
    >
      <div className="flex flex-none border-b border-[var(--workbench-border)]" role="tablist" aria-label={t('previewSource.aria')}>
        {(['shots', 'assets'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn(
              'flex-1 cursor-pointer border-0 bg-transparent py-2 text-caption',
              'transition-[color,box-shadow] duration-[var(--nomi-transition-fast)]',
              tab === value
                ? 'font-semibold text-nomi-ink shadow-[inset_0_-1.5px_0_var(--workbench-accent)]'
                : 'text-nomi-ink-60 hover:text-nomi-ink',
            )}
            onClick={() => setTab(value)}
          >
            {t(value === 'shots' ? 'previewSource.tabs.shots' : 'previewSource.tabs.assets')}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tab === 'shots' ? (
          <ShotGrid />
        ) : (
          <React.Suspense fallback={null}>
            <AssetLibraryContent
              projectId={projectId}
              compact
              showHeader={false}
              includeAudio
              usageContext="timeline"
            />
          </React.Suspense>
        )}
      </div>

      <button
        type="button"
        className={cn(
          'flex flex-none cursor-pointer items-center gap-1 border-0 border-t border-[var(--workbench-border)]',
          'bg-transparent px-2.5 py-1.5 text-micro text-[var(--workbench-muted)] hover:text-[var(--workbench-ink)]',
        )}
        aria-label={t('previewSource.collapse')}
        onClick={() => setCollapsed(true)}
      >
        <IconChevronLeft size={13} stroke={1.8} aria-hidden="true" />
        {t('previewSource.collapse')}
      </button>
    </aside>
  )
}
