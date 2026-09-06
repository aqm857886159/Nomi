import React from 'react'
import type { LabState } from '../../labScreen'
import StoryboardAnchorZone from '../../../../workbench/creation/storyboard/anchorZone/StoryboardAnchorZone'
import StoryboardBulkBar from '../../../../workbench/creation/storyboard/StoryboardBulkBar'
import StoryboardShotTable from '../../../../workbench/creation/storyboard/StoryboardShotTable'
import { deriveStoryboardRowRuntimes } from '../../../../workbench/creation/storyboard/exec/storyboardRowStatus'
import type { StoryboardPlan } from '../../../../workbench/generationCanvas/agent/storyboardPlan'
import { AutoClick, AutoFocus, PlaybackStage, TableStage } from '../storyboardLabKit'
import {
  LAB_ANCHORS,
  LAB_IMAGE_MODELS,
  LAB_VIDEO_MODELS,
  labAnchorRuntime,
  labPlan,
  labShot,
  NOOP,
  STILL_NEON,
  STILL_PORTRAIT,
  STILL_PROP,
  STILL_ROOFTOP,
} from '../storyboardFixtures'

/**
 * 设计实验室 · 分镜表 v6 —— **锚区两态、批量条、场分组、多选浮条**（合同 §2.1/§2.2/§2.6/§2.7）。
 *
 * 这一族里有几格是**把多个现役组件摆在同一张舞台上**（批量条 + 锚区 + 表）。它们的
 * coverage 是 `component-only` 而不是 `shell`：真机上这三块由 `StoryboardPlanEditor` 装配，
 * 而那个壳要读 workbenchStore / 画布 store，实验室本轮不灌它们。**这一点必须诚实标出来**——
 * 看着像整屏，其实少了壳那一层（标题栏、footer 的真实计数、放大预览挂载点）。
 */

const SCENES = [
  { id: 'sc-1', title: '第一场 · 天台对峙' },
  { id: 'sc-2', title: '第二场 · 雨停之后' },
]

function scenePlan(): StoryboardPlan {
  return labPlan({
    scenes: SCENES,
    shots: [
      labShot({ index: 1, sceneId: 'sc-1' }),
      labShot({ index: 2, sceneId: 'sc-1', params: { aspect_ratio: '16:9' }, prompt: '中景，@陈默 从阴影里走出来，两人对视' }),
      labShot({ index: 3, sceneId: 'sc-1', shotKind: 'image', durationSec: 3, modelKey: 'nano-banana-2', modeId: 'edit', prompt: '近景，闪回定格，做旧照片质感' }),
      labShot({ index: 4, sceneId: 'sc-2', params: { aspect_ratio: '1:1' }, prompt: '特写，固定机位，@旧怀表 在积水里' }),
      labShot({ index: 5, sceneId: 'sc-2', prompt: '大远景，升降，无人机视角，城市重新亮起来' }),
    ],
  })
}

/**
 * **全表同一画幅**的五镜（16:9 / 9:16 各一格）。
 *
 * 2026-09-06 用户反馈四点名的就是这两格：「至少大家都同一个比例（比如从上到下都 16:9）时，
 * 单个分镜行要排得很好、对齐。」所以它们不是混排那格的陪衬，而是**对齐规则的主证据**——
 * 每行的顶线、媒体盒、参数行、生成钮四条线必须逐行对得上，媒体盒还要正好被缩略图铺满（无黑边）。
 */
function uniformPlan(aspect: string): StoryboardPlan {
  return labPlan({
    aspectRatio: aspect,
    scenes: SCENES,
    shots: [
      labShot({ index: 1, sceneId: 'sc-1' }),
      labShot({ index: 2, sceneId: 'sc-1', prompt: '中景，@陈默 从阴影里走出来，两人对视' }),
      labShot({ index: 3, sceneId: 'sc-1', shotKind: 'image', durationSec: 3, modelKey: 'nano-banana-2', modeId: 'edit', prompt: '近景，闪回定格，做旧照片质感' }),
      labShot({ index: 4, sceneId: 'sc-2', prompt: '特写，固定机位，@旧怀表 在积水里' }),
      labShot({ index: 5, sceneId: 'sc-2', prompt: '大远景，升降，无人机视角，城市重新亮起来' }),
    ],
  })
}

