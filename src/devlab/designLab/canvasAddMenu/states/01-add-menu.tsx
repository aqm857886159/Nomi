// 设计实验室 · 画布「加东西」这一族的三态（2026-09-06 拍板的第三档）。
//
// 拍板前后的差别一句话：左缘原来是 **9 个平铺**，两组之间只有一条 `w-px` 分隔线（真机上淡到
// 看不见），「生成什么」和「摆一个空间/草图」两类心智没有边界；现在是 **5 个常驻 + 一个「更多」**，
// 每一段都有名字。三格分别钉住：常驻长什么样、「更多」展开长什么样、右键菜单列全是什么样。
//
// 顺序有意义：`labStates.mjs` 按本屏目录里 `NN-*.tsx` 的文件名排序解析，汇总口按同样顺序拼接。
import React from 'react'
import CanvasToolbar, { NodeAddMenu } from '../../../../workbench/generationCanvas/components/CanvasToolbar'
import { CanvasAddStage } from '../canvasAddMenuLabKit'
import type { LabState } from '../../labScreen'

const noop = (): void => {}
const insertionPosition = (): { x: number; y: number } => ({ x: 0, y: 0 })

function Rail(): JSX.Element {
  return <CanvasToolbar getInsertionPosition={insertionPosition} categoryId="lab" />
}

export const CANVAS_ADD_MENU_STATES: readonly LabState[] = [
  {
    id: 'canvas-add-01-rail-collapsed',
    name: '左缘常驻 · 5 个 + 一颗「更多」',
    source: '现役 CanvasToolbar.tsx ← canvasToolbarModel.ts 意图表（docs/design/nomi-design-system.md §1.5.1 常驻预算）',
    coverage: 'shell',
    render: () => (
      <CanvasAddStage>
        <Rail />
      </CanvasAddStage>
    ),
  },
  {
    id: 'canvas-add-02-rail-more-open',
    name: '「更多」展开 · 两段带名字（更多 / 空间 · 草图）',
    source: '现役 CanvasToolbar.tsx 的 more 菜单 ← canvasMoreAddSections()（§1.5.3 分段要有名字）',
    coverage: 'shell',
    render: () => (
      <CanvasAddStage openMore>
        <Rail />
      </CanvasAddStage>
    ),
  },
  {
    id: 'canvas-add-03-context-menu-full',
    name: '空白处右键 · 三段列全（生成 / 导入 / 空间 · 草图）',
    source: '现役 NodeAddMenu ← canvasFullAddSections()；落点语义见 useCanvasMenuActions.ts',
    coverage: 'shell',
    render: () => (
      <CanvasAddStage>
        <NodeAddMenu
          className="!left-16 !top-8"
          onAddNode={noop}
          onImportFiles={noop}
        />
      </CanvasAddStage>
    ),
  },
]
