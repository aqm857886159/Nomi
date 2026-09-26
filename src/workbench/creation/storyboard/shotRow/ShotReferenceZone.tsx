import React from 'react'
import { isProjectExecutionContextCurrent, isProjectImportCancellation, withProjectAction } from '../../../project/projectCanvasReadSurface'
import { useTranslation } from 'react-i18next'
import { IconPhoto, IconPlus } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import { notify } from '../../../../ui/notificationPolicy'
import { useOpenProjectId } from '../../../project/useOpenProjectId'
import type { AssetKind, AssetRef } from '../../../assets/assetTypes'
import { importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import { assetUrl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import type { ModelArchetype, ArchetypeMode, ArchetypeReferenceSlot } from '../../../../../electron/shared/modelArchetypes/types'
import type { PlanAnchor } from '../../../generationCanvas/agent/storyboardPlan'
import type { PlannedFirstFrame } from '../exec/storyboardRowStatus'
import { appendBinding, bindingsOf, removeBinding, reorderBinding, type ReferenceBindingMap } from './shotReferenceSlots'
import { cellCount, referenceColumnOf, type ShotReferenceCell } from './shotReferenceCells'
import ShotReferenceSlotPopover from './ShotReferenceSlotPopover'
import { referenceColumnWidthOf, useStoryboardRowNarrow } from './storyboardRowDensity'
import {
  REFERENCE_SLOT_BOX,
  REFERENCE_SLOT_GAP,
  REFERENCE_STACK_ANGLES,
  REFERENCE_STACK_CARD_HEIGHT,
  REFERENCE_STACK_CARD_WIDTH,
  REFERENCE_STACK_VISIBLE_CARDS,
  referenceStackBox,
} from './shotReferenceStackGeometry'

/**
 * 分镜行的参考列（合同 v6 §4）——**固定宽度、单行、一个槽一个格、永不换行**。
 *
 * 与 v5 的差别是"格的单位"变了：v5 一张图一个格（30 图的槽会把行撑爆），v6 一个槽一个格
 * ——装几张都只占一格，多张画成**手抓扑克**叠放 + 计数角标，点开是浮层网格加删排序。
 * 行高因此稳定，表格才扫得动。
 *
 * 槽本身仍由**档案声明**驱动（`shotReferenceCells` 从 `ArchetypeMode.slots` derive，
 * 键用跨供应商稳定的 `slot.kind`），上传/素材库/引用四条入口仍复用现役 `AssetPicker`——
 * 参考槽的声明式数据与选择器都已存在，这里不新造（见 docs/lessons/nomi-reference-slots-are-already-declarative）。
 * 新的只有**行内的排布方式**，那正是本合同要求与画布节点不同的地方。
 *
 * **窄档（2026-09-21 样张 v1）**：编辑器被左栏挤到 585px 时，这一列从「三格 211px」收成
 * 「一格 65px + 『+N』」，省下的 146px 全给提示词列。参考卡是**已经定好的**、提示词是**正在写的**，
 * 空间不够时让前者；收成一格后信息没丢——「+N」点一下就摊开，摊开的还是这同一排格子，
 * 不是第二套渲染。判据与到期条件（T-DS-01 · A-2 落地即收回）都在 `storyboardRowDensity.ts`。
 */

type Props = {
  mode: ArchetypeMode | null
  /** 该行模型的整份档案。只用来回答一个问题：**这个模型还有别的模式吃参考吗**
   *  （不吃参考那一行要不要指出去处）。缺省 = 不指去处，不编。 */
  archetype?: ModelArchetype | null
  /** 这一行的绑定桶。镜头行传 `shot.referenceBindings`，锚展开行传 `anchor.referenceBindings`——
   *  两者共用同一套参考列解剖（合同 §2.2），所以这里收的是绑定记录而不是某一种行的实体。 */
  bindings: ReferenceBindingMap | undefined
  onChangeBindings: (next: ReferenceBindingMap) => void
  /**
   * 这一行**缺**的必填槽（`shotRowModel.missingRequiredSlotsOf` 的结果；镜头行 = `exec.missingSlots`）。
   * 红格只看它——不在这里拿「必填 + 没绑定」另判一遍：那样看不见计划首帧、看不见锚，
   * 行状态说不缺、这里照样红（0.22.0 误报）。
   */
  missingSlots: readonly ArchetypeReferenceSlot[]
  /** 计划首帧（`exec.plannedFirstFrame`）：生成时会填进的那一格画成首帧，而不是空格。锚行没有 → 缺省。 */
  plannedFirstFrame?: PlannedFirstFrame | null
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
 *
 * 尺寸全部来自 `REFERENCE_SLOT_BOX`：**格子按扇面全开的包围盒占位，不按这一槽装了几张占位**。
 * 卡片自己是 44×56，扇开之后要占到 65×73——少预留那一圈，扇面就压到右边的槽和下面的 caption 上；
 * 按张数动态占位则会让每个槽、每一行高高低低（2026-09-06 用户反馈四），所以这只盒是**固定**的。
 */
/**
 * 一格里要画的卡：计划首帧排最前（落画布后首帧边先于上传落槽，发出去也是第一张），其后是已绑定的素材。
 * 计划首帧还没生成时 url = null——画一张占位卡，不是空格，更不是红格：生成时这一格会被它填上。
 */
type SlotTile = { url: string | null; planned: boolean }

function slotTilesOf(cell: ShotReferenceCell, planned: PlannedFirstFrame | null): SlotTile[] {
  return [
    ...(planned ? [{ url: planned.url, planned: true }] : []),
    ...cell.bindings.map((binding) => ({ url: binding.url, planned: false })),
  ]
}

function TileFace({ tile, alt }: { tile: SlotTile; alt: string }): JSX.Element {
  if (tile.url) return <NomiImage src={tile.url} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
  return (
    <span className="absolute inset-0 grid place-items-center text-nomi-ink-30" aria-hidden>
      <IconPhoto size={16} stroke={1.6} />
    </span>
  )
}

function SlotStack({ cell, tiles }: { cell: ShotReferenceCell; tiles: readonly SlotTile[] }): JSX.Element {
  const { used, total } = cellCount(cell, tiles.filter((tile) => tile.planned).length)
  const box = referenceStackBox(tiles.length)
  const top = tiles.slice(0, REFERENCE_STACK_VISIBLE_CARDS)
  return (
    <span
      className="relative block"
      data-storyboard-ref-stack={cell.key}
      style={{ width: `${box.width}px`, height: `${box.height}px` }}
    >
      {top.map((tile, index) => (
        <span
          key={`${tile.url ?? 'planned'}-${index}`}
          className="absolute overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05"
          {...(tile.planned ? { 'data-storyboard-ref-planned': 'first-frame' } : {})}
          style={{
            left: `${box.cardLeft}px`,
            top: `${box.cardTop}px`,
            width: `${REFERENCE_STACK_CARD_WIDTH}px`,
            height: `${REFERENCE_STACK_CARD_HEIGHT}px`,
            transformOrigin: '20% 100%',
            transform: `rotate(${REFERENCE_STACK_ANGLES[index] ?? 0}deg)`,
            zIndex: REFERENCE_STACK_VISIBLE_CARDS - index,
          }}
        >
          <TileFace tile={tile} alt="" />
        </span>
      ))}
      {cell.numbered ? (
        <span
          className="absolute z-[4] rounded-br-nomi-sm bg-nomi-overlay-chip px-1 text-micro text-nomi-media-ink tabular-nums"
          style={{ left: `${box.cardLeft}px`, top: `${box.cardTop}px` }}
        >
          1
        </span>
      ) : null}
      {/* 角标落在预留框的右下角——扇面最低点在它左上方，两者不叠，也不会被格子裁掉。 */}
      <span
        className="absolute bottom-0 right-0 z-[4] rounded-nomi-sm bg-nomi-overlay-chip-strong px-1 text-micro text-nomi-media-ink tabular-nums"
        data-storyboard-ref-stack-count={used}
      >
        {total === null ? used : `${used}/${total}`}
      </span>
    </span>
  )
}

export default function ShotReferenceZone({ mode, archetype, bindings, onChangeBindings, missingSlots, plannedFirstFrame, anchors, onTriggerMention, mentionEnabled }: Props): JSX.Element {
  const openProjectId = useOpenProjectId()
  const { t } = useTranslation()
  const narrow = useStoryboardRowNarrow()
  const [expanded, setExpanded] = React.useState(false)
  // 回到宽档就没有「摊开」这回事了——留着的话再窄下来时会以展开态出场。
  React.useEffect(() => { if (!narrow) setExpanded(false) }, [narrow])
  const [openSlotKey, setOpenSlotKey] = React.useState('')
  const [uploadingSlotKey, setUploadingSlotKey] = React.useState('')
  const [uploadError, setUploadError] = React.useState('')
  const feedbackIdentity = React.useId()
  const report = React.useCallback((message: string) => {
    notify({ identity: `storyboard-reference:${feedbackIdentity}`, reason: 'reference-input', level: 'inline', type: 'error', message, present: setUploadError })
  }, [feedbackIdentity])
  const column = referenceColumnOf(mode, bindings, archetype)
  const anchorsById = React.useMemo(() => new Map(anchors.map((anchor) => [anchor.id, anchor])), [anchors])

  // 拒绝理由都用人话说清「为什么不行」，不做沉默失败（§1.6：禁用不做沟通死路）。
  const applyAppend = React.useCallback(
    (cell: ShotReferenceCell, url: string, kind: AssetKind, extra: { name?: string; sourceNodeId?: string }) => {
      setUploadError('')
      const result = appendBinding(bindings, cell.declared, { url, ...extra }, kind)
      if (result.status === 'wrong-kind') {
        report(t(WRONG_KIND_KEY[result.accept], { label: cell.label }))
        return
      }
      if (result.status === 'full') {
        report(t('storyboardEditor.row.slotFull', { label: cell.label, max: result.max }))
        return
      }
      if (result.status === 'duplicate') return
      onChangeBindings(result.next)
    },
    [bindings, onChangeBindings, report, t],
  )

  const handleUpload = React.useCallback(
    async (cell: ShotReferenceCell, file: File) => {
      setUploadError('')
      const kind = assetKindOfFile(file)
      if (kind !== cell.assetSlot.accept) {
        if (cell.assetSlot.accept !== 'model3d') report(t(WRONG_KIND_KEY[cell.assetSlot.accept], { label: cell.label }))
        return
      }
      await withProjectAction(async (context) => {
        setUploadingSlotKey(cell.key)
        setUploadError('')
        try {
          const uploaded = await importWorkbenchLocalAssetFile(file, file.name || cell.label, {
            projectBinding: context.binding, assertCurrent: context.assertCurrent,
            ...(cell.assetSlot.accept === 'image' ? { taskKind: 'image_edit' as const } : {}),
          })
          context.assertCurrent()
          applyAppend(cell, assetUrl(uploaded), kind, { name: uploaded.name || file.name })
        } catch (error) {
          if (!isProjectExecutionContextCurrent(context) || isProjectImportCancellation(error)) return
          setUploadError(error instanceof Error ? error.message : String(error))
        } finally {
          if (isProjectExecutionContextCurrent(context)) setUploadingSlotKey('')
        }
      })
    },
    [applyAppend, report, t],
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
   * 红只给**真的缺**的槽（`missingSlots`）：必填但生成时会被计划首帧或锚填上的槽不红。
   * 第一张是计划首帧 → 写「本镜首帧」，title 说清这一格生成时由它填。
   */
  const missingKinds = new Set(missingSlots.map((slot) => slot.kind))
  const plannedFor = (cell: ShotReferenceCell): PlannedFirstFrame | null =>
    plannedFirstFrame && plannedFirstFrame.slotKind === cell.key ? plannedFirstFrame : null
  const captionOf = (cell: ShotReferenceCell): { text: string; title: string; danger: boolean } => {
    const title = cell.required
      ? t('storyboardEditor.slot.requiredCaption', { label: cell.label })
      : t('storyboardEditor.slot.optionalCaption', { label: cell.label })
    const danger = missingKinds.has(cell.declared.kind)
    if (plannedFor(cell)) {
      return { text: t('storyboardEditor.slot.plannedFirstFrame'), title: t('storyboardEditor.slot.plannedFirstFrameTitle', { label: cell.label }), danger }
    }
    if (cell.bindings.length === 0) return { text: cell.label, title, danger }
    const first = cell.bindings[0]
    const anchor = first.anchorId ? anchorsById.get(first.anchorId) ?? null : null
    return { text: anchor?.name.trim() || first.name?.trim() || cell.label, title, danger }
  }

  // 窄档下这一列只露第一格；其余的藏在「+N」后面，点一下摊开（摊开的仍是同一排格子）。
  const collapsible = narrow && column.kind === 'cells' && column.cells.length > 1
  const shownCells = column.kind === 'cells'
    ? (collapsible && !expanded ? column.cells.slice(0, 1) : column.cells)
    : []
  const hiddenCellCount = column.kind === 'cells' ? column.cells.length - shownCells.length : 0

  return (
    // 列宽按档位来（宽档 = 三只固定盒 + 两个间距；窄档 = 一只盒）、nowrap。
    // 槽数 >3 的模式今天不存在（合同 §4.1 按六种真实档案定的上限），
    // 真出现时这一行横向滚动——宁可滚，也不换行（换行 = 行高不稳 = 表格扫不动），更不静默丢槽。
    // 顶对齐、不撑最小高：这一列要和左边的画面格共用同一条顶线（2026-09-06 用户反馈四）。
    // 上一版 `min-h-[135px] justify-center` 把参考卡垂直居中在 135px 里——16:9 的行画面格只有 77 高，
    // 参考卡却仍落在 135 的中线上，两列从此对不上。
    <div
      className={cn('relative flex shrink-0 flex-col items-start gap-2', narrow ? '' : 'overflow-x-auto')}
      style={{ width: referenceColumnWidthOf(narrow) }}
      data-storyboard-refzone="true"
      data-storyboard-refzone-density={narrow ? 'narrow' : 'wide'}
    >
      {column.kind === 'none-accepted' ? (column.switchTo ? (
        <span
          className={cn('text-micro leading-relaxed text-nomi-ink-30', narrow && 'line-clamp-3')}
          title={column.switchTo.modeLabel === column.switchTo.slotLabel
            ? t('storyboardEditor.row.noRefAcceptedSwitchSame', { mode: column.modeLabel, other: column.switchTo.modeLabel })
            : t('storyboardEditor.row.noRefAcceptedSwitch', { mode: column.modeLabel, other: column.switchTo.modeLabel, slot: column.switchTo.slotLabel })}
        >
          {/* 模式名和槽名撞词时（「首帧」模式的槽也叫「首帧」）换一句说法——
              「切「首帧」可挂首帧」读起来像卡带了。 */}
          {column.switchTo.modeLabel === column.switchTo.slotLabel
              ? t('storyboardEditor.row.noRefAcceptedSwitchSame', {
                  mode: column.modeLabel,
                  other: column.switchTo.modeLabel,
                })
              : t('storyboardEditor.row.noRefAcceptedSwitch', {
                  mode: column.modeLabel,
                  other: column.switchTo.modeLabel,
                  slot: column.switchTo.slotLabel,
                })}
        </span>
      ) : null) : column.kind === 'unknown-contract' ? (
        // 契约未知（默认模型无档案）：不假装知道能收什么，退回通用「@」入口。
        <span className="flex flex-col items-center gap-0.5 self-start" data-storyboard-ref-slot="__mention__">
          <button
            type="button"
            onClick={mentionEnabled ? onTriggerMention : undefined}
            disabled={!mentionEnabled}
            aria-label={t('storyboardEditor.row.atRefAria')}
            title={mentionEnabled ? t('storyboardEditor.row.atRefTitle') : t('storyboardEditor.row.atRefUnavailableTitle')}
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
        <div
          className={cn(
            'flex flex-nowrap items-start',
            // 摊开 = 同一排格子挪到浮层里画，不是第二套渲染；纸底 + 描边 + 投影才读得出它浮在提示词列上面。
            collapsible && expanded && 'absolute left-0 top-0 z-[5] rounded-nomi border border-nomi-line bg-nomi-paper p-1.5 shadow-nomi-md',
          )}
          style={{ gap: `${REFERENCE_SLOT_GAP}px` }}
          data-storyboard-refzone-expanded={collapsible && expanded ? 'true' : undefined}
        >
          {shownCells.map((cell, cellIndex) => {
            const caption = captionOf(cell)
            const tiles = slotTilesOf(cell, plannedFor(cell))
            const first = tiles[0]
            return (
              <span
                key={cell.key}
                className="relative flex shrink-0 flex-col items-start gap-0.5"
                style={{ width: `${REFERENCE_SLOT_BOX.width}px` }}
                data-storyboard-ref-slot={cell.key}
                data-storyboard-ref-state={caption.danger ? 'missing' : first ? 'filled' : 'empty'}
              >
                <button
                  type="button"
                  onClick={() => setOpenSlotKey((previous) => (previous === cell.key ? '' : cell.key))}
                  aria-label={t('storyboardEditor.slot.openAria', { label: cell.label })}
                  className="flex w-full items-start rounded-nomi-sm"
                  style={{ height: `${REFERENCE_SLOT_BOX.height}px` }}
                >
                  {tiles.length >= 2 ? (
                    <SlotStack cell={cell} tiles={tiles} />
                  ) : first ? (
                    <span
                      className="relative block size-14 overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05"
                      data-storyboard-ref-tile={cell.key}
                      {...(first.planned ? { 'data-storyboard-ref-planned': 'first-frame' } : {})}
                    >
                      <TileFace tile={first} alt={caption.text} />
                      {cell.numbered ? (
                        <span className="absolute left-0 top-0 rounded-br-nomi-sm bg-nomi-overlay-chip px-1 text-micro text-nomi-media-ink tabular-nums">1</span>
                      ) : null}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'grid size-14 place-items-center rounded-nomi-sm border border-dashed',
                        caption.danger
                          ? 'border-workbench-danger bg-workbench-danger-soft text-workbench-danger'
                          : 'border-nomi-ink-20 text-nomi-ink-30 hover:border-nomi-accent hover:text-nomi-accent',
                      )}
                      data-storyboard-ref-tile={cell.key}
                    >
                      <IconPlus size={16} stroke={1.8} />
                    </span>
                  )}
                </button>
                {collapsible && cellIndex === 0 ? (
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); setExpanded((previous) => !previous) }}
                    aria-label={expanded
                      ? t('storyboardEditor.slot.collapseAria')
                      : t('storyboardEditor.slot.moreAria', { count: hiddenCellCount })}
                    aria-expanded={expanded}
                    title={t('storyboardEditor.slot.moreTitle', { total: column.cells.length })}
                    data-storyboard-ref-more={expanded ? 0 : hiddenCellCount}
                    className="absolute right-0 top-0 z-[6] grid h-4 min-w-4 place-items-center rounded-nomi-sm bg-nomi-overlay-chip-strong px-1 text-micro text-nomi-media-ink tabular-nums"
                  >
                    {expanded ? '\u2212' : `+${hiddenCellCount}`}
                  </button>
                ) : null}
                <span className={cn('w-full truncate text-micro', caption.danger ? 'text-workbench-danger' : 'text-nomi-ink-40')} title={caption.title}>
                  {caption.text}
                </span>
                {openSlotKey === cell.key ? (
                  <ShotReferenceSlotPopover
                    cell={cell}
                    projectId={openProjectId}
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
      {collapsible && expanded ? (
        // 浮层脱离文档流，列里留一只同尺寸的空盒——否则摊开的瞬间整行高度先塌一下再弹回来。
        <span aria-hidden className="block" style={{ width: `${REFERENCE_SLOT_BOX.width}px`, height: `${REFERENCE_SLOT_BOX.height}px` }} />
      ) : null}
      {uploadError ? (
        <span className="text-micro leading-tight text-workbench-danger" role="alert">{uploadError}</span>
      ) : null}
    </div>
  )
}