function TableStageWithPlan({ plan, clip = true }: { plan: StoryboardPlan; clip?: boolean }): JSX.Element {
  const rows = deriveStoryboardRowRuntimes({
    plan,
    designId: 'design-lab',
    imageModelOptions: LAB_IMAGE_MODELS,
    videoModelOptions: LAB_VIDEO_MODELS,
    nodes: [],
  })
  return (
    <TableStage clip={clip}>
      <StoryboardShotTable
        plan={plan}
        rows={rows}
        imageModelOptions={LAB_IMAGE_MODELS}
        videoModelOptions={LAB_VIDEO_MODELS}
        emptyPromptShots={new Set()}
        onChange={NOOP}
        onGenerateRow={NOOP}
        onRegenerateRow={NOOP}
        onVariantsRow={NOOP}
        onToggleLockRow={NOOP}
        onOpenPreviewRow={NOOP}
        onRerunFreshRefsRow={NOOP}
        onJumpToAnchor={NOOP}
        onSaveResultAsReference={NOOP}
        onSetResultAsFirstFrame={NOOP}
        onGenerateSelected={NOOP}
        onDeleteSelected={NOOP}
        onAgentHandoff={NOOP}
        onLockSelected={NOOP}
        onToggleSkip={NOOP}
        // 场组头的 ▶「播放本场」只在编辑器传了 onPlayGroup 时渲染；实验室不传就等于
        // 把这枚按钮从取景里悄悄漏掉——形态没被钉住，只能靠人记得它存在（假绿）。
        onPlayGroup={NOOP}
      />
    </TableStage>
  )
}

const ANCHOR_RUNTIMES = [
  labAnchorRuntime(LAB_ANCHORS[0], { resultUrl: STILL_PORTRAIT, locked: true, referencedByCount: 4 }),
  labAnchorRuntime(LAB_ANCHORS[1], { resultUrl: STILL_ROOFTOP, referencedByCount: 3 }),
  labAnchorRuntime(LAB_ANCHORS[2], { referencedByCount: 1, waitingShotCount: 1 }),
  labAnchorRuntime(LAB_ANCHORS[3], { referencedByCount: 5 }),
]

const ANCHOR_STATE_MATRIX = [
  labAnchorRuntime({ ...LAB_ANCHORS[0], id: 'm-empty', name: '未生成' }),
  labAnchorRuntime({ ...LAB_ANCHORS[0], id: 'm-generating', name: '生成中' }, { generating: true, progressPercent: 48 }),
  labAnchorRuntime({ ...LAB_ANCHORS[0], id: 'm-failed', name: '失败' }, { failed: true, errorMessage: '厂商未启用' }),
  labAnchorRuntime({ ...LAB_ANCHORS[1], id: 'm-done', name: '已生成' }, { resultUrl: STILL_NEON, referencedByCount: 2 }),
  labAnchorRuntime({ ...LAB_ANCHORS[2], id: 'm-locked', name: '已锁定' }, { resultUrl: STILL_PROP, locked: true, referencedByCount: 3 }),
  labAnchorRuntime({ ...LAB_ANCHORS[3], id: 'm-text', name: '仅文字' }, { referencedByCount: 5 }),
]

function AnchorZoneStage({ cards, expanded }: { cards: typeof ANCHOR_RUNTIMES; expanded: boolean }): JSX.Element {
  return (
    <TableStage clip={false}>
      <div className="p-3">
        <StoryboardAnchorZone
          cards={cards}
          aspect="9:16"
          imageModelOptions={LAB_IMAGE_MODELS}
          expanded={expanded}
          onToggleExpanded={NOOP}
          onUpdateAnchor={NOOP}
          onChangeKind={NOOP}
          onRemoveAnchor={NOOP}
          onGenerateAnchor={NOOP}
          onRegenerateAnchor={NOOP}
          onToggleLockAnchor={NOOP}
          onFilterByAnchor={NOOP}
          onAddAnchor={NOOP}
        />
      </div>
    </TableStage>
  )
}

