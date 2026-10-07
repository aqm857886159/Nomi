import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  IconAdjustmentsHorizontal,
  IconBrush,
  IconCheck,
  IconCrop,
  IconDownload,
  IconFlipHorizontal,
  IconFlipVertical,
  IconLayoutGrid,
  IconMaximize,
  IconRotate2,
  IconRotateClockwise2,
  IconScissors,
  IconSparkles,
} from '@tabler/icons-react'
import type { WorkbenchMenuIcon, WorkbenchMenuNode } from '../../../design/menu'
import { NomiLoadingMark } from '../../../design'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  FloatingToolbarShell,
  TOOLBAR_ICON as I,
  ToolbarButton,
  ToolbarDivider,
  ToolbarDuplicateVariantButton,
  ToolbarIconButton,
  ToolbarProvenanceButton,
} from '../nodes/NodeFloatingToolbar'
import { ToolbarActionMenu } from '../nodes/ToolbarActionMenu'
import { GridSplitPicker, type GridSplitSpec } from '../nodes/GridSplitPicker'
import type { ImageTransformOp } from '../nodes/useNodeImageEditing'
import type { CropGridSize } from '../nodes/render/ImageCropGridOverlay'
import { useResultDownload } from '../nodes/useResultDownload'
import WhiteboardModal from '../nodes/whiteboard/WhiteboardModal'
import { inferWhiteboardAspectRatio, readWhiteboardState } from '../nodes/whiteboard/whiteboardState'
import { readQuickActionMeta } from './deriveFromNode'
import { quickActionsInGroup, type QuickActionDefinition, type QuickActionId } from './quickActionCatalog'
import type { QuickActionGuide } from './capabilityGuide'

/**
 * 图片节点浮条 · 快捷动作版（2026-10-04 批次 1；取代了旧的 `NodeImageEditToolbar.tsx`，同一提交删掉旧文件）。
 * 纯展示：点多机位九宫格 / ▾ 下拉 / 改图里生成新图的项走 `useQuickActionHost` → `deriveFromNode`（生产宿主 `ImageQuickActionsToolbarHost`）。
 *
 * 一行四颗文字钮，和现在一样多（#969 刚收成一行，1280 窗口 + Agent 面板下英文锚卡已经折两行，
 * 再多一颗普通卡也会折）。左 → 右按创作优先级：
 *
 *   [锁] │ [定妆*] │ [复制为变体] [重拍*] [切成 N 张*] · 多机位九宫格 [▾] · 抠图 改图▾ 宫格▾ · 画板(纯图标) · [全屏] [下载] [生成记录]
 *          锚卡才有        制作镜头才有   宫格派生才有   └ 派生新东西 ┘  └ 改这张 ┘     交接         看和拿
 *
 *   · **多机位九宫格**（文字钮）：最常用的一个效果直接放在浮条上（先按判断定，以后有使用数据再调）。点它 = 新建下游节点
 *     + 连参考 + 填效果库模板 + 沿用模型，**不生成**（`deriveFromNode.ts`；用户 2026-10-05 拍板：花钱留给用户在新节点上点 ↑）。
 *   · **▾**（分体按钮右块，和「宫格 ▾」同一个胶囊样子、中间不画竖线；title / aria-label「更多效果」）：其余效果（下一刻 / 前一刻 / 三视图 / 剧情四宫格），按常用程度排。
 *     菜单里不写价格、不写价格说明（2026-10-05 用户拍板：官方额度上线、价格真能拿到再做）。
 *   · **改图 ▾**：两段带名字——「生成新图」（高清 / 扩图，也是派生，同样不生成）与「本机处理」
 *     （裁剪 / 旋转翻转；抠图不在这里，留在一级）。原「变换▾」平铺进第二段，不是再包一层（§1.5.4 反例第 2 行：不许把
 *     已经在二级的东西再降一级——这里点击数不变，都是两下）。
 *   · **宫格 ▾**：等分 4 / 9 / 16 / 25 + 自定义行列点阵。
 *   · **切成 N 张**：只出现在宫格类预设派生出来的节点上（它记得自己是几行几列），一下直达切割框。
 *
 * 「抠图」留在一级、「画板」改纯图标（2026-10-05 用户在两条拍板冲突时选的：设计系统 §1.5.4 反例第 1 行
 * 「不把抠图收进 ▾ 凑数」优先于批次方案「抠图并进改图▾」；文字钮仍是 4 颗）。
 */

