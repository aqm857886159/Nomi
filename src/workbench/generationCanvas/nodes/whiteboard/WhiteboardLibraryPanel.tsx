import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconEye, IconEyeOff, IconPhoto, IconTrash } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import type { CanvasObjectTarget } from './WhiteboardLeaferCanvas'
import type { WhiteboardResultLibraryItem } from './whiteboardTypes'
import type { AssetPanelItem, LibraryDragPayload } from './whiteboardStateOps'

export type WhiteboardLibraryTabKey = 'board' | 'results'

type WhiteboardLibraryPanelProps = {
  activeObject: CanvasObjectTarget | null
  activeTab: WhiteboardLibraryTabKey
  assetPanelItems: AssetPanelItem[]
  boardLibraryItemCount: number
  canvasImageItems: WhiteboardResultLibraryItem[]
  resultItems: WhiteboardResultLibraryItem[]
  onActiveTabChange: (tab: WhiteboardLibraryTabKey) => void
  onAssetDragEnd: () => void
  onAssetDragStart: (event: React.DragEvent<HTMLElement>, payload: LibraryDragPayload) => void
  onDeleteTarget: (target: CanvasObjectTarget) => void
  onSelectAsset: (item: AssetPanelItem) => void
  onToggleLayerVisibility: (layerId: string) => void
}

function LibraryResultCard({
  item,
  onAssetDragEnd,
  onAssetDragStart,
}: {
  item: WhiteboardResultLibraryItem
  onAssetDragEnd: () => void
  onAssetDragStart: (event: React.DragEvent<HTMLElement>, payload: LibraryDragPayload) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      draggable
      className="group overflow-hidden rounded-nomi-sm border border-nomi-line-soft bg-nomi-paper text-caption text-nomi-ink-80 shadow-nomi-sm cursor-grab hover:border-nomi-line hover:bg-nomi-ink-05 active:cursor-grabbing"
      title={t('generationCommon.whiteboard.library.dragResult')}
      onDragStart={(event) => onAssetDragStart(event, { source: 'result', itemId: item.id })}
      onDragEnd={onAssetDragEnd}
    >
      <span className="block aspect-[4/3] overflow-hidden bg-nomi-ink-05">
        <img className="h-full w-full object-cover" src={item.url} alt="" draggable={false} />
      </span>
      <span className="block min-w-0 truncate px-1.5 py-1 text-micro">{item.name}</span>
    </div>
  )
}

