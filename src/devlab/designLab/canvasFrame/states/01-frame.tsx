// 设计实验室 · 画布框工具的六态（2026-09-06 用户拍板的第一档）。
//
// 六格分别钉住：画完还空着什么样、装了东西什么样、拖进去/拖出来的那一刻长什么样、
// 折叠成卡什么样、⋯ 菜单里有哪几项。前四格是这一档真正的新东西——尤其三、四两格：
// 实拍里这一刻**完全没有反馈**（拖出去松手才发现框追着长大把它重新包住）。
//
// 顺序有意义：`labStates.mjs` 按本屏目录里 `NN-*.tsx` 的文件名排序解析，汇总口按同样顺序拼接。
import React from 'react'

import { CollapsedGroupCard } from '../../../../workbench/generationCanvas/components/CollapsedGroupCard'
import FrameContextMenu from '../../../../workbench/generationCanvas/components/FrameContextMenu'
import { CanvasFrameStage, makeFrame, makeFrameMember } from '../canvasFrameLabKit'
import type { LabState } from '../../labScreen'

const NOOP = (): void => {}

// 成员用**真实渲染尺寸**（图片节点的下限就是 240×120，见 nodeSizing）：两上一下摆成
// 一小段戏的样子。坐标照着框的留白算（框 24..600，内容留白 24 → 活动区 48..576），
// 所以三张卡在框里是真的摆得下，不是缩略图里看着差不多。
const MEMBERS = [
  makeFrameMember('shot-1', { x: 48, y: 116 }),
  makeFrameMember('shot-2', { x: 312, y: 116 }),
  makeFrameMember('shot-3', { x: 48, y: 260 }),
]

const FRAME_BOUNDS = { x: 24, y: 56, w: 552, h: 348 }

const FILLED_FRAME = makeFrame('frame-filled', {
  name: '第二幕 · 咖啡馆',
  description: '林夏推门那一段',
  nodeIds: MEMBERS.map((member) => member.id),
  frameBounds: FRAME_BOUNDS,
})

// `source` 逐条写成字面单引号串（不是抽常量再拼）：`labStates.mjs` 那把源码正则按
// 「id / name / source / coverage 四行紧挨着的单引号串」解析注册项。
export const CANVAS_FRAME_STATES: readonly LabState[] = [
  {
    id: 'canvas-frame-01-empty',
    name: '空框 · 刚画完，还没放东西（虚线）',
    source: '现役 GroupFrame.tsx ← getCanvasGroupBoxes 读 frameBounds（docs/plan/2026-09-06-canvas-frame-tool.md §2.2）',
    coverage: 'shell',
    // 2026-09-06 之前零成员的组**根本不渲染**（getCanvasGroupBoxes 直接 return []），
    // 用户画完一个空框会看不见它。这一格钉住「空框存在，并且长得像还没装东西的样子」。
    render: () => (
      <CanvasFrameStage
        frame={makeFrame('frame-empty', {
          name: '未命名框',
          nodeIds: [],
          frameBounds: FRAME_BOUNDS,
        })}
      />
    ),
  },
  {
    id: 'canvas-frame-02-filled',
    name: '有内容 · 实线 + 标题 / 说明 / 计数',
    source: '现役 GroupFrameHeader.tsx（docs/plan/2026-09-06-canvas-frame-tool.md §2.3 头部）',
    coverage: 'shell',
    // 头部一行要装下五样：点 · 标题 · 灰字说明 · 计数 · 折叠 · ⋯。这一格看的是它挤不挤、
    // 说明那一句会不会把计数推出胶囊。
    render: () => <CanvasFrameStage frame={FILLED_FRAME} members={MEMBERS} />,
  },
  {
    id: 'canvas-frame-03-drag-join',
    name: '拖入反馈 · 框边亮起、计数「3 → 4」',
    source: '现役 GroupFrame.tsx 的 membershipPreview（docs/plan/2026-09-06-canvas-frame-tool.md §2.4）',
    coverage: 'shell',
    // accent 只在这一刻出现——`groupVisualContract` 的写死是「常驻装饰中性，强调色只留给
    // 临时交互反馈」。这一格就是那句注释允许的唯一场景。
    render: () => (
      <CanvasFrameStage
        frame={FILLED_FRAME}
        members={MEMBERS}
        interaction={{ membershipPreview: { groupId: FILLED_FRAME.id, change: 'join', nextCount: 4 } }}
      />
    ),
  },
  {
    id: 'canvas-frame-04-drag-leave',
    name: '拖出反馈 · 框边变虚线、计数「3 → 2」',
    source: '实拍落差 tests/ux/shots/group-frame-now/README.md 的 e、e2（框追着长大那条 bug 的反面）',
    coverage: 'shell',
    // 这一格是整档最要紧的一张：实拍里拖出去的那一刻**什么反馈都没有**，松手才发现
    // 框长大了、成员根本没退组。现在松手之前就把结果写出来。
    render: () => (
      <CanvasFrameStage
        frame={FILLED_FRAME}
        members={MEMBERS}
        interaction={{ membershipPreview: { groupId: FILLED_FRAME.id, change: 'leave', nextCount: 2 } }}
      />
    ),
  },
  {
    id: 'canvas-frame-05-collapsed',
    name: '折叠成卡 · 沿用现役形态（一张卡 + 左右锚点）',
    source: '现役 CollapsedGroupCard.tsx（第一档不改折叠态，这一格是防回归的基线）',
    coverage: 'shell',
    render: () => (
      <CanvasFrameStage frame={makeFrame('frame-collapsed', { name: '第二幕 · 咖啡馆', nodeIds: [] })}>
        <CollapsedGroupCard
          card={{ groupId: 'frame-collapsed', name: '第二幕 · 咖啡馆', memberCount: 3, position: { x: 160, y: 92 } }}
          readOnly={false}
          pendingConnection={false}
          pendingConnectionSource={false}
          onPointerDown={NOOP}
          onExpand={NOOP}
          onStartConnection={NOOP}
          onCompleteConnection={NOOP}
        />
      </CanvasFrameStage>
    ),
  },
  {
    id: 'canvas-frame-06-menu',
    name: '⋯ 菜单 · 头部那颗与框边右键同一份',
    source: '现役 FrameContextMenu.tsx ← canvasPointerGestureModel 的右键落点四分表',
    coverage: 'shell',
    // 「解散」下面那句灰字是刻意的：它是「解散 ≠ 删除」这个区别本身，不写用户不敢点。
    render: () => (
      <CanvasFrameStage frame={FILLED_FRAME} members={MEMBERS}>
        <FrameContextMenu
          className="!left-[300px] !top-[80px]"
          frameName="第二幕 · 咖啡馆"
          canGenerate
          canSendToTimeline={false}
          onAction={NOOP}
        />
      </CanvasFrameStage>
    ),
  },
]
