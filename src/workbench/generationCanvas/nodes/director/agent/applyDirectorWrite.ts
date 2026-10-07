/**
 * [INPUT]: 依赖 electron/shared/director 的 planPatch / directorPlanSchema、electron/shared/agentCapabilities/directorWrite 的输入类型、
 *          ../model/compiler/directorPlanCompiler 的 compileDirectorPlan、../model/directorShotSummaries 的 summarizeDirectorShots、
 *          ../model/directorPreviewState、../model/directorNodeMeta、../directorSessionRegistry、画布 store / create_nodes / 布局
 * [OUTPUT]: 对外提供 applyDirectorWrite（director.write 在渲染端的领域执行体）、DirectorWriteDomainResult
 * [POS]: 3D-BOX `stage_shot` 的执行那一半。只被 applyCanvasToolCall 在提议事务里调用（审批、收据、changeId、撤销都在外面那层）。
 *        新建：编译 → 建导演节点（工程 + 计划 + 修订号 + 编译基线指纹 + 预演标志）；修订：比修订号 → 应用补丁 → 没变化就一个字不写、
 *        不重编译（unchanged）→ 整份重编译 → 叠手改覆盖层（planOverrides：直接改到且被新编译改了的手改丢弃并列出，其余重放）→
 *        测量对「编译 + 覆盖」后的工程测 → 编辑器开着走 3a 的唯一外部写口、关着写节点 meta。
 *        目标视频镜头声明了时长 → 计划时长必须与之一致（以镜头为准，宿主不缩放时间）。
 *        领域拒绝（过期 / 补丁不成立 / 编译不过或时长不符 / 目标不在）不写画布，原样交回，由 lane 翻成模型读得懂的失败。永不花钱。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import i18n from '../../../../../i18n'
import type { DirectorPreviewStatus } from '../../../../../../electron/shared/director/directorPreviewStatus'
import { parseDirectorPlan, type DirectorPlan } from '../../../../../../electron/shared/director/directorPlanSchema'
import { applyDirectorPlanEdits, canonicalDirectorPlan, directorPlanRevision } from '../../../../../../electron/shared/director/planPatch'
import type { DirectorWriteInput } from '../../../../../../electron/shared/agentCapabilities/directorWrite'
import { generationCanvasTools, readGenerationCanvasSnapshot } from '../../../agent/generationCanvasTools'
import { layoutPlannedNodes } from '../../../agent/trajectoryLayout'
import { getDefaultCategoryForNodeKind, isVideoLikeGenerationNodeKind } from '../../../model/generationNodeKinds'
import type { GenerationNodeKind } from '../../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { hasDirectorSession, readDirectorSessionProject, writeExternalDirectorProject } from '../directorSessionRegistry'
import { compileDirectorPlan, type DirectorCompileIssue } from '../model/compiler/directorPlanCompiler'
import { measureContinuity, sampleDirectorProject } from '../model/directorEvalMeasurement'
import { DIRECTOR_NODE_KIND, DIRECTOR_PLAN_META_KEY, DIRECTOR_PREVIEW_META_KEY, DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import {
  DIRECTOR_PREVIEW_DURATION_TOLERANCE_SECONDS, DIRECTOR_PREVIEW_MAX_SECONDS, declaredShotDurationSeconds, readDirectorPlanMeta, readDirectorPreview, type DirectorPreviewMeta,
} from '../model/directorPreviewState'
import { normalizeDirectorProject } from '../model/directorProject'
import { summarizeDirectorShots } from '../model/directorShotSummaries'
import type { DirectorProject } from '../model/directorTypes'
import { DIRECTOR_COMPILED_SCENE_ID, fingerprintDirectorProject, overlayDirectorProject, readDirectorCompiledBase, type DirectorCompiledBase } from '../model/planOverrides'
import { readDirectorPatchNotes, recordDirectorPatchNote, type DirectorPatchNotes } from '../model/directorPatchNotes'

type Issue = { kind: string; message: string; time?: number; ref?: string }
type Cut = { shot: string | null; start: number; end: number; shotSize: string | null; move: string }
type Preview = { status: DirectorPreviewStatus; targetNodeId?: string; attach?: 'video_ref' | 'prompt_only'; assetId?: string; reason?: string }

export type DirectorWriteDomainResult =
  | {
      applied: true
      directorNodeId: string
      revision: string
      unchanged: boolean
      plan: DirectorPlan
      issues: Issue[]
      cuts: Cut[]
      touched: string[]
      reorderedOverrides: string[]
      changedEntities: string[]
      preview: Preview
    }
  | { applied: false; rejected: 'stale_revision' | 'invalid_patch' | 'compile_failed' | 'target_missing'; messages: string[]; currentRevision?: string }

export type ApplyDirectorWriteContext = Readonly<{
  inCtx: <T>(fn: () => T) => T
  resolveNodeId: (id: string) => string
  /** 这笔提议的身份：写进预演标志，Host 事后挂接沿用它，撤销把挂接当成同一笔改动。 */
  proposalId?: string
}>

