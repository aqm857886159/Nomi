/**
 * GroupFrame —— 画布上每个框（Frame）的框体 + 拖动 handle。
 *
 * E.2C-30 抽离自 GenerationCanvas.tsx 内联实现（spec §6/Task E.2-8 要求）。
 * 单一职责：按 groupBoxes 数据渲染框体、边框状态与可拖动表面；头部胶囊归 GroupFrameHeader。
 * 不依赖 store；所有数据由调用方传入，便于将来虚拟化或换 dnd 后端。
 *
 * 2026-09-06 框工具第一档改了三件事：
 *  · 框的边界不再是成员包围盒算出来的皮，而是 `union(用户画的矩形, 成员矩形)`（见
 *    model/canvasFrameBounds，几何在 generationCanvasGeometry 里算完再传进来）；
 *  · **空框画虚线**（刚画完、还没往里放东西），放进第一个东西才变实线；
 *  · 拖动中给**入组/退组反馈**：进框亮 accent，出框变虚线——颜色只做这一种临时反馈，
 *    框的常驻装饰仍然中性（groupVisualContract 的写死不动）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import type { NodeGroup } from '../model/generationCanvasTypes'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import { GROUP_VISUAL_CLASS } from './groupVisualContract'
import { GroupFrameHeader, type FrameMembershipPreview } from './GroupFrameHeader'

export type CanvasGroupBox = {
  group: NodeGroup
  left: number
  top: number
  width: number
  height: number
  memberCount: number
  /** 零成员的框（用户刚画完、还没往里放东西）：画虚线，放进第一个东西才变实线。 */
  empty: boolean
}

/**
 * 框这一族交互的**一个**入口。收成一个对象而不是七个散 props：它们要穿过
 * GroupFrameList → CanvasGroupProjectionLayer → Viewport → 画布外壳四层，
 * 散着传会让 663 行的外壳直接顶到 800 行门岗（R9/R12）。
 */
export type CanvasFrameInteraction = {
  /** 拖动中的归属预览：只有一个框会亮，因为一个节点只属一个框。 */
  membershipPreview: { groupId: string; change: Exclude<FrameMembershipPreview, null>; nextCount: number } | null
  /** 正在编辑头部文字的那个框（⋯ 菜单的「改名 / 说明」也走它）。 */
  editingGroupId: string | null
  onEditingChange: (groupId: string | null) => void
  onRename: (groupId: string, name: string) => void
  onDescribe: (groupId: string, description: string) => void
  onOpenMenu: (groupId: string, point: { x: number; y: number }) => void
}

export type GroupFrameProps = {
  box: CanvasGroupBox
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string) => void
  /**
   * 有线待连时，组框变成可落点：落下 = 给组内每个成员各连一根（见 store.connectToGroup）。
   * 此时**不能**再走拖动 handle，否则一拖就把组挪走了。
   */
  pendingConnection?: boolean
  pendingConnectionSide?: ConnectionAnchorSide
  onConnectToGroup?: (groupId: string) => void
  readOnly?: boolean
  onCollapse?: (groupId: string) => void
  frame?: CanvasFrameInteraction
}

// 这里**刻意不放「整组运行」按钮**（2026-08-02 加过又删）：点组框本来就会选中全部成员
// （useCanvasSelectionDrag.handleGroupFramePointerDown），选择浮条随即显示「生成 N 个」——
// 整组运行早就有了。在标签上再放一个 ▶ 等于同屏两个一模一样的动作（实测两者相距约 600px 同时可见），
// 是并行版（违 P1）。要改整组运行的行为，改选择浮条那一条路径。
// 2026-09-06 的 ⋯ 菜单里有「生成整框」，与这条不冲突：它藏在菜单里（不与浮条同屏并存），
// 而且走的**就是**浮条那一条批量生产路径，只是把 scope 换成框内成员——一份实现，两个入口。

