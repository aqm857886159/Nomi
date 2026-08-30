import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconBrush, IconCheck, IconCrop, IconDownload, IconFlipHorizontal, IconFlipVertical, IconGrid3x3, IconGridDots, IconLayersSubtract, IconLayoutGrid, IconMaximize, IconRotate2, IconRotateClockwise2, IconScissors, IconSparkles, IconTransform, IconTypography, IconWand } from '@tabler/icons-react'
import { type ImageGridSize, type ImageTransformOp } from './useNodeImageEditing'
import type { CropGridSize } from './render/ImageCropGridOverlay'
import { useResultDownload } from './useResultDownload'
import { FloatingToolbarShell, TOOLBAR_ICON as I, ToolbarButton, ToolbarDivider, ToolbarDuplicateVariantButton, ToolbarIconButton, ToolbarMenu, ToolbarProvenanceButton } from './NodeFloatingToolbar'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import WhiteboardModal from './whiteboard/WhiteboardModal'
import { inferWhiteboardAspectRatio, readWhiteboardState } from './whiteboard/whiteboardState'
import { applyTextEdit } from '../textEdit/buildTextEditNode'
import { useDecomposeLayers } from './decompose/useDecomposeLayers'
import { NomiLoadingMark } from '../../../design'

// 图片节点编辑浮条（按「创作优先级」排左→右，用户拍板）：
//   左·创作：定妆 · AI编辑▾ ｜ 中·改这张：裁剪 · 抠图 · 切图▾ · 变换▾ ｜ 交接：画板 ｜ 右·工具：全屏 · 下载。
// 全屏是「看」的工具，不占最左创作主位——与下载同归右侧工具区（此前全屏在最左，抢了 accent 主动作定妆的位）。
// 低频的截图(2)/变换(4)收进两个下拉，常用动作外露 1 次点击直达。容器/按钮/图标全走 NodeFloatingToolbar
// 共享组件（token 合规，§2/§6）。图片类与素材类节点共用此条。

type Props = {
  node: GenerationCanvasNode
  /** 当前打开的可调框：null=未开，1=裁剪，2/3=切图。开着或忙时禁用编辑入口。 */
  editGrid: CropGridSize | null
  imageOpBusy: boolean
  onGridSplit: (gridSize: ImageGridSize) => void
  onCrop: () => void
  onTransform: (op: ImageTransformOp) => void
  onRemoveBackground?: () => void
  removeBackgroundBusy?: boolean
  /** 打开共享图片全屏预览。 */
  onPreview: () => void
  /** 打开生成记录（原先住卡片右上角，常驻压在图上；2026-08-04 迁来这条浮条）。 */
  onOpenProvenance: () => void
  /** Tier1「建参考卡」：基于当前图建一个预填身份板提示词的新节点（不自动生成）。缺省不渲染该按钮。 */
  onMakeup?: () => void
  /** 这张卡本身是不是「视觉锚」（角色/场景/道具参考卡）。是 → 最左出「定妆」而非「建参考卡」。 */
  isAnchor?: boolean
  /** 该锚是否已定妆（形象已确认）。isAnchor 时驱动「定妆 / 已定妆✓」两态。 */
  frozen?: boolean
  /** 定妆开关（写/删 meta.frozen）。isAnchor 时点最左动作触发。 */
  onToggleFreeze?: () => void
}

