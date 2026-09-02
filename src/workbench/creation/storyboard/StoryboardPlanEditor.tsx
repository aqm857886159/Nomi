import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck, IconMovie, IconLockOpen, IconPlus } from '@tabler/icons-react'
import { alertDialog, confirmDialog, WorkbenchButton } from '../../../design'
import { useWorkbenchStore } from '../../workbenchStore'
import { applyCanvasToolCall, resolveCanvasToolNodeId } from '../../generationCanvas/agent/applyCanvasToolCall'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { resolveStoryboardImageDefault, resolveStoryboardVideoDefault } from '../../generationCanvas/agent/availableModels'
import { useModelOptionsState } from '../../../config/useModelOptions'
import { storyboardPlanToCreateNodesArgs } from '../../generationCanvas/agent/storyboardPlan'
import {
  addAnchor,
  addShot,
  changeAnchorKind,
  removeAnchor,
  updateAnchor,
  updateTitle,
  validatePlan,
  type PlanIssue,
} from '../../generationCanvas/agent/storyboardPlanEdits'
import { classifyGenerationError } from '../../observability/classifyError'
import StoryboardAnchorCard from './StoryboardAnchorCard'
import StoryboardBulkBar from './StoryboardBulkBar'
import StoryboardShotTable from './StoryboardShotTable'
import { productionRunApi } from '../../production/productionRunApi'
import { useProductionRunStore } from '../../production/productionRunStore'
import {
  findMatchingCandidateStoryboard,
  storyboardDesignNeedsSync,
  storyboardPlanSourceMatchesApprovedScript,
} from './storyboardPlanGuards'

/**
 * 分镜方案字段编辑器（S3，决策 B）。创作区主列在 storyboardPlan 存在时替换文档编辑器渲染它。
 * 字段直接绑对象——每次改字段经纯编辑层（storyboardPlanEdits）算出新方案，写回 store，无解析。
 * 确认 → storyboardPlanToCreateNodesArgs 转 create_canvas_nodes → applyCanvasToolCall 落画布 → 清方案、切生成区。
 */