export default function GroupFrame({
  box,
  onPointerDown,
  pendingConnection,
  pendingConnectionSide,
  onConnectToGroup,
  readOnly = false,
  onCollapse,
  frame,
}: GroupFrameProps): JSX.Element {
  const { t } = useTranslation()
  const connectable = Boolean(!readOnly && pendingConnection && onConnectToGroup && box.memberCount > 0)
  const groupIsSource = connectable && pendingConnectionSide === 'left'
  const connectionLabel = groupIsSource
    ? t('generationCommon.canvas.group.connectFromHere', { name: box.group.name, count: box.memberCount })
    : t('generationCommon.canvas.group.connectHere', { name: box.group.name, count: box.memberCount })
  const preview = frame?.membershipPreview?.groupId === box.group.id ? frame.membershipPreview : null
  const previewCount = preview ? preview.nextCount : null
  // 拖动中的临时反馈：进框亮 accent、出框变虚线。这是 groupVisualContract 允许强调色出现的
  // 唯一场景（「强调色只留给临时交互反馈」），常驻装饰仍然中性。
  const membershipClass = preview
    ? preview.change === 'join'
      ? 'border-workbench-accent bg-workbench-accent/[0.06]'
      : 'border-dashed border-nomi-ink-40'
    : null
  const membershipLabel = preview
    ? preview.change === 'join'
      ? t('generationCommon.canvas.group.joinPreview', { name: box.group.name, count: preview.nextCount })
      : t('generationCommon.canvas.group.leavePreview', { name: box.group.name, count: preview.nextCount })
    : null

  return (
    <div
      className={cn(
        'generation-canvas-v2__group-box',
        'absolute select-none rounded-nomi-lg',
        readOnly ? 'pointer-events-none' : 'pointer-events-auto',
        GROUP_VISUAL_CLASS.frame,
        // 空框先画虚线：它还没圈住任何东西，实线会让人以为里面本来有内容而没渲染出来。
        box.empty && !connectable && !membershipClass ? 'border-dashed border-nomi-ink-30' : null,
        connectable
          ? cn('cursor-copy', GROUP_VISUAL_CLASS.dropTarget)
          : readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        membershipClass,
      )}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }}
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      // 拖线松手时 useDragToConnect 靠这个属性在元素栈里认出组框（与 data-node-id 同一套命中法）。
      data-group-id={box.group.id}
      data-frame-empty={box.empty ? 'true' : undefined}
      data-frame-membership={preview ? preview.change : undefined}
      aria-label={
        readOnly
          ? undefined
          : membershipLabel
          ? membershipLabel
          : connectable
          ? connectionLabel
          : t('generationCommon.canvas.group.dragNamed', { name: box.group.name })
      }
      title={
        readOnly
          ? box.group.name
          : connectable
          ? connectionLabel
          : t('generationCommon.canvas.group.drag')
      }
      onPointerDown={(event) => {
        if (readOnly) return
        // 有线待连时组框是落点不是把手：照常走拖动会把整组拽走(用户以为在连线)。
        if (connectable) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onPointerDown(event, box.group.id)
      }}
      onClick={(event) => {
        if (!connectable) return
        event.stopPropagation()
        onConnectToGroup?.(box.group.id)
      }}
    >
      <GroupFrameHeader
        groupId={box.group.id}
        name={box.group.name}
        description={box.group.description}
        memberCount={box.memberCount}
        previewCount={previewCount}
        readOnly={readOnly}
        connectable={connectable}
        editing={frame?.editingGroupId === box.group.id}
        onEditingChange={(editing) => frame?.onEditingChange(editing ? box.group.id : null)}
        onRename={frame?.onRename ?? noop}
        onDescribe={frame?.onDescribe ?? noop}
        onCollapse={onCollapse}
        onOpenMenu={frame?.onOpenMenu}
      />
    </div>
  )
}

function noop(): void {}

export type GroupFrameListProps = {
  boxes: readonly CanvasGroupBox[]
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string) => void
  pendingConnection?: boolean
  pendingConnectionSide?: ConnectionAnchorSide
  onConnectToGroup?: (groupId: string) => void
  readOnly?: boolean
  onCollapse?: (groupId: string) => void
  frame?: CanvasFrameInteraction
}

export function GroupFrameList({
  boxes,
  onPointerDown,
  pendingConnection,
  pendingConnectionSide,
  onConnectToGroup,
  readOnly,
  onCollapse,
  frame,
}: GroupFrameListProps): JSX.Element {
  return (
    <div className="generation-canvas-v2__group-boxes pointer-events-none absolute inset-0">
      {boxes.map((box) => (
        <GroupFrame
          key={box.group.id}
          box={box}
          onPointerDown={onPointerDown}
          pendingConnection={pendingConnection}
          pendingConnectionSide={pendingConnectionSide}
          onConnectToGroup={onConnectToGroup}
          readOnly={readOnly}
          onCollapse={onCollapse}
          frame={frame}
        />
      ))}
    </div>
  )
}