export default function NodeImageEditToolbar({ node, editGrid, imageOpBusy, onGridSplit, onCrop, onTransform, onRemoveBackground, removeBackgroundBusy = false, onPreview, onOpenProvenance, onMakeup, isAnchor = false, frozen = false, onToggleFreeze }: Props): JSX.Element {
  const { t } = useTranslation()
  const { downloading, download } = useResultDownload(node)
  const [whiteboardOpen, setWhiteboardOpen] = React.useState(false)
  const imageUrl = node.result?.type === 'image' ? node.result.url || '' : ''
  const { decomposeBusy, decomposeState, runDecompose, clearDecompose } = useDecomposeLayers(node, imageUrl)
  const busy = editGrid !== null || imageOpBusy || removeBackgroundBusy || decomposeBusy
  // 拆解出图后自动打开白板（effect-first：用户立刻看到一堆可抓的元素，设计评审定）。
  React.useEffect(() => {
    if (decomposeState) setWhiteboardOpen(true)
  }, [decomposeState])
  return (
    <>
      <FloatingToolbarShell ariaLabel={t('generationCommon.imageToolbar.aria')}>
        {/* 锚卡（角色/场景/道具参考卡）：最左是「定妆」= 确认形象、放行下游镜头（F15 装上的操作者）。
            一功能一个家——锚卡不再显示「建参考卡」（对着参考卡再建参考卡冗余）。 */}
        {isAnchor && onToggleFreeze ? (
          <ToolbarButton
            icon={frozen ? <IconCheck size={I.size} stroke={I.stroke} /> : <IconSparkles size={I.size} stroke={I.stroke} />}
            label={frozen ? t('generationCommon.imageToolbar.frozen') : t('generationCommon.imageToolbar.freeze')}
            accent={!frozen}
            title={frozen ? t('generationCommon.imageToolbar.frozenHint') : t('generationCommon.imageToolbar.freezeHint')}
            onClick={onToggleFreeze}
          />
        ) : onMakeup ? (
          <ToolbarButton
            icon={<IconSparkles size={I.size} stroke={I.stroke} />}
            label={t('generationCommon.imageToolbar.makeup')}
            accent
            title={t('generationCommon.imageToolbar.makeupHint')}
            onClick={onMakeup}
          />
        ) : null}
        <ToolbarMenu
          icon={decomposeBusy ? <NomiLoadingMark size={I.size} /> : <IconWand size={I.size} stroke={I.stroke} />}
          label={decomposeBusy ? t('generationCommon.imageToolbar.decomposing') : t('generationCommon.imageToolbar.aiEdit')}
          disabled={busy || !imageUrl}
          items={[
            { icon: <IconLayersSubtract size={I.size} stroke={I.stroke} />, label: t('generationCommon.imageToolbar.decompose'), onClick: () => { void runDecompose() } },
            { icon: <IconTypography size={I.size} stroke={I.stroke} />, label: t('generationCommon.imageToolbar.editText'), onClick: () => applyTextEdit(node) },
          ]}
        />
        <ToolbarDivider />
        <ToolbarDuplicateVariantButton nodeId={node.id} />
        <ToolbarButton
          icon={<IconCrop size={I.size} stroke={I.stroke} />}
          label={t('generationCommon.imageToolbar.crop')}
          title={t('generationCommon.imageToolbar.cropHint')}
          disabled={busy}
          onClick={onCrop}
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
        <ToolbarMenu
          icon={<IconGridDots size={I.size} stroke={I.stroke} />}
          label={t('generationCommon.imageToolbar.split')}
          disabled={busy}
          items={[
            { icon: <IconLayoutGrid size={I.size} stroke={I.stroke} />, label: t('generationCommon.imageToolbar.fourView'), onClick: () => onGridSplit(2) },
            { icon: <IconGrid3x3 size={I.size} stroke={I.stroke} />, label: t('generationCommon.imageToolbar.gridNine'), onClick: () => onGridSplit(3) },
          ]}
        />
        <ToolbarMenu
          icon={<IconTransform size={I.size} stroke={I.stroke} />}
          label={t('generationCommon.imageToolbar.transform')}
          disabled={busy}
          items={([
            { op: 'rotate-left' as const, icon: <IconRotate2 size={I.size} stroke={I.stroke} /> },
            { op: 'rotate-right' as const, icon: <IconRotateClockwise2 size={I.size} stroke={I.stroke} /> },
            { op: 'flip-h' as const, icon: <IconFlipHorizontal size={I.size} stroke={I.stroke} /> },
            { op: 'flip-v' as const, icon: <IconFlipVertical size={I.size} stroke={I.stroke} /> },
          ]).map(({ op, icon }) => ({
            icon,
            label: t(`generationCommon.imageToolbar.${op === 'rotate-left' ? 'rotateLeft' : op === 'rotate-right' ? 'rotateRight' : op === 'flip-h' ? 'flipHorizontal' : 'flipVertical'}` as 'generationCommon.imageToolbar.rotateLeft'),
            onClick: () => onTransform(op),
          }))}
        />
        <ToolbarDivider />
        <ToolbarButton
          icon={<IconBrush size={I.size} stroke={I.stroke} />}
          label={t('generationCommon.imageToolbar.whiteboard')}
          title={t('generationCommon.imageToolbar.whiteboardHint')}
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
        <ToolbarButton
          icon={<IconDownload size={I.size} stroke={I.stroke} />}
          label={t('generationCommon.imageToolbar.download')}
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
          nodeTitle={`${node.title || t('generationCommon.imageToolbar.image')} · ${decomposeState ? t('generationCommon.imageToolbar.decomposeTitle') : t('generationCommon.imageToolbar.whiteboard')}`}
          initialState={decomposeState ?? readWhiteboardState(node)}
          {...(decomposeState
            ? {}
            : { initialImage: { url: imageUrl, aspectRatio: inferWhiteboardAspectRatio(node.meta?.imageWidth, node.meta?.imageHeight) } })}
          onClose={() => { setWhiteboardOpen(false); clearDecompose() }}
        />
      ) : null}
    </>
  )
}
