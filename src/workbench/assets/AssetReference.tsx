import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowsLeftRight, IconPlus } from '@tabler/icons-react'
import { ICON_TIERS } from '../../design'
import { cn } from '../../utils/cn'
import AssetTile, { AssetActionTile } from './AssetTile'
import AssetPicker from './AssetPicker'
import AssetReferenceButton from './AssetReferenceButton'
import AssetPickerPopover from './AssetPickerPopover'
import type { AssetKind, AssetRef } from './assetTypes'
import type { ReferenceInfo } from './referenceNames'

// 节点侧的参考行（B3）。**声明式 slot 描述符驱动**(R5):一份 AssetSlot 声明「要几个什么槽、单还是数组、是否连边」。
// 值与边的写入逻辑留在调用方(复用已验证的 handleSlotAssignment/handleArrayAdd…),本组件只负责「呈现 + 回调」。
//
// 一行，在文字上方：
//   [画布点选 40][+ 40]  小图 小图 小图 …………………………………… 参考图 N 张
//   · 小图平时干净（没有序号、没有 ×）；悬停才出 ×，并出现名字 + 来源的小提示（见 AssetTile）。
//   · 首尾帧方式：「首帧」「尾帧（可不填）」两格，名字在格下，中间一颗对调钮。
//   · 模型自己放不下的图只变淡，不逐张写字（边界样张 K3）；一句话在行尾说清。
//   · 行尾那句话整句不折（K2）：图只有一行、整句放得下就在行尾；否则整句换到图下面单独一行、靠右。
//     不量文字宽度：滚动口和那句话是同一个 flex-wrap 里的两件，滚动口按图一行的宽度要位置，放不下那句话就自然掉到下一行；
//     那句话在滚动口外面，图再多（30 + 10 + 10）也钉在可视区里，不跟着图滚走（K1）。

export type AssetSlot = {
  key: string
  label: string
  accept: AssetKind
  form: 'single' | 'array'
  persistAsEdge: boolean
  numbered: boolean
  max?: number
  caption?: string
  /** 可不填的槽（首尾帧里的尾帧）：格下的名字写成「尾帧（可不填）」。 */
  optional?: boolean
}

type AssetReferenceProps = {
  slots: AssetSlot[]
  remainingCapacity?: number
  capacityMessage?: string
  /** 每个槽当前值:单 → 缩略图 url(空串=空);数组 → url 列表(仅有 url 的显示项)。 */
  valuesByKey: Record<string, string | string[]>
  /** 数组槽**已占用位置数**(含连线 + pending 边,单源 resolveReferenceSlots.fills.length)。容量(能否再加)
   *  按它判,而非有 url 的显示数——否则被 pending 边占满的槽仍显示「+」却加不进去。无此 key → 退回按显示数。 */
  occupiedByKey?: Record<string, number> | Map<string, number>
  projectId: string | null
  openSlotKey: string
  uploadingSlotKey: string
  onTogglePicker: (key: string) => void
  onPick: (slot: AssetSlot, asset: AssetRef) => void
  onUpload: (slot: AssetSlot, file: File) => void
  onRemove: (slot: AssetSlot, index: number) => void
  /** 点媒体参考 tile → 在描述框插入 @ 引用 chip(主路径)。 */
  onInsertMention?: (url: string) => void
  /** 同槽内拖拽重排(from→to);跨槽(image/video/audio)由组件内 metaKey 守卫禁止。 */
  onReorder?: (slot: AssetSlot, from: number, to: number) => void
  /** picker 里「浏览全部 →」打开素材面板。 */
  onBrowseAll?: () => void
  onPickOnCanvas?: (slots: AssetSlot[]) => void
  /** 这个数组槽的第一张缩略图标「首帧」（image_ref[0] 里有 first_frame 连线时才传；见 firstFrameTaggedSlot）。 */
  firstFrameSlotKey?: string
  /** url → 名字 / 来源 / 是否连线进来：悬停小提示和 × 的名字用。 */
  referenceInfos?: ReadonlyMap<string, ReferenceInfo>
  /** 别的方式里放着、此刻用不上的图（首尾帧方式里的参考图）：淡显，切回去还在。 */
  unusedUrls?: readonly string[]
  /** 「未用到」那张的 ×（和在用缩略图同一颗悬停 ×，用户 10-22 拍板 ⑫）：删的是节点参考列表里那一张；连线来的就断开那条线。 */
  onRemoveUnused?: (url: string) => void
  /** 「未用到」里先放一边的旧工程残留（#1269 条件 4）：点一下 onUseParked 放回在用，悬停写「点一下用上」。 */
  parkedUrls?: ReadonlySet<string>
  onUseParked?: (url: string) => void
  /** 首尾帧两格的对调（只有恰好两个单帧槽时才给）。 */
  onSwapFrames?: () => void
  /** 对调后这个方式发不出去（另一格必填而现在是空的）：⇄ 置灰，悬停写这句原因。不传 = 可点。 */
  swapFramesDisabledReason?: string
  /** 模型根本不收参考：入口灰掉、悬停说原因；已经连进来的图淡显。 */
  disabledReason?: string
  /** 行尾那句 12px 小字（报数 / 已改成 / 不会发），由宿主按方式现算。不传 = 没有。 */
  tail?: React.ReactNode
  /** 图那一行的滚动口样式（宿主定：最多露几行、往哪外扩）。那句话不在滚动口里。 */
  scrollClassName?: string
  /**
   * 「+」按「再放一件之后」现算（宿主问落格的那一个判据）：给了它，「+」选择器只给 accept 这几类、选了 / 上传了交给
   * onAsset / onUpload 落格（落哪一格、换不换方式由宿主那个判据定），不再按当前方式的数组格分流；accept 为空 =「+」置灰（悬停说放满了，点不开选择器）。
   * 不给 = 按当前方式的格加（没有方式可换的宿主）。
   */
  addEntry?: { accept: readonly AssetKind[]; onAsset: (asset: AssetRef) => void; onUpload: (file: File) => void }
}

