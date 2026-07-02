import React from 'react'
import { IconAlertTriangle, IconCheck, IconMovie, IconLockOpen, IconPlus } from '@tabler/icons-react'
import { alertDialog, confirmDialog, WorkbenchButton } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import { applyCanvasToolCall } from '../../generationCanvas/agent/applyCanvasToolCall'
import { resolveStoryboardImageDefault, resolveStoryboardVideoDefault } from '../../generationCanvas/agent/availableModels'
import { useModelOptionsState } from '../../../config/useModelOptions'
import { storyboardPlanToCreateNodesArgs } from '../../generationCanvas/agent/storyboardPlan'
import {
  addAnchor,
  addShot,
  changeAnchorKind,
  danglingAnchorIdsForShot,
  moveShot,
  removeAnchor,
  removeShotAt,
  toggleShotAnchor,
  updateAnchor,
  updateShotAt,
  updateTitle,
  validatePlan,
  type PlanIssue,
} from '../../generationCanvas/agent/storyboardPlanEdits'
import StoryboardAnchorCard from './StoryboardAnchorCard'
import StoryboardShotCard from './StoryboardShotCard'

/**
 * 分镜方案字段编辑器（S3，决策 B）。创作区主列在 storyboardPlan 存在时替换文档编辑器渲染它。
 * 字段直接绑对象——每次改字段经纯编辑层（storyboardPlanEdits）算出新方案，写回 store，无解析。
 * 确认 → storyboardPlanToCreateNodesArgs 转 create_canvas_nodes → applyCanvasToolCall 落画布 → 清方案、切生成区。
 */

function firstIssueLabel(issue: PlanIssue): string {
  switch (issue.kind) {
    case 'no-shots':
      return '还没有镜头'
    case 'empty-shot-prompt':
      return `镜 ${issue.shotIndex} 没写提示词`
    case 'dangling-ref':
      return `镜 ${issue.shotIndex} 有失效引用`
    case 'anchor-no-name':
      return '有锚还没起名字'
  }
}

