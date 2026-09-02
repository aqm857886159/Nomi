import React from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'
import { AssetThumb } from './AssetTile'
import type { AssetKind, AssetRef } from './assetTypes'

// @ 内联媒体引用 chip 的 nodeview 组件:句中一个 18px 缩略图(样张 v4 .atChip)。
// 单独成文件,让 AssetMentionNode 只导出 Tiptap Node(非组件)——避免 react-refresh/only-export-components 警告。
export default function AssetMentionChip({ node }: NodeViewProps): JSX.Element {
  const { t } = useTranslation()
  const url = String(node.attrs.url || '')
  const index = Number(node.attrs.index)
  const kind: AssetKind = node.attrs.kind === 'video' ? 'video' : node.attrs.kind === 'audio' ? 'audio' : 'image'
  const indexedKey = kind === 'video'
    ? 'assetLibrary.referenceVideoIndexed'
    : kind === 'audio'
      ? 'assetLibrary.referenceAudioIndexed'
      : 'assetLibrary.referenceImageIndexed'
  const fallbackKey = kind === 'video'
    ? 'assetLibrary.referenceVideo'
    : kind === 'audio'
      ? 'assetLibrary.referenceAudio'
      : 'assetLibrary.referenceImage'
  const label = Number.isInteger(index) && index > 0 ? t(indexedKey, { index }) : t(fallbackKey)
  const asset: AssetRef = {
    id: url,
    kind,
    name: label,
    renderUrl: url,
    source: 'project',
    origin: { source: 'project', projectId: '', relativePath: '' },
  }
  const [hoverPreview, setHoverPreview] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)
  const onEnter = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setHoverPreview(true), 280)
  }
  const onLeave = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    setHoverPreview(false)
  }
  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])
  return (
    <NodeViewWrapper
      as="span"
      data-asset-mention=""
      data-storyboard-mention-chip="true"
      aria-label={label}
      className={cn('inline-flex align-[-5px] h-[22px] items-center gap-[4px] mx-[2px] pr-[6px] rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 overflow-hidden cursor-pointer hover:outline hover:outline-2 hover:outline-offset-1 hover:outline-nomi-accent')}
      contentEditable={false}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onDoubleClick={() => window.dispatchEvent(new CustomEvent('nomi:asset-mention-preview', { detail: { url, kind, label } }))}
    >
      <span className={cn('relative w-[22px] h-[22px] overflow-hidden bg-nomi-ink-05 shrink-0 flex items-center justify-center')} aria-hidden>
        <AssetThumb asset={asset} playSize={10} />
      </span>
      <span className={cn('text-micro font-medium leading-none text-nomi-ink-70 whitespace-nowrap')}>{label}</span>
      {hoverPreview ? (
        <span className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 w-40 overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1 shadow-nomi-md">
          <AssetThumb asset={asset} playSize={12} />
        </span>
      ) : null}
    </NodeViewWrapper>
  )
}
