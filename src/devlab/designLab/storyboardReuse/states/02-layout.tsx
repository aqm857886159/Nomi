import React from 'react'
import type { LabState } from '../../labScreen'
import type { GenerationCanvasNode } from '../../../../workbench/generationCanvas/model/generationCanvasTypes'
import { labAnchorRuntime } from '../../storyboard/storyboardFixtures'
import { LAYOUT_NARROW, LAYOUT_WIDE, LayoutAnchors, LayoutRows } from '../storyboardLayoutLabKit'
import { ANCHOR_CHARACTER_3_4, ANCHOR_SCENE_16_9, LAYOUT_ANCHORS, RESULT_16_9, layoutPlan, layoutShots } from '../storyboardLayoutFixtures'

/**
 * 第二轮（2026-10-06 用户：「优化左侧的显示……给左边留出空间可以清晰预览……注意各个比例的展示……对齐」）。
 * 版面由协调会话定：行首 gutter · 视觉列（预览框 + 参考缩略图条）· 内容列（提示词 + 底栏）。
 * 同一个 id 在 main / 上一版 / 本版各渲染一次。
 */

const SOURCE_FILM = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md 第二轮 · 视觉列按整片画幅'
const SOURCE_MIXED = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md 第二轮 · 混合画幅 contain + 画幅标签'
const SOURCE_ANCHOR = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md 第二轮 · 参考卡区同一套网格'
const SOURCE_STATES = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md 第二轮 · 有结果 / 生成中 / 失败'
const ROW = 'src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx:169'
const ANCHOR = 'src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx:100'

function resultNode(id: string, extra: Partial<GenerationCanvasNode>): GenerationCanvasNode {
  return { id, kind: 'video', title: id, position: { x: 0, y: 0 }, status: 'success', ...extra } as GenerationCanvasNode
}

const ANCHOR_CARDS = () => [
  labAnchorRuntime(LAYOUT_ANCHORS[0], { resultUrl: ANCHOR_CHARACTER_3_4, referencedByCount: 1 }),
  labAnchorRuntime(LAYOUT_ANCHORS[1], { resultUrl: ANCHOR_SCENE_16_9, referencedByCount: 2 }),
]

export const LAYOUT_STATES: readonly LabState[] = [
  {
    id: 'sbl-01-film-16x9-wide',
    name: '整片 16:9 · 宽 900',
    source: SOURCE_FILM,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('16:9')} width={LAYOUT_WIDE} />,
  },
  {
    id: 'sbl-02-film-16x9-narrow',
    name: '整片 16:9 · 最小窗口 664',
    source: SOURCE_FILM,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('16:9')} width={LAYOUT_NARROW} />,
  },
  {
    id: 'sbl-03-film-9x16-wide',
    name: '整片 9:16 · 宽 900',
    source: SOURCE_FILM,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('9:16')} width={LAYOUT_WIDE} />,
  },
  {
    id: 'sbl-04-film-9x16-narrow',
    name: '整片 9:16 · 最小窗口 664',
    source: SOURCE_FILM,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('9:16')} width={LAYOUT_NARROW} />,
  },
  {
    id: 'sbl-05-film-1x1-wide',
    name: '整片 1:1 · 宽 900',
    source: SOURCE_FILM,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('1:1')} width={LAYOUT_WIDE} />,
  },
  {
    id: 'sbl-06-film-1x1-narrow',
    name: '整片 1:1 · 最小窗口 664',
    source: SOURCE_FILM,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('1:1')} width={LAYOUT_NARROW} />,
  },
  {
    id: 'sbl-07-mixed-wide',
    name: '混合画幅：整片 16:9，镜 2 覆盖 9:16、镜 3 覆盖 1:1 · 宽',
    source: SOURCE_MIXED,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('16:9', layoutShots({ 2: '9:16', 3: '1:1' }))} width={LAYOUT_WIDE} />,
  },
  {
    id: 'sbl-08-mixed-narrow',
    name: '混合画幅 · 最小窗口',
    source: SOURCE_MIXED,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('16:9', layoutShots({ 2: '9:16', 3: '1:1' }))} width={LAYOUT_NARROW} />,
  },
  {
    id: 'sbl-09-anchors-wide',
    name: '参考卡区：角色 3:4 + 场景 16:9（整片 16:9）· 宽',
    source: SOURCE_ANCHOR,
    mirrors: ANCHOR,
    coverage: 'component-only',
    render: () => <LayoutAnchors cards={ANCHOR_CARDS()} aspect="16:9" width={LAYOUT_WIDE} />,
  },
  {
    id: 'sbl-10-anchors-narrow',
    name: '参考卡区 · 最小窗口',
    source: SOURCE_ANCHOR,
    mirrors: ANCHOR,
    coverage: 'component-only',
    render: () => <LayoutAnchors cards={ANCHOR_CARDS()} aspect="16:9" width={LAYOUT_NARROW} />,
  },
  {
    id: 'sbl-11-row-states',
    name: '三种状态：有结果 / 生成中 45% / 失败（整片 16:9）',
    source: SOURCE_STATES,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => (
      <LayoutRows
        plan={layoutPlan('16:9')}
        width={LAYOUT_WIDE}
        execs={{
          1: { status: 'done', resultUrl: RESULT_16_9, node: resultNode('sbl-done', { result: { type: 'image', url: RESULT_16_9 } } as Partial<GenerationCanvasNode>) },
          2: { status: 'generating', progressPercent: 45, node: resultNode('sbl-running', { status: 'running', progress: { phase: 'generating', percent: 45, updatedAt: Date.now() - 12000 } } as Partial<GenerationCanvasNode>) },
          3: { status: 'failed', errorMessage: '供应商返回 400：参数不合法', node: resultNode('sbl-failed', { status: 'error', error: '供应商返回 400：参数不合法' } as Partial<GenerationCanvasNode>) },
        }}
      />
    ),
  },
  {
    id: 'sbl-12-film-16x9-dark',
    name: '整片 16:9 · 宽 · 暗',
    source: SOURCE_FILM,
    mirrors: ROW,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <LayoutRows plan={layoutPlan('16:9')} width={LAYOUT_WIDE} />,
  },
]