export default function StoryboardPlanEditor(): JSX.Element | null {
  const plan = useWorkbenchStore((s) => s.storyboardPlan)
  const setStoryboardPlan = useWorkbenchStore((s) => s.setStoryboardPlan)
  const setStoryboardEditorOpen = useWorkbenchStore((s) => s.setStoryboardEditorOpen)
  const commitStoryboardPlan = useWorkbenchStore((s) => s.commitStoryboardPlan)
  const discardStoryboardPlan = useWorkbenchStore((s) => s.discardStoryboardPlan)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const requestCanvasFit = useWorkbenchStore((s) => s.requestCanvasFit)
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)
  const [landing, setLanding] = React.useState(false)
  // 图片/视频模型清单各拉一次，按镜头种类传给镜卡的模型选择器 + 参数控件（完整 option 供解析 archetype 参数）。
  const videoModelOptions = useModelOptionsState('video').options
  const imageModelOptions = useModelOptionsState('image').options

  if (!plan) return null

  const issues = validatePlan(plan)
  const emptyPromptShots = new Set(issues.filter((i) => i.kind === 'empty-shot-prompt').map((i) => i.shotIndex))
  const noNameAnchorIds = new Set(issues.filter((i) => i.kind === 'anchor-no-name').map((i) => i.anchorId))

  const onDiscard = async () => {
    const ok = await confirmDialog({
      title: '丢弃这份方案？',
      message: '方案和你刚才的修改会清空，可以重新让 AI 拆镜头。',
      confirmLabel: '丢弃',
      danger: true,
    })
    if (ok) discardStoryboardPlan()
  }

  const onConfirm = async () => {
    if (issues.length > 0 || landing) return
    setLanding(true)
    try {
      // 注入默认模型（用户拍板 B-clean）：定妆卡=图片模型（偏好 GPT Image 2）；镜头=视频模型
      // （偏好 Seedance，没在编辑器为某镜选模型时兜底）。通用解析，解析失败/无可用模型 → 全空，
      // 节点不带模型、用户在画布上自己选（不阻断落画布）。
      const [imageDefault, videoDefault] = await Promise.all([
        resolveStoryboardImageDefault(),
        resolveStoryboardVideoDefault(),
      ])
      const args = storyboardPlanToCreateNodesArgs(plan, {
        ...(imageDefault.modelKey ? { defaultImageModelKey: imageDefault.modelKey } : {}),
        ...(imageDefault.modeId ? { defaultImageModeId: imageDefault.modeId } : {}),
        ...(imageDefault.refModeId ? { defaultImageRefModeId: imageDefault.refModeId } : {}),
        ...(videoDefault.modelKey ? { defaultVideoModelKey: videoDefault.modelKey } : {}),
        ...(videoDefault.modeId ? { defaultVideoModeId: videoDefault.modeId } : {}),
      })
      await applyCanvasToolCall('create_canvas_nodes', args)
      // 不再即焚:方案保留、转「已落画布」、收起编辑器 → 卡片留在对话流可回看/再编辑。
      commitStoryboardPlan()
      setWorkspaceMode('generation')
      // 揭示新落的镜头：请画布平滑 fit 一次。否则新节点落在已加载画布的视口外，
      // 用户点完「确认落画布」看着像「没反应」（useAutoFitOnLoad 只在首次加载/切分类触发）。
      requestCanvasFit()
    } catch (error: unknown) {
      await alertDialog({
        title: '落画布失败',
        message: error instanceof Error && error.message ? error.message : '未知错误，请重试。',
      })
    } finally {
      setLanding(false)
    }
  }

  return (
    <section className="relative w-full h-full min-h-0 grid grid-rows-[auto_auto_minmax(0,1fr)_auto] border border-workbench-border rounded-workbench bg-workbench-surface-solid shadow-workbench-md overflow-hidden">
      <header className="flex items-center justify-between gap-3 h-12 px-4 border-b border-nomi-line">
        <div className="flex items-center gap-2 min-w-0">
          <IconMovie size={16} stroke={1.5} className="text-nomi-ink-60 shrink-0" />
          <input
            value={plan.title}
            onChange={(event) => setStoryboardPlan(updateTitle(plan, event.target.value))}
            aria-label="方案标题"
            placeholder="给方案起个名字"
            className="min-w-0 max-w-[260px] text-title font-medium text-nomi-ink bg-transparent outline-none focus:bg-nomi-ink-05 rounded-nomi-sm px-1"
          />
          <span className="shrink-0 text-micro text-nomi-ink-40 bg-nomi-ink-05 px-2 py-0.5 rounded-full">{plan.shots.length} 镜</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <WorkbenchButton
            variant="default"
            size="sm"
            onClick={() => setStoryboardEditorOpen(false)}
          >
            收起
          </WorkbenchButton>
          <WorkbenchButton
            variant="default"
            size="sm"
            onClick={onDiscard}
          >
            丢弃方案
          </WorkbenchButton>
        </div>
      </header>

      <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-nomi-line-soft text-caption text-nomi-ink-40">
        <IconLockOpen size={14} stroke={1.6} className="shrink-0" />
        <span className="truncate"><span className="text-nomi-ink-60">AI 草拟，随便改</span> · 确认前不生成、不花钱</span>
      </div>

      <div className="overflow-y-auto px-4 py-4 flex flex-col gap-4">
        <section>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-body-sm font-medium text-nomi-ink-80">跨镜头要一致的</span>
            <span className="text-micro text-nomi-ink-40">生成参考图=锁长相 · 仅提示词=写进 prompt</span>
          </div>
          <div className="border border-nomi-line rounded-nomi divide-y divide-nomi-line-soft overflow-hidden">
            {plan.anchors.length === 0 && (
              <div className="text-caption text-nomi-ink-40 px-2.5 py-2">还没有锚——加一个，或直接写镜头。</div>
            )}
            {plan.anchors.map((anchor) => (
              <StoryboardAnchorCard
                key={anchor.id}
                anchor={anchor}
                nameInvalid={noNameAnchorIds.has(anchor.id)}
                onUpdate={(patch) => setStoryboardPlan(updateAnchor(plan, anchor.id, patch))}
                onChangeKind={(kind) => setStoryboardPlan(changeAnchorKind(plan, anchor.id, kind))}
                onRemove={() => setStoryboardPlan(removeAnchor(plan, anchor.id))}
              />
            ))}
            <button
              type="button"
              onClick={() => setStoryboardPlan(addAnchor(plan))}
              className="w-full flex items-center gap-1.5 px-2.5 py-2 bg-nomi-ink-05 text-caption text-nomi-ink-40 hover:text-nomi-ink-60 hover:bg-nomi-ink-10"
            >
              <IconPlus size={13} stroke={1.8} />
              添加锚（角色 / 场景 / 道具 / 风格）
            </button>
          </div>
        </section>

        <section>
          <div className="text-body-sm font-medium text-nomi-ink-80 mb-2">分镜 · {plan.shots.length} 镜</div>
          <div className="flex flex-col gap-2">
            {plan.shots.map((shot, pos) => (
              <StoryboardShotCard
                key={shot.index}
                shot={shot}
                anchors={plan.anchors}
                modelOptions={shot.shotKind === 'image' ? imageModelOptions : videoModelOptions}
                danglingIds={danglingAnchorIdsForShot(plan, shot)}
                promptInvalid={emptyPromptShots.has(shot.index)}
                draggable
                isDragOver={overIndex === pos && dragIndex !== null && dragIndex !== pos}
                onDragStart={() => setDragIndex(pos)}
                onDragOver={(event) => {
                  event.preventDefault()
                  setOverIndex(pos)
                }}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== pos) setStoryboardPlan(moveShot(plan, dragIndex, pos))
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                onUpdate={(patch) => setStoryboardPlan(updateShotAt(plan, pos, patch))}
                onToggleAnchor={(anchorId) => setStoryboardPlan(toggleShotAnchor(plan, pos, anchorId))}
                onRemove={() => setStoryboardPlan(removeShotAt(plan, pos))}
                onApplyParamsToAll={() => setStoryboardPlan({
                  ...plan,
                  shots: plan.shots.map((s) => ({ ...s, modelKey: shot.modelKey, modeId: shot.modeId, params: shot.params })),
                })}
              />
            ))}
            <button
              type="button"
              onClick={() => setStoryboardPlan(addShot(plan))}
              className="self-start h-6 px-2.5 rounded-full border border-dashed border-nomi-ink-20 text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:text-nomi-ink-80"
            >
              <IconPlus size={13} stroke={1.8} />
              添加镜头
            </button>
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-nomi-line bg-nomi-paper">
        {issues.length > 0 ? (
          <span className="text-caption text-workbench-danger inline-flex items-center gap-[5px] min-w-0">
            <IconAlertTriangle size={14} stroke={1.8} className="shrink-0" />
            <span className="truncate">{issues.length} 处待处理：{firstIssueLabel(issues[0])}</span>
          </span>
        ) : (
          <span className="text-caption text-workbench-success inline-flex items-center gap-[5px]">
            <IconCheck size={14} stroke={1.8} />
            全部就绪 · {plan.anchors.length} 锚 · {plan.shots.length} 镜
          </span>
        )}
        <WorkbenchButton
          variant="primary"
          onClick={onConfirm}
          disabled={issues.length > 0 || landing}
        >
          <IconCheck size={15} stroke={1.8} />
          {landing ? '落画布中…' : '确认落画布'}
        </WorkbenchButton>
      </footer>
    </section>
  )
}
