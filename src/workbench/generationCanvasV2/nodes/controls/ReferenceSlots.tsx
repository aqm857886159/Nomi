import React from 'react'
import { IconMusic, IconPhoto, IconVideo } from '@tabler/icons-react'
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
// 唯一图标库 Tabler（Design.md §6），stroke 1.5——不用 emoji（跨平台渲染不一、和 outline 风格冲突）。
const ACCEPT_ICON: Record<ArchetypeArraySlot['accept'], typeof IconPhoto> = { image: IconPhoto, video: IconVideo, audio: IconMusic }

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
        // D2：空的「可选且无说明」组（如未用的参考视频/音频）收起组头，只留「+ 标签」按钮（样张 U3）。
        // 有说明的组（角色参考的 character1…9 提示）即使空也保留组头——那条说明对用户有价值。
        const showHeader = items.length > 0 || slot.min > 0 || Boolean(slot.caption)
        return (
          <div key={slot.metaKey} className={cn('flex flex-col gap-[4px]')}>
            {showHeader ? (
              <div className={cn('flex items-baseline gap-[8px]')}>
                <span className={cn('text-nomi-ink-60 text-micro leading-none')}>{slot.label}</span>
                {slot.caption ? <span className={cn('text-nomi-ink-40 text-micro leading-none')}>{slot.caption}</span> : null}
              </div>
            ) : null}
            <div className={cn('relative flex flex-wrap items-center gap-[6px]')}>
              {items.map((url, index) => {
                const AcceptIcon = ACCEPT_ICON[slot.accept]
                return (
                <div key={`${url}-${index}`} className={cn('relative w-12 h-12 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 overflow-hidden flex items-center justify-center')}>
                  {slot.accept === 'image'
                    ? <img className={cn('w-full h-full object-cover')} src={url} alt={`${slot.label}${index + 1}`} />
                    : <AcceptIcon size={20} stroke={1.5} className={cn('text-nomi-ink-40')} />}
                  {slot.numbered ? (
                    <span className={cn('absolute -top-[4px] -left-[4px] min-w-[15px] h-[15px] px-[3px] rounded-pill bg-nomi-accent text-nomi-paper text-micro font-semibold flex items-center justify-center leading-none')}>{index + 1}</span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`移除${slot.label}${index + 1}`}
                    className={cn('absolute -top-[4px] -right-[4px] w-[15px] h-[15px] rounded-pill bg-nomi-paper border border-nomi-line text-nomi-ink-60 text-micro leading-none flex items-center justify-center cursor-pointer')}
                    onClick={(event) => { event.stopPropagation(); onRemove(slot.metaKey, index) }}
                  >×</button>
                </div>
                )
              })}
              {canAdd ? (
                slot.accept === 'image' ? (
                  <WorkbenchButton
                    className={cn('h-7 px-[10px] rounded-pill border border-dashed border-nomi-ink-20 bg-nomi-paper text-nomi-ink-60 text-micro inline-flex items-center gap-1 cursor-pointer hover:border-nomi-accent hover:text-nomi-accent')}
                    aria-label={`添加${slot.label}`}
                    onClick={() => onToggleMenu(slot.metaKey)}
                  >＋ {slot.label}</WorkbenchButton>
                ) : (
                  <label className={cn('h-7 px-[10px] rounded-pill border border-dashed border-nomi-ink-20 bg-nomi-paper text-nomi-ink-60 text-micro inline-flex items-center gap-1 cursor-pointer hover:border-nomi-accent hover:text-nomi-accent')}>
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
                  className={cn('absolute top-[54px] left-0 z-[3] grid grid-cols-[repeat(4,32px)] gap-1 w-max max-w-[148px] p-[5px] rounded-nomi border border-nomi-line-soft bg-nomi-paper shadow-nomi-lg')}
                  role="menu"
                  aria-label={`${slot.label}来源`}
                >
                  <label className={cn('relative flex items-center justify-center w-8 h-8 rounded-nomi-sm bg-nomi-ink-05 text-nomi-ink-40 overflow-hidden cursor-pointer')}>
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
                      className={cn('relative flex items-center justify-center w-8 h-8 rounded-nomi-sm bg-nomi-ink-05 overflow-hidden cursor-pointer')}
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
