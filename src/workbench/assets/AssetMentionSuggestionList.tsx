import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../utils/cn'

// @ suggestion 下拉(样张 v4 态②.atPicker):列出当前可引用的 image 参考缩略图,选一个插入 chip。
// 键盘:↑↓←→ 移动、Enter 选、Esc 关(Esc 在扩展层处理)。空态:无参考时显「先加参考图」(规范 §4)。

export type MentionSuggestionItem = { url: string; index: number } // index = 在有序参考图列表里的 0-based 位置

export type MentionSuggestionListRef = { onKeyDown: (args: { event: KeyboardEvent }) => boolean }

type Props = { items: MentionSuggestionItem[]; command: (item: MentionSuggestionItem) => void }

const AssetMentionSuggestionList = React.forwardRef<MentionSuggestionListRef, Props>(({ items, command }, ref) => {
  const { t } = useTranslation()
  const [selected, setSelected] = React.useState(0)
  React.useEffect(() => { setSelected(0) }, [items])

  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { setSelected((s) => (s + 1) % items.length); return true }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { setSelected((s) => (s - 1 + items.length) % items.length); return true }
      if (event.key === 'Enter') { const it = items[selected]; if (it) command(it); return true }
      return false
    },
  }), [items, selected, command])

  if (!items.length) {
    return (
      <div className={cn('inline-flex items-center px-[8px] h-[30px] rounded-nomi-sm border border-nomi-line bg-nomi-paper shadow-nomi-sm text-nomi-ink-40 text-micro')}>
        {t('assetLibrary.mentionEmpty')}
      </div>
    )
  }
  return (
    <div
      className={cn('flex flex-wrap items-center gap-[6px] p-[6px] rounded-nomi-sm border border-nomi-line bg-nomi-paper shadow-nomi-sm')}
      style={{ maxWidth: 'min(520px, calc(100vw - 16px))' }}
    >
      <span className={cn('text-nomi-ink-40 text-micro px-[2px]')}>{t('assetLibrary.mentionLabel')}</span>
      {items.map((item, i) => (
        <button
          key={item.url}
          type="button"
          aria-label={t('assetLibrary.insertImageIndexed', { index: item.index + 1 })}
          onMouseEnter={() => setSelected(i)}
          onClick={() => command(item)}
          className={cn(
            'relative inline-flex h-[34px] items-center gap-[5px] rounded-nomi-sm overflow-hidden border border-nomi-line bg-nomi-paper pr-[7px] cursor-pointer',
            i === selected && 'outline outline-2 outline-offset-1 outline-nomi-accent',
          )}
        >
          <img src={item.url} alt="" draggable={false} className={cn('w-[34px] h-[34px] object-cover select-none shrink-0')} />
          <span className={cn('text-micro font-medium leading-none text-nomi-ink-70 whitespace-nowrap')}>{t('assetLibrary.referenceImageIndexed', { index: item.index + 1 })}</span>
        </button>
      ))}
    </div>
  )
})
AssetMentionSuggestionList.displayName = 'AssetMentionSuggestionList'

export default AssetMentionSuggestionList