// 合并后的数组参考行用这个伪 key 记展开状态。
export const MERGED_ARRAY_KEY = '__refs__'

function displayRef(url: string, kind: AssetKind, name: string): AssetRef {
  return { id: url, kind, name, renderUrl: url, source: 'project', origin: { source: 'project', projectId: '', relativePath: '' } }
}

function kindFromFile(file: File): AssetKind {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'image'
}

export default function AssetReference({
  slots, remainingCapacity, capacityMessage, valuesByKey, occupiedByKey, projectId, openSlotKey, uploadingSlotKey,
  onTogglePicker, onPick, onUpload, onRemove, onInsertMention, onReorder, onBrowseAll, onPickOnCanvas, firstFrameSlotKey,
  referenceInfos, unusedUrls, onRemoveUnused, parkedUrls, onUseParked, onSwapFrames, swapFramesDisabledReason, disabledReason, tail, scrollClassName, addEntry,
}: AssetReferenceProps): JSX.Element {
  const { t } = useTranslation()
  const dragRef = React.useRef<{ key: string; index: number } | null>(null)
  const singleSlots = slots.filter((s) => s.form === 'single')
  const arraySlots = slots.filter((s) => s.form === 'array')
  const labelSingles = singleSlots.length > 1 // 首尾帧:两个单帧槽才需标签区分;单个时不加标签。
  const disabled = Boolean(disabledReason)

  // 槽**已占用位置数**：优先 occupiedByKey(含 pending 边)，无则退回有 url 的显示数(向后兼容)。
  const occupiedOf = (slot: AssetSlot): number => {
    const raw = valuesByKey[slot.key]
    const shown = Array.isArray(raw) ? raw.filter(Boolean).length : 0
    const occ = occupiedByKey instanceof Map ? occupiedByKey.get(slot.key) : occupiedByKey?.[slot.key]
    return Math.max(occ ?? 0, shown)
  }

  const arrayAccepts = Array.from(new Set(arraySlots.map((s) => s.accept)))
  const arrayTiles = arraySlots.flatMap((slot) => {
    const raw = valuesByKey[slot.key]
    const urls = (Array.isArray(raw) ? raw : []).filter(Boolean)
    return urls.map((url, index) => ({ slot, url, index }))
  })
  const totalFull = remainingCapacity !== undefined && remainingCapacity <= 0
  const arrayCanAdd = !totalFull && arraySlots.some((slot) => (slot.max === undefined || occupiedOf(slot) < slot.max))
  const arrayUploading = arraySlots.some((slot) => uploadingSlotKey === slot.key)
  // 已到上限的类型(该数组满)→ 在合并 picker 里灰显;点击仍走 onPick→handleArrayAdd 出「最多 N」toast。
  const atLimitKinds = arraySlots
    .filter((slot) => totalFull || (slot.max !== undefined && occupiedOf(slot) >= slot.max))
    .map((slot) => slot.accept)

  const routeByKind = (kind: AssetKind): AssetSlot => arraySlots.find((s) => s.accept === kind) ?? arraySlots[0]!
  const firstEmptySingle = singleSlots.find((slot) => {
    const raw = valuesByKey[slot.key]
    return !(typeof raw === 'string' && raw)
  })
  // 「+」：有数组槽 → 合并选择器；只有单帧槽 → 落到第一个空格。
  const plusKey = addEntry ? (addEntry.accept.length > 0 ? MERGED_ARRAY_KEY : '')
    : arraySlots.length > 0 ? (arrayCanAdd ? MERGED_ARRAY_KEY : '') : firstEmptySingle?.key ?? ''
  // 宿主给了判据（addEntry）：「+」一直在，一类都放不下时置灰、悬停说放满了（拍板图 K1 画的就是灰着的「+」），点不开选择器。
  const showPlus = addEntry ? true : Boolean(plusKey) || disabled || arraySlots.length > 0 || labelSingles
  const infoOf = (url: string): ReferenceInfo | undefined => referenceInfos?.get(url)
  const sourceLabelOf = (info: ReferenceInfo | undefined): string | undefined => {
    if (!info) return undefined
    return t(info.source === 'canvas' ? 'assetLibrary.refRow.sourceCanvas' : info.source === 'library' ? 'assetLibrary.refRow.sourceLibrary' : 'assetLibrary.refRow.sourceUpload')
  }
  const tileProps = (url: string, kind: AssetKind, fallbackName: string) => {
    const info = infoOf(url)
    const name = info?.name || fallbackName
    return {
      asset: displayRef(url, kind, name),
      sourceLabel: sourceLabelOf(info),
      ...(info?.fromEdge ? { tipText: t('assetLibrary.refRow.tipConnected', { name }), removeLabel: t('assetLibrary.refRow.disconnect') } : {}),
    }
  }
  const tailContent = tail ?? null

  return (
    <div data-reference-block="true" className="flex flex-wrap items-center gap-x-2 gap-y-1">
    {/* 滚动口按「图排成一行要多宽」要位置（flex: 0 1 auto），最多占满一整行；外扩 1.5rem 给悬停才出的 × 留地方。 */}
    <div data-reference-scroll="true" className={cn('min-w-0 max-w-[calc(100%+1.5rem)] flex-[0_1_auto]', scrollClassName)}>
    {/* 这一排所有格按顶对齐（items-start）；首尾帧的名字在格下面，所以只有那一排会比 40px 高。 */}
    <div data-reference-row="true" data-reference-row-disabled={disabled ? 'true' : undefined} className="flex min-h-10 flex-wrap items-start gap-2">
      <div className="relative shrink-0">
        <AssetReferenceButton disabled={disabled || Boolean(uploadingSlotKey)}
          title={disabled ? disabledReason : totalFull ? capacityMessage : undefined}
          onClick={() => onPickOnCanvas?.(slots)} />
      </div>
      {showPlus ? <div className="relative shrink-0">
        <AssetActionTile
          data-reference-add-entry="true"
          aria-label={t('assetLibrary.refRow.addMenu')}
          title={disabled ? disabledReason : !plusKey ? capacityMessage || t('assetLibrary.refRow.addFull') : t('assetLibrary.refRow.addMenu')}
          disabled={disabled || !plusKey}
          selected={Boolean(plusKey) && openSlotKey === plusKey}
          onClick={() => plusKey && onTogglePicker(plusKey)}
        >
          <IconPlus size={ICON_TIERS.bar.size} stroke={ICON_TIERS.bar.stroke} aria-hidden />
        </AssetActionTile>
        {plusKey === MERGED_ARRAY_KEY && openSlotKey === MERGED_ARRAY_KEY ? (
          <AssetPickerPopover onClose={() => onTogglePicker(MERGED_ARRAY_KEY)}>
            <AssetPicker
              projectId={projectId}
              accept={addEntry ? [...addEntry.accept] : arrayAccepts}
              uploading={addEntry ? uploadingSlotKey === MERGED_ARRAY_KEY : arrayUploading}
              onPick={(asset) => (addEntry ? addEntry.onAsset(asset) : onPick(routeByKind(asset.kind), asset))}
              onUpload={(file) => (addEntry ? addEntry.onUpload(file) : onUpload(routeByKind(kindFromFile(file)), file))}
              onBrowseAll={onBrowseAll}
              atLimitKinds={addEntry ? [] : atLimitKinds}
            />
          </AssetPickerPopover>
        ) : null}
      </div> : null}
      {/* 单帧槽(首/尾帧、源视频):横排并列,各一个方块;≥2 时(首尾帧)名字在格下面，中间一颗对调钮 */}
      {singleSlots.map((slot, slotIndex) => {
        const raw = valuesByKey[slot.key]
        const url = typeof raw === 'string' ? raw : ''
        const isOpen = openSlotKey === slot.key
        const label = slot.optional ? t('assetLibrary.refRow.lastFrameOptional') : slot.label
        return (
          <React.Fragment key={slot.key}>
            {labelSingles && slotIndex === 1 && onSwapFrames ? (
              <button
                type="button"
                data-reference-swap="true"
                aria-label={t('assetLibrary.refRow.swapFrames')}
                title={swapFramesDisabledReason ?? t('assetLibrary.refRow.swapFrames')}
                disabled={Boolean(swapFramesDisabledReason)}
                data-reference-swap-disabled={swapFramesDisabledReason ? 'true' : undefined}
                onClick={onSwapFrames}
                className="mt-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-nomi-line bg-nomi-paper p-0 text-nomi-ink-80 hover:bg-nomi-ink-05 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-nomi-paper"
              >
                <IconArrowsLeftRight size={ICON_TIERS.tool.size} stroke={ICON_TIERS.tool.stroke} aria-hidden />
              </button>
            ) : null}
            <div data-asset-slot={slot.key} className={cn('relative flex min-w-10 shrink-0 flex-col items-start gap-1', slotIndex === 0 && 'ml-3')}>
              {url
                ? <AssetTile {...tileProps(url, slot.accept, slot.label)} onRemove={() => onRemove(slot, 0)} dimmed={disabled} />
                : <AssetActionTile data-asset-add-tile="true" aria-label={t('assetLibrary.addNamed', { label: slot.label })} selected={isOpen} disabled={disabled}
                  onClick={() => onTogglePicker(slot.key)}><IconPlus size={ICON_TIERS.bar.size} stroke={ICON_TIERS.bar.stroke} aria-hidden /></AssetActionTile>}
              {labelSingles ? <span data-asset-slot-label="true" className="whitespace-nowrap text-caption leading-4 text-nomi-ink-60">{label}</span> : null}
              {isOpen && plusKey !== MERGED_ARRAY_KEY ? (
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
          </React.Fragment>
        )
      })}

      {/* 数组参考:合并成一排小图（「+」已经是行首的工具钮）。没有序号、没有组标签。
          这一组不自成一块（display: contents）：小图直接接在「+」后面排、满了折行（边界样张 K1），
          自成一块时放不下一行就整组掉到「+」下面，第一行只剩两颗工具钮。 */}
      {arraySlots.length > 0 ? (
        <div data-asset-slot-group="array" className="contents">
          {arrayTiles.map(({ slot, url, index }) => (
            <AssetTile
              key={`${slot.key}-${url}-${index}`}
              {...tileProps(url, slot.accept, `${slot.label}${index + 1}`)}
              tag={firstFrameSlotKey === slot.key && index === 0 ? t('generationCommon.parameters.firstFrame') : undefined}
              dimmed={disabled}
              onRemove={() => onRemove(slot, index)}
              onClick={onInsertMention ? () => onInsertMention(url) : undefined}
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
        </div>
      ) : null}
      {/* 模型自己放不下的那几张：只变淡，不逐张写字（行尾一句话说清；生成照常能点，不挡路）。悬停写「名字 · 不会发」。
          旧工程里以前藏着的图（先放一边）也在这里：悬停写「名字 · 没在用，点一下用上」，点一下放回在用。 */}
      {(unusedUrls ?? []).map((url) => {
        const unusedTile = tileProps(url, 'image', t('assetLibrary.referenceImage'))
        const usable = Boolean(onUseParked && parkedUrls?.has(url) && !disabled)
        return (
        <div key={`unused-${url}`} data-reference-unused="true" data-reference-parked={parkedUrls?.has(url) ? 'true' : undefined} className="flex min-w-10 shrink-0 flex-col items-start">
          <AssetTile {...unusedTile} dimmed
            {...(onRemoveUnused && !disabled ? { onRemove: () => onRemoveUnused(url) } : {})}
            {...(usable
              ? { onClick: () => onUseParked!(url), tipText: t('assetLibrary.refRow.useParked', { name: unusedTile.asset.name }) }
              : disabled ? {} : { tipText: t('assetLibrary.refRow.notSentTip', { name: unusedTile.asset.name }) })} />
        </div>
        )
      })}
    </div>
    </div>
      {tailContent ? (
        // 整句不折、不缩（whitespace-nowrap，按内容宽要位置、不收）：放不下就整句换到下一行；再吃满剩余宽、字靠右（justify-end）。
        <span data-reference-tail="true" className="flex flex-[1_0_auto] items-center justify-end gap-1 whitespace-nowrap text-caption text-nomi-ink-60">{tailContent}</span>
      ) : null}
      {totalFull && capacityMessage ? <span className="basis-full text-micro text-nomi-ink-60" role="status">{capacityMessage}</span> : null}
    </div>
  )
}
