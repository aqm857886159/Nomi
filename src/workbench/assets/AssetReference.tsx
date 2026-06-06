import React from 'react'
import { cn } from '../../utils/cn'
import AssetTile, { AssetAddTile } from './AssetTile'
import AssetPicker from './AssetPicker'
import AssetPickerPopover from './AssetPickerPopover'
import type { AssetKind, AssetRef } from './assetTypes'

// 节点侧的参考槽组件(P1.1,对齐样张 v4)。**声明式 slot 描述符驱动**(R5):一份 AssetSlot 声明「要几个
// 什么槽、单还是数组、是否连边、怎么编号」。值与边的写入逻辑留在调用方(复用已验证的 handleSlotAssignment
// /handleArrayAdd…),本组件只负责「呈现 + 回调」。
//
// 样张对齐(关键,别再做丑):**最少文字 / 形态自明**。
//   - 数组参考(角色图/视频/音频)**合并成一排方块 + 一个「+」**,无组标签、无 caption(编号靠 tile 上的徽标自明)。
//   - 单帧槽(首/尾帧、源视频)只有在**多于一个**时(首尾帧)才显小标签以区分;单个时不加标签(空态只一个虚线「+」)。

export type AssetSlot = {
  key: string
  label: string
  accept: AssetKind
  form: 'single' | 'array'
  persistAsEdge: boolean
  numbered: boolean
  max: number
  caption?: string
}

type AssetReferenceProps = {
  slots: AssetSlot[]
  /** 每个槽当前值:单 → 缩略图 url(空串=空);数组 → url 列表。 */
  valuesByKey: Record<string, string | string[]>
  projectId: string | null
  openSlotKey: string
  uploadingSlotKey: string
  onTogglePicker: (key: string) => void
  onPick: (slot: AssetSlot, asset: AssetRef) => void
  onUpload: (slot: AssetSlot, file: File) => void
  onRemove: (slot: AssetSlot, index: number) => void
  /** 点 image 参考 tile → 在描述框插入 @ 引用 chip(主路径)。 */
  onInsertMention?: (url: string) => void
  /** 同槽内拖拽重排(from→to);跨槽(image/video/audio)由组件内 metaKey 守卫禁止。 */
  onReorder?: (slot: AssetSlot, from: number, to: number) => void
  /** picker 里「浏览全部 →」打开素材面板。 */
  onBrowseAll?: () => void
}

// 合并后的数组参考行用这个伪 key 记展开状态。
const MERGED_ARRAY_KEY = '__refs__'

function displayRef(url: string, kind: AssetKind, name: string): AssetRef {
  return { id: url, kind, name, renderUrl: url, source: 'project', origin: { source: 'project', projectId: '', relativePath: '' } }
}

function kindFromFile(file: File): AssetKind {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'image'
}

