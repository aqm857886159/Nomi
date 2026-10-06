import React from 'react'
import type { LabState } from '../../labScreen'
import {
  BATCH_NARROW,
  BATCH_WIDE,
  BatchDialogStage,
  BatchFooter,
  BatchRows,
  BulkBarStage,
  ClickFirst,
  SelectionStage,
  batchItems,
} from '../storyboardBatchLabKit'
import { batchPlan, batchShots } from '../storyboardBatchFixtures'

/**
 * 设计实验室 · 分镜「批量 / 选择」提案（2026-10-06，L-sbbatch；设计卡 `docs/plan/2026-10-06-storyboard-batch-select.md`）。
 *
 * 三件事各占一组：B2「生成剩余」确认框（复用 Agent 付费卡的计划行）、B5b 行首勾选框 = 选中 + 结果可移除、
 * B7 批量 / 多选参数 = 所选镜公共可选集（复用画布底栏同一个 `InlineParameterBar`）。
 * 「现在」的对照图是改之前在 main 上截的，存在 `docs/evidence/2026-10-06-storyboard-batch-select/now/`，这里只留「改后」。
 */

const DOC = 'docs/plan/2026-10-06-storyboard-batch-select.md'
const SOURCE_B2 = `${DOC} §B2 生成剩余`
const SOURCE_B5 = `${DOC} §B5b 勾选 = 选中 · 结果可移除`
const SOURCE_B7 = `${DOC} §B7 批量 / 多选参数 = 公共可选集`
const ROW = 'src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx:169'
const BAR = 'src/workbench/creation/storyboard/StoryboardSelectionToolbar.tsx:45'
const BULK = 'src/workbench/creation/storyboard/StoryboardBulkBar.tsx:55'
const CARD = 'src/workbench/ai/v4/AgentPanelV4Cards.tsx:208'
const FOOTER = 'src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:693'