function issuesOf(issues: readonly DirectorCompileIssue[]): Issue[] {
  return issues.map((issue) => {
    const ref = issue.objectId ?? issue.actorId ?? issue.assetId
    return { kind: issue.kind, message: issue.message, ...(issue.time !== undefined ? { time: issue.time } : {}), ...(ref ? { ref } : {}) }
  })
}

/** 逐 cut 实测（测量模块对工程的实测，不读计划值）；cut 名按编译器的稳定机位 id `shot:<name>/camera` 认回计划镜头。 */
function cutsOf(project: DirectorProject): Cut[] {
  // 量编译出来的那一层（用户另建的图层不归计划）
  const compiledLayer = project.scenes.some((scene) => scene.id === DIRECTOR_COMPILED_SCENE_ID) ? { ...project, activeSceneId: DIRECTOR_COMPILED_SCENE_ID } : project
  return summarizeDirectorShots(compiledLayer).map((summary) => ({
    shot: summary.cameraId?.match(/^shot:(.+)\/camera$/)?.[1] ?? null,
    start: summary.start,
    end: summary.end,
    shotSize: summary.shotSize,
    move: summary.move,
  }))
}

/** 动作库缺的细节动作（方案拍板 8）：按计划里的角色名 + 语义动作 + 时间窗写成一句，挂接时进视频节点提示词。 */
function missingActionNotes(plan: DirectorPlan, issues: readonly DirectorCompileIssue[]): string[] {
  const notes: string[] = []
  for (const issue of issues) {
    if (issue.kind !== 'missing_asset' || !issue.actorId || !issue.assetId) continue
    const actor = plan.actors.find((candidate) => candidate.id === issue.actorId)
    const action = plan.blocking.find((item) => item.actor === issue.actorId && item.action === issue.assetId)
    const window = action ? `${action.window[0]}–${action.window[1]} 秒` : ''
    const note = `${actor?.desc ?? issue.actorId}${window ? ` ${window}` : ''}：${issue.assetId.replace(/_/g, ' ')}`
    if (!notes.includes(note)) notes.push(note)
  }
  return notes
}

function previewMetaFor(targetNodeId: string | undefined, revision: string, duration: number, proposalId: string | undefined, notes: readonly string[]): DirectorPreviewMeta | undefined {
  if (!targetNodeId) return undefined
  const tooLong = duration > DIRECTOR_PREVIEW_MAX_SECONDS + 1e-6
  return {
    status: tooLong ? 'failed' : 'rendering',
    targetNodeId,
    revision,
    ...(notes.length ? { notes: [...notes] } : {}),
    ...(proposalId ? { proposalId } : {}),
    ...(tooLong ? { reason: 'too_long' as const } : {}),
    updatedAt: Date.now(),
  }
}

