import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlus } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import { showInfoToast } from '../../../../utils/showInfoToast'
import { getDesktopActiveProjectId } from '../../../../desktop/activeProject'
import type { AssetKind, AssetRef } from '../../../assets/assetTypes'
import { importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import { assetUrl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import type { ArchetypeMode } from '../../../../config/modelArchetypes/types'
import type { PlanAnchor } from '../../../generationCanvas/agent/storyboardPlan'
import { appendBinding, bindingsOf, removeBinding, reorderBinding, type ReferenceBindingMap } from './shotReferenceSlots'
import { cellCount, referenceColumnOf, type ShotReferenceCell } from './shotReferenceCells'
import ShotReferenceSlotPopover from './ShotReferenceSlotPopover'

/**
 * 分镜行的参考列（合同 v6 §4）——**固定 200px、单行、一个槽一个格、永不换行**。
 *
 * 与 v5 的差别是"格的单位"变了：v5 一张图一个格（30 图的槽会把行撑爆），v6 一个槽一个格
 * ——装几张都只占一格，多张画成**手抓扑克**叠放 + 计数角标，点开是浮层网格加删排序。
 * 行高因此稳定，表格才扫得动。
 *
 * 槽本身仍由**档案声明**驱动（`shotReferenceCells` 从 `ArchetypeMode.slots` derive，
 * 键用跨供应商稳定的 `slot.kind`），上传/素材库/引用四条入口仍复用现役 `AssetPicker`——
 * 参考槽的声明式数据与选择器都已存在，这里不新造（见 docs/lessons/nomi-reference-slots-are-already-declarative）。
 * 新的只有**行内的排布方式**，那正是本合同要求与画布节点不同的地方。
 */

type Props = {
  mode: ArchetypeMode | null
  /** 这一行的绑定桶。镜头行传 `shot.referenceBindings`，锚展开行传 `anchor.referenceBindings`——
   *  两者共用同一套参考列解剖（合同 §2.2），所以这里收的是绑定记录而不是某一种行的实体。 */
  bindings: ReferenceBindingMap | undefined
  onChangeBindings: (next: ReferenceBindingMap) => void
  anchors: readonly PlanAnchor[]
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

/**
 * 叠放格（手抓扑克，合同 §2.6/§6.3）：第一张正放在最上面，后面两张以**左下角为轴**
 * （`transform-origin: 20% 100%`）向右上各转 13°/26°，露出右上角；右下角落 `N/max` 计数角标。
 * 只画前三张——叠放是"这里不止一张"的信号，不是缩略图列表；全部内容在点开的浮层里。
 */
function SlotStack({ cell }: { cell: ShotReferenceCell }): JSX.Element {
  const { used, total } = cellCount(cell)
  const top = cell.bindings.slice(0, 3)
  return (
    <span className="relative block h-14 w-14" data-storyboard-ref-stack={cell.key}>
      {top.map((binding, index) => (
        <span
          key={`${binding.url}-${index}`}
          className="absolute inset-0 overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05"
          style={{
            transformOrigin: '20% 100%',
            transform: `rotate(${index * 13}deg)`,
            zIndex: 3 - index,
          }}
        >
          <NomiImage src={binding.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </span>
      ))}
      {cell.numbered ? (
        <span className="absolute left-0 top-0 z-[4] rounded-br-nomi-sm bg-nomi-overlay-chip px-1 text-micro text-nomi-paper tabular-nums">1</span>
      ) : null}
      <span
        className="absolute -bottom-0.5 -right-0.5 z-[4] rounded-nomi-sm bg-nomi-overlay-chip-strong px-1 text-micro text-nomi-paper tabular-nums"
        data-storyboard-ref-stack-count={used}
      >
        {total === null ? used : `${used}/${total}`}
      </span>
    </span>
  )
}

export default function ShotReferenceZone({ mode, bindings, onChangeBindings, anchors, onTriggerMention, mentionEnabled }: Props): JSX.Element {
  const { t } = useTranslation()
  const [openSlotKey, setOpenSlotKey] = React.useState('')
  const [uploadingSlotKey, setUploadingSlotKey] = React.useState('')
  const [uploadError, setUploadError] = React.useState('')
  const column = referenceColumnOf(mode, bindings)
  const anchorsById = React.useMemo(() => new Map(anchors.map((anchor) => [anchor.id, anchor])), [anchors])

  // 拒绝理由都用人话说清「为什么不行」，不做沉默失败（§1.6：禁用不做沟通死路）。
  const applyAppend = React.useCallback(
    (cell: ShotReferenceCell, url: string, kind: AssetKind, extra: { name?: string; sourceNodeId?: string }) => {
      const result = appendBinding(bindings, cell.declared, { url, ...extra }, kind)
      if (result.status === 'wrong-kind') {
        showInfoToast(t(WRONG_KIND_KEY[result.accept], { label: cell.label }))
        return
      }
      if (result.status === 'full') {
        showInfoToast(t('storyboardEditor.row.slotFull', { label: cell.label, max: result.max }))
        return
      }
      if (result.status === 'duplicate') return
      onChangeBindings(result.next)
    },
    [bindings, onChangeBindings, t],
  )

  const handleUpload = React.useCallback(
    async (cell: ShotReferenceCell, file: File) => {
      const kind = assetKindOfFile(file)
      if (kind !== cell.assetSlot.accept) {
        if (cell.assetSlot.accept !== 'model3d') showInfoToast(t(WRONG_KIND_KEY[cell.assetSlot.accept], { label: cell.label }))
        return
      }
      setUploadingSlotKey(cell.key)
      setUploadError('')
      try {
        const uploaded = await importWorkbenchLocalAssetFile(file, file.name || cell.label, {
          ...(cell.assetSlot.accept === 'image' ? { taskKind: 'image_edit' as const } : {}),
        })
        applyAppend(cell, assetUrl(uploaded), kind, { name: uploaded.name || file.name })
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : String(error))
      } finally {
        setUploadingSlotKey('')
      }
    },
    [applyAppend, t],
  )

  /** 这一次引用的「要忽略的特征」：写在**槽的这条绑定**上，不回写锚（§4.4）。 */
  const changeIgnore = React.useCallback(
    (cell: ShotReferenceCell, index: number, ignore: string) => {
      const current = bindingsOf(bindings, cell.key)
      if (index < 0 || index >= current.length) return
      const next = current.map((binding, position) => (position === index ? { ...binding, ignore } : binding))
      onChangeBindings({ ...(bindings ?? {}), [cell.key]: next })
    },
    [bindings, onChangeBindings],
  )

  /**
   * caption 只写**名字**：空槽写槽名（首帧/尾帧/参考图），有内容写来源名（锚名/素材名）。
   * 必填与否靠**颜色**说（红=必填、灰=可选）——56px 宽的 caption 塞不下「（必填）」，塞了就被截成
   * 「参考音频…」，红/灰的信号还在、括号里的字反而没了。完整说法留在 title（hover 可见）。
   */
  const captionOf = (cell: ShotReferenceCell): { text: string; title: string; danger: boolean } => {
    const title = cell.required
      ? t('storyboardEditor.slot.requiredCaption', { label: cell.label })
      : t('storyboardEditor.slot.optionalCaption', { label: cell.label })
    if (cell.bindings.length === 0) return { text: cell.label, title, danger: cell.required }
    const first = cell.bindings[0]
    const anchor = first.anchorId ? anchorsById.get(first.anchorId) ?? null : null
    return { text: anchor?.name.trim() || first.name?.trim() || cell.label, title, danger: false }
  }

  return (
    // 200px 固定、nowrap。槽数 >3 的模式今天不存在（合同 §4.1 按六种真实档案定的上限），
    // 真出现时这一行横向滚动——宁可滚，也不换行（换行 = 行高不稳 = 表格扫不动），更不静默丢槽。
    <div
      className="flex w-[200px] min-h-[135px] shrink-0 flex-col justify-center gap-2 overflow-x-auto"
      data-storyboard-refzone="true"
    >
      {column.kind === 'none-accepted' ? (
        <span className="text-micro leading-relaxed text-nomi-ink-30">{t('storyboardEditor.row.noRefAccepted')}</span>
      ) : column.kind === 'unknown-contract' ? (
        // 契约未知（默认模型无档案）：不假装知道能收什么，退回通用「@」入口。
        <span className="flex flex-col items-center gap-0.5 self-start" data-storyboard-ref-slot="__mention__">
          <button
            type="button"
            onClick={mentionEnabled ? onTriggerMention : undefined}
            disabled={!mentionEnabled}
            aria-label={t('storyboardEditor.row.atRefAria')}
            title={mentionEnabled ? t('storyboardEditor.row.atRefTitle') : t('storyboardEditor.row.atRefDisabledTitle')}
            className={cn(
              'grid size-14 place-items-center rounded-nomi-sm border border-dashed text-title',
              mentionEnabled
                ? 'border-nomi-ink-20 text-nomi-ink-40 hover:border-nomi-accent hover:text-nomi-accent'
                : 'cursor-not-allowed border-nomi-ink-20 text-nomi-ink-20',
            )}
          >
            @
          </button>
          <span className={cn('text-micro', mentionEnabled ? 'text-nomi-ink-40' : 'text-nomi-ink-20')}>
            {t('storyboardEditor.row.refIntakeCap')}
          </span>
        </span>
      ) : (
        <div className="flex flex-nowrap items-start gap-2">
          {column.cells.map((cell) => {
            const caption = captionOf(cell)
            const first = cell.bindings[0]
            return (
              <span key={cell.key} className="relative flex shrink-0 flex-col items-center gap-0.5" data-storyboard-ref-slot={cell.key}>
                <button
                  type="button"
                  onClick={() => setOpenSlotKey((previous) => (previous === cell.key ? '' : cell.key))}
                  aria-label={t('storyboardEditor.slot.openAria', { label: cell.label })}
                  className="rounded-nomi-sm"
                >
                  {cell.bindings.length >= 2 ? (
                    <SlotStack cell={cell} />
                  ) : first ? (
                    <span
                      className="relative block size-14 overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05"
                      data-storyboard-ref-tile={cell.key}
                    >
                      <NomiImage src={first.url} alt={caption.text} className="absolute inset-0 h-full w-full object-cover" />
                      {cell.numbered ? (
                        <span className="absolute left-0 top-0 rounded-br-nomi-sm bg-nomi-overlay-chip px-1 text-micro text-nomi-paper tabular-nums">1</span>
                      ) : null}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'grid size-14 place-items-center rounded-nomi-sm border border-dashed',
                        cell.required
                          ? 'border-workbench-danger bg-workbench-danger-soft text-workbench-danger'
                          : 'border-nomi-ink-20 text-nomi-ink-30 hover:border-nomi-accent hover:text-nomi-accent',
                      )}
                      data-storyboard-ref-tile={cell.key}
                    >
                      <IconPlus size={16} stroke={1.8} />
                    </span>
                  )}
                </button>
                <span className={cn('max-w-14 truncate text-micro', caption.danger ? 'text-workbench-danger' : 'text-nomi-ink-40')} title={caption.title}>
                  {caption.text}
                </span>
                {openSlotKey === cell.key ? (
                  <ShotReferenceSlotPopover
                    cell={cell}
                    projectId={getDesktopActiveProjectId() || null}
                    uploading={uploadingSlotKey === cell.key}
                    anchorsById={anchorsById}
                    onPick={(asset: AssetRef) => applyAppend(cell, asset.renderUrl, asset.kind, {
                      name: asset.name,
                      ...(asset.origin.source === 'canvas' ? { sourceNodeId: asset.origin.nodeId } : {}),
                    })}
                    onUpload={(file) => { void handleUpload(cell, file) }}
                    onRemove={(index) => { const next = removeBinding(bindings, cell.key, index); if (next) onChangeBindings(next) }}
                    onReorder={(from, to) => { const next = reorderBinding(bindings, cell.key, from, to); if (next) onChangeBindings(next) }}
                    onChangeIgnore={(index, ignore) => changeIgnore(cell, index, ignore)}
                    onBrowseAll={() => { setOpenSlotKey(''); window.dispatchEvent(new CustomEvent('nomi-open-files-panel')) }}
                    onClose={() => setOpenSlotKey('')}
                  />
                ) : null}
              </span>
            )
          })}
        </div>
      )}
      {uploadError ? (
        <span className="text-micro leading-tight text-workbench-danger" role="alert">{uploadError}</span>
      ) : null}
    </div>
  )
}
