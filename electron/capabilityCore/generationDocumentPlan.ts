// 能力核 · 文稿方案的落地、呈现、批量改镜与「一次请求一份方案」（2026-10-05 / 2026-11-28）。
//
// 文稿来源的分镜方案只有一个家：渲染层项目记录里的 `storyboardDesign`（和用户手建的那种同一份）。
// 主进程是**唯一铸方案 id 的地方**（方案 id = 草稿 id），所有文稿方案的落盘、补镜、呈现与批量改镜都在本模块收口。
import { BoundedCache } from '../shared/boundedCache';
import type { GenerationInvocationContext } from '../shared/agentCapabilities/generationInvocationContext';
import { generationTaskReference } from '../shared/agentCapabilities/taskReference';
import { GENERATE_USER_DECISION_KEY, type GenerateUserDecision } from '../shared/agentLane/generateUserDecision';
import type { PlanAnchor, PlanShot, StoryboardPlan } from '../shared/storyboard/storyboardPlan';
import { appendStoryboardSubjects, type AppendedStoryboardSubject } from '../shared/storyboard/storyboardSubjectIdentity';
import { storyboardReferenceSlot, storyboardSubjectFromCandidate } from '../shared/storyboard/storyboardSubjectAdapter';
import type { PlanCandidate } from './executionContract';
import type { GenerationOperationDraftShot } from './mcpGenerationMultiShot';
import { refuseArgument } from './transportFailure';

