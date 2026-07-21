import React from 'react'
import { useTranslation } from 'react-i18next'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { cn } from '../../utils/cn'

// @ 内联引用 chip 的 nodeview 组件:句中一个 18px 缩略图(样张 v4 .atChip)。
// 单独成文件,让 AssetMentionNode 只导出 Tiptap Node(非组件)——避免 react-refresh/only-export-components 警告。
export default function AssetMentionChip({ node }: NodeViewProps): JSX.Element {
  const { t } = useTranslation()
  const url = String(node.attrs.url || '')
  const index = Number(node.attrs.index)
  const label = Number.isInteger(index) && index > 0
    ? t('assetLibrary.referenceImageIndexed', { index })
    : t('assetLibrary.referenceImage')
  return (
    <NodeViewWrapper
      as="span"
      data-asset-mention=""
      aria-label={label}
      className={cn('inline-flex align-[-5px] h-[22px] items-center gap-[4px] mx-[2px] pr-[6px] rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 overflow-hidden cursor-pointer hover:outline hover:outline-2 hover:outline-offset-1 hover:outline-nomi-accent')}
      contentEditable={false}
    >
      <img src={url} alt="" draggable={false} className={cn('w-[22px] h-[22px] object-cover select-none shrink-0')} />
      <span className={cn('text-micro font-medium leading-none text-nomi-ink-70 whitespace-nowrap')}>{label}</span>
    </NodeViewWrapper>
  )
}
