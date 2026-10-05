import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { isProjectExecutionContextCurrent, isProjectImportCancellation, withProjectAction } from '../../../project/projectCanvasReadSurface'
import { notify } from '../../../../ui/notificationPolicy'
import { useOpenProjectId } from '../../../project/useOpenProjectId'
import { WorkbenchIconButton } from '../../../../design'
import { IconPhotoPlus } from '../../../../vendor/tablerIcons'
import AssetReference, { type AssetSlot } from '../../../assets/AssetReference'
import AssetPicker from '../../../assets/AssetPicker'
import AssetPickerPopover from '../../../assets/AssetPickerPopover'
import type { AssetKind, AssetRef } from '../../../assets/assetTypes'
import { importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import { assetUrl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import type { ArchetypeMode, ArchetypeReferenceSlot, ModelArchetype } from '../../../../../electron/shared/modelArchetypes/types'
import { appendBinding, bindingsOf, hasShownReferences, reorderBinding, storyboardAssetSlots, type ReferenceBindingMap } from './shotReferenceSlots'
import { imageReferenceMode } from '../exec/storyboardAutoReference'

/**
 * 分镜行（镜头 / 参考卡）的参考图 = **画布节点同一个组件**（`AssetReference`）：缩略图一排、右上角直接有 ×、
 * 数组参考合并成一排 + 一个「+」、首尾帧两个槽时才各带一个小名字，没有每格一行的说明文字。
 * 它住在提示词框里、提示词上面——和画布节点的浮框同一个位置。
 *
 * **一张参考都没有时不占一整行**（分镜一屏十几行，空的「+」大方块 × 每行 = 白白多出 64px）：
 * 这时入口是底栏里一颗图标按钮（`ShotReferenceAddButton`，与画布底栏的工具图标同一种按钮），
 * 点开就是同一个素材选择器。摆进第一张之后，这一排才出现。
 *
 * 当前模式收不了参考图（如「文生视频」）、而同一个模型里有能收参考图的模式：那颗按钮照样在，
 * 选完素材 = 切到那个模式并放进去（设计卡 §B 方案 A，待拍板）。没有这样的模式就不摆按钮。
 */

const WRONG_KIND_KEY: Record<'image' | 'video' | 'audio', string> = {
  image: 'storyboardEditor.row.slotAccepts.image',
  video: 'storyboardEditor.row.slotAccepts.video',
  audio: 'storyboardEditor.row.slotAccepts.audio',
}

type Editing = {
  mode: ArchetypeMode | null
  bindings: ReferenceBindingMap | undefined
  onChangeBindings: (next: ReferenceBindingMap) => void
}

/** 放一张 / 传一张：拒绝理由都用人话说清（§1.6：禁用不做沟通死路）。两处入口共用这一份。 */
function useReferenceIntake({ bindings, onChangeBindings }: Omit<Editing, 'mode'>) {
  const { t } = useTranslation()
  const [uploadingKey, setUploadingKey] = React.useState('')
  const [error, setError] = React.useState('')
  const identity = React.useId()
  const report = React.useCallback((message: string) => {
    notify({ identity: `storyboard-reference:${identity}`, reason: 'reference-input', level: 'inline', type: 'error', message, present: setError })
  }, [identity])

  const append = (slot: ArchetypeReferenceSlot, label: string, url: string, kind: AssetKind, extra: { name?: string; sourceNodeId?: string }): boolean => {
    setError('')
    const result = appendBinding(bindings, slot, { url, ...extra }, kind)
    if (result.status === 'wrong-kind') { report(t(WRONG_KIND_KEY[result.accept], { label })); return false }
    if (result.status === 'full') { report(t('storyboardEditor.row.slotFull', { label, max: result.max })); return false }
    if (result.status === 'added') onChangeBindings(result.next)
    return true
  }

  const upload = async (slot: ArchetypeReferenceSlot, label: string, file: File, onDone: () => void): Promise<void> => {
    await withProjectAction(async (context) => {
      setUploadingKey(slot.kind)
      try {
        const kind: AssetKind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image'
        const uploaded = await importWorkbenchLocalAssetFile(file, file.name || label, {
          projectBinding: context.binding, assertCurrent: context.assertCurrent,
          ...(kind === 'image' ? { taskKind: 'image_edit' as const } : {}),
        })
        context.assertCurrent()
        if (append(slot, label, assetUrl(uploaded), kind, { name: uploaded.name || file.name })) onDone()
      } catch (cause) {
        if (!isProjectExecutionContextCurrent(context) || isProjectImportCancellation(cause)) return
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (isProjectExecutionContextCurrent(context)) setUploadingKey('')
      }
    })
  }

  return { append, upload, uploadingKey, error }
}

/** 这一行摆着的参考（有一张以上才渲染）。 */
export default function ShotReferenceStrip({
  mode, bindings, onChangeBindings, onRemove, onInsertMention, hiddenSlotKeys,
}: Editing & {
  /** 删一张：调用方负责把提示词里对应的 @ 一起删（`removeReferenceWithMention`）。 */
  onRemove: (slotKey: string, index: number) => void
  /** 点缩略图 = 在提示词光标处插一枚指向它的 @（画布同一手势）。 */
  onInsertMention?: ((url: string) => void) | undefined
  /** 生成时会被计划首帧填上的槽：不摆出来（不是用户摆的参考，删不掉也换不了）。 */
  hiddenSlotKeys?: ReadonlySet<string> | undefined
}): JSX.Element | null {
  const projectId = useOpenProjectId()
  const [openSlotKey, setOpenSlotKey] = React.useState('')
  const { append, upload, uploadingKey, error } = useReferenceIntake({ bindings, onChangeBindings })
  const slots = storyboardAssetSlots(mode).filter((slot) => !hiddenSlotKeys?.has(slot.key))
  if (!hasShownReferences(mode, bindings, hiddenSlotKeys)) return null
  const declared = (slot: AssetSlot) => mode?.slots.find((candidate) => candidate.kind === slot.key)
  const valuesByKey: Record<string, string | string[]> = Object.fromEntries(slots.map((slot) => {
    const urls = bindingsOf(bindings, slot.key).map((binding) => binding.url)
    return [slot.key, slot.form === 'array' ? urls : urls[0] ?? '']
  }))
  return (
    <div className="px-2.5 pt-2" data-storyboard-refs="true">
      <AssetReference
        slots={slots}
        valuesByKey={valuesByKey}
        projectId={projectId}
        openSlotKey={openSlotKey}
        uploadingSlotKey={uploadingKey}
        onTogglePicker={(key) => setOpenSlotKey((previous) => (previous === key ? '' : key))}
        onPick={(slot, asset: AssetRef) => {
          const target = declared(slot)
          if (target && append(target, slot.label, asset.renderUrl, asset.kind, {
            name: asset.name,
            ...(asset.origin.source === 'canvas' ? { sourceNodeId: asset.origin.nodeId } : {}),
          })) setOpenSlotKey('')
        }}
        onUpload={(slot, file) => { const target = declared(slot); if (target) void upload(target, slot.label, file, () => setOpenSlotKey('')) }}
        onRemove={(slot, index) => onRemove(slot.key, index)}
        {...(onInsertMention ? { onInsertMention } : {})}
        onReorder={(slot, from, to) => { const next = reorderBinding(bindings, slot.key, from, to); if (next) onChangeBindings(next) }}
        onBrowseAll={() => { setOpenSlotKey(''); window.dispatchEvent(new CustomEvent('nomi-open-files-panel')) }}
      />
      {error ? <span className="mt-1 block text-micro leading-tight text-workbench-danger" role="alert">{error}</span> : null}
    </div>
  )
}

/**
 * 一张参考都没有时，底栏里那颗「加参考」图标按钮。点开是同一个素材选择器（`AssetPicker`）。
 * 放进哪个槽：当前模式的图片参考槽，没有就首帧槽；当前模式一个槽都没有 → 切到同模型能收参考图的模式再放。
 */
export function ShotReferenceAddButton({
  mode, archetype, bindings, onChangeBindings, onSwitchMode,
}: Editing & {
  archetype?: ModelArchetype | null
  /** 允许切模式（已出过结果的行不传：切了就和它手上的结果对不上）。 */
  onSwitchMode?: ((modeId: string) => void) | undefined
}): JSX.Element | null {
  const { t } = useTranslation()
  const projectId = useOpenProjectId()
  const [open, setOpen] = React.useState(false)
  const { append, upload, uploadingKey, error } = useReferenceIntake({ bindings, onChangeBindings })
  const own = mode?.slots.find((slot) => slot.kind === 'image_ref') ?? mode?.slots.find((slot) => slot.kind === 'first_frame') ?? mode?.slots[0]
  const switchTo = own ? null : onSwitchMode ? imageReferenceMode(archetype) : null
  const slot = own ?? switchTo?.slots.find((candidate) => candidate.kind === 'image_ref') ?? null
  if (!slot) return null
  const accept = slot.kind === 'video_ref' ? 'video' : slot.kind === 'audio_ref' ? 'audio' : 'image'
  const label = t('assetLibrary.addReference')
  const commit = (place: () => boolean): void => {
    if (switchTo) onSwitchMode?.(switchTo.id)
    if (place()) setOpen(false)
  }
  return (
    <span className="relative inline-flex shrink-0" data-storyboard-ref-add={switchTo ? 'switch-mode' : 'own'}>
      <WorkbenchIconButton size="sm" icon={<IconPhotoPlus aria-hidden />} label={label} aria-expanded={open} onClick={() => setOpen((value) => !value)} />
      {open ? (
        <AssetPickerPopover onClose={() => setOpen(false)}>
          <AssetPicker
            projectId={projectId}
            accept={[accept]}
            uploading={uploadingKey === slot.kind}
            onPick={(asset) => commit(() => append(slot, label, asset.renderUrl, asset.kind, {
              name: asset.name,
              ...(asset.origin.source === 'canvas' ? { sourceNodeId: asset.origin.nodeId } : {}),
            }))}
            onUpload={(file) => { if (switchTo) onSwitchMode?.(switchTo.id); void upload(slot, label, file, () => setOpen(false)) }}
            onBrowseAll={() => { setOpen(false); window.dispatchEvent(new CustomEvent('nomi-open-files-panel')) }}
          />
        </AssetPickerPopover>
      ) : null}
      {error ? <span className="ml-1 self-center text-micro leading-tight text-workbench-danger" role="alert">{error}</span> : null}
    </span>
  )
}