export const ZONE_STATES: readonly LabState[] = [
  {
    id: 'sb-zone-01-anchors-collapsed',
    name: '锚区 · 收起（紧凑参考条）',
    source: '合同 §2.2 锚区两态 · 收起态',
    coverage: 'shell',
    render: () => <AnchorZoneStage cards={ANCHOR_RUNTIMES} expanded={false} />,
  },
  {
    id: 'sb-zone-02-anchors-expanded',
    name: '锚区 · 展开（与镜头行同解剖）',
    source: '合同 §2.2 锚区两态 · 展开态 / §3.2 锚状态',
    coverage: 'shell',
    render: () => <AnchorZoneStage cards={ANCHOR_RUNTIMES.slice(0, 2)} expanded />,
  },
  {
    id: 'sb-zone-03-anchor-state-matrix',
    name: '锚 · 六态同屏（空/生成中/失败/已生成/已锁/文字）',
    source: '合同 §3.2 锚状态表',
    coverage: 'shell',
    render: () => <AnchorZoneStage cards={ANCHOR_STATE_MATRIX} expanded={false} />,
  },
  {
    id: 'sb-zone-04-bulkbar-project-aspect',
    name: '批量条 · 整片默认画幅（+「已覆盖的 N 镜不跟着变」）',
    source: '合同 §2.1 批量条 / §2.4.1 画幅是项目级设置',
    coverage: 'shell',
    render: () => (
      <TableStage clip={false}>
        <StoryboardBulkBar
          plan={scenePlan()}
          imageModelOptions={LAB_IMAGE_MODELS}
          videoModelOptions={LAB_VIDEO_MODELS}
          onChange={NOOP}
        />
      </TableStage>
    ),
  },
  {
    id: 'sb-zone-05-scene-groups',
    name: '场分组 · 组头（合计时长 + 缺必填计数）+ 五镜混排画幅',
    source: '合同 §2.6 场分组 / §2.4 三种画幅混排仍左对齐',
    coverage: 'component-only',
    render: () => <TableStageWithPlan plan={scenePlan()} />,
  },
  {
    id: 'sb-zone-06-selection-toolbar',
    name: '多选浮条 · 纸白胶囊（含「交给 Agent」）',
    source: '合同 §2.6 多选浮条 / §2.7 Agent 三入口之二',
    coverage: 'component-only',
    render: () => (
      <AutoClick selector="[data-storyboard-select='2']">
        <TableStageWithPlan plan={scenePlan()} clip={false} />
      </AutoClick>
    ),
  },
  {
    id: 'sb-zone-07-insert-line',
    name: '行间插入线（键盘可达：focus 也现身，不只 hover）',
    source: '合同 §2.6 增 · 行间悬停「+」插入线',
    coverage: 'component-only',
    render: () => (
      <AutoFocus selector="[data-storyboard-insert-line] button">
        <TableStageWithPlan plan={scenePlan()} />
      </AutoFocus>
    ),
  },
  {
    id: 'sb-zone-08-screen-composite',
    name: '整屏拼装 · 批量条 + 锚区 + 分镜表',
    source: '合同 §2.1 表壳五段（缺标题栏与 footer——那两段住 StoryboardPlanEditor，本轮实验室未灌 store）',
    coverage: 'component-only',
    render: () => {
      const plan = scenePlan()
      return (
        <TableStage clip={false}>
          <StoryboardBulkBar plan={plan} imageModelOptions={LAB_IMAGE_MODELS} videoModelOptions={LAB_VIDEO_MODELS} onChange={NOOP} />
          <div className="flex flex-col gap-4 p-3">
            <StoryboardAnchorZone
              cards={ANCHOR_RUNTIMES}
              aspect="9:16"
              imageModelOptions={LAB_IMAGE_MODELS}
              expanded={false}
              onToggleExpanded={NOOP}
              onUpdateAnchor={NOOP}
              onChangeKind={NOOP}
              onRemoveAnchor={NOOP}
              onGenerateAnchor={NOOP}
              onRegenerateAnchor={NOOP}
              onToggleLockAnchor={NOOP}
              onFilterByAnchor={NOOP}
              onAddAnchor={NOOP}
            />
            <TableStageWithPlan plan={plan} />
          </div>
        </TableStage>
      )
    },
  },
  {
    id: 'sb-zone-09-playback-playing',
    name: '播放本场 · 播放中（镜 i / n + 进度）',
    source: '合同 §2.6 播放本场 / §3 播放中',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <PlaybackStage variant="playing" />,
  },
  {
    id: 'sb-zone-10-playback-skipped',
    name: '播放全部 · 未生成行灰色跳过',
    source: '合同 §2.6 播放全部 / §3 跳过未生成',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <PlaybackStage variant="skipped" />,
  },
  {
    id: 'sb-zone-11-playback-empty',
    name: '播放全部 · 全部未生成（空态）',
    source: '合同 §3 播放空态',
    coverage: 'shell',
    capture: 'viewport',
    render: () => <PlaybackStage variant="empty" />,
  },
  {
    id: 'sb-zone-12-uniform-16-9',
    name: '全 16:9 五行 · 四条线逐行对齐（媒体盒铺满、无黑边）',
    source: '合同 §2.4 修订（2026-09-06 用户反馈四）：全表同一画幅 → 盒 = 该画幅的框',
    coverage: 'component-only',
    render: () => <TableStageWithPlan plan={uniformPlan('16:9')} />,
  },
  {
    id: 'sb-zone-13-uniform-9-16',
    name: '全 9:16 五行 · 竖版同一只盒',
    source: '合同 §2.4 修订（2026-09-06 用户反馈四）：竖版全表同高同宽',
    coverage: 'component-only',
    render: () => <TableStageWithPlan plan={uniformPlan('9:16')} />,
  },
]
