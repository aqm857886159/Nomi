import React from 'react'
import type { LabState } from '../../labScreen'
import {
  AnchorThenShot,
  AnchorZone,
  ClickFirst,
  ReuseStage,
  REUSE_NARROW,
  REUSE_WIDE,
  ShotRow,
  ShotRows,
  reuseAnchorCards,
} from '../storyboardReuseLabKit'
import {
  planAfterAnchorResult,
  reusePlan,
  shotAfterRemovingFirstReference,
  shotImageEdit,
  shotOmni,
} from '../storyboardReuseFixtures'

/**
 * 设计实验室 · 分镜表「复用画布底栏」提案（2026-10-06，L-sbui；设计卡
 * `docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md`）。
 *
 * 同一个 id 在 main 上渲染「现在」、在本分支上渲染「改后」，成对出图给用户拍板。
 * 每一格都是现役组件本体（coverage: component-only——表格外壳 / 编辑器那一层没有挂）。
 */

const SOURCE_AD = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md §A 参数复用画布 · §D 空间'
const SOURCE_A = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md §A 参数复用画布'
const SOURCE_B = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md §B 自动引用'
const SOURCE_C = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md §C 删得掉'
const SOURCE_D = 'docs/plan/2026-10-06-storyboard-reuse-canvas-composer.md §D 空间'
const ROW = 'src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx:169'
const ANCHOR = 'src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx:100'

export const REUSE_STATES: readonly LabState[] = [
  {
    id: 'sbr-01-rows-wide',
    name: '镜头行 ×3 · 宽（全能参考 / 文生视频 / 改图）',
    source: SOURCE_AD,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <ShotRows plan={reusePlan()} width={REUSE_WIDE} />,
  },
  {
    id: 'sbr-02-rows-narrow',
    name: '镜头行 ×3 · 最小窗口 1100×690（表格 664 宽）',
    source: SOURCE_D,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <ShotRows plan={reusePlan()} width={REUSE_NARROW} />,
  },
  {
    id: 'sbr-03-rows-dark',
    name: '镜头行 ×3 · 暗',
    source: SOURCE_AD,
    mirrors: ROW,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <ShotRows plan={reusePlan()} width={REUSE_WIDE} />,
  },
  {
    id: 'sbr-04-params-open',
    name: '镜头行 · 点开参数（现在：⋯ 弹层；改后：画布同款平铺面板）',
    source: SOURCE_A,
    mirrors: ROW,
    coverage: 'component-only',
    capture: 'viewport',
    render: () => (
      <ReuseStage width={REUSE_WIDE}>
        <div className="pt-[300px]" />
        <ClickParams />
      </ReuseStage>
    ),
  },
  {
    id: 'sbr-05-anchors-wide',
    name: '参考卡 ×3 · 宽（已出图 / 未生成 / 仅文字）',
    source: SOURCE_AD,
    mirrors: ANCHOR,
    coverage: 'component-only',
    render: () => <AnchorZone width={REUSE_WIDE} />,
  },
  {
    id: 'sbr-06-anchors-narrow',
    name: '参考卡 ×3 · 最小窗口（664 宽）',
    source: SOURCE_D,
    mirrors: ANCHOR,
    coverage: 'component-only',
    render: () => <AnchorZone width={REUSE_NARROW} />,
  },
  {
    id: 'sbr-07-anchors-dark',
    name: '参考卡 ×3 · 暗',
    source: SOURCE_AD,
    mirrors: ANCHOR,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <AnchorZone width={REUSE_WIDE} />,
  },
  {
    id: 'sbr-08-anchor-params-open',
    name: '参考卡 · 参数（现在：只有一个模型下拉；改后：按模型出全部参数）',
    source: SOURCE_A,
    mirrors: ANCHOR,
    coverage: 'component-only',
    capture: 'viewport',
    render: () => (
      <div className="pt-[320px]">
        <AnchorParams />
      </div>
    ),
  },
  {
    id: 'sbr-09-anchor-menu',
    name: '参考卡 · 类型 / 出图方式 / 删除（现在：一整排按钮；改后：收进行首 ⋯）',
    source: SOURCE_D,
    mirrors: ANCHOR,
    coverage: 'component-only',
    capture: 'viewport',
    render: () => <AnchorMenu />,
  },
  {
    id: 'sbr-10-auto-reference',
    name: '自动引用 · 林薇出图之后，镜 1 提示词里的「林薇」',
    source: SOURCE_B,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <AnchorThenShot plan={planAfterAnchorResult(reusePlan([shotOmni()]))} width={REUSE_WIDE} />,
  },
  {
    id: 'sbr-11-auto-reference-narrow',
    name: '自动引用 · 最小窗口',
    source: SOURCE_B,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <AnchorThenShot plan={planAfterAnchorResult(reusePlan([shotOmni()]))} width={REUSE_NARROW} />,
  },
  {
    id: 'sbr-12-reference-remove-entry',
    name: '删参考的入口（现在：点开浮层找 20px 垃圾桶；改后：缩略图右上角 ×）',
    source: SOURCE_C,
    mirrors: ROW,
    coverage: 'component-only',
    capture: 'viewport',
    render: () => <RemoveEntry />,
  },
  {
    id: 'sbr-13-reference-removed',
    name: '删掉第一张参考之后（现在：@ 芯片留下变孤儿；改后：@ 跟着删）',
    source: SOURCE_C,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => {
      const plan = reusePlan([shotAfterRemovingFirstReference(shotImageEdit())])
      return <ShotRows plan={plan} width={REUSE_WIDE} />
    },
  },
]

// ── 需要「点一下」的几格：点的是现役按钮（选择器按现役 DOM 写） ──────────────────────


function ClickParams(): React.ReactElement {
  const plan = reusePlan([shotOmni()])
  return (
    <ClickFirst selector="[data-storyboard-composer-switches]">
      <ShotRow plan={plan} shot={plan.shots[0]} />
    </ClickFirst>
  )
}

function AnchorParams(): React.ReactElement {
  return <AnchorZone width={REUSE_WIDE} cards={reuseAnchorCards().slice(0, 1)} />
}

function AnchorMenu(): React.ReactElement {
  return <AnchorZone width={REUSE_WIDE} cards={reuseAnchorCards().slice(0, 1)} />
}

function RemoveEntry(): React.ReactElement {
  const plan = reusePlan([shotImageEdit()])
  return (
    <ReuseStage width={REUSE_WIDE}>
      <ClickFirst selector="[data-storyboard-ref-slot='image_ref'] button">
        <ShotRow plan={plan} shot={plan.shots[0]} />
      </ClickFirst>
    </ReuseStage>
  )
}
