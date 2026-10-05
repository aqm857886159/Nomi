import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { isProjectExecutionContextCurrent, isProjectImportCancellation, withProjectAction } from '../../../project/projectCanvasReadSurface'
import { notify } from '../../../../ui/notificationPolicy'
import { useOpenProjectId } from '../../../project/useOpenProjectId'
import { AnchoredPopover } from '../../../../design'
import AssetTile, { AssetAddTile } from '../../../assets/AssetTile'
import AssetPicker from '../../../assets/AssetPicker'
import AssetPickerPopover from '../../../assets/AssetPickerPopover'
import type { AssetKind, AssetRef } from '../../../assets/assetTypes'
import { importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import { assetUrl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import { referenceSlotAccept, slotAsArray } from '../../../generationCanvas/nodes/controls/archetypeMeta'
import type { ArchetypeMode, ArchetypeReferenceSlot, ModelArchetype } from '../../../../../electron/shared/modelArchetypes/types'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import { appendBinding, bindingsOf, type ReferenceBindingMap } from './shotReferenceSlots'
import { imageReferenceMode } from '../exec/storyboardAutoReference'
import type { PlannedFirstFrame } from '../exec/storyboardRowStatus'
import { IconPhoto } from '../../../../vendor/tablerIcons'
import { useStoryboardRowNarrow } from './storyboardRowDensity'
import { cn } from '../../../../utils/cn'
import { densityBox } from './shotFrameGeometry'

/**
 * 视觉列里、预览框下面那一条**参考缩略图条**（2026-10-06 第二轮：「我们原来的设计是为了空间，
 * 把参考的图片放到了左边」——放回左边，换成小方块）。
 *
 * 每张是画布同款 `AssetTile`（cover 裁切、hover 放大、右上角 ×），宽档 36、窄档 28、间距 4，
 * 在视觉列宽度里折行；左上角的序号就是这张在**提示词芯片编号**里的位置（`@图片1` ↔ 1）——
 * 序号与芯片读同一份有序列表（这一行所有绑定按槽展开），所以两边永远对得上。
 * 最后一格是同尺寸的「+」，点开同一个素材选择器（`AssetPicker`）。
 * 窄档一行放不下：前几张 + 「+N」+「+」，「+N」点开浮层看全部（同样带 ×）。
 *
 * 当前模式收不了参考（如「文生视频」）、同一个模型里有能收参考图的模式、且这一镜还没出过结果：
 * 「+」照样在，选完素材 = 切到那个模式再放进去（设计卡 §B 方案 A）。没有这样的模式就不摆「+」。
 */

const WRONG_KIND_KEY: Record<'image' | 'video' | 'audio', string> = {
  image: 'storyboardEditor.row.slotAccepts.image',
  video: 'storyboardEditor.row.slotAccepts.video',
  audio: 'storyboardEditor.row.slotAccepts.audio',
}

const GAP = 4
/** 竖版时预览框与右边参考带之间的间距（视觉列内）。 */
export const RIGHT_GAP = 8

type Props = {
  mode: ArchetypeMode | null
  archetype?: ModelArchetype | null
  bindings: ReferenceBindingMap | undefined
  onChangeBindings: (next: ReferenceBindingMap) => void
  /** 删一张：调用方负责把提示词里对应的 @ 一起删（`removeReferenceWithMention`）。 */
  onRemove: (slotKey: string, index: number) => void
  /** 点缩略图 = 在提示词光标处插一枚指向它的 @（画布同一手势）。 */
  onInsertMention?: ((url: string) => void) | undefined
  /** 允许为放参考切模式（已出过结果的行不传：切了就和它手上的结果对不上）。 */
  onSwitchMode?: ((modeId: string) => void) | undefined
  /**
   * 计划首帧（图片+视频镜：生成时先出首帧图、再把它发进这一槽）。排在最前面，没有 ×、没有序号——
   * 它不是用户摆的参考（删不掉也换不了），也不是提示词里的芯片；还没出图时是一格虚线占位。
   */
  planned?: PlannedFirstFrame | null
  /**
   * 摆在哪、占多大（宽档值；窄档在这里按行的档位缩，与画面格同一个 context）：
   *   · `below`：横版 / 方图，排在预览框下面，宽 = 预览框宽，折行（窄档一行放不下折成 +N）；
   *   · `right`：竖版（2026-10-06 用户选 A「竖版参考挪右边」），排在预览框右边的那条窄带里，
   *     宽 = 视觉列宽 − 框宽 − 8，高 = 框高，竖着排、可多列，「+」在最后；放不下折成 +N。
   */
  layout: { placement: 'below'; width: number } | { placement: 'right'; columnWidth: number; frameWidth: number; frameHeight: number }
}

type Tile = { slot: ArchetypeReferenceSlot; slotKey: string; indexInSlot: number; number: number; url: string; name: string; kind: AssetKind }

/** 「+」放进哪个槽：数组参考槽优先，其次第一个空的单槽（首帧 → 尾帧），都满了就替换第一个单槽。 */
function slotFor(mode: ArchetypeMode, bindings: ReferenceBindingMap | undefined, kind: AssetKind): ArchetypeReferenceSlot | null {
  const accepting = mode.slots.filter((slot) => referenceSlotAccept(slot.kind) === kind)
  return accepting.find((slot) => slotAsArray(slot))
    ?? accepting.find((slot) => bindingsOf(bindings, slot.kind).length === 0)
    ?? accepting[0]
    ?? null
}

export default function ShotReferenceStrip({
  mode, archetype, bindings, onChangeBindings, onRemove, onInsertMention, onSwitchMode, planned, layout,
}: Props): JSX.Element | null {
  const { t } = useTranslation()
  const projectId = useOpenProjectId()
  const narrow = useStoryboardRowNarrow()
  const size = narrow ? 28 : 36
  const scaled = (value: number): number => densityBox({ width: value, height: 0 }, narrow).width
  const right = layout.placement === 'right'
  const width = right ? scaled(layout.columnWidth) - scaled(layout.frameWidth) - RIGHT_GAP : scaled(layout.width)
  const height = right ? densityBox({ width: layout.frameWidth, height: layout.frameHeight }, narrow).height : 0
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [overflowOpen, setOverflowOpen] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState('')
  const identity = React.useId()
  const overflowRef = React.useRef<HTMLButtonElement>(null)
  const report = React.useCallback((message: string) => {
    notify({ identity: `storyboard-reference:${identity}`, reason: 'reference-input', level: 'inline', type: 'error', message, present: setError })
  }, [identity])

  // 序号 = 这张在「所有绑定按槽展开」那份有序列表里的位置——与提示词芯片编号同一份列表。
  const declared = new Map((mode?.slots ?? []).map((slot) => [slot.kind as string, slot]))
  let counter = 0
  const tiles: Tile[] = Object.keys(bindings ?? {}).flatMap((slotKey) => bindingsOf(bindings, slotKey).map((binding, indexInSlot) => {
    counter += 1
    const slot = declared.get(slotKey)
    if (!slot) return null
    return { slot, slotKey, indexInSlot, number: counter, url: binding.url, name: binding.name?.trim() || translateModelDisplayText(slot.label), kind: referenceSlotAccept(slot.kind) as AssetKind }
  }).filter((tile): tile is Tile => tile !== null))

  // 「+」：本模式能收什么；收不了参考且允许切 → 同模型能收参考图的模式。
  const switchTo = mode && mode.slots.length === 0 && onSwitchMode ? imageReferenceMode(archetype) : null
  const targetMode = mode && mode.slots.length > 0 ? mode : switchTo
  const accepts = [...new Set((targetMode?.slots ?? []).map((slot) => referenceSlotAccept(slot.kind)))]
  const canAdd = Boolean(targetMode) && accepts.length > 0

  if (tiles.length === 0 && !canAdd && !planned) return null

  const place = (asset: { url: string; kind: AssetKind; name?: string; sourceNodeId?: string }): boolean => {
    if (!targetMode) return false
    const slot = slotFor(targetMode, bindings, asset.kind)
    if (!slot) { report(t(WRONG_KIND_KEY[accepts[0] ?? 'image'], { label: translateModelDisplayText(targetMode.slots[0]?.label ?? '') })); return false }
    const result = appendBinding(bindings, slot, { url: asset.url, ...(asset.name ? { name: asset.name } : {}), ...(asset.sourceNodeId ? { sourceNodeId: asset.sourceNodeId } : {}) }, asset.kind)
    const label = translateModelDisplayText(slot.label)
    if (result.status === 'wrong-kind') { report(t(WRONG_KIND_KEY[result.accept], { label })); return false }
    if (result.status === 'full') { report(t('storyboardEditor.row.slotFull', { label, max: result.max })); return false }
    if (switchTo) onSwitchMode?.(switchTo.id)
    if (result.status === 'added') onChangeBindings(result.next)
    setError('')
    return true
  }

  const upload = async (file: File): Promise<void> => {
    await withProjectAction(async (context) => {
      setUploading(true)
      try {
        const kind: AssetKind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image'
        const uploaded = await importWorkbenchLocalAssetFile(file, file.name, {
          projectBinding: context.binding, assertCurrent: context.assertCurrent,
          ...(kind === 'image' ? { taskKind: 'image_edit' as const } : {}),
        })
        context.assertCurrent()
        if (place({ url: assetUrl(uploaded), kind, name: uploaded.name || file.name })) setPickerOpen(false)
      } catch (cause) {
        if (!isProjectExecutionContextCurrent(context) || isProjectImportCancellation(cause)) return
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (isProjectExecutionContextCurrent(context)) setUploading(false)
      }
    })
  }

  const tileClass = narrow ? 'w-7 h-7' : 'w-9 h-9'
  const renderTile = (tile: Tile): JSX.Element => (
    <span key={`${tile.slotKey}-${tile.url}-${tile.indexInSlot}`} title={translateModelDisplayText(tile.slot.label)} data-storyboard-ref-thumb={tile.number}>
      <AssetTile
        className={tileClass}
        asset={{ id: tile.url, kind: tile.kind, name: tile.name, renderUrl: tile.url, source: 'project', origin: { source: 'project', projectId: '', relativePath: '' } }}
        index={tile.number}
        onRemove={() => onRemove(tile.slotKey, tile.indexInSlot)}
        onClick={onInsertMention ? () => onInsertMention(tile.url) : undefined}
      />
    </span>
  )

  // 窄档只排一行：放得下几格（含「+」）就放几张，其余收进「+N」。宽档折行，全摆。
  const perRow = Math.max(1, Math.floor((width + GAP) / (size + GAP)))
  const perColumn = right ? Math.max(1, Math.floor((height + GAP) / (size + GAP))) : 0
  const reserved = (canAdd ? 1 : 0) + (planned ? 1 : 0)
  // 放得下的格数：竖版 = 右边那条带的列数 × 行数；横版窄档 = 一行；横版宽档折行不限。
  const capacity = right ? perRow * perColumn : narrow ? perRow : Number.POSITIVE_INFINITY
  const fold = tiles.length + reserved > capacity
  const shown = fold ? tiles.slice(0, Math.max(0, capacity - reserved - 1)) : tiles
  const hidden = tiles.length - shown.length

  return (
    <div className={cn('flex flex-col gap-1', !right && 'mt-1.5')} data-storyboard-refs={layout.placement} data-storyboard-refs-size={size}>
      <div
        className={right ? 'grid' : 'flex flex-wrap'}
        style={right
          // 竖着排：先填满一列再换下一列（序号 1、2、3 从上往下读）。
          ? { gap: GAP, width, gridAutoFlow: 'column', gridTemplateRows: `repeat(${perColumn}, ${size}px)`, gridAutoColumns: `${size}px` }
          : { gap: GAP, width }}
      >
        {planned ? (
          <span title={t('storyboardEditor.slot.plannedFirstFrameTitle', { label: translateModelDisplayText(declared.get(planned.slotKind)?.label ?? '') })} data-storyboard-ref-planned="first-frame">
            {planned.url ? (
              <AssetTile
                className={tileClass}
                asset={{ id: planned.url, kind: 'image', name: t('storyboardEditor.slot.plannedFirstFrame'), renderUrl: planned.url, source: 'project', origin: { source: 'project', projectId: '', relativePath: '' } }}
              />
            ) : (
              <span className="grid place-items-center rounded-nomi-sm border border-dashed border-nomi-ink-20 bg-nomi-ink-05 text-nomi-ink-30" style={{ width: size, height: size }} aria-hidden>
                <IconPhoto size={14} stroke={1.6} />
              </span>
            )}
          </span>
        ) : null}
        {shown.map(renderTile)}
        {fold && hidden > 0 ? (
          <button
            ref={overflowRef}
            type="button"
            onClick={() => setOverflowOpen((open) => !open)}
            aria-expanded={overflowOpen}
            aria-label={t('storyboardEditor.slot.moreAria', { count: hidden })}
            data-storyboard-ref-more={hidden}
            className="grid place-items-center rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 text-micro tabular-nums text-nomi-ink-80 hover:border-nomi-accent"
            style={{ width: size, height: size }}
          >
            +{hidden}
          </button>
        ) : null}
        {canAdd ? (
          <span className="relative inline-flex" data-storyboard-ref-add={switchTo ? 'switch-mode' : 'own'}>
            <AssetAddTile className={tileClass} label={t('assetLibrary.addReference')} selected={pickerOpen} onClick={() => setPickerOpen((open) => !open)} />
            {pickerOpen ? (
              <AssetPickerPopover onClose={() => setPickerOpen(false)}>
                <AssetPicker
                  projectId={projectId}
                  accept={accepts}
                  uploading={uploading}
                  onPick={(asset: AssetRef) => {
                    if (place({ url: asset.renderUrl, kind: asset.kind, name: asset.name, ...(asset.origin.source === 'canvas' ? { sourceNodeId: asset.origin.nodeId } : {}) })) setPickerOpen(false)
                  }}
                  onUpload={(file) => { void upload(file) }}
                  onBrowseAll={() => { setPickerOpen(false); window.dispatchEvent(new CustomEvent('nomi-open-files-panel')) }}
                />
              </AssetPickerPopover>
            ) : null}
          </span>
        ) : null}
      </div>
      {overflowOpen ? (
        <AnchoredPopover anchorRef={overflowRef} align="start" gap={6} onClose={() => setOverflowOpen(false)}>
          <div className="flex max-w-[240px] flex-wrap gap-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-2 shadow-nomi-md" data-storyboard-ref-overflow="true">
            {tiles.map((tile) => (
              <span key={`all-${tile.slotKey}-${tile.url}-${tile.indexInSlot}`} title={translateModelDisplayText(tile.slot.label)}>
                <AssetTile
                  className="w-9 h-9"
                  asset={{ id: tile.url, kind: tile.kind, name: tile.name, renderUrl: tile.url, source: 'project', origin: { source: 'project', projectId: '', relativePath: '' } }}
                  index={tile.number}
                  onRemove={() => onRemove(tile.slotKey, tile.indexInSlot)}
                  onClick={onInsertMention ? () => onInsertMention(tile.url) : undefined}
                />
              </span>
            ))}
          </div>
        </AnchoredPopover>
      ) : null}
      {error ? <span className="text-micro leading-tight text-workbench-danger" role="alert" style={{ maxWidth: width }}>{error}</span> : null}
    </div>
  )
}
