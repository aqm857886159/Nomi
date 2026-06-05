import React from 'react'
import { cn } from '../../../../utils/cn'
import { WorkbenchButton } from '../../../../design'
import type { ArchetypeArraySlot } from './archetypeMeta'

// 全能参考的**数组**参考槽 UI（C3，样张 v3）。每组：组头（标签 + 共享说明）→ 已加的缩略图 chip
// （角色图带 ①②③ 数字徽标 = prompt 的 character1..9，U2）→「+ 添加」。meta-only（不走画布边，M6）。
// 角色图「+ 添加」展开一个小菜单（上传本地 / 选画布里已有的图）；视频/音频直接文件上传。

export type ArrayCandidate = { id: string; title: string; url: string }

type ReferenceSlotsProps = {
  slots: ArchetypeArraySlot[]
  valuesByKey: Record<string, string[]>
  candidates: ArrayCandidate[]
  openKey: string
  uploadingKey: string
  onToggleMenu: (metaKey: string) => void
  onPickNode: (metaKey: string, url: string) => void
  onUpload: (slot: ArchetypeArraySlot, file: File | null | undefined) => void
  onRemove: (metaKey: string, index: number) => void
}

const ACCEPT_ATTR: Record<ArchetypeArraySlot['accept'], string> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
}
const ACCEPT_ICON: Record<ArchetypeArraySlot['accept'], string> = { image: '🖼', video: '🎬', audio: '🔊' }

export default function ReferenceSlots({
  slots, valuesByKey, candidates, openKey, uploadingKey,
  onToggleMenu, onPickNode, onUpload, onRemove,
}: ReferenceSlotsProps): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-[8px]')}>
      {slots.map((slot) => {
        const items = valuesByKey[slot.metaKey] || []
        const canAdd = items.length < slot.max
        const isOpen = openKey === slot.metaKey
        return (
          <div key={slot.metaKey} className={cn('flex flex-col gap-[4px]')}>
            <div className={cn('flex items-baseline gap-[8px]')}>
              <span className={cn('text-nomi-ink-60 text-[11px] leading-none')}>{slot.label}</span>
              {slot.caption ? <span className={cn('text-nomi-ink-40 text-[10px] leading-none')}>{slot.caption}</span> : null}
            </div>
            <div className={cn('relative flex flex-wrap items-center gap-[6px]')}>
              {items.map((url, index) => (
                <div key={`${url}-${index}`} className={cn('relative w-9 h-9 rounded-[5px] border border-nomi-line bg-nomi-ink-05 overflow-hidden flex items-center justify-center')}>
                  {slot.accept === 'image'
                    ? <img className={cn('w-full h-full object-cover')} src={url} alt={`${slot.label}${index + 1}`} />
                    : <span className={cn('text-[15px] leading-none select-none')}>{ACCEPT_ICON[slot.accept]}</span>}
                  {slot.numbered ? (
                    <span className={cn('absolute -top-[5px] -left-[5px] min-w-[15px] h-[15px] px-[3px] rounded-full bg-nomi-accent text-nomi-paper text-[10px] font-semibold flex items-center justify-center leading-none')}>{index + 1}</span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`移除${slot.label}${index + 1}`}
                    className={cn('absolute -top-[5px] -right-[5px] w-[15px] h-[15px] rounded-full bg-nomi-paper border border-nomi-line text-nomi-ink-60 text-[10px] leading-none flex items-center justify-center cursor-pointer')}
                    onClick={(event) => { event.stopPropagation(); onRemove(slot.metaKey, index) }}
                  >×</button>
                </div>
              ))}
              {canAdd ? (
                slot.accept === 'image' ? (
                  <WorkbenchButton
                    className={cn('h-7 px-[10px] rounded-full border border-dashed border-nomi-ink-20 bg-nomi-paper text-nomi-ink-60 text-[11px] inline-flex items-center gap-1 cursor-pointer hover:border-nomi-accent hover:text-nomi-accent')}
                    aria-label={`添加${slot.label}`}
                    onClick={() => onToggleMenu(slot.metaKey)}
                  >＋ {slot.label}</WorkbenchButton>
                ) : (
                  <label className={cn('h-7 px-[10px] rounded-full border border-dashed border-nomi-ink-20 bg-nomi-paper text-nomi-ink-60 text-[11px] inline-flex items-center gap-1 cursor-pointer hover:border-nomi-accent hover:text-nomi-accent')}>
                    {uploadingKey === slot.metaKey ? '上传中…' : `＋ ${slot.label}`}
                    <input
                      className={cn('absolute w-px h-px opacity-0 overflow-hidden')}
                      type="file"
                      accept={ACCEPT_ATTR[slot.accept]}
                      aria-label={`上传${slot.label}`}
                      disabled={Boolean(uploadingKey)}
                      onChange={(event) => { const f = event.currentTarget.files?.[0] || null; onUpload(slot, f); event.currentTarget.value = '' }}
                    />
                  </label>
                )
              ) : null}
              {isOpen && slot.accept === 'image' ? (
                <div
                  className={cn('absolute top-[40px] left-0 z-[3] grid grid-cols-[repeat(4,32px)] gap-1 w-max max-w-[148px] p-[5px] rounded-[7px] border border-nomi-line-soft bg-nomi-paper shadow-nomi-lg')}
                  role="menu"
                  aria-label={`${slot.label}来源`}
                >
                  <label className={cn('relative flex items-center justify-center w-8 h-8 rounded-[5px] bg-nomi-ink-05 text-nomi-ink-40 overflow-hidden cursor-pointer')}>
                    <span className={cn('text-[16px] leading-none select-none')}>{uploadingKey === slot.metaKey ? '…' : '+'}</span>
                    <input
                      className={cn('absolute inset-0 w-full h-full opacity-0 cursor-pointer')}
                      type="file"
                      accept={ACCEPT_ATTR[slot.accept]}
                      aria-label={`上传${slot.label}`}
                      disabled={Boolean(uploadingKey)}
                      onChange={(event) => { const f = event.currentTarget.files?.[0] || null; onUpload(slot, f); event.currentTarget.value = '' }}
                    />
                  </label>
                  {candidates.map((item) => (
                    <WorkbenchButton
                      key={item.id}
                      className={cn('relative flex items-center justify-center w-8 h-8 rounded-[5px] bg-nomi-ink-05 overflow-hidden cursor-pointer')}
                      aria-label={item.title}
                      onClick={() => onPickNode(slot.metaKey, item.url)}
                    >
                      <img className={cn('w-full h-full object-cover')} src={item.url} alt={item.title} />
                    </WorkbenchButton>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
