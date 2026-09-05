import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../utils/cn'
import { showInfoToast } from '../../../../utils/showInfoToast'
import { getDesktopActiveProjectId } from '../../../../desktop/activeProject'
import AssetReference, { type AssetSlot } from '../../../assets/AssetReference'
import type { AssetKind, AssetRef } from '../../../assets/assetTypes'
import { importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import { assetUrl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import type { ArchetypeMode } from '../../../../config/modelArchetypes/types'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import type { ReferenceZoneView } from './shotRowModel'
import { appendShotBinding, removeShotBinding, reorderShotBinding } from './shotReferenceSlots'

/**
 * 分镜行的参考区（第三列）。**复用画布节点那套参考槽组件**（AssetReference → AssetTile / AssetPicker），
 * 不另造一套（P1）：上传、素材库、引用某镜结果、引用参考卡四条入口全在 AssetPicker 里，
 * 「视频槽拒图片、图片槽拒视频」「超上限拒绝」由 appendShotBinding 按档案声明判（P4，零供应商分支）。
 *
 * 与画布的唯一差别：分镜行没有画布边（行是 plan 上的编辑态，节点可能还没建），所以所有槽
 * `persistAsEdge: false`，值住 `shot.referenceBindings`，落画布时才投影进节点 meta。
 */

type Props = {
  zone: ReferenceZoneView
  mode: ArchetypeMode | null
  shot: PlanShot
  onUpdate: (patch: Partial<PlanShot>) => void
  /** 通用「@」入口（契约未知的默认模型行）；缺省 = 该行禁用 @。 */
  onTriggerMention?: (() => void) | undefined
  mentionEnabled: boolean
}

/** 槽只收某一种媒体时的人话拒绝理由。写成静态映射而非动态键——动态键会在门岗外静默漏译。 */
const WRONG_KIND_KEY: Record<'image' | 'video' | 'audio', string> = {
  image: 'storyboardEditor.row.slotAccepts.image',
  video: 'storyboardEditor.row.slotAccepts.video',
  audio: 'storyboardEditor.row.slotAccepts.audio',
}

function assetKindOfFile(file: File): AssetKind {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'image'
}

export default function ShotReferenceZone({ zone, mode, shot, onUpdate, onTriggerMention, mentionEnabled }: Props): JSX.Element {
  const { t } = useTranslation()
  const [openSlotKey, setOpenSlotKey] = React.useState('')
  const [uploadingSlotKey, setUploadingSlotKey] = React.useState('')
  const [uploadError, setUploadError] = React.useState('')

  const declaredSlot = React.useCallback(
    (key: string) => mode?.slots.find((slot) => slot.kind === key) ?? null,
    [mode],
  )

  // 拒绝理由都用人话说清「为什么不行」，不做沉默失败（§1.6：禁用不做沟通死路）。
  const applyAppend = React.useCallback(
    (assetSlot: AssetSlot, url: string, kind: AssetKind, extra: { name?: string; sourceNodeId?: string; anchorId?: string }) => {
      const slot = declaredSlot(assetSlot.key)
      if (!slot) return
      const result = appendShotBinding(shot, slot, { url, ...extra }, kind)
      if (result.status === 'wrong-kind') {
        showInfoToast(t(WRONG_KIND_KEY[result.accept], { label: assetSlot.label }))
        return
      }
      if (result.status === 'full') {
        showInfoToast(t('storyboardEditor.row.slotFull', { label: assetSlot.label, max: result.max }))
        return
      }
      if (result.status === 'duplicate') return
      onUpdate(result.patch)
      setOpenSlotKey('')
    },
    [declaredSlot, onUpdate, shot, t],
  )

  const handlePick = React.useCallback(
    (assetSlot: AssetSlot, asset: AssetRef) => {
      applyAppend(assetSlot, asset.renderUrl, asset.kind, {
        name: asset.name,
        ...(asset.origin.source === 'canvas' ? { sourceNodeId: asset.origin.nodeId } : {}),
      })
    },
    [applyAppend],
  )

  const handleUpload = React.useCallback(
    async (assetSlot: AssetSlot, file: File) => {
      const kind = assetKindOfFile(file)
      if (kind !== assetSlot.accept) {
        if (assetSlot.accept !== 'model3d') showInfoToast(t(WRONG_KIND_KEY[assetSlot.accept], { label: assetSlot.label }))
        return
      }
      setUploadingSlotKey(assetSlot.key)
      setUploadError('')
      try {
        const uploaded = await importWorkbenchLocalAssetFile(file, file.name || assetSlot.label, {
          ...(assetSlot.accept === 'image' ? { taskKind: 'image_edit' } : {}),
        })
        applyAppend(assetSlot, assetUrl(uploaded), kind, { name: uploaded.name || file.name })
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : String(error))
      } finally {
        setUploadingSlotKey('')
      }
    },
    [applyAppend, t],
  )

  const handleRemove = React.useCallback(
    (assetSlot: AssetSlot, index: number) => {
      const patch = removeShotBinding(shot, assetSlot.key, index)
      if (patch) onUpdate(patch)
    },
    [onUpdate, shot],
  )

  const handleReorder = React.useCallback(
    (assetSlot: AssetSlot, from: number, to: number) => {
      const patch = reorderShotBinding(shot, assetSlot.key, from, to)
      if (patch) onUpdate(patch)
    },
    [onUpdate, shot],
  )

  const anchors: PlanAnchor[] = zone.kind === 'none-accepted' ? [] : zone.referencedAnchors

  return (
    <div className="min-h-[132px] flex flex-col justify-center gap-2" data-storyboard-refzone="true">
      {zone.kind === 'none-accepted' ? (
        <span className="text-micro text-nomi-ink-30 leading-relaxed">{t('storyboardEditor.row.noRefAccepted')}</span>
      ) : (
        <>
          {zone.kind === 'slots' ? (
            <AssetReference
              slots={zone.slots}
              valuesByKey={zone.valuesByKey}
              projectId={getDesktopActiveProjectId() || null}
              openSlotKey={openSlotKey}
              uploadingSlotKey={uploadingSlotKey}
              onTogglePicker={(key) => setOpenSlotKey((prev) => (prev === key ? '' : key))}
              onPick={handlePick}
              onUpload={(assetSlot, file) => {
                void handleUpload(assetSlot, file)
              }}
              onRemove={handleRemove}
              onReorder={handleReorder}
              onBrowseAll={() => {
                setOpenSlotKey('')
                window.dispatchEvent(new CustomEvent('nomi-open-files-panel'))
              }}
            />
          ) : null}

          {/* 已引用的参考卡（锚）——关系住 shot.anchorIds，与按槽绑定并存：一个是「这镜用了哪张卡」，
              一个是「这张图放进哪个槽」。 */}
          {anchors.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {anchors.map((anchor) => (
                <span key={anchor.id} className="flex flex-col items-center gap-0.5">
                  <span data-storyboard-ref-tile="anchor" className="grid place-items-center w-14 h-14 rounded-nomi-sm border border-nomi-line bg-nomi-ink-10 text-title text-nomi-ink-60">
                    {(anchor.name || t('storyboardEditor.unnamed')).slice(0, 1)}
                  </span>
                  <span className="text-micro text-nomi-ink-40 max-w-14 truncate">{anchor.name || t('storyboardEditor.unnamed')}</span>
                </span>
              ))}
            </div>
          ) : null}

          {/* 契约未知（默认模型无档案）：不假装知道能收什么，退回通用「@」入口。 */}
          {zone.kind === 'unknown-contract' ? (
            <span className="flex flex-col items-center gap-0.5 self-start">
              {mentionEnabled ? (
                <button
                  type="button"
                  onClick={onTriggerMention}
                  aria-label={t('storyboardEditor.row.atRefAria')}
                  title={t('storyboardEditor.row.atRefTitle')}
                  data-storyboard-ref-tile="intake"
                  className="grid place-items-center w-14 h-14 rounded-nomi-sm border border-dashed border-nomi-ink-20 text-title text-nomi-ink-40 hover:border-nomi-accent hover:text-nomi-accent transition-colors duration-[var(--nomi-transition-fast)]"
                >
                  @
                </button>
              ) : (
                <span
                  data-storyboard-ref-tile="intake"
                  className="grid place-items-center w-14 h-14 rounded-nomi-sm border border-dashed border-nomi-ink-20 text-title text-nomi-ink-20 cursor-not-allowed"
                  title={t('storyboardEditor.row.atRefDisabledTitle')}
                  aria-hidden
                >
                  @
                </span>
              )}
              <span className={cn('text-micro', mentionEnabled ? 'text-nomi-ink-40' : 'text-nomi-ink-20')}>
                {t('storyboardEditor.row.refIntakeCap')}
              </span>
            </span>
          ) : null}

          {uploadError ? (
            <span className="text-micro text-workbench-danger leading-tight" role="alert">{uploadError}</span>
          ) : null}
        </>
      )}
    </div>
  )
}