export default function AssetReference({
  slots, valuesByKey, projectId, openSlotKey, uploadingSlotKey,
  onTogglePicker, onPick, onUpload, onRemove, onInsertMention, onReorder, onBrowseAll,
}: AssetReferenceProps): JSX.Element {
  const dragRef = React.useRef<{ key: string; index: number } | null>(null)
  const singleSlots = slots.filter((s) => s.form === 'single')
  const arraySlots = slots.filter((s) => s.form === 'array')
  const labelSingles = singleSlots.length > 1 // 首尾帧:两个单帧槽才需标签区分;单个时不加标签(样张態③)。

  const arrayAccepts = Array.from(new Set(arraySlots.map((s) => s.accept)))
  const arrayTiles = arraySlots.flatMap((slot) => {
    const raw = valuesByKey[slot.key]
    const urls = (Array.isArray(raw) ? raw : []).filter(Boolean)
    return urls.map((url, index) => ({ slot, url, index }))
  })
  const arrayCanAdd = arraySlots.some((slot) => {
    const raw = valuesByKey[slot.key]
    const len = Array.isArray(raw) ? raw.filter(Boolean).length : 0
    return len < slot.max
  })
  const arrayUploading = arraySlots.some((slot) => uploadingSlotKey === slot.key)

  const routeByKind = (kind: AssetKind): AssetSlot => arraySlots.find((s) => s.accept === kind) ?? arraySlots[0]

  return (
    <div className={cn('flex flex-col gap-[8px]')}>
      {/* 单帧槽(首/尾帧、源视频):横排并列,各一个方块;≥2 时(首尾帧)显小标签区分 */}
      {singleSlots.length > 0 ? (
        <div className={cn('flex flex-wrap items-start gap-[8px]')}>
          {singleSlots.map((slot) => {
            const raw = valuesByKey[slot.key]
            const url = typeof raw === 'string' ? raw : ''
            const isOpen = openSlotKey === slot.key
            return (
              <div key={slot.key} className={cn('relative flex flex-col gap-[4px]')}>
                {labelSingles ? <span className={cn('text-nomi-ink-60 text-micro leading-none')}>{slot.label}</span> : null}
                {url
                  ? <AssetTile asset={displayRef(url, slot.accept, slot.label)} onRemove={() => onRemove(slot, 0)} />
                  : <AssetAddTile label={`添加${slot.label}`} selected={isOpen} onClick={() => onTogglePicker(slot.key)} />}
                {isOpen ? (
                  <AssetPickerPopover onClose={() => onTogglePicker(slot.key)}>
                    <AssetPicker
                      projectId={projectId}
                      accept={[slot.accept]}
                      uploading={uploadingSlotKey === slot.key}
                      onPick={(asset) => onPick(slot, asset)}
                      onUpload={(file) => onUpload(slot, file)}
                      onBrowseAll={onBrowseAll}
                    />
                  </AssetPickerPopover>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* 数组参考:合并成一排方块 + 一个「+」(样张態①),无标签无 caption */}
      {arraySlots.length > 0 ? (
        <div className={cn('relative flex flex-col gap-[4px]')}>
          <div className={cn('flex flex-wrap items-center gap-[8px]')}>
            {arrayTiles.map(({ slot, url, index }) => (
              <AssetTile
                key={`${slot.key}-${url}-${index}`}
                asset={displayRef(url, slot.accept, `${slot.label}${index + 1}`)}
                index={slot.numbered ? index + 1 : undefined}
                onRemove={() => onRemove(slot, index)}
                onClick={slot.accept === 'image' && onInsertMention ? () => onInsertMention(url) : undefined}
                dragProps={onReorder ? {
                  draggable: true,
                  onDragStart: () => { dragRef.current = { key: slot.key, index } },
                  onDragOver: (e) => { e.preventDefault(); e.currentTarget.setAttribute('data-dragover', 'true') },
                  onDragLeave: (e) => { e.currentTarget.removeAttribute('data-dragover') },
                  onDrop: (e) => {
                    e.preventDefault()
                    e.currentTarget.removeAttribute('data-dragover')
                    const d = dragRef.current
                    dragRef.current = null
                    // 同 metaKey 守卫:只在同一槽(image/video/audio 各自数组)内重排,禁跨槽(合并行视觉相邻 ≠ 同数组)
                    if (d && d.key === slot.key && d.index !== index) onReorder(slot, d.index, index)
                  },
                  onDragEnd: () => { dragRef.current = null },
                } : undefined}
              />
            ))}
            {arrayCanAdd ? (
              <AssetAddTile label="加参考" selected={openSlotKey === MERGED_ARRAY_KEY} onClick={() => onTogglePicker(MERGED_ARRAY_KEY)} />
            ) : null}
          </div>
          {openSlotKey === MERGED_ARRAY_KEY ? (
            <AssetPickerPopover onClose={() => onTogglePicker(MERGED_ARRAY_KEY)}>
              <AssetPicker
                projectId={projectId}
                accept={arrayAccepts}
                uploading={arrayUploading}
                onPick={(asset) => onPick(routeByKind(asset.kind), asset)}
                onUpload={(file) => onUpload(routeByKind(kindFromFile(file)), file)}
                onBrowseAll={onBrowseAll}
              />
            </AssetPickerPopover>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