type RequestRenderer = (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
type SourceDocument = Readonly<{ documentId: string; revision: number; contentHash: string }>;
type ResolveUrl = (projectId: string, reference: PlanCandidate['references'][number]) => string;

/** Author bodies are small; a renderer that cannot answer inside this window is not going to. */
const STORYBOARD_RENDERER_TIMEOUT_MS = 15_000;

/** 记多少个请求就够：一条用户消息就是一个请求，桌面上同时开着的远少于这个数。 */
const REMEMBERED_REQUESTS = 64;

/**
 * Creation adapter only: execution remains owned by the original renderer runner.
 * 方案名取**模型自己写的标题**（第一个非锚镜头的 `title`）；模型一个标题都没给时才退回提示词首行。
 */
export function storyboardPlanFromDraftSubjects(
  subjects: readonly GenerationOperationDraftShot[],
  projectId: string,
  resolveUrl?: ResolveUrl,
): StoryboardPlan {
  const named = subjects.find((subject) => subject.role !== 'anchor' && subject.title?.trim())
    ?? subjects.find((subject) => subject.title?.trim());
  const empty: StoryboardPlan = {
    title: (named?.title?.trim() || subjects[0].candidate.prompt.split('\n')[0]).slice(0, 500),
    anchors: [],
    shots: [],
  };
  return appendStoryboardSubjects(empty, storyboardSubjectsFromDrafts(subjects, projectId, resolveUrl), { assignIds: false }).plan;
}

/** 已准入的草稿主体 → 编辑器契约的主体（参考图换成可预览的地址）。首建与补镜头共用这一处。 */
export function storyboardSubjectsFromDrafts(
  subjects: readonly GenerationOperationDraftShot[],
  projectId: string,
  resolveUrl?: ResolveUrl,
): Array<PlanAnchor | PlanShot> {
  return subjects.map((subject) => {
    const urls = Object.fromEntries(
      subject.candidate.references.map((reference) => [reference.assetId, resolveUrl?.(projectId, reference) ?? '']),
    );
    return storyboardSubjectFromCandidate(subject, subject.storyboard, urls);
  });
}

export type StoryboardSavedFact = Readonly<{
  designId: string;
  title: string;
  opened: boolean;
  openFrom: string;
  shots: ReadonlyArray<Readonly<{ row: number; shotId: string }>>;
  anchors: readonly string[];
  addShots: string;
}>;

export function storyboardSavedFact(designId: string, plan: StoryboardPlan, opened: boolean): StoryboardSavedFact {
  return {
    designId,
    title: plan.title,
    opened,
    openFrom: opened
      ? 'The user asked for this plan with the storyboard button, so it is already open for them.'
      : 'Creation page, left column: the plan row under its source document. It is NOT opened for the user — tell them it is written and where to open it.',
    shots: plan.shots.map((shot) => ({ row: shot.index, shotId: shot.shotId ?? `shot-${shot.index}` })),
    anchors: plan.anchors.map((anchor) => anchor.id),
    addShots: addShotsGuidance(designId),
  };
}

export function addShotsGuidance(designId: string): string {
  return `To add shots or reference cards to this plan, call draft_shots with operationId ${designId} and the new shots without shotId; `
    + 'they are appended to this same plan and numbered after its existing shots. Within the same request a draft_shots call without operationId '
    + 'is also added to this plan. Start a separate plan only when the user explicitly asks for another one: pass newPlan: true.';
}

export function refuseIfStoryboardRejected(reply: unknown): void {
  if (!reply || typeof reply !== 'object' || (reply as { status?: unknown }).status !== 'rejected') return;
  const raw = (reply as { issues?: unknown }).issues;
  const issues = (Array.isArray(raw) ? raw : []).flatMap((item) => {
    const path = item && typeof item === 'object' ? (item as { path?: unknown }).path : undefined;
    const problem = item && typeof item === 'object' ? (item as { problem?: unknown }).problem : undefined;
    return typeof path === 'string' && typeof problem === 'string'
      ? [{ path: path.slice(0, 120), problem: problem.slice(0, 160) }]
      : [];
  }).slice(0, 8);
  if (!issues.length) return;
  refuseArgument(
    `The storyboard plan was not saved and nothing changed. Fix these fields and send it again: ${issues.map((issue) => `${issue.path} ${issue.problem}`).join('; ')}.`,
    { field: issues[0].path },
  );
}

export type StoryboardExtendedFact = Readonly<{
  designId: string;
  added: readonly AppendedStoryboardSubject[];
  addShots: string;
}>;

export async function extendStoryboardDesign(
  request: RequestRenderer,
  input: { projectId: string; documentId: string; designId: string; subjects: ReadonlyArray<PlanAnchor | PlanShot> },
): Promise<StoryboardExtendedFact> {
  const reply = await request('storyboard.extend-design', input, STORYBOARD_RENDERER_TIMEOUT_MS) as
    { status?: unknown; designId?: unknown; added?: unknown } | null;
  refuseIfStoryboardRejected(reply);
  if (!reply || reply.status !== 'saved' || reply.designId !== input.designId || !Array.isArray(reply.added) || reply.added.length !== input.subjects.length) {
    throw new Error('storyboard_design_save_rejected');
  }
  return { designId: input.designId, added: reply.added as AppendedStoryboardSubject[], addShots: addShotsGuidance(input.designId) };
}

export async function upsertStoryboardDesign(
  request: RequestRenderer,
  input: { projectId: string; documentId: string; designId: string; plan: StoryboardPlan; initiator: 'user' | 'agent' },
): Promise<void> {
  const reply = await request('storyboard.upsert-design', input, STORYBOARD_RENDERER_TIMEOUT_MS) as
    { status?: unknown; designId?: unknown } | null;
  refuseIfStoryboardRejected(reply);
  if (!reply || reply.status !== 'saved' || reply.designId !== input.designId) throw new Error('storyboard_design_save_rejected');
}

function storyboardUserDecision(value: unknown): GenerateUserDecision | undefined {
  if (value === 'started') return { outcome: 'approved' };
  if (value === 'declined') return { outcome: 'declined' };
  return undefined;
}

export async function presentStoryboardAuthoring(
  current: { candidate: PlanCandidate; sourceDocumentId?: string },
  projectId: string,
  designId: string,
  requested: unknown,
  request?: (op: string, payload: unknown) => Promise<unknown>,
) {
  if (!request || !current.sourceDocumentId) throw new Error('storyboard_renderer_required');
  const reply = await request('storyboard.present', {
    projectId,
    designId,
    sourceDocumentId: current.sourceDocumentId,
    ...(requested === undefined ? {} : { shotIds: requested }),
  });
  const receipt = reply as { status?: unknown; designId?: unknown; shotIds?: unknown; decision?: unknown; operations?: unknown } | null;
  if (!receipt || receipt.status !== 'presented' || receipt.designId !== designId || !Array.isArray(receipt.shotIds)) {
    throw new Error('storyboard_presentation_receipt_mismatch');
  }
  const shots = receipt.shotIds as string[];
  const decision = storyboardUserDecision(receipt.decision);
  const operations = Array.isArray(receipt.operations)
    ? (receipt.operations as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
  if (!decision) {
    return {
      taskRef: generationTaskReference(designId),
      status: receipt.decision === 'nothing-to-run' ? 'nothing_to_generate' : 'presented',
      shots,
      nextAction: 'inspect_canvas',
    };
  }
  return {
    taskRef: generationTaskReference(designId),
    status: 'presented',
    shots,
    nextAction: 'inspect_canvas',
    ...(operations.length ? { operations } : {}),
    [GENERATE_USER_DECISION_KEY]: decision,
  };
}

function shotNotFoundMessage(shotId: string, reply: { shots?: unknown; anchorHoldsShotNumber?: unknown }): string {
  const shots = Array.isArray(reply.shots) ? reply.shots as Array<{ id?: unknown; row?: unknown }> : [];
  const listed = shots.map((shot) => `row ${String(shot.row)} = ${String(shot.id)}`).join(', ');
  const why = reply.anchorHoldsShotNumber === true
    ? `In this older plan ${shotId} is a reference card, not a numbered shot, so it was not changed.`
    : `This plan has no shot ${shotId}.`;
  return `${why} Its shots are: ${listed || 'none yet'}. Use the shotId of the row the user means.`;
}

export async function patchStoryboardAuthoring(
  current: { sourceDocumentId?: string },
  params: Record<string, unknown>,
  projectId: string,
  designId: string,
  resolveReferences: (projectId: string, value: unknown) => PlanCandidate['references'],
  resolveUrl: ResolveUrl | undefined,
  request?: RequestRenderer,
): Promise<void> {
  if (!current.sourceDocumentId) refuseArgument('This storyboard revision needs a document-backed plan.');
  if (!request) throw new Error('storyboard_renderer_required');
  const rawBatch = Array.isArray(params.patches) ? params.patches : undefined;
  const entries: Array<{ shotId: string; patch: Record<string, unknown> }> = rawBatch
    ? rawBatch.map((item, idx) => {
        const rec = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
        if (typeof rec.shotId !== 'string' || !rec.shotId.trim()) refuseArgument(`patches[${idx}] requires shotId.`);
        if (!rec.patch || typeof rec.patch !== 'object' || Array.isArray(rec.patch)) refuseArgument(`patches[${idx}].patch must be an object.`);
        return { shotId: rec.shotId.trim(), patch: rec.patch as Record<string, unknown> };
      })
    : (() => {
        if (typeof params.shotId !== 'string' || !params.shotId.trim()) {
          refuseArgument('This storyboard revision needs the shotId of the shot you are changing. To add a new shot to this plan instead, give it a title and leave shotId out.');
        }
        if (!params.patch || typeof params.patch !== 'object' || Array.isArray(params.patch)) {
          refuseArgument('patch must be an object holding the fields you are changing.');
        }
        return [{ shotId: params.shotId.trim(), patch: params.patch as Record<string, unknown> }];
      })();

  const prepared: Array<{ shotId: string; patch: Record<string, unknown>; references?: Record<string, Array<{ url: string }>> }> = [];
  const prepErrors: string[] = [];
  for (const [idx, entry] of entries.entries()) {
    try {
      const references: Record<string, Array<{ url: string }>> | undefined = entry.patch.references === undefined ? undefined : {};
      for (const reference of entry.patch.references === undefined ? [] : resolveReferences(projectId, entry.patch.references)) {
        const url = resolveUrl?.(projectId, reference);
        if (!url) throw new Error('storyboard_reference_preview_unavailable');
        (references![storyboardReferenceSlot(reference)] ??= []).push({ url });
      }
      prepared.push({ ...entry, ...(references ? { references } : {}) });
    } catch (error) {
      if (entries.length === 1) throw error;
      prepErrors.push(`shots[${idx}] (${entry.shotId}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (prepErrors.length) refuseArgument(`${prepErrors.length} storyboard shots failed validation: ${prepErrors.join('; ')}`);

  if (prepared.length === 1) {
    const entry = prepared[0]!;
    const reply = await request(
      'storyboard.patch-design',
      { projectId, documentId: current.sourceDocumentId, designId, shotId: entry.shotId, patch: entry.patch, ...(entry.references ? { references: entry.references } : {}) },
      STORYBOARD_RENDERER_TIMEOUT_MS,
    ) as { status?: unknown; shotId?: unknown; shots?: unknown; anchorHoldsShotNumber?: unknown } | null;
    if (reply?.status === 'shot-not-found') refuseArgument(shotNotFoundMessage(entry.shotId, reply));
    refuseIfStoryboardRejected(reply);
    if (!reply || reply.status !== 'saved' || reply.shotId !== entry.shotId) throw new Error('storyboard_design_save_rejected');
    return;
  }

  const batchReply = await request(
    'storyboard.patch-design',
    { projectId, documentId: current.sourceDocumentId, designId, patches: prepared },
    STORYBOARD_RENDERER_TIMEOUT_MS,
  ) as {
    status?: unknown;
    shotIds?: unknown;
    failures?: Array<{ index?: unknown; kind?: unknown; shotId?: unknown; shots?: unknown; anchorHoldsShotNumber?: unknown; issues?: Array<{ path?: unknown; problem?: unknown }> }>;
  } | null;
  if (batchReply?.status === 'batch-failed' && Array.isArray(batchReply.failures) && batchReply.failures.length > 0) {
    const applyErrors = batchReply.failures.map((failure) => {
      const idx = typeof failure.index === 'number' ? failure.index : 0;
      const shotId = typeof failure.shotId === 'string' ? failure.shotId : prepared[idx]?.shotId ?? 'unknown';
      if (failure.kind === 'shot-not-found') {
        return `shots[${idx}] (${shotId}): ${shotNotFoundMessage(shotId, failure)}`;
      }
      const issuesText = (Array.isArray(failure.issues) ? failure.issues : [])
        .flatMap((issue) => (typeof issue?.path === 'string' && typeof issue?.problem === 'string' ? [`${issue.path} ${issue.problem}`] : []))
        .join('; ');
      return `shots[${idx}] (${shotId}): ${issuesText || 'invalid storyboard patch'}`;
    });
    refuseArgument(`${applyErrors.length} storyboard shots could not be revised (nothing changed): ${applyErrors.join('; ')}`);
  }
  refuseIfStoryboardRejected(batchReply);
  if (!batchReply || batchReply.status !== 'saved' || !Array.isArray(batchReply.shotIds) || batchReply.shotIds.length !== prepared.length) {
    throw new Error('storyboard_design_save_rejected');
  }
}

export function createDocumentPlanAuthoring(deps: { requestRenderer?: RequestRenderer; resolveStoryboardReferenceUrl?: ResolveUrl }) {
  const planOfRequest = new BoundedCache<string, string>({ maxEntries: REMEMBERED_REQUESTS, order: 'write' });
  const requestKey = (projectId: string, target: GenerationInvocationContext['storyboardTarget']): string | undefined =>
    target?.requestId ? `${projectId}\u0000${target.requestId}` : undefined;

  const renderer = (): RequestRenderer => {
    if (!deps.requestRenderer) throw new Error('storyboard_renderer_required');
    return deps.requestRenderer;
  };

  return {
    planToExtend(
      projectId: string,
      source: SourceDocument | undefined,
      target: GenerationInvocationContext['storyboardTarget'],
      newPlan: boolean,
    ): string | undefined {
      if (!source || newPlan) return undefined;
      const key = requestKey(projectId, target);
      return key ? planOfRequest.get(key) : undefined;
    },

    async saveDocumentPlan(
      projectId: string,
      source: SourceDocument | undefined,
      designId: string,
      shots: readonly GenerationOperationDraftShot[],
      target: GenerationInvocationContext['storyboardTarget'],
    ): Promise<StoryboardSavedFact | undefined> {
      if (!source) return undefined;
      const request = renderer();
      const plan = storyboardPlanFromDraftSubjects(shots, projectId, deps.resolveStoryboardReferenceUrl);
      const initiator = target?.openResult ? 'user' : 'agent';
      await upsertStoryboardDesign(request, { projectId, documentId: source.documentId, designId, plan, initiator });
      const key = requestKey(projectId, target);
      if (key) planOfRequest.set(key, designId);
      return storyboardSavedFact(designId, plan, initiator === 'user');
    },

    extendDocumentPlan(
      projectId: string,
      documentId: string,
      designId: string,
      shots: readonly GenerationOperationDraftShot[],
    ): Promise<StoryboardExtendedFact> {
      return extendStoryboardDesign(renderer(), {
        projectId,
        documentId,
        designId,
        subjects: storyboardSubjectsFromDrafts(shots, projectId, deps.resolveStoryboardReferenceUrl),
      });
    },
  };
}
