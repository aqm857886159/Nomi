// 设计实验室 · 屏「画布 · 框工具」的取景台与夹具。
//
// 这一格渲染的是**现役组件本身**（`GroupFrame` / `CollapsedGroupCard` / `FrameContextMenu`），
// 不是照着它画的样张——2026-09-06 用户拍板的「UI 交付定义」就是这一条：样张与实现是两套
// 代码描述同一个东西，中间靠人脑翻译，漂移是结构性的。
//
// 取景台只做两件事：
//  1. 给一块 `relative` 的舞台——框是 `absolute left/top/width/height`（画布坐标），
//     没有定位祖先它会飘到视口上；
//  2. 把「框里有几个节点」画成占位块。这些占位块**不是**节点组件的替身：它们只负责让人
//     看清框与内容的关系（留白够不够、标题压不压到卡）。框本身的几何仍由现役
//     `getCanvasGroupBoxes` 算出来，不是在这里手填 left/top/width/height——
//     手填就等于把「框有多大」这件事在实验室里重新实现了一遍。
import React from 'react'

import GroupFrame, { type CanvasFrameInteraction } from '../../../workbench/generationCanvas/components/GroupFrame'
import {
  getCanvasGroupBoxes,
  getCanvasNodeVisualSize,
} from '../../../workbench/generationCanvas/components/generationCanvasGeometry'
import type { CanvasGroupBox } from '../../../workbench/generationCanvas/components/GroupFrame'
import type { GenerationCanvasNode, NodeGroup } from '../../../workbench/generationCanvas/model/generationCanvasTypes'

// 取景框要装得下「三张真实尺寸的卡 + 框的留白」。节点有渲染下限（图片节点 240×120，
// 见 nodeSizing.MIN_NODE_*），所以这里不能按缩略图的手感随便定个 560——
// 定小了框会被悄悄截掉右半边，而截图看起来只是「框比较宽」。
export const CANVAS_FRAME_CELL_WIDTH = 680
export const CANVAS_FRAME_CELL_HEIGHT = 470

const NOOP = (): void => {}

/** 画布坐标原点在舞台左上角略内缩一点，免得框贴着取景框边缘看不出边界。 */
const STAGE_ORIGIN = { x: -24, y: -12 }

export function makeFrameMember(
  id: string,
  position: { x: number; y: number },
  size = { width: 240, height: 120 },
): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position,
    size,
    categoryId: 'shots',
  } as GenerationCanvasNode
}

/**
 * id 走**位置参数**，不写在对象里——写成 `{ id: 'x', name: 'y' }` 会被
 * `labStates.mjs` 的注册项签名（`id: '<kebab>',` 紧跟 `name: '`）当成一条状态注册项，
 * 于是门岗抱怨「这条状态没有 source」。NodeGroup 天生就有 id + name 两个字段，
 * 与那把正则的入口签名逐字撞上，所以这里从形状上避开，而不是靠人记得别那么写。
 */
export function makeFrame(id: string, partial: Omit<Partial<NodeGroup>, 'id'> & Pick<NodeGroup, 'name' | 'nodeIds'>): NodeGroup {
  return {
    id,
    categoryId: 'shots',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as NodeGroup
}

/**
 * 舞台。`members` 既用来算框的几何（喂给现役 `getCanvasGroupBoxes`），
 * 也用来画占位块——两者同一份数据，所以「框包不包得住内容」在图上是真的，不是摆出来的。
 */
export function CanvasFrameStage({
  frame,
  members,
  interaction,
  children,
}: {
  frame: NodeGroup
  members?: readonly GenerationCanvasNode[]
  interaction?: Partial<CanvasFrameInteraction>
  children?: React.ReactNode
}): JSX.Element {
  const nodes = members ?? []
  const [box] = getCanvasGroupBoxes([frame], nodes) as CanvasGroupBox[]
  const frameInteraction: CanvasFrameInteraction = {
    membershipPreview: null,
    editingGroupId: null,
    onEditingChange: NOOP,
    onRename: NOOP,
    onDescribe: NOOP,
    onOpenMenu: NOOP,
    ...interaction,
  }
  return (
    <div
      className="relative overflow-hidden rounded-nomi border border-nomi-line bg-[var(--workbench-surface)]"
      style={{ width: CANVAS_FRAME_CELL_WIDTH, height: CANVAS_FRAME_CELL_HEIGHT }}
      data-design-lab-stage="canvas-frame"
    >
      <div className="absolute inset-0" style={{ transform: `translate(${-STAGE_ORIGIN.x}px, ${-STAGE_ORIGIN.y}px)` }}>
        {box ? (
          <GroupFrame box={box} onPointerDown={NOOP} onCollapse={NOOP} frame={frameInteraction} />
        ) : null}
        {nodes.map((node) => {
          // 占位块必须用**和框同一个**尺寸解析器。读 `node.size` 会得出另一份真相：
          // 图片节点有 240×120 的渲染下限，写 120×96 的话框按 240 算、占位块按 120 画，
          // 于是「框为什么这么宽」在图上完全看不出来（这一格第一版就是这么被截掉右半边的）。
          const size = getCanvasNodeVisualSize(node)
          return (
            <div
              key={node.id}
              className="absolute rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm"
              style={{ left: node.position.x, top: node.position.y, width: size.width, height: size.height }}
              aria-hidden="true"
            />
          )
        })}
        {children}
      </div>
    </div>
  )
}