export type ImageQuickActionsToolbarProps = {
  reportFeedback: (message: string) => void
  node: GenerationCanvasNode
  editGrid: CropGridSize | null
  imageOpBusy: boolean
  onGridSplit: (spec: GridSplitSpec) => void
  onCrop: () => void
  onTransform: (op: ImageTransformOp) => void
  onRemoveBackground?: () => void
  removeBackgroundBusy?: boolean
  onPreview: () => void
  onOpenProvenance: () => void
  isAnchor?: boolean
  frozen?: boolean
  onToggleFreeze?: () => void
  /** 点不了的快捷动作与原因（效果库缺条目 …）：灰掉、第二行写原因。 */
  quickActionBlocked?: Partial<Record<QuickActionId, string>>
  /**
   * 这一项要的能力此刻没有（目录里没有能做这件事的模型），但有**一步可走的路**：项不灰，第二行说缺什么，
   * 点它走 onSelect（去添加 / 换一个同能力的模型），不派生（2026-10-06 用户：高清没有模型时不能是死路）。
   */
  quickActionGuides?: Partial<Record<QuickActionId, QuickActionGuide>>
  onQuickAction: (id: QuickActionId) => void
}

function quickActionItems(
  actions: readonly QuickActionDefinition[],
  t: TFunction,
  blocked: ImageQuickActionsToolbarProps['quickActionBlocked'],
  onPick: (id: QuickActionId) => void,
  guides?: ImageQuickActionsToolbarProps['quickActionGuides'],
): WorkbenchMenuNode[] {
  return actions.map((action) => {
    const guide = guides?.[action.id]
    if (guide) {
      return {
        id: `quick-${action.id}`,
        label: t(action.labelKey),
        icon: action.icon as unknown as WorkbenchMenuIcon,
        description: guide.description,
        onSelect: guide.onSelect,
      }
    }
    const reason = blocked?.[action.id]
    return {
      id: `quick-${action.id}`,
      label: t(action.labelKey),
      icon: action.icon as unknown as WorkbenchMenuIcon,
      disabled: Boolean(reason),
      ...(reason ? { description: reason, disabledReason: reason } : {}),
      onSelect: () => onPick(action.id),
    }
  })
}

const menuIcon = (component: unknown): WorkbenchMenuIcon => component as WorkbenchMenuIcon

