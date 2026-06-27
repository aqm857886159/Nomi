import React from 'react'
import { IconBrush, IconCrop, IconDownload, IconFlipHorizontal, IconFlipVertical, IconGrid3x3, IconGridDots, IconLayoutGrid, IconRotate2, IconRotateClockwise2, IconScissors, IconSparkles, IconTransform, IconTypography } from '@tabler/icons-react'
import { IMAGE_TRANSFORM_LABEL, type ImageGridSize, type ImageTransformOp } from './useNodeImageEditing'
import type { CropGridSize } from './render/ImageCropGridOverlay'
import { useResultDownload } from './useResultDownload'
import { FloatingToolbarShell, TOOLBAR_ICON as I, ToolbarButton, ToolbarDivider, ToolbarMenu } from './NodeFloatingToolbar'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import WhiteboardModal from './whiteboard/WhiteboardModal'
import { inferWhiteboardAspectRatio, readWhiteboardState } from './whiteboard/whiteboardState'
import { applyTextEdit } from '../textEdit/buildTextEditNode'
import { NomiLoadingMark } from '../../../design'

// 图片节点编辑浮条（方案 B 分组，用户拍板）：定妆 ｜ 裁剪 · 切图▾ · 变换▾ ｜ 下载。
// 把低频的截图(2)/变换(4)收进两个下拉，常用动作留在外面 1 次点击直达。容器/按钮/图标全走
// NodeFloatingToolbar 共享组件（token 合规，§2/§6）。图片类与素材类节点共用此条。

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
  /** Tier1「定妆」：基于当前图建一个预填身份板提示词的新节点（不自动生成）。缺省不渲染该按钮。 */
  onMakeup?: () => void
}

export default function NodeImageEditToolbar({ node, editGrid, imageOpBusy, onGridSplit, onCrop, onTransform, onRemoveBackground, removeBackgroundBusy = false, onMakeup }: Props): JSX.Element {
  const { downloading, download } = useResultDownload(node)
  const [whiteboardOpen, setWhiteboardOpen] = React.useState(false)
  const busy = editGrid !== null || imageOpBusy || removeBackgroundBusy
  const imageUrl = node.result?.type === 'image' ? node.result.url || '' : ''
  return (
    <>
      <FloatingToolbarShell ariaLabel="图片操作">
        {onMakeup ? (
          <ToolbarButton
            icon={<IconSparkles size={I.size} stroke={I.stroke} />}
            label="定妆"
            accent
            title="定妆：基于这张图，预填一份角色/场景身份板提示词到新节点（不自动生成）"
            onClick={onMakeup}
          />
        ) : null}
        <ToolbarButton
          icon={<IconTypography size={I.size} stroke={I.stroke} />}
          label="改字"
          title="改字：基于这张图，预填一份「把旧字改成新字、保留字体/风格」改图提示词到新节点（不自动生成）"
          disabled={busy || !imageUrl}
          onClick={() => applyTextEdit(node)}
        />
        <ToolbarDivider />
        <ToolbarButton
          icon={<IconCrop size={I.size} stroke={I.stroke} />}
          label="裁剪"
          title="裁剪（可拖取景框，加入堆叠并设为主图）"
          disabled={busy}
          onClick={onCrop}
        />
        {onRemoveBackground ? (
          <ToolbarButton
            icon={removeBackgroundBusy ? <NomiLoadingMark size={I.size} /> : <IconScissors size={I.size} stroke={I.stroke} />}
            label={removeBackgroundBusy ? '抠图中' : '抠图'}
            title="抠图（去除背景，加入堆叠并设为主图）"
            disabled={busy}
            ariaBusy={removeBackgroundBusy}
            onClick={onRemoveBackground}
          />
        ) : null}
        <ToolbarMenu
          icon={<IconGridDots size={I.size} stroke={I.stroke} />}
          label="切图"
          disabled={busy}
          items={[
            { icon: <IconLayoutGrid size={I.size} stroke={I.stroke} />, label: '四视图（2×2）', onClick: () => onGridSplit(2) },
            { icon: <IconGrid3x3 size={I.size} stroke={I.stroke} />, label: '九宫格（3×3）', onClick: () => onGridSplit(3) },
          ]}
        />
        <ToolbarMenu
          icon={<IconTransform size={I.size} stroke={I.stroke} />}
          label="变换"
          disabled={busy}
          items={([
            { op: 'rotate-left' as const, icon: <IconRotate2 size={I.size} stroke={I.stroke} /> },
            { op: 'rotate-right' as const, icon: <IconRotateClockwise2 size={I.size} stroke={I.stroke} /> },
            { op: 'flip-h' as const, icon: <IconFlipHorizontal size={I.size} stroke={I.stroke} /> },
            { op: 'flip-v' as const, icon: <IconFlipVertical size={I.size} stroke={I.stroke} /> },
          ]).map(({ op, icon }) => ({ icon, label: IMAGE_TRANSFORM_LABEL[op], onClick: () => onTransform(op) }))}
        />
        <ToolbarDivider />
        <ToolbarButton
          icon={<IconBrush size={I.size} stroke={I.stroke} />}
          label="画板"
          title="在画板中编辑（自动导入当前图片）"
          disabled={busy || !imageUrl}
          onClick={() => setWhiteboardOpen(true)}
        />
        <ToolbarDivider />
        <ToolbarButton
          icon={<IconDownload size={I.size} stroke={I.stroke} />}
          label="下载"
          title="下载 / 另存到本地"
          disabled={downloading}
          onClick={download}
        />
      </FloatingToolbarShell>
      {whiteboardOpen && imageUrl ? (
        <WhiteboardModal
          nodeId={node.id}
          sourceKind="image"
          nodeTitle={`${node.title || '图片'} · 画板`}
          initialState={readWhiteboardState(node)}
          initialImage={{
            url: imageUrl,
            aspectRatio: inferWhiteboardAspectRatio(node.meta?.imageWidth, node.meta?.imageHeight),
          }}
          onClose={() => setWhiteboardOpen(false)}
        />
      ) : null}
    </>
  )
}
