import React from 'react'
import type { LabState } from '../../labScreen'
import { LAYOUT_NARROW, LAYOUT_WIDE, LayoutRows } from '../storyboardLayoutLabKit'
import { layoutPlan } from '../storyboardLayoutFixtures'
import { portraitShots } from '../storyboardPortraitFixtures'

/**
 * 第三轮（2026-10-06 用户：「选 A 竖版参考挪右边」）：整片竖版时，视觉列与横版同宽、预览框靠左，
 * 参考缩略图竖着排在框右边（可多列，「+」最后）；提示词与底栏贴在一起，不再撑满行高。
 * 同一个 id 在第二轮版本与本版各渲染一次。
 */
const SOURCE_PORTRAIT = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md 第三轮 · 竖版参考在框右边'
const ROW = 'src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx:169'

export const PORTRAIT_STATES: readonly LabState[] = [
  {
    id: 'sbp-01-film-9x16-wide',
    name: '整片 9:16 · 宽 900（镜 1 挂 5 张参考）',
    source: SOURCE_PORTRAIT,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('9:16', portraitShots())} width={LAYOUT_WIDE} />,
  },
  {
    id: 'sbp-02-film-9x16-narrow',
    name: '整片 9:16 · 最小窗口 664',
    source: SOURCE_PORTRAIT,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('9:16', portraitShots())} width={LAYOUT_NARROW} />,
  },
  {
    id: 'sbp-03-film-3x4-wide',
    name: '整片 3:4 · 宽 900',
    source: SOURCE_PORTRAIT,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('3:4', portraitShots())} width={LAYOUT_WIDE} />,
  },
  {
    id: 'sbp-04-film-3x4-narrow',
    name: '整片 3:4 · 最小窗口 664',
    source: SOURCE_PORTRAIT,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <LayoutRows plan={layoutPlan('3:4', portraitShots())} width={LAYOUT_NARROW} />,
  },
]
