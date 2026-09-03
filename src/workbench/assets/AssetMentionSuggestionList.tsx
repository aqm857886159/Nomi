import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlugConnected } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { AssetThumb } from './AssetTile'
import type { AssetKind, AssetRef } from './assetTypes'

// @ suggestion 下拉：列出可引用的媒体，按来源分组，打字即过滤。
// 键盘：↑↓ 移动、Enter 选、Esc 关（Esc 在扩展层处理）。
//
// 「当前参考」以外的两组选中后**会真的建立引用**（画布→建一条真边；素材库→落进上传参考槽），
// 不是只在文本里留一句话——右侧那个「连上」角标就是在提前说清这件事（见 nodes/mentionCandidates.ts）。

export type MentionSuggestionItem = {
  key: string
  url: string
  label: string
  kind?: 'image' | 'video' | 'audio'
  group: 'current' | 'canvas' | 'library' | 'upload'
  index?: number
  /** 分镜候选可把 canvas owner 的结果单独标成「某镜结果」，不复制 group 语义。 */
  groupLabelKey?: string
}

export type MentionSuggestionListRef = { onKeyDown: (args: { event: KeyboardEvent }) => boolean }

export type MentionUploadControls = { openFilePicker: () => void; inputRef: React.RefObject<HTMLInputElement>; onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void; isDragging: boolean }
type Props = { items: MentionSuggestionItem[]; command: (item: MentionSuggestionItem) => void; upload?: MentionUploadControls }

function displayAsset(url: string, kind: AssetKind, name: string): AssetRef {
  return {
    id: url,
    kind,
    name,
    renderUrl: url,
    source: 'project',
    origin: { source: 'project', projectId: '', relativePath: '' },
  }
}

const GROUP_LABEL_KEY: Record<MentionSuggestionItem['group'], string> = {
  current: 'assetLibrary.mentionGroupCurrent',
  canvas: 'assetLibrary.mentionGroupCanvas',
  library: 'assetLibrary.mentionGroupLibrary',
  upload: 'assetLibrary.mentionGroupUpload',
}

const AssetMentionSuggestionList = React.forwardRef<MentionSuggestionListRef, Props>(({ items, command, upload }, ref) => {
  const { t } = useTranslation()
  const [selected, setSelected] = React.useState(0)
  React.useEffect(() => { setSelected(0) }, [items])

  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === 'ArrowDown') { setSelected((s) => (s + 1) % items.length); return true }
      if (event.key === 'ArrowUp') { setSelected((s) => (s - 1 + items.length) % items.length); return true }
      if (event.key === 'Enter') { const it = items[selected]; if (it) command(it); return true }
      return false
    },
  }), [items, selected, command])

  if (!items.length && !upload) {
    return (
      <div className={cn('inline-flex items-center px-[8px] h-[30px] rounded-nomi-sm border border-nomi-line bg-nomi-paper shadow-nomi-sm text-nomi-ink-40 text-micro')}>
        {t('assetLibrary.mentionEmpty')}
      </div>
    )
  }

  let lastGroup: MentionSuggestionItem['group'] | null = null
  return (
    <div
      className={cn('flex flex-col gap-[1px] p-[5px] rounded-nomi-sm border border-nomi-line bg-nomi-paper shadow-nomi-sm overflow-y-auto')}
      style={{ width: 'min(320px, calc(100vw - 16px))', maxHeight: 'min(320px, 60vh)' }}
      data-mention-list="true"
    >
      {items.map((item, i) => {
        const showHeader = item.group !== lastGroup
        lastGroup = item.group
        return (
          <React.Fragment key={item.key}>
            {showHeader ? (
              <div className={cn('px-[6px] pt-[6px] pb-[2px] text-micro text-nomi-ink-40')}>
                {t(item.groupLabelKey ?? GROUP_LABEL_KEY[item.group])}
              </div>
            ) : null}
            <button
              type="button"
              data-mention-item={item.key}
              data-mention-group={item.group}
              data-mention-kind={item.kind ?? 'image'}
              aria-label={item.label}
              onMouseEnter={() => setSelected(i)}
              onClick={() => command(item)}
              className={cn(
                'flex w-full items-center gap-[8px] rounded-nomi-sm border-0 bg-transparent px-[6px] py-[4px] text-left cursor-pointer',
                'transition-colors duration-[var(--nomi-transition-fast)]',
                i === selected ? 'bg-nomi-accent-soft' : 'hover:bg-nomi-ink-05',
              )}
            >
              <span className={cn('relative size-[26px] shrink-0 select-none overflow-hidden rounded-nomi-sm bg-nomi-ink-05 flex items-center justify-center')} aria-hidden>
                <AssetThumb asset={displayAsset(item.url, item.kind ?? 'image', item.label)} playSize={12} />
              </span>
              <span className={cn('min-w-0 flex-1 truncate text-micro leading-none text-nomi-ink-80')}>{item.label}</span>
              {item.group === 'current' ? (
                <span className={cn('shrink-0 rounded-nomi-sm bg-nomi-accent-soft px-[5px] py-[2px] text-micro text-nomi-accent')}>
                  {(item.kind ?? 'image') === 'image'
                    ? t('assetLibrary.referenceImageIndexed', { index: (item.index ?? 0) + 1 })
                    : item.kind === 'video'
                      ? t('assetLibrary.referenceVideoIndexed', { index: (item.index ?? 0) + 1 })
                      : t('assetLibrary.referenceAudioIndexed', { index: (item.index ?? 0) + 1 })}
                </span>
              ) : (
                <span className={cn('inline-flex shrink-0 items-center gap-[3px] rounded-nomi-sm bg-nomi-ink-05 px-[5px] py-[2px] text-micro text-nomi-ink-60')}>
                  <IconPlugConnected size={11} stroke={1.8} aria-hidden />
                  {t('assetLibrary.mentionWillConnect')}
                </span>
              )}
            </button>
          </React.Fragment>
        )
      })}
      {upload ? (
        <div className={cn('mt-[4px] border-t border-nomi-line pt-[5px]')}>
          <button
            type="button"
            onClick={upload.openFilePicker}
            className={cn('w-full rounded-nomi-sm border border-dashed border-nomi-ink-20 px-[6px] py-[5px] text-left text-micro text-nomi-ink-60 hover:border-nomi-accent hover:text-nomi-accent')}
          >
            {upload.isDragging ? t('assetLibrary.mentionDropUpload') : t('assetLibrary.mentionUpload')}
          </button>
          <input ref={upload.inputRef} type="file" accept="image/*,video/*,audio/*" onChange={upload.onInputChange} className="sr-only" />
        </div>
      ) : null}
    </div>
  )
})
AssetMentionSuggestionList.displayName = 'AssetMentionSuggestionList'

export default AssetMentionSuggestionList