export default function StoryboardPlanEditor(): JSX.Element | null {
  const { t } = useTranslation()
  const entry = useWorkbenchStore((s) => (s.activeDocumentId ? s.storyboardPlans[s.activeDocumentId] : undefined))
  const plan = entry?.plan ?? null
  const setStoryboardPlan = useWorkbenchStore((s) => s.setStoryboardPlan)
  const commitStoryboardPlan = useWorkbenchStore((s) => s.commitStoryboardPlan)
  const deleteStoryboardDesign = useWorkbenchStore((s) => s.deleteStoryboardDesign)
  const setWorkspaceMode = useWorkbenchStore((s) => s.setWorkspaceMode)
  const setActiveStoryboardId = useWorkbenchStore((s) => s.setActiveStoryboardId)
  const activeDocumentId = useWorkbenchStore((s) => s.activeDocumentId)
  const activeStoryboardId = useWorkbenchStore((s) => s.activeStoryboardId)
  const [landing, setLanding] = React.useState(false)
  // 图片/视频模型清单各拉一次，按镜头种类传给镜卡的模型选择器 + 参数控件（完整 option 供解析 archetype 参数）。
  const videoModelOptions = useModelOptionsState('video').options
  const imageModelOptions = useModelOptionsState('image').options

  const firstIssueLabel = (issue: PlanIssue): string => {
    switch (issue.kind) {
      case 'no-shots': return t('storyboardEditor.issue.noShots')
      case 'empty-shot-prompt': return t('storyboardEditor.issue.emptyPrompt', { index: issue.shotIndex })
      case 'dangling-ref': return t('storyboardEditor.issue.danglingRef', { index: issue.shotIndex })
      case 'anchor-no-name': return t('storyboardEditor.issue.anchorNoName')
    }
  }

  if (!plan) return null

  const issues = validatePlan(plan)
  const emptyPromptShots = new Set(issues.filter((i) => i.kind === 'empty-shot-prompt').map((i) => i.shotIndex))
  const noNameAnchorIds = new Set(issues.filter((i) => i.kind === 'anchor-no-name').map((i) => i.anchorId))

  const onDiscard = async () => {
    const targetDocumentId = activeDocumentId
    const targetStoryboardId = activeStoryboardId
    if (!targetStoryboardId) return
    const ok = await confirmDialog({
      title: t('storyboardEditor.discardTitle'),
      message: t('storyboardEditor.discardMessage'),
      confirmLabel: t('storyboardEditor.discard'),
      danger: true,
    })
    if (ok) deleteStoryboardDesign(targetStoryboardId, targetDocumentId)
  }

  const onConfirm = async () => {
    if (issues.length > 0 || landing) return
    const targetDocumentId = activeDocumentId
    const targetStoryboardId = activeStoryboardId
    if (!targetStoryboardId) return
    const targetDesign = useWorkbenchStore.getState().storyboardDesignsByDocumentId[targetDocumentId]
      ?.find((design) => design.id === targetStoryboardId)
    if (!targetDesign) return
    const targetCanStillLand = () => {
      const state = useWorkbenchStore.getState()
      const current = state.storyboardDesignsByDocumentId[targetDocumentId]
        ?.find((design) => design.id === targetStoryboardId)
      return current === targetDesign
    }
    const targetIsStillVisible = () => {
      const state = useWorkbenchStore.getState()
      return state.activeDocumentId === targetDocumentId && state.activeStoryboardId === targetStoryboardId
    }
    const targetDocument = useWorkbenchStore.getState().workbenchDocuments.find((document) => document.id === targetDocumentId)
    if (targetDocument && storyboardDesignNeedsSync(targetDocument.updatedAt, targetDesign.sourceDocumentUpdatedAt)) {
      const proceed = await confirmDialog({
        title: t('storyboardEditor.staleTitle'),
        message: t('storyboardEditor.staleMessage'),
        confirmLabel: t('storyboardEditor.staleConfirm'),
      })
      if (!proceed || !targetCanStillLand()) return
    }
    // A storyboard is a one-way projection of the approved script. Check the
    // identity before mutating the canvas so a stale plan cannot leave orphaned
    // nodes that the production run will later reject.
    const productionRunBeforeLanding = useProductionRunStore.getState().run
    if (productionRunBeforeLanding && (plan.sourceScriptHash || plan.sourceScriptArtifactId || plan.sourceScriptVersion)) {
      // A provenance-bearing plan is only valid when the exact approved source
      // is still present. Missing source metadata is not a match: otherwise an
      // old storyboard could silently land after the script was revised.
      const matches = storyboardPlanSourceMatchesApprovedScript(plan, productionRunBeforeLanding.artifacts)
      if (!matches) {
        await alertDialog({
          title: t('storyboardEditor.landFailed'),
          message: t('storyboardEditor.unknownRetry'),
        })
        return
      }
    }
    setLanding(true)
    try {
      const productionRun = useProductionRunStore.getState().run
      // A run may contain multiple storyboard candidates. Only the exact
      // content-hash match is allowed through the durable review/materialize
      // path; an unrelated local design must never approve the first artifact.
      const storyboardArtifact = productionRun
        ? await findMatchingCandidateStoryboard(plan, productionRun.artifacts)
        : undefined
      if (!targetCanStillLand()) return
      // Production runs use the same durable review → materialize seam as
      // external MCP. The UI confirmation is the storyboard review decision;
      // only after it is adopted does the main process ask the renderer to
      // create nodes and return durable bindings.
      if (productionRun && storyboardArtifact) {
        const reviewed = await productionRunApi.command(productionRun.projectId, productionRun.runId, {
          commandId: globalThis.crypto.randomUUID(),
          expectedRevision: productionRun.revision,
          type: 'artifact.review',
          payload: { artifactId: storyboardArtifact.artifactId, decision: 'approved' },
          issuedAt: new Date().toISOString(),
        })
        if (!targetCanStillLand()) return
        const materialized = await productionRunApi.materializeStoryboard(
          productionRun.projectId,
          productionRun.runId,
          storyboardArtifact.artifactId,
          reviewed.run.artifacts.find((artifact) => artifact.artifactId === storyboardArtifact.artifactId)?.version || storyboardArtifact.version || 1,
        )
        await useProductionRunStore.getState().load(productionRun.projectId)
        if (!targetCanStillLand()) return
        commitStoryboardPlan(targetDocumentId, targetStoryboardId)
        const landedIds = materialized.createdNodeIds
        if (targetIsStillVisible()) {
          setWorkspaceMode('generation')
          if (landedIds.length > 1) useGenerationCanvasStore.getState().selectNodes(landedIds)
        }
        return
      }
      // 注入默认模型（用户拍板 B-clean）：定妆卡=图片模型（偏好 GPT Image 2）；镜头=视频模型
      // （偏好 Seedance，没在编辑器为某镜选模型时兜底）。通用解析，解析失败/无可用模型 → 全空，
      // 节点不带模型、用户在画布上自己选（不阻断落画布）。
      const [imageDefault, videoDefault] = await Promise.all([
        resolveStoryboardImageDefault(),
        resolveStoryboardVideoDefault(),
      ])
      if (!targetCanStillLand()) return
      const args = storyboardPlanToCreateNodesArgs(plan, {
        creationDocumentId: targetDocumentId,
        storyboardDesignId: targetStoryboardId,
        ...(imageDefault.modelKey ? { defaultImageModelKey: imageDefault.modelKey } : {}),
        ...(imageDefault.modeId ? { defaultImageModeId: imageDefault.modeId } : {}),
        ...(imageDefault.refModeId ? { defaultImageRefModeId: imageDefault.refModeId } : {}),
        ...(videoDefault.modelKey ? { defaultVideoModelKey: videoDefault.modelKey } : {}),
        ...(videoDefault.modeId ? { defaultVideoModeId: videoDefault.modeId } : {}),
      })
      await applyCanvasToolCall('create_canvas_nodes', args, undefined, targetCanStillLand)
      if (!targetCanStillLand()) return
      // 不再即焚:方案保留、转「已落画布」、收起编辑器 → 卡片留在对话流可回看/再编辑。
      commitStoryboardPlan(targetDocumentId, targetStoryboardId)
      // 落画布即自动全选这批新节点（样张拍板 2026-07-29）→ 既有多选浮条「生成 N 个」直接浮现，
      // 批量入口不再靠用户自己发现框选；点浮条整批确认生成，依赖波次照旧（定妆/首帧先、镜头后）。
      // clientId 经注册表换真实节点 id；≤1 个不选（浮条本就只在多选时出现，单节点一键生成足矣）。
      const landedIds = args.nodes.map((created) => resolveCanvasToolNodeId(created.clientId))
      if (targetIsStillVisible()) {
        setWorkspaceMode('generation')
        if (landedIds.length > 1) useGenerationCanvasStore.getState().selectNodes(landedIds)
      }
    } catch (error: unknown) {
      if (!targetCanStillLand()) return
      // 人话化：别把服务端/内部原串直贴进对话框（2026-08-25 走查同类问题）。
      // 走 classifyGenerationError 拿分类后的 reason（+ 缺 key 时的一句指引），与错误卡同一真相源（P1）。
      const raw = error instanceof Error && error.message ? error.message : ''
      const report = raw ? classifyGenerationError(raw) : null
      const message = report
        ? report.hint
          ? `${report.reason}——${report.hint}`
          : report.reason
        : t('storyboardEditor.unknownRetry')
      await alertDialog({
        title: t('storyboardEditor.landFailed'),
        message,
      })
    } finally {
      setLanding(false)
    }
  }

  return (
    <section
      className="relative w-full h-full min-h-0 grid grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] border border-workbench-border rounded-workbench bg-workbench-surface-solid shadow-workbench-md overflow-hidden"
      data-storyboard-editor="true"
    >
      <header className="flex items-center justify-between gap-3 h-12 px-4 border-b border-nomi-line">
        <div className="flex items-center gap-2 min-w-0">
          <IconMovie size={16} stroke={1.5} className="text-nomi-ink-60 shrink-0" />
          <input
            value={plan.title}
            onChange={(event) => setStoryboardPlan(updateTitle(plan, event.target.value))}
            aria-label={t('storyboardEditor.titleAria')}
            placeholder={t('storyboardEditor.titlePlaceholder')}
            className="min-w-0 max-w-[260px] text-title font-medium text-nomi-ink bg-transparent outline-none focus:bg-nomi-ink-05 rounded-nomi-sm px-1"
          />
          <span className="shrink-0 text-micro text-nomi-ink-40 bg-nomi-ink-05 px-2 py-0.5 rounded-full">{t('storyboardEditor.shotCount', { count: plan.shots.length })}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <WorkbenchButton
            variant="default"
            size="sm"
            onClick={onDiscard}
          >
            {t('storyboardEditor.discardPlan')}
          </WorkbenchButton>
        </div>
      </header>

      <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-nomi-line-soft text-caption text-nomi-ink-40">
        <IconLockOpen size={14} stroke={1.6} className="shrink-0" />
        <span className="truncate"><span className="text-nomi-ink-60">{t('storyboardEditor.draftEditable')}</span> · {t('storyboardEditor.freeBeforeConfirm')}</span>
      </div>

      {/* 「全部镜头」批量条（样张 A）：整片作用域的类型/模型/时长常驻这里，
          底下镜卡那排同款选择器作用域是「这一镜」——两者靠组名 + 底色分开（§1.5 C3）。 */}
      <StoryboardBulkBar
        plan={plan}
        imageModelOptions={imageModelOptions}
        videoModelOptions={videoModelOptions}
        onChange={setStoryboardPlan}
      />

      <div className="overflow-y-auto px-4 py-4 flex flex-col gap-4">
        <section>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-body-sm font-medium text-nomi-ink-80">{t('storyboardEditor.consistencyTitle')}</span>
            <span className="text-micro text-nomi-ink-40">{t('storyboardEditor.consistencyHint')}</span>
          </div>
          <div className="border border-nomi-line rounded-nomi divide-y divide-nomi-line-soft overflow-hidden">
            {plan.anchors.length === 0 && (
              <div className="text-caption text-nomi-ink-40 px-2.5 py-2">{t('storyboardEditor.noAnchors')}</div>
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
              {t('storyboardEditor.addAnchor')}
            </button>
          </div>
        </section>

        <section>
          <div className="text-body-sm font-medium text-nomi-ink-80 mb-2">{t('storyboardEditor.storyboardHeading', { count: plan.shots.length })}</div>
          <div className="flex flex-col gap-2">
            <StoryboardShotTable
              plan={plan}
              imageModelOptions={imageModelOptions}
              videoModelOptions={videoModelOptions}
              emptyPromptShots={emptyPromptShots}
              onChange={setStoryboardPlan}
            />
            <button
              type="button"
              onClick={() => setStoryboardPlan(addShot(plan))}
              className="self-start h-6 px-2.5 rounded-full border border-dashed border-nomi-ink-20 text-caption text-nomi-ink-60 inline-flex items-center gap-1 hover:text-nomi-ink-80"
            >
              <IconPlus size={13} stroke={1.8} />
              {t('storyboardEditor.addShot')}
            </button>
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-nomi-line bg-nomi-paper">
        <div className="flex items-center gap-2 min-w-0">
          <WorkbenchButton variant="default" size="sm" onClick={() => {
            setActiveStoryboardId(null)
            setWorkspaceMode('creation')
          }}>
            {t('storyboardEditor.backToCreation')}
          </WorkbenchButton>
          {issues.length > 0 ? (
            <span className="text-caption text-workbench-danger inline-flex items-center gap-[5px] min-w-0">
              <IconAlertTriangle size={14} stroke={1.8} className="shrink-0" />
              <span className="truncate">{t('storyboardEditor.issuesSummary', { count: issues.length, issue: firstIssueLabel(issues[0]) })}</span>
            </span>
          ) : (
            <span className="text-caption text-workbench-success inline-flex items-center gap-[5px]">
              <IconCheck size={14} stroke={1.8} />
              {t('storyboardEditor.readySummary', { anchors: plan.anchors.length, shots: plan.shots.length })}
            </span>
          )}
        </div>
        <WorkbenchButton
          variant="primary"
          onClick={onConfirm}
          disabled={issues.length > 0 || landing}
        >
          <IconCheck size={15} stroke={1.8} />
          {landing ? t('storyboardEditor.landing') : t('storyboardEditor.confirmLanding')}
        </WorkbenchButton>
      </footer>
    </section>
  )
}