export function WhiteboardLibraryPanel({
  activeObject,
  activeTab,
  assetPanelItems,
  boardLibraryItemCount,
  canvasImageItems,
  resultItems,
  onActiveTabChange,
  onAssetDragEnd,
  onAssetDragStart,
  onDeleteTarget,
  onSelectAsset,
  onToggleLayerVisibility,
}: WhiteboardLibraryPanelProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <aside
      className="flex h-full min-h-0 min-w-[320px] shrink-0 flex-col overflow-hidden bg-nomi-paper"
      style={{ flexBasis: 'clamp(340px, 28vw, 500px)' }}
    >
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-nomi-line-soft px-3 text-body-sm font-medium text-nomi-ink">
          <IconPhoto size={16} stroke={1.7} className="shrink-0 text-nomi-ink-40" />
          <span className="min-w-0 flex-1 truncate">{t('generationCommon.whiteboard.library.title')}</span>
          <div className="ml-auto inline-flex shrink-0 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 p-0.5">
            {[
              {
                key: 'board' as const,
                label: t('generationCommon.whiteboard.library.board'),
                count: boardLibraryItemCount,
              },
              {
                key: 'results' as const,
                label: t('generationCommon.whiteboard.library.results'),
                count: resultItems.length,
              },
            ].map((tab) => {
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-nomi-sm px-2 text-caption transition-colors',
                    active
                      ? 'bg-nomi-paper font-medium text-nomi-ink shadow-nomi-sm'
                      : 'text-nomi-ink-60 hover:text-nomi-ink',
                  )}
                  aria-pressed={active}
                  onClick={() => onActiveTabChange(tab.key)}
                >
                  <span>{tab.label}</span>
                  <span className="text-micro text-nomi-ink-40">{tab.count}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid min-h-0 content-start gap-2 overflow-y-auto p-2.5">
          {activeTab === 'board' && boardLibraryItemCount === 0 ? (
            <div className="grid min-h-[120px] place-items-center rounded-nomi border border-dashed border-nomi-line px-3 text-center text-caption text-nomi-ink-40">
              {t('generationCommon.whiteboard.library.emptyBoard')}
            </div>
          ) : null}
          {activeTab === 'results' && resultItems.length === 0 ? (
            <div className="grid min-h-[120px] place-items-center rounded-nomi border border-dashed border-nomi-line px-3 text-center text-caption text-nomi-ink-40">
              {t('generationCommon.whiteboard.library.emptyResults')}
            </div>
          ) : null}
          {activeTab === 'board' && boardLibraryItemCount > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {assetPanelItems.map((item) => {
                const active = activeObject?.kind === 'asset' && activeObject.id === item.target.id
                return (
                  <div
                    key={item.id}
                    draggable
                    className={cn(
                      'group overflow-hidden rounded-nomi-sm border bg-nomi-paper text-caption shadow-nomi-sm',
                      'cursor-grab active:cursor-grabbing',
                      active
                        ? 'border-nomi-accent bg-nomi-accent-soft text-nomi-accent'
                        : 'border-nomi-line-soft text-nomi-ink-80 hover:border-nomi-line hover:bg-nomi-ink-05',
                    )}
                    title={t('generationCommon.whiteboard.library.dragBoard')}
                    onDragStart={(event) => onAssetDragStart(event, { source: 'board', assetId: item.target.id })}
                    onDragEnd={onAssetDragEnd}
                  >
                    <button
                      type="button"
                      className="block w-full bg-transparent text-left text-inherit"
                      onClick={() => onSelectAsset(item)}
                    >
                      <span className="block aspect-[4/3] overflow-hidden bg-nomi-ink-05">
                        <img
                          className={cn('h-full w-full object-cover', !item.visible && 'opacity-35 grayscale')}
                          src={item.url}
                          alt=""
                          draggable={false}
                        />
                      </span>
                      <span className="block min-w-0 truncate px-1.5 py-1 text-micro">{item.name}</span>
                    </button>
                    <div className="flex items-center justify-between border-t border-nomi-line-soft px-1 py-0.5">
                      <button
                        type="button"
                        className="grid size-6 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-paper hover:text-nomi-ink"
                        aria-label={t(
                          item.visible
                            ? 'generationCommon.whiteboard.library.hide'
                            : 'generationCommon.whiteboard.library.show',
                          { name: item.name },
                        )}
                        onClick={() => onToggleLayerVisibility(item.layerId)}
                      >
                        {item.visible ? <IconEye size={13} stroke={1.7} /> : <IconEyeOff size={13} stroke={1.7} />}
                      </button>
                      <span className="min-w-0 truncate px-1 text-micro text-nomi-ink-40">
                        {item.width} × {item.height}
                      </span>
                      <button
                        type="button"
                        className="grid size-6 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-workbench-danger-soft hover:text-workbench-danger disabled:opacity-30"
                        disabled={item.locked}
                        aria-label={t('generationCommon.whiteboard.library.delete', { name: item.name })}
                        onClick={() => onDeleteTarget(item.target)}
                      >
                        <IconTrash size={12} stroke={1.7} />
                      </button>
                    </div>
                  </div>
                )
              })}
              {canvasImageItems.map((item) => (
                <LibraryResultCard
                  key={item.id}
                  item={item}
                  onAssetDragEnd={onAssetDragEnd}
                  onAssetDragStart={onAssetDragStart}
                />
              ))}
            </div>
          ) : null}
          {activeTab === 'results' && resultItems.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {resultItems.map((item) => (
                <LibraryResultCard
                  key={item.id}
                  item={item}
                  onAssetDragEnd={onAssetDragEnd}
                  onAssetDragStart={onAssetDragStart}
                />
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </aside>
  )
}