function previewView(meta: DirectorPreviewMeta | null | undefined): Preview {
  if (!meta) return { status: 'none' }
  return {
    status: meta.status,
    ...(meta.targetNodeId ? { targetNodeId: meta.targetNodeId } : {}),
    ...(meta.attach ? { attach: meta.attach } : {}),
    ...(meta.assetId ? { assetId: meta.assetId } : {}),
    ...(meta.reason ? { reason: meta.reason === 'too_long' ? `longer than ${DIRECTOR_PREVIEW_MAX_SECONDS}s` : meta.reason } : {}),
  }
}

function compileOrReject(plan: DirectorPlan) {
  const compiled = compileDirectorPlan(plan)
  return compiled.ok ? compiled : { ok: false as const, rejection: { applied: false as const, rejected: 'compile_failed' as const, messages: compiled.errors.length ? compiled.errors : ['the compiler rejected this plan'] } }
}

/**
 * 预演挂到哪一镜，就得和那一镜一样长（以镜头为准）：8 秒的预演当 6 秒视频的参考，视频模型只能截掉或拉伸运镜。
 * 宿主不替模型缩放时间——拒绝并说清两条路。镜头没声明时长不拦。
 */
function durationRejection(targetNodeId: string | undefined, planSeconds: number): DirectorWriteDomainResult | null {
  if (!targetNodeId) return null
  const shotSeconds = declaredShotDurationSeconds(readGenerationCanvasSnapshot().nodes.find((node) => node.id === targetNodeId))
  if (shotSeconds === undefined || Math.abs(shotSeconds - planSeconds) <= DIRECTOR_PREVIEW_DURATION_TOLERANCE_SECONDS) return null
  const shot = `${Number(shotSeconds.toFixed(2))}s`
  return {
    applied: false, rejected: 'compile_failed',
    messages: [`shot node ${targetNodeId} is ${shot} long but this plan runs to ${Number(planSeconds.toFixed(2))}s; the preview must match the shot. Fit every shot and blocking window into 0–${shot}, or first change this shot's duration with draft_shots.`],
  }
}

type PlanMetaValue = { plan: DirectorPlan; revision: string; issueCount: number; compiledBase: DirectorCompiledBase; patchNotes?: DirectorPatchNotes }

/**
 * 测量对「编译 + 覆盖」后的工程测（方案 §6.5）：连续性问题在最终工程上重量；编译期的几何判断（挤出实心、视线被挡）
 * 说的是编译出来的摆位，对重放了手改的实体已不成立，去掉——否则 Agent 会为了「修」它去改那一镜，反把手改丢掉。
 */
function measuredIssues(compiled: Extract<ReturnType<typeof compileDirectorPlan>, { ok: true }>, project: DirectorProject, replayed: readonly string[]): DirectorCompileIssue[] {
  if (!replayed.length) return compiled.issues
  const handled = new Set(replayed)
  const kept = compiled.issues.filter((issue) => issue.kind !== 'measurement' && !((issue.kind === 'overlap' || issue.kind === 'occluded') && issue.objectId && (handled.has(issue.objectId) || handled.has(`actor:${issue.objectId}`))))
  const measured = { ...project, activeSceneId: DIRECTOR_COMPILED_SCENE_ID }
  const scene = measured.scenes.find((item) => item.id === DIRECTOR_COMPILED_SCENE_ID)
  if (!scene) return kept
  const continuity = measureContinuity(sampleDirectorProject(measured, { fps: 30, duration: compiled.duration, anchors: compiled.anchors }), scene)
  return [...kept, ...continuity.map((item) => ({ kind: 'measurement' as const, message: item.message, time: item.time, objectId: item.objectId }))]
}

/** 编辑器开着时它的 store 是唯一写者，手改以 store 为准（meta 最多落后 2 秒）；关着读节点 meta。 */
function currentDirectorProject(nodeId: string, meta: Record<string, unknown> | undefined): DirectorProject {
  return readDirectorSessionProject(nodeId) ?? normalizeDirectorProject(meta?.[DIRECTOR_PROJECT_META_KEY])
}

