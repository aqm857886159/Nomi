import { planAnchorSchema, planShotSchema, storyboardPlanSchema } from '../../../../electron/shared/storyboard/storyboardPlanSchema'
import { patchStoryboardSubject } from '../../../../electron/shared/storyboard/storyboardSubjectAdapter'
import {
  appendStoryboardSubjects, stableShotId, StoryboardSubjectNotFoundError, type AppendedStoryboardSubject,
} from '../../../../electron/shared/storyboard/storyboardSubjectIdentity'
import type { PlanAnchor, PlanShot } from '../../../../electron/shared/storyboard/storyboardPlan'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { useWorkbenchStore } from '../../workbenchStore'

/**
 * Agent 产出的分镜**落地点**：它写的就是用户手建方案住的那一份 `storyboardDesign`。
 *
 * 为什么由渲染层拥有：方案正本是项目记录的一部分（跟着项目导出、跟着 undo、跟着侧栏的改名/删除/复制）。
 * 主进程手里只有一次性的作者载荷，没有第二份分镜存储——那正是这一刀要消掉的东西。
 *
 * 身份：`designId` = 模型手里那个 draft id。模型指名哪一份，用户就看到哪一行被改，
 * 没有「当前打开的是哪份」这种隐式推断（推断错＝悄悄覆盖用户的另一份方案）。
 */

function targetDocument(projectId: unknown, documentId: unknown, designId: unknown): { documentId: string; designId: string } {
  if (typeof projectId !== 'string' || typeof documentId !== 'string' || typeof designId !== 'string'
    || !projectId || !documentId || !designId) throw new Error('storyboard_target_required')
  return { documentId, designId }
}

function assertProject(projectId: string): void {
  const project = withProjectAction(current => current, () => { throw new Error('storyboard_project_unavailable') })
  project.assertCurrent()
  if (project.binding.projectId !== projectId) throw new Error('storyboard_project_changed')
}

/** 建或整份替换一份 Agent 方案。替换只在模型**指名**了已有 id 时发生。 */
export function upsertAgentStoryboardDesign(data: Record<string, unknown>): { status: 'saved'; designId: string } {
  const { documentId, designId } = targetDocument(data.projectId, data.documentId, data.designId)
  // 谁发起的由主进程按用户那句话的目标显式给出；缺了或不认识就拒——不在这里猜。
  if (data.initiator !== 'user' && data.initiator !== 'agent') throw new Error('storyboard_initiator_required')
  assertProject(data.projectId as string)
  const plan = storyboardPlanSchema.parse(data.plan) as StoryboardPlan
  const store = useWorkbenchStore.getState()
  if (!store.workbenchDocuments.some(document => document.id === documentId)) throw new Error('storyboard_document_missing')
  const existing = (store.storyboardDesignsByDocumentId[documentId] ?? []).find(design => design.id === designId)
  const saved = existing
    ? store.setStoryboardPlan(plan, documentId, designId, true)
    : store.addStoryboardDesign({ initiator: data.initiator, documentId, source: plan, identity: { id: designId, title: plan.title } })
  if (!saved || saved.id !== designId) throw new Error('storyboard_design_save_rejected')
  return { status: 'saved', designId }
}

/** 改一镜时按 id 没找到那一行：回给主进程真实的镜头清单，由它如实告诉模型（不是一个看不懂的异常）。 */
type ShotNotFoundReply = { status: 'shot-not-found'; shotId: string; shots: ReadonlyArray<{ id: string; row: number }>; anchorHoldsShotNumber: boolean }

/** 改一份 Agent 方案里的一镜。方案不存在就拒——绝不「顺手新建一份」。 */
export function patchAgentStoryboardDesign(data: Record<string, unknown>): { status: 'saved'; shotId: string } | ShotNotFoundReply {
  const { documentId, designId } = targetDocument(data.projectId, data.documentId, data.designId)
  assertProject(data.projectId as string)
  const shotId = typeof data.shotId === 'string' && data.shotId.trim() ? data.shotId.trim() : ''
  if (!shotId) throw new Error('storyboard_shot_id_required')
  const patch = data.patch && typeof data.patch === 'object' && !Array.isArray(data.patch) ? data.patch as Record<string, unknown> : null
  if (!patch) throw new Error('Invalid generation patch')
  const store = useWorkbenchStore.getState()
  const design = (store.storyboardDesignsByDocumentId[documentId] ?? []).find(value => value.id === designId)
  if (!design) throw new Error('storyboard_design_missing')
  const references = data.references as Record<string, Array<{ url: string }>> | undefined
  let subject: PlanAnchor | PlanShot
  try {
    subject = patchStoryboardSubject(design.plan, shotId, patch, references)
  } catch (error) {
    if (!(error instanceof StoryboardSubjectNotFoundError)) throw error
    return { status: 'shot-not-found', shotId, shots: error.shots, anchorHoldsShotNumber: error.anchorHoldsShotNumber }
  }
  const next: StoryboardPlan = 'description' in subject
    ? { ...design.plan, anchors: design.plan.anchors.map(anchor => (anchor.id === shotId ? subject as PlanAnchor : anchor)) }
    : { ...design.plan, shots: design.plan.shots.map(shot => (stableShotId(shot) === shotId ? subject as PlanShot : shot)) }
  if (!store.setStoryboardPlan(next, documentId, designId, true)) throw new Error('storyboard_design_save_rejected')
  return { status: 'saved', shotId }
}

/**
 * 在一份已有的 Agent 方案后面补镜头 / 参考卡（「先立角色、再补镜头」「再加两镜」）。方案不存在就拒，
 * 绝不新建。新行的 id 与镜号由分镜主体身份的唯一 owner 按**这份方案此刻的样子**发——主进程不知道
 * 用户在编辑器里又加删过什么，所以发号只能在方案正本这一侧做；发出的 id 原样回给主进程，模型据此改它们。
 */
export function extendAgentStoryboardDesign(data: Record<string, unknown>): { status: 'saved'; designId: string; added: AppendedStoryboardSubject[] } {
  const { documentId, designId } = targetDocument(data.projectId, data.documentId, data.designId)
  assertProject(data.projectId as string)
  if (!Array.isArray(data.subjects) || data.subjects.length === 0) throw new Error('storyboard_subjects_required')
  const subjects = data.subjects.map((value): PlanAnchor | PlanShot => (
    value && typeof value === 'object' && 'description' in value ? planAnchorSchema.parse(value) as PlanAnchor : planShotSchema.parse(value) as PlanShot))
  const store = useWorkbenchStore.getState()
  const design = (store.storyboardDesignsByDocumentId[documentId] ?? []).find(value => value.id === designId)
  if (!design) throw new Error('storyboard_design_missing')
  const { plan, added } = appendStoryboardSubjects(design.plan, subjects, { assignIds: true })
  if (!store.setStoryboardPlan(plan, documentId, designId, true)) throw new Error('storyboard_design_save_rejected')
  return { status: 'saved', designId, added }
}
