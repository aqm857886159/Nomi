import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconBrush,
  IconCrop,
  IconDotsVertical,
  IconDownload,
  IconFlipHorizontal,
  IconFlipVertical,
  IconGrid3x3,
  IconLayersSubtract,
  IconLayoutGrid,
  IconMaximize,
  IconPhotoPlus,
  IconRotate2,
  IconRotateClockwise2,
  IconScissors,
  IconTypography,
  IconWand,
} from '@tabler/icons-react'
import { type ImageGridSize, type ImageTransformOp } from './useNodeImageEditing'
import type { CropGridSize } from './render/ImageCropGridOverlay'
import { useResultDownload } from './useResultDownload'
import {
  FloatingToolbarShell,
  TOOLBAR_ICON as I,
  ToolbarButton,
  ToolbarDivider,
  ToolbarIconButton,
  ToolbarMenu,
  ToolbarProvenanceButton,
  type ToolbarMenuItem,
} from './NodeFloatingToolbar'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import WhiteboardModal from './whiteboard/WhiteboardModal'
import { inferWhiteboardAspectRatio, readWhiteboardState } from './whiteboard/whiteboardState'
import { applyTextEdit } from '../textEdit/buildTextEditNode'
import { useDecomposeLayers } from './decompose/useDecomposeLayers'
import { NomiLoadingMark } from '../../../design'

// 图片节点编辑浮条：建参考图 / AI 编辑保留创作主位；裁剪 / 抠图直达；切图、变换、画板收进「更多」。

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
  /** Tier1「建参考图」：基于当前图建一个预填身份板提示词的新节点（不自动生成）。缺省不渲染该按钮。 */
  onMakeup?: () => void
}

export default function NodeImageEditToolbar({
  node,
  editGrid,
  imageOpBusy,
  onGridSplit,
  onCrop,
  onTransform,
  onRemoveBackground,
  removeBackgroundBusy = false,
  onPreview,
  onOpenProvenance,
  onMakeup,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const { downloading, download } = useResultDownload(node)
  const [whiteboardOpen, setWhiteboardOpen] = React.useState(false)
  const imageUrl = node.result?.type === 'image' ? node.result.url || '' : ''
  const { decomposeBusy, decomposeState, runDecompose, clearDecompose } = useDecomposeLayers(node, imageUrl)
  const busy = editGrid !== null || imageOpBusy || removeBackgroundBusy || decomposeBusy
  const moreItems: ToolbarMenuItem[] = [
    { kind: 'label', label: t('generationCommon.imageToolbar.splitAndTransform') },
    {
      icon: <IconLayoutGrid size={I.size} stroke={I.stroke} />,
      label: t('generationCommon.imageToolbar.fourView'),
      onClick: () => onGridSplit(2),
    },
    {
      icon: <IconGrid3x3 size={I.size} stroke={I.stroke} />,
      label: t('generationCommon.imageToolbar.gridNine'),
      onClick: () => onGridSplit(3),
    },
    {
      icon: <IconRotate2 size={I.size} stroke={I.stroke} />,
      label: t('generationCommon.imageToolbar.rotateLeft'),
      onClick: () => onTransform('rotate-left'),
    },
    {
      icon: <IconRotateClockwise2 size={I.size} stroke={I.stroke} />,
      label: t('generationCommon.imageToolbar.rotateRight'),
      onClick: () => onTransform('rotate-right'),
    },
    {
      icon: <IconFlipHorizontal size={I.size} stroke={I.stroke} />,
      label: t('generationCommon.imageToolbar.flipHorizontal'),
      onClick: () => onTransform('flip-h'),
    },
    {
      icon: <IconFlipVertical size={I.size} stroke={I.stroke} />,
      label: t('generationCommon.imageToolbar.flipVertical'),
      onClick: () => onTransform('flip-v'),
    },
    { kind: 'label', label: t('generationCommon.imageToolbar.handoff') },
    {
      icon: <IconBrush size={I.size} stroke={I.stroke} />,
      label: t('generationCommon.imageToolbar.openInWhiteboard'),
      disabled: !imageUrl,
      onClick: () => setWhiteboardOpen(true),
    },
  ]
  // 拆解出图后自动打开白板（effect-first：用户立刻看到一堆可抓的元素，设计评审定）。
  React.useEffect(() => {
    if (decomposeState) setWhiteboardOpen(true)
  }, [decomposeState])
  return (
    <>
      <FloatingToolbarShell ariaLabel={t('generationCommon.imageToolbar.aria')}>
        {onMakeup ? (
          <ToolbarButton
            icon={<IconPhotoPlus size={I.size} stroke={I.stroke} />}
            label={t('generationCommon.imageToolbar.makeup')}
            accent
            title={t('generationCommon.imageToolbar.makeupHint')}
            onClick={onMakeup}
          />
        ) : null}
        <ToolbarMenu
          icon={decomposeBusy ? <NomiLoadingMark size={I.size} /> : <IconWand size={I.size} stroke={I.stroke} />}
          label={
            decomposeBusy ? t('generationCommon.imageToolbar.decomposing') : t('generationCommon.imageToolbar.aiEdit')
          }
          disabled={busy || !imageUrl}
          items={[
            {
              icon: <IconLayersSubtract size={I.size} stroke={I.stroke} />,
              label: t('generationCommon.imageToolbar.decompose'),
              onClick: () => {
                void runDecompose()
              },
            },
            {
              icon: <IconTypography size={I.size} stroke={I.stroke} />,
              label: t('generationCommon.imageToolbar.editText'),
              onClick: () => applyTextEdit(node),
            },
          ]}
        />
        <ToolbarDivider />
        <span className="px-1 text-micro text-nomi-ink-40" aria-hidden="true">
          {t('generationCommon.imageToolbar.editGroup')}
        </span>
        <ToolbarButton
          icon={<IconCrop size={I.size} stroke={I.stroke} />}
          label={t('generationCommon.imageToolbar.crop')}
          title={t('generationCommon.imageToolbar.cropHint')}
          disabled={busy}
          onClick={onCrop}
        />
        {onRemoveBackground ? (
          <ToolbarButton
            icon={
              removeBackgroundBusy ? (
                <NomiLoadingMark size={I.size} />
              ) : (
                <IconScissors size={I.size} stroke={I.stroke} />
              )
            }
            label={
              removeBackgroundBusy
                ? t('generationCommon.imageToolbar.removingBackground')
                : t('generationCommon.imageToolbar.removeBackground')
            }
            title={t('generationCommon.imageToolbar.removeBackgroundHint')}
            disabled={busy}
            ariaBusy={removeBackgroundBusy}
            onClick={onRemoveBackground}
          />
        ) : null}
        <ToolbarMenu
          icon={<IconDotsVertical size={I.size} stroke={I.stroke} />}
          label={t('generationCommon.imageToolbar.more')}
          disabled={busy}
          items={moreItems}
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
          title={t('generationCommon.imageToolbar.downloadHint')}
          ariaLabel={t('generationCommon.imageToolbar.download')}
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
            : {
                initialImage: {
                  url: imageUrl,
                  aspectRatio: inferWhiteboardAspectRatio(node.meta?.imageWidth, node.meta?.imageHeight),
                },
              })}
          onClose={() => {
            setWhiteboardOpen(false)
            clearDecompose()
          }}
        />
      ) : null}
    </>
  )
}