export default function ImageQuickActionsToolbar(props: ImageQuickActionsToolbarProps): JSX.Element {
  const {
    reportFeedback, node, editGrid, imageOpBusy, onGridSplit, onCrop, onTransform, onRemoveBackground,
    removeBackgroundBusy = false, onPreview, onOpenProvenance, isAnchor = false, frozen = false, onToggleFreeze,
    quickActionBlocked, quickActionGuides, onQuickAction,
  } = props
  const { t } = useTranslation()
  const { downloading, download } = useResultDownload(node, reportFeedback)
  const [whiteboardOpen, setWhiteboardOpen] = React.useState(false)
  const imageUrl = node.result?.type === 'image' ? node.result.url || '' : ''
  const busy = editGrid !== null || imageOpBusy || removeBackgroundBusy
  const derivedGrid = readQuickActionMeta(node)?.grid

  const featured = quickActionsInGroup('featured')[0]
  const more = quickActionsInGroup('more')
  const refines = quickActionsInGroup('refine')

  const moreItems = quickActionItems(more, t, quickActionBlocked, onQuickAction, quickActionGuides)
  const featuredBlocked = featured ? quickActionBlocked?.[featured.id] : undefined
  // 能力此刻没有（没有能改图的模型）：主体照样可点，点了去补；悬停说缺什么。
  const featuredGuide = featured ? quickActionGuides?.[featured.id] : undefined

  const transformItems: WorkbenchMenuNode[] = ([
    { op: 'rotate-left' as const, icon: IconRotate2, key: 'generationCommon.imageToolbar.rotateLeft' as const },
    { op: 'rotate-right' as const, icon: IconRotateClockwise2, key: 'generationCommon.imageToolbar.rotateRight' as const },
    { op: 'flip-h' as const, icon: IconFlipHorizontal, key: 'generationCommon.imageToolbar.flipHorizontal' as const },
    { op: 'flip-v' as const, icon: IconFlipVertical, key: 'generationCommon.imageToolbar.flipVertical' as const },
  ]).map(({ op, icon, key }) => ({ id: `transform-${op}`, label: t(key), icon: menuIcon(icon), onSelect: () => onTransform(op) }))

  const refineItems: WorkbenchMenuNode[] = [
    { kind: 'group', id: 'refine-generate', label: t('generationCommon.quickActions.groups.generate'), items: quickActionItems(refines, t, quickActionBlocked, onQuickAction, quickActionGuides) },
    { kind: 'separator', id: 'refine-sep' },
    {
      kind: 'group',
      id: 'refine-local',
      label: t('generationCommon.quickActions.groups.local'),
      items: [
        { id: 'crop', label: t('generationCommon.imageToolbar.crop'), icon: menuIcon(IconCrop), onSelect: onCrop },
        ...transformItems,
      ],
    },
  ]

  return (
    <>
      <FloatingToolbarShell ariaLabel={t('generationCommon.imageToolbar.aria')} lockNodeId={node.id}>
        {isAnchor && onToggleFreeze ? (
          <>
            <ToolbarButton
              icon={frozen ? <IconCheck size={I.size} stroke={I.stroke} /> : <IconSparkles size={I.size} stroke={I.stroke} />}
              label={frozen ? t('generationCommon.imageToolbar.frozen') : t('generationCommon.imageToolbar.freeze')}
              accent={!frozen}
              title={frozen ? t('generationCommon.imageToolbar.frozenHint') : t('generationCommon.imageToolbar.freezeHint')}
              onClick={onToggleFreeze}
            />
            <ToolbarDivider />
          </>
        ) : null}
        <ToolbarDuplicateVariantButton nodeId={node.id} />
        {derivedGrid ? (
          <ToolbarButton
            icon={<IconLayoutGrid size={I.size} stroke={I.stroke} />}
            label={t('generationCommon.quickActions.splitInto', { count: derivedGrid.rows * derivedGrid.cols })}
            accent
            title={t('generationCommon.quickActions.splitIntoHint', derivedGrid)}
            disabled={busy || !imageUrl}
            onClick={() => onGridSplit(derivedGrid)}
          />
        ) : null}
        <ToolbarActionMenu
          id="more-effects"
          iconOnly
          icon={null}
          label={t('generationCommon.quickActions.moreEffects')}
          menuLabel={t('generationCommon.quickActions.moreEffects')}
          items={moreItems}
          disabled={!imageUrl}
          primary={featured ? {
            icon: <featured.icon size={I.size} stroke={I.stroke} />,
            label: t(featured.labelKey),
            title: featuredGuide?.description ?? featuredBlocked ?? t('generationCommon.quickActions.featuredHint'),
            disabled: !imageUrl || (!featuredGuide && Boolean(featuredBlocked)),
            onClick: featuredGuide ? featuredGuide.onSelect : () => onQuickAction(featured.id),
          } : undefined}
        />
        {onRemoveBackground ? (
          <ToolbarButton
            icon={removeBackgroundBusy ? <NomiLoadingMark size={I.size} /> : <IconScissors size={I.size} stroke={I.stroke} />}
            label={removeBackgroundBusy ? t('generationCommon.imageToolbar.removingBackground') : t('generationCommon.imageToolbar.removeBackground')}
            title={t('generationCommon.imageToolbar.removeBackgroundHint')}
            disabled={busy}
            ariaBusy={removeBackgroundBusy}
            onClick={onRemoveBackground}
          />
        ) : null}
        <ToolbarActionMenu
          id="refine"
          icon={<IconAdjustmentsHorizontal size={I.size} stroke={I.stroke} />}
          label={t('generationCommon.quickActions.refine')}
          menuLabel={t('generationCommon.quickActions.refineMenu')}
          items={refineItems}
          disabled={busy}
        />
        <GridSplitPicker disabled={busy || !imageUrl} onSplit={onGridSplit} />
        <ToolbarDivider />
        <ToolbarIconButton
          icon={<IconBrush size={I.size} stroke={I.stroke} />}
          title={t('generationCommon.imageToolbar.whiteboardHint')}
          ariaLabel={t('generationCommon.imageToolbar.whiteboard')}
          disabled={busy || !imageUrl}
          onClick={() => setWhiteboardOpen(true)}
        />
        <ToolbarDivider />
        <ToolbarIconButton
          icon={<IconMaximize size={I.size} stroke={I.stroke} />}
          title={t('generationCommon.imageToolbar.fullscreen')}
          ariaLabel={t('generationCommon.imageToolbar.fullscreenAria')}
          disabled={!imageUrl}
          onClick={onPreview}
        />
        <ToolbarIconButton
          icon={<IconDownload size={I.size} stroke={I.stroke} />}
          ariaLabel={t('generationCommon.imageToolbar.download')}
          title={t('generationCommon.imageToolbar.downloadHint')}
          disabled={downloading}
          onClick={download}
        />
        <ToolbarProvenanceButton onOpen={onOpenProvenance} />
      </FloatingToolbarShell>
      {whiteboardOpen && imageUrl ? (
        <WhiteboardModal
          nodeId={node.id}
          sourceKind="image"
          nodeTitle={`${node.title || t('generationCommon.imageToolbar.image')} · ${t('generationCommon.imageToolbar.whiteboard')}`}
          initialState={readWhiteboardState(node)}
          initialImage={{ url: imageUrl, aspectRatio: inferWhiteboardAspectRatio(node.meta?.imageWidth, node.meta?.imageHeight) }}
          onClose={() => setWhiteboardOpen(false)}
        />
      ) : null}
    </>
  )
}