export const BATCH_STATES: readonly LabState[] = [
  // ───── B2 ─────
  {
    id: 'sbb-b2-01-dialog',
    name: 'B2 · 生成剩余 · 参考卡 2 张 → 镜头 4 个',
    source: SOURCE_B2,
    mirrors: CARD,
    coverage: 'component-only',
    render: () => <BatchDialogStage items={batchItems()} />,
  },
  {
    id: 'sbb-b2-02-dialog-removed',
    name: 'B2 · 去掉「后巷」参考卡和镜 3 → 生成 4 项',
    source: SOURCE_B2,
    mirrors: CARD,
    coverage: 'component-only',
    render: () => <BatchDialogStage items={batchItems({ removed: [1, 4] })} />,
  },
  {
    id: 'sbb-b2-03-dialog-no-anchors',
    name: 'B2 · 边界 · 没有待生成的参考卡（只剩镜头，不出组标题）',
    source: SOURCE_B2,
    mirrors: CARD,
    coverage: 'component-only',
    render: () => <BatchDialogStage items={batchItems({ anchors: 0 })} />,
  },
  {
    id: 'sbb-b2-04-dialog-many',
    name: 'B2 · 边界 · 参考卡 3 张 + 镜头 12 个（清单自己滚）',
    source: SOURCE_B2,
    mirrors: CARD,
    coverage: 'component-only',
    render: () => <BatchDialogStage items={batchItems({ anchors: 3, shots: 12 })} />,
  },
  {
    id: 'sbb-b2-05-dialog-none',
    name: 'B2 · 边界 · 全部去掉（主按钮不可点，× 取消）',
    source: SOURCE_B2,
    mirrors: CARD,
    coverage: 'component-only',
    render: () => <BatchDialogStage items={batchItems({ removed: [0, 1, 2, 3, 4, 5] })} />,
  },
  {
    id: 'sbb-b2-06-dialog-narrow',
    name: 'B2 · 最小窗口 1100×690（表格 664 宽）',
    source: SOURCE_B2,
    mirrors: CARD,
    coverage: 'component-only',
    render: () => <BatchDialogStage items={batchItems({ anchors: 3, shots: 12 })} width={BATCH_NARROW} cardWidth={420} />,
  },
  {
    id: 'sbb-b2-07-dialog-dark',
    name: 'B2 · 暗',
    source: SOURCE_B2,
    mirrors: CARD,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <BatchDialogStage items={batchItems({ removed: [1, 4] })} />,
  },
  {
    id: 'sbb-b2-08-footer-idle',
    name: 'B2 · 页脚 · 平时（按钮带数）',
    source: SOURCE_B2,
    mirrors: FOOTER,
    coverage: 'component-only',
    render: () => <BatchFooter phase="idle" width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b2-09-footer-anchors',
    name: 'B2 · 页脚 · 确认后先出参考卡',
    source: SOURCE_B2,
    mirrors: FOOTER,
    coverage: 'component-only',
    render: () => <BatchFooter phase="anchors" width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b2-10-footer-shots',
    name: 'B2 · 页脚 · 参考卡好了，镜头在跑',
    source: SOURCE_B2,
    mirrors: FOOTER,
    coverage: 'component-only',
    render: () => <BatchFooter phase="shots" width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b2-11-footer-stopped',
    name: 'B2 · 页脚 · 参考卡失败：镜头没发出',
    source: SOURCE_B2,
    mirrors: FOOTER,
    coverage: 'component-only',
    render: () => <BatchFooter phase="stopped" width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b2-12-footer-done',
    name: 'B2 · 页脚 · 边界 · 全部已生成',
    source: SOURCE_B2,
    mirrors: FOOTER,
    coverage: 'component-only',
    render: () => <BatchFooter phase="done" width={BATCH_WIDE} />,
  },
  // ───── B5b ─────
  {
    id: 'sbb-b5-01-rows',
    name: 'B5b · 勾选 = 选中（已生成 / 本次跳过 / 选中）',
    source: SOURCE_B5,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <BatchRows flags={['done', 'skipped', 'selected']} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b5-02-rows-narrow',
    name: 'B5b · 最小窗口 664',
    source: SOURCE_B5,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <BatchRows flags={['done', 'skipped', 'selected']} width={BATCH_NARROW} />,
  },
  {
    id: 'sbb-b5-03-rows-dark',
    name: 'B5b · 暗',
    source: SOURCE_B5,
    mirrors: ROW,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <BatchRows flags={['done', 'skipped', 'selected']} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b5-04-row-menu',
    name: 'B5b · 行菜单里有「本次跳过」',
    source: SOURCE_B5,
    mirrors: ROW,
    coverage: 'component-only',
    capture: 'viewport',
    render: () => (
      <ClickFirst selector="[data-storyboard-row-menu-trigger]">
        <BatchRows flags={['plain']} width={BATCH_WIDE} />
      </ClickFirst>
    ),
  },
  {
    id: 'sbb-b5-05-result-removed',
    name: 'B5b · 移除结果之后（回到未生成，历史版本 ×2 还在）',
    source: SOURCE_B5,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <BatchRows flags={['removed']} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b5-06-result-narrow',
    name: 'B5b · 结果上的动作条 · 最小窗口',
    source: SOURCE_B5,
    mirrors: ROW,
    coverage: 'component-only',
    render: () => <BatchRows flags={['done']} width={BATCH_NARROW} />,
  },
  // ───── B7 ─────
  {
    id: 'sbb-b7-01-toolbar-same-model',
    name: 'B7 · 多选 2 镜，同一个模型（参数全在；时长不一致 = 混合）',
    source: SOURCE_B7,
    mirrors: BAR,
    coverage: 'component-only',
    render: () => <SelectionStage pick={[1, 2]} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b7-02-toolbar-three-models',
    name: 'B7 · 多选跨 3 个模型（Seedance / Veo / Kling）',
    source: SOURCE_B7,
    mirrors: BAR,
    coverage: 'component-only',
    render: () => <SelectionStage pick={[1, 4, 5]} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b7-03-toolbar-mixed-kinds',
    name: 'B7 · 图片镜 + 视频镜（两档各一组）',
    source: SOURCE_B7,
    mirrors: BAR,
    coverage: 'component-only',
    render: () => <SelectionStage pick={[1, 3, 4]} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b7-04-toolbar-narrow',
    name: 'B7 · 最小窗口 664 · 图片 + 视频',
    source: SOURCE_B7,
    mirrors: BAR,
    coverage: 'component-only',
    render: () => <SelectionStage pick={[1, 3, 4]} width={BATCH_NARROW} />,
  },
  {
    id: 'sbb-b7-05-toolbar-empty',
    name: 'B7 · 边界 · 公共集为空（Seedance + Hailuo）',
    source: SOURCE_B7,
    mirrors: BAR,
    coverage: 'component-only',
    render: () => <SelectionStage pick={[1, 6]} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b7-06-panel-three-models',
    name: 'B7 · 点开参数 · 跨 3 个模型（只剩比例，其余说明谁没有）',
    source: SOURCE_B7,
    mirrors: BAR,
    coverage: 'component-only',
    capture: 'viewport',
    render: () => (
      <ClickFirst selector="[data-parameter-summary]">
        <div className="pt-[260px]"><SelectionStage pick={[1, 4, 5]} width={BATCH_WIDE} withRows={false} /></div>
      </ClickFirst>
    ),
  },
  {
    id: 'sbb-b7-07-panel-same-model',
    name: 'B7 · 点开参数 · 同一个模型（全部参数，时长显示混合）',
    source: SOURCE_B7,
    mirrors: BAR,
    coverage: 'component-only',
    capture: 'viewport',
    render: () => (
      <ClickFirst selector="[data-parameter-summary]">
        <div className="pt-[420px]"><SelectionStage pick={[1, 2]} width={BATCH_WIDE} withRows={false} /></div>
      </ClickFirst>
    ),
  },
  {
    id: 'sbb-b7-08-panel-empty',
    name: 'B7 · 点开参数 · 公共集为空时说明原因',
    source: SOURCE_B7,
    mirrors: BAR,
    coverage: 'component-only',
    capture: 'viewport',
    render: () => (
      <ClickFirst selector="[data-parameter-summary]">
        <div className="pt-[300px]"><SelectionStage pick={[1, 6]} width={BATCH_WIDE} withRows={false} /></div>
      </ClickFirst>
    ),
  },
  {
    id: 'sbb-b7-09-toolbar-dark',
    name: 'B7 · 暗',
    source: SOURCE_B7,
    mirrors: BAR,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <SelectionStage pick={[1, 4, 5]} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b7-10-bulkbar',
    name: 'B7 · 「全部镜头」条（图片 + 视频两档，画幅候选由模型派生）',
    source: SOURCE_B7,
    mirrors: BULK,
    coverage: 'component-only',
    render: () => <BulkBarStage plan={batchPlan(batchShots().slice(0, 5))} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b7-11-bulkbar-narrow',
    name: 'B7 · 全部镜头条 · 最小窗口 664',
    source: SOURCE_B7,
    mirrors: BULK,
    coverage: 'component-only',
    render: () => <BulkBarStage plan={batchPlan(batchShots().slice(0, 5))} width={BATCH_NARROW} />,
  },
  {
    id: 'sbb-b7-12-bulkbar-one-model',
    name: 'B7 · 全部镜头条 · 边界 · 只有 Seedance 镜（参数全在）',
    source: SOURCE_B7,
    mirrors: BULK,
    coverage: 'component-only',
    render: () => <BulkBarStage plan={batchPlan(batchShots().slice(0, 2))} width={BATCH_WIDE} />,
  },
  {
    id: 'sbb-b7-13-bulkbar-empty',
    name: 'B7 · 全部镜头条 · 边界 · 其中有一镜的模型没有可调参数（公共集为空）',
    source: SOURCE_B7,
    mirrors: BULK,
    coverage: 'component-only',
    render: () => <BulkBarStage plan={batchPlan()} width={BATCH_WIDE} />,
  },
]