/** 上一次编译的指纹；3b 建的旧节点没有 → 用当前编译器重编旧计划求出来（一次性迁移，之后写回新指纹）。 */
function compiledBaseOf(planMeta: unknown, plan: DirectorPlan): DirectorCompiledBase {
  const stored = readDirectorCompiledBase((planMeta as { compiledBase?: unknown } | null)?.compiledBase)
  if (stored) return stored
  const recompiled = compileDirectorPlan(plan)
  return recompiled.ok ? fingerprintDirectorProject(recompiled.project) : { v: 1, entities: {} }
}

function createPlan(input: Extract<DirectorWriteInput, { operation: 'create_director_plan' }>, context: ApplyDirectorWriteContext): DirectorWriteDomainResult {
  const nodes = readGenerationCanvasSnapshot().nodes
  let targetNodeId: string | undefined
  if (input.shotNodeId) {
    targetNodeId = context.resolveNodeId(input.shotNodeId)
    const target = nodes.find((node) => node.id === targetNodeId)
    if (!target) return { applied: false, rejected: 'target_missing', messages: [`no canvas node ${input.shotNodeId}`] }
    if (!isVideoLikeGenerationNodeKind(target.kind as GenerationNodeKind)) {
      return { applied: false, rejected: 'target_missing', messages: [`${input.shotNodeId} is a ${target.kind} node; a 3D-BOX preview can only become the reference video of a video shot (omit target for a standalone preview)`] }
    }
  }
  const plan = canonicalDirectorPlan(input.plan)
  const compiled = compileOrReject(plan)
  if (!compiled.ok) return compiled.rejection
  const tooShortOrLong = durationRejection(targetNodeId, compiled.duration)
  if (tooShortOrLong) return tooShortOrLong
  const revision = directorPlanRevision(plan)
  const preview = previewMetaFor(targetNodeId, revision, compiled.duration, context.proposalId, missingActionNotes(plan, compiled.issues))
  const planMeta: PlanMetaValue = { plan, revision, issueCount: compiled.issues.length, compiledBase: fingerprintDirectorProject(compiled.project) }
  const position = layoutPlannedNodes(['image'], nodes)[0]
  const created = context.inCtx(() => generationCanvasTools.create_nodes([{
    kind: DIRECTOR_NODE_KIND,
    categoryId: getDefaultCategoryForNodeKind(DIRECTOR_NODE_KIND),
    title: i18n.t('director.agent.boxPreview'),
    prompt: '',
    position,
    meta: {
      [DIRECTOR_PROJECT_META_KEY]: compiled.project,
      [DIRECTOR_PLAN_META_KEY]: planMeta,
      ...(preview ? { [DIRECTOR_PREVIEW_META_KEY]: preview } : {}),
    },
  }]))
  const directorNodeId = created[0]?.id
  if (!directorNodeId) throw new Error('director node was not created')
  return {
    applied: true, directorNodeId, revision, unchanged: false, plan,
    issues: issuesOf(compiled.issues), cuts: cutsOf(compiled.project),
    touched: [...plan.shots.map((shot) => `shot:${shot.id}`), ...plan.actors.map((actor) => `actor:${actor.id}`), ...plan.scene.setPieces.map((piece) => `setPiece:${piece.id}`)],
    reorderedOverrides: [], changedEntities: [], preview: previewView(preview),
  }
}

