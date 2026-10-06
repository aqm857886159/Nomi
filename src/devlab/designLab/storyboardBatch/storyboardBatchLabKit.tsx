import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlayerPlay } from '@tabler/icons-react'
import { V4Intervention } from '../../../workbench/ai/v4/AgentPanelV4Cards'
import { useV4Labels } from '../../../workbench/ai/v4/agentPanelV4Labels'
import type { InterventionData, PlanRow } from '../../../workbench/ai/v4/agentPanelV4Types'
import { WorkbenchButton } from '../../../design'
import StoryboardSelectionToolbar from '../../../workbench/creation/storyboard/StoryboardSelectionToolbar'
import StoryboardBulkBar from '../../../workbench/creation/storyboard/StoryboardBulkBar'
import { storyboardBulkParamGroups } from '../../../workbench/creation/storyboard/storyboardBulkParamScope'
import type { PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import { labExec, NOOP, STILL_NEON } from '../storyboard/storyboardFixtures'
import { ReuseStage, ShotRow } from '../storyboardReuse/storyboardReuseLabKit'
import { V4_LAB_SLOT_HANDLERS } from '../v4/agentPanelV4LabKit'
import { BATCH_IMAGE_MODELS, BATCH_VIDEO_MODELS, batchPlan, batchShots } from './storyboardBatchFixtures'

/**
 * 分镜「批量 / 选择」提案屏的取景台（2026-10-06，L-sbbatch）。
 *
 * 宽度沿用上一轮真机量出来的两档：宽 900（1440 视口 + Agent 面板展开时表格容器宽）、窄 664（最小窗口 1100×690）。
 * 舞台上摆的全是**现役组件本体**（行、浮条、批量条、Agent 付费卡的计划行）；回调都是 no-op，
 * 数据变化（公共参数集、取值「混合」）走真函数，不是这里手写的。
 */
export const BATCH_WIDE = 900
export const BATCH_NARROW = 664
export const BATCH_MODELS = { image: BATCH_IMAGE_MODELS, video: BATCH_VIDEO_MODELS }

const aspectOf = (): string => '16:9'

// ───────────────────────── B5b：行 ─────────────────────────

type RowFlag = 'plain' | 'selected' | 'skipped' | 'done' | 'removed'

const VARIANTS = [
  { id: 'v2', url: STILL_NEON, tag: '镜01-v2', modelLabel: 'Seedance 2.5', modeLabel: '', prompt: '', createdAt: 2 },
  { id: 'v1', url: STILL_NEON, tag: '镜01-v1', modelLabel: 'Seedance 2.5', modeLabel: '', prompt: '', createdAt: 1 },
]

function rowExtra(flag: RowFlag): NonNullable<Parameters<typeof ShotRow>[0]['extra']> {
  const base = { onToggleSelect: NOOP, onToggleSkip: NOOP, selected: flag === 'selected', skipped: flag === 'skipped' }
  if (flag === 'done') return { ...base, onRemoveResult: NOOP, exec: labExec({ status: 'done', resultUrl: STILL_NEON }), variants: VARIANTS, outputTag: '镜01' }
  // 移除结果之后：回到未生成态（画面格空、底栏「生成」回来），**历史版本还在**——变体计数不变。
  if (flag === 'removed') return { ...base, exec: labExec({ status: 'ready' }), variants: VARIANTS, outputTag: '镜01' }
  return base
}

/** 三行摞在一起：每行一种状态（flags 按行给）。 */
export function BatchRows({ flags, width }: { flags: readonly RowFlag[]; width: number }): JSX.Element {
  const shots = batchShots().slice(0, flags.length)
  const plan = batchPlan(shots)
  return (
    <ReuseStage width={width}>
      <div className="flex flex-col divide-y divide-nomi-line-soft">
        {shots.map((shot, index) => (
          <ShotRow key={shot.index} plan={plan} shot={shot} models={BATCH_MODELS} extra={rowExtra(flags[index])} />
        ))}
      </div>
    </ReuseStage>
  )
}

// ───────────────────────── B7：浮条 / 批量条 ─────────────────────────

/** 多选浮条（真组件）：`pick` = 选中的镜号。上面摆两行选中的镜，让「勾选 → 浮条」在同一个取景里读得到。 */
export function SelectionStage({ pick, width, skippedAll = false, withRows = true }: { pick: readonly number[]; width: number; skippedAll?: boolean; withRows?: boolean }): JSX.Element {
  const all = batchShots()
  const shots = all.filter((shot) => pick.includes(shot.index))
  const plan = batchPlan(all)
  const groups = storyboardBulkParamGroups({
    shots,
    imageModelOptions: BATCH_IMAGE_MODELS,
    videoModelOptions: BATCH_VIDEO_MODELS,
    aspectOf,
  })
  return (
    <ReuseStage width={width}>
      {withRows ? (
        <div className="flex flex-col divide-y divide-nomi-line-soft">
          {shots.slice(0, 2).map((shot) => (
            <ShotRow key={shot.index} plan={plan} shot={shot} models={BATCH_MODELS} extra={rowExtra('selected')} />
          ))}
        </div>
      ) : null}
      <div className="flex justify-center p-3">
        <StoryboardSelectionToolbar
          selectedCount={shots.length}
          modelGroups={groups}
          sceneOptions={[]}
          onGenerate={NOOP}
          onMoveToScene={NOOP}
          onApplyModel={NOOP}
          onApplyParam={NOOP}
          allSkipped={skippedAll}
          onSkip={NOOP}
          onDelete={NOOP}
          onClear={NOOP}
          onAgentHandoff={NOOP}
          onLock={NOOP}
        />
      </div>
    </ReuseStage>
  )
}

/** 「全部镜头」批量条（真组件）。 */
export function BulkBarStage({ plan, width }: { plan: StoryboardPlan; width: number }): JSX.Element {
  return (
    <ReuseStage width={width}>
      <StoryboardBulkBar plan={plan} imageModelOptions={BATCH_IMAGE_MODELS} videoModelOptions={BATCH_VIDEO_MODELS} onChange={NOOP} />
    </ReuseStage>
  )
}

// ───────────────────────── B2：生成剩余 ─────────────────────────

export type BatchItem = Readonly<{ group: 'anchor' | 'shot'; label: string; detail: string; checked: boolean }>

/** 一份方案里「还没生成」的项：参考卡先、镜头后（顺序就是发出的顺序）。 */
export function batchItems(options: { anchors?: number; shots?: number; removed?: readonly number[] } = {}): BatchItem[] {
  const anchorNames = ['林薇', '后巷', '陈默', '旧怀表', '天台']
  const shotPrompts = [
    '林薇冲进后巷，镜头跟拍', '她回头，追兵的车灯扫过', '近景，霓虹招牌下的旧怀表', '大远景，后巷尽头亮起红灯',
    '特写，雨滴落在她的睫毛上', '她转身离开，背影渐远', '俯拍，雨幕中的十字路口', '中景，陈默从阴影里走出来',
    '近景，积水里的倒影', '远景，城市重新亮起来', '特写，她握紧的手', '全景，两人隔着斑马线对视',
  ]
  const anchors = options.anchors ?? 2
  const shots = options.shots ?? 4
  const removed = new Set(options.removed ?? [])
  const items: BatchItem[] = []
  for (let index = 0; index < anchors; index += 1) {
    items.push({ group: 'anchor', label: anchorNames[index % anchorNames.length], detail: 'GPT Image 2', checked: !removed.has(items.length) })
  }
  for (let index = 0; index < shots; index += 1) {
    items.push({ group: 'shot', label: shotPrompts[index % shotPrompts.length], detail: index === 2 ? 'Nano Banana 2' : index === 3 ? 'Kling 3.0' : 'Seedance 2.5', checked: !removed.has(items.length) })
  }
  return items
}

/**
 * 「生成剩余」确认框：**Agent 付费卡的计划行**（`V4Intervention` 的 `plan`），不是新造的一套。
 * 勾 = 这次生成，去掉的不生成；× 与「取消」一样，什么都没发生。组标题只在两组都有时出现。
 */
export function BatchDialogCard({ items, width = 440 }: { items: readonly BatchItem[]; width?: number }): JSX.Element {
  const { t } = useTranslation()
  const labels = useV4Labels()
  const hasAnchors = items.some((item) => item.group === 'anchor')
  const hasShots = items.some((item) => item.group === 'shot')
  const count = (group: 'anchor' | 'shot') => items.filter((item) => item.group === group).length
  const checked = items.filter((item) => item.checked).length
  const plan: PlanRow[] = items.map((item, index) => ({
    label: item.group === 'shot' ? t('storyboardEditor.batch.shotLabel', { index: index - count('anchor') + 1, text: item.label }) : item.label,
    aside: item.detail,
    checked: item.checked,
    ...(hasAnchors && hasShots ? { group: item.group === 'anchor' ? t('storyboardEditor.batch.groupAnchors', { count: count('anchor') }) : t('storyboardEditor.batch.groupShots', { count: count('shot') }) } : {}),
  }))
  const data: InterventionData = {
    kind: 'spend',
    title: t('storyboardEditor.batch.title', { count: items.length }),
    plan,
    confirmLabel: t('storyboardEditor.batch.confirm', { count: checked }),
    actionsDisabled: checked === 0,
  }
  return (
    <div style={{ width }} data-storyboard-batch-dialog="true">
      <V4Intervention {...V4_LAB_SLOT_HANDLERS} data={data} labels={labels.intervention} />
    </div>
  )
}

/** 对话框盖在表格上：下面是淡出的镜头行，上面是遮罩与卡。 */
export function BatchDialogStage({ items, width = BATCH_WIDE, cardWidth = 440 }: { items: readonly BatchItem[]; width?: number; cardWidth?: number }): JSX.Element {
  const plan = batchPlan(batchShots().slice(0, 3))
  return (
    <ReuseStage width={width}>
      <div className="relative overflow-hidden rounded-nomi" style={{ minHeight: 560 }}>
        <div className="flex flex-col divide-y divide-nomi-line-soft" aria-hidden>
          {plan.shots.map((shot) => (
            <ShotRow key={shot.index} plan={plan} shot={shot} models={BATCH_MODELS} extra={rowExtra('plain')} />
          ))}
        </div>
        <div className="absolute inset-0 grid place-items-center bg-black/40 p-4">
          <BatchDialogCard items={items} width={Math.min(cardWidth, width - 32)} />
        </div>
      </div>
    </ReuseStage>
  )
}

// ───────────────────────── B2：页脚 ─────────────────────────

export type FooterPhase = 'idle' | 'anchors' | 'shots' | 'stopped' | 'done'

/**
 * 表格页脚的主按钮区（与 `StoryboardPlanEditor` 页脚同一排版：左进度、右主动作）。
 * 页脚本体住在要读 store 的编辑器壳里，这里只复刻它的**这一行**。
 */
export function BatchFooter({ phase, width }: { phase: FooterPhase; width: number }): JSX.Element {
  const { t } = useTranslation()
  const progress = {
    idle: t('storyboardEditor.footer.progress', { done: 2, total: 6 }),
    anchors: t('storyboardEditor.batch.progressAnchors', { done: 1, total: 2 }),
    shots: t('storyboardEditor.batch.progressShots', { done: 2, total: 4 }),
    stopped: t('storyboardEditor.batch.stoppedByAnchor'),
    done: t('storyboardEditor.footer.progress', { done: 6, total: 6 }),
  }[phase]
  const running = phase === 'anchors' || phase === 'shots'
  const label = phase === 'done' ? t('storyboardEditor.batch.allDone') : t('storyboardEditor.batch.generateRemaining', { count: phase === 'stopped' ? 4 : 6 })
  return (
    <ReuseStage width={width}>
      <footer className="flex items-center justify-between gap-3 border-t border-nomi-line bg-nomi-paper px-4 py-2.5" data-storyboard-batch-footer={phase}>
        <span className={`min-w-0 truncate text-caption ${phase === 'stopped' ? 'text-workbench-danger' : 'text-nomi-ink-60'}`}>{progress}</span>
        <WorkbenchButton variant="primary" disabled={running || phase === 'done'} className="shrink-0">
          <IconPlayerPlay size={15} stroke={1.8} />
          {label}
        </WorkbenchButton>
      </footer>
    </ReuseStage>
  )
}

/**
 * 打开「点一下才出现」的形态：点的是真按钮、走真状态机（与上一轮同一个理由）。
 * 找不到就当场喊：静默截一张收起态是假证据。
 */
export function ClickFirst({ selector, children }: { selector: string; children: React.ReactNode }): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const target = ref.current?.querySelector<HTMLElement>(selector)
    if (!target) throw new Error(`[storyboard-batch] 找不到 ${selector}，这一格截不到展开态`)
    target.click()
  }, [selector])
  return <div ref={ref}>{children}</div>
}

export type { PlanShot }
