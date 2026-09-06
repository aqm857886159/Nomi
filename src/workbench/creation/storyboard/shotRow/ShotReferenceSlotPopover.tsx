import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconGripVertical, IconTrash } from '../../../../vendor/tablerIcons'
import { NomiImage } from '../../../../design/media'
import AssetPicker from '../../../assets/AssetPicker'
import AssetPickerPopover from '../../../assets/AssetPickerPopover'
import type { AssetRef } from '../../../assets/assetTypes'
import type { PlanAnchor } from '../../../generationCanvas/agent/storyboardPlan'
import type { ShotReferenceCell } from './shotReferenceCells'

/**
 * 槽浮层（合同 v6 §4.2 + §4.4）——参考列那个格子点开之后的样子。
 *
 * 它承担三件参考列**横向预算装不下**的事，所以它们都在这里而不是在列里（§4.1 规则②：
 * 参考列固定宽度、单行三格仍然成立）：
 *   ① 这个槽里的素材网格：加 / 删 / 排序（characterIndexed 的槽顺序是语义，不是装饰）；
 *   ② 这一次引用要模型「**忽略的特征**」——参考图永远多带了东西（背景、光线、服装），
 *      没有显式的忽略通道，用户唯一能做的就是去 P 图或重拍一张更干净的参考；
 *   ③ 素材来自锚时，把锚的描述显示出来（描述住锚上，同一张锚被 5 镜引用只写一次）。
 *
 * 浮层本体复用现役 `AssetPickerPopover` + `AssetPicker`（上传/素材库/引用某镜结果四条入口都在里面），
 * 不另造一套选择器。
 */

type Props = {
  cell: ShotReferenceCell
  projectId: string | null
  uploading: boolean
  anchorsById: ReadonlyMap<string, PlanAnchor>
  onPick: (asset: AssetRef) => void
  onUpload: (file: File) => void
  onRemove: (index: number) => void
  onReorder: (from: number, to: number) => void
  onChangeIgnore: (index: number, ignore: string) => void
  onBrowseAll: () => void
  onClose: () => void
}

export default function ShotReferenceSlotPopover({
  cell,
  projectId,
  uploading,
  anchorsById,
  onPick,
  onUpload,
  onRemove,
  onReorder,
  onChangeIgnore,
  onBrowseAll,
  onClose,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const dragIndex = React.useRef<number | null>(null)
  const atLimit = cell.max !== undefined && cell.bindings.length >= cell.max
  return (
    <AssetPickerPopover onClose={onClose}>
      <div className="flex w-[320px] flex-col gap-2.5 p-1" data-storyboard-slot-popover={cell.key}>
        <div className="flex items-baseline gap-2">
          <span className="text-caption font-medium text-nomi-ink-80">{cell.label}</span>
          <span className="text-micro text-nomi-ink-40">
            {cell.max !== undefined
              ? t('storyboardEditor.slot.usedOf', { used: cell.bindings.length, max: cell.max })
              : t('storyboardEditor.slot.used', { used: cell.bindings.length })}
          </span>
        </div>

        {cell.bindings.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {cell.bindings.map((binding, index) => {
              const anchor = binding.anchorId ? anchorsById.get(binding.anchorId) ?? null : null
              const name = anchor?.name.trim() || binding.name?.trim() || t('storyboardEditor.unnamed')
              return (
                <li
                  key={`${binding.url}-${index}`}
                  className="flex gap-2 rounded-nomi-sm border border-nomi-line-soft p-1.5"
                  draggable
                  onDragStart={() => { dragIndex.current = index }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragIndex.current !== null && dragIndex.current !== index) onReorder(dragIndex.current, index)
                    dragIndex.current = null
                  }}
                >
                  <span className="relative size-12 shrink-0 overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05">
                    <NomiImage src={binding.url} alt={name} className="absolute inset-0 h-full w-full object-cover" />
                    {cell.numbered ? (
                      <span className="absolute left-0 top-0 rounded-br-nomi-sm bg-nomi-overlay-chip px-1 text-micro text-nomi-paper tabular-nums">
                        {index + 1}
                      </span>
                    ) : null}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <IconGripVertical size={12} stroke={1.6} className="shrink-0 cursor-grab text-nomi-ink-20" aria-hidden />
                      <span className="min-w-0 truncate text-micro text-nomi-ink-80">{name}</span>
                      <button
                        type="button"
                        onClick={() => onRemove(index)}
                        aria-label={t('storyboardEditor.slot.remove', { name })}
                        className="ml-auto grid size-5 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-workbench-danger-soft hover:text-workbench-danger"
                      >
                        <IconTrash size={12} stroke={1.6} />
                      </button>
                    </div>
                    {anchor && anchor.description.trim() ? (
                      <span className="line-clamp-2 text-micro text-nomi-ink-40" title={anchor.description}>
                        {t('storyboardEditor.slot.anchorDescription', { text: anchor.description.trim() })}
                      </span>
                    ) : null}
                    <input
                      value={binding.ignore ?? ''}
                      onChange={(event) => onChangeIgnore(index, event.target.value)}
                      placeholder={t('storyboardEditor.slot.ignorePlaceholder')}
                      aria-label={t('storyboardEditor.slot.ignoreAria', { name })}
                      data-storyboard-slot-ignore={cell.key}
                      className="h-6 w-full rounded-nomi-sm border border-nomi-line bg-nomi-paper px-1.5 text-micro text-nomi-ink-80 outline-none focus:border-nomi-accent"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}

        {atLimit ? (
          <span className="text-micro text-nomi-ink-40">
            {t('storyboardEditor.row.slotFull', { label: cell.label, max: cell.max })}
          </span>
        ) : (
          <AssetPicker
            projectId={projectId}
            accept={[cell.assetSlot.accept]}
            uploading={uploading}
            onPick={onPick}
            onUpload={onUpload}
            onBrowseAll={onBrowseAll}
          />
        )}
      </div>
    </AssetPickerPopover>
  )
}