function patchPlan(input: Extract<DirectorWriteInput, { operation: 'patch_director_plan' }>, context: ApplyDirectorWriteContext): DirectorWriteDomainResult {
  const directorNodeId = context.resolveNodeId(input.directorNodeId)
  const node = readGenerationCanvasSnapshot().nodes.find((candidate) => candidate.id === directorNodeId)
  if (!node || node.kind !== DIRECTOR_NODE_KIND) return { applied: false, rejected: 'target_missing', messages: [`no 3D-BOX node ${input.directorNodeId} on the canvas`] }
  const planMeta = readDirectorPlanMeta(node)
  const base = planMeta ? parseDirectorPlan(planMeta.plan) : null
  if (!planMeta || !base?.success) {
    return { applied: false, rejected: 'target_missing', messages: [`${input.directorNodeId} has no 3D-BOX plan (it was made with the older director tools); create a new preview with a whole plan instead`] }
  }
  if (planMeta.revision !== input.baseRevision) {
    return { applied: false, rejected: 'stale_revision', messages: [`baseRevision ${input.baseRevision} is not the current plan`], currentRevision: planMeta.revision }
  }
  const currentPreview = readDirectorPreview(node)
  const patched = applyDirectorPlanEdits(canonicalDirectorPlan(base.data), input.edits)
  if (!patched.ok) return { applied: false, rejected: 'invalid_patch', messages: [...patched.errors] }
  const current = currentDirectorProject(directorNodeId, node.meta)
  if (patched.unchanged) {
    // 方案 §6.1：指令不引起计划变化就不动——不重编译、不写画布；实测照当前工程（含手改）回读
    return {
      applied: true, directorNodeId, revision: planMeta.revision, unchanged: true, plan: patched.plan,
      issues: [], cuts: cutsOf(current), touched: [], reorderedOverrides: [], changedEntities: [],
      preview: previewView(currentPreview),
    }
  }
  const compiled = compileOrReject(patched.plan)
  if (!compiled.ok) return compiled.rejection
  const tooShortOrLong = durationRejection(currentPreview?.targetNodeId, compiled.duration)
  if (tooShortOrLong) return tooShortOrLong
  // 方案 §6.2–6.4：整份重编译后按稳定 id 叠回手改；编译器不知道覆盖层（结构守卫 planOverrides.guard.test.ts）
  const overlay = overlayDirectorProject({ compiled: compiled.project, current, base: compiledBaseOf(node.meta?.[DIRECTOR_PLAN_META_KEY], base.data), touched: patched.touched })
  const issues = measuredIssues(compiled, overlay.project, overlay.replayedEntities)
  const revision = directorPlanRevision(patched.plan)
  const preview = previewMetaFor(currentPreview?.targetNodeId, revision, compiled.duration, context.proposalId, missingActionNotes(patched.plan, compiled.issues))
  // 这一笔覆盖了哪些手调（按提议 id 记）：Agent 面板在那一笔工具行下面确定性地说出来，不靠模型复述
  const patchNotes = recordDirectorPatchNote(readDirectorPatchNotes(node.meta?.[DIRECTOR_PLAN_META_KEY]), context.proposalId, overlay.reorderedOverrides)
  const planMetaValue: PlanMetaValue = { plan: patched.plan, revision, issueCount: issues.length, compiledBase: fingerprintDirectorProject(compiled.project), ...(Object.keys(patchNotes).length ? { patchNotes } : {}) }
  context.inCtx(() => {
    // 一个写者（方案 §3）：编辑器开着 → 进编辑器 store（3a 的唯一外部写口会立刻落到节点 meta）；关着 → 直接写节点 meta。
    const mounted = hasDirectorSession(directorNodeId) && writeExternalDirectorProject(directorNodeId, overlay.project)
    const store = useGenerationCanvasStore.getState()
    const fresh = store.nodes.find((candidate) => candidate.id === directorNodeId)
    const meta: Record<string, unknown> = { ...(fresh?.meta ?? node.meta ?? {}) }
    if (!mounted) meta[DIRECTOR_PROJECT_META_KEY] = overlay.project
    meta[DIRECTOR_PLAN_META_KEY] = planMetaValue
    if (preview) meta[DIRECTOR_PREVIEW_META_KEY] = preview
    else delete meta[DIRECTOR_PREVIEW_META_KEY]
    store.updateNode(directorNodeId, { meta })
  })
  return {
    applied: true, directorNodeId, revision, unchanged: false, plan: patched.plan,
    issues: issuesOf(issues), cuts: cutsOf(overlay.project), touched: [...patched.touched],
    reorderedOverrides: overlay.reorderedOverrides, changedEntities: overlay.changedEntities, preview: previewView(preview),
  }
}

export function applyDirectorWrite(input: DirectorWriteInput, context: ApplyDirectorWriteContext): DirectorWriteDomainResult {
  return input.operation === 'create_director_plan' ? createPlan(input, context) : patchPlan(input, context)
}
