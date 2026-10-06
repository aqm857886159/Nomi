// 能力核 · 文稿方案的落地与「一次请求一份方案」（2026-10-05，用户「分镜方案经常做错」）。
//
// 文稿来源的分镜方案只有一个家：渲染层项目记录里的 `storyboardDesign`（和用户手建的那种同一份）。
// 主进程是**唯一铸方案 id 的地方**（方案 id = 草稿 id），所以「这一请求已经有方案了没有」也只能在这里回答：
//
//   · 首建：`saveDocumentPlan` 把作者载荷交给渲染层，记下 requestId → 方案 id。
//   · 同一请求再起草一次（不带 operationId）：补到这一请求的那份方案上，不再新建——除非模型明说 `newPlan`
//     （用户明确要另起一份）。审计 A-sb P10 的轨迹：宿主回「镜头下一次 draft_shots 再补」，模型照做不带
//     operationId，左栏多出一份。
//   · 补镜头（`extend`，或上一条的自动补）：主体由渲染层按方案此刻的样子发号，回包带回发出的 id 与行号。
//
// 记忆随进程活：重启后 requestId 本来就变了（下一条消息是新请求），不会误合并。
import type { GenerationInvocationContext } from '../shared/agentCapabilities/generationInvocationContext';
import type { PlanCandidate } from './executionContract';
import {
  extendStoryboardDesign,
  storyboardPlanFromDraftSubjects,
  storyboardSavedFact,
  storyboardSubjectsFromDrafts,
  upsertStoryboardDesign,
  type GenerationOperationDraftShot,
  type StoryboardExtendedFact,
  type StoryboardSavedFact,
} from './mcpGenerationMultiShot';

type RequestRenderer = (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
type SourceDocument = Readonly<{ documentId: string; revision: number; contentHash: string }>;
type ResolveUrl = (projectId: string, reference: PlanCandidate['references'][number]) => string;

/** 记多少个请求就够：一条用户消息就是一个请求，桌面上同时开着的远少于这个数。 */
const REMEMBERED_REQUESTS = 64;

export function createDocumentPlanAuthoring(deps: { requestRenderer?: RequestRenderer; resolveStoryboardReferenceUrl?: ResolveUrl }) {
  /** `${projectId}\u0000${requestId}` → 这一请求起草出的方案 id（最近那一份）。 */
  const planOfRequest = new Map<string, string>();
  const requestKey = (projectId: string, target: GenerationInvocationContext['storyboardTarget']): string | undefined =>
    target?.requestId ? `${projectId}\u0000${target.requestId}` : undefined;

  const renderer = (): RequestRenderer => {
    if (!deps.requestRenderer) throw new Error('storyboard_renderer_required');
    return deps.requestRenderer;
  };

  return {
    /**
     * 这一请求已经起草过方案、而这次又不带 operationId 地起草：返回那份方案的 id（应补到它上面）。
     * `newPlan` = 用户明确要另起一份，照新建。只对文稿来源的起草生效——画布草稿一次请求建几张是常态。
     */
    planToExtend(projectId: string, source: SourceDocument | undefined, target: GenerationInvocationContext['storyboardTarget'],
      newPlan: boolean): string | undefined {
      if (!source || newPlan) return undefined;
      const key = requestKey(projectId, target);
      return key ? planOfRequest.get(key) : undefined;
    },

    /**
     * A document-admitted draft's author body goes to that document's plan list — the same
     * `storyboardDesign` a hand-made plan uses, so the sidebar row can be renamed, deleted,
     * duplicated and placed on the canvas by the user. The draft id **is** the plan id, so the
     * id the model holds and the row the user sees are one identity.
     */
    async saveDocumentPlan(projectId: string, source: SourceDocument | undefined, designId: string,
      shots: readonly GenerationOperationDraftShot[], target: GenerationInvocationContext['storyboardTarget']): Promise<StoryboardSavedFact | undefined> {
      if (!source) return undefined;
      const request = renderer();
      const plan = storyboardPlanFromDraftSubjects(shots, projectId, deps.resolveStoryboardReferenceUrl);
      // 谁发起的：只有用户亲手点「拆分镜」（目标上带 openResult）才替他打开；Agent 自己决定建的只入列表。
      const initiator = target?.openResult ? 'user' : 'agent';
      await upsertStoryboardDesign(request, { projectId, documentId: source.documentId, designId, plan, initiator });
      const key = requestKey(projectId, target);
      if (key) {
        planOfRequest.delete(key);
        planOfRequest.set(key, designId);
        if (planOfRequest.size > REMEMBERED_REQUESTS) planOfRequest.delete(planOfRequest.keys().next().value!);
      }
      return storyboardSavedFact(designId, plan, initiator === 'user');
    },

    /** 把已准入的主体补到一份文稿方案后面。方案不在了由渲染层拒（`storyboard_design_missing`），绝不新建。 */
    extendDocumentPlan(projectId: string, documentId: string, designId: string,
      shots: readonly GenerationOperationDraftShot[]): Promise<StoryboardExtendedFact> {
      return extendStoryboardDesign(renderer(), {
        projectId, documentId, designId, subjects: storyboardSubjectsFromDrafts(shots, projectId, deps.resolveStoryboardReferenceUrl),
      });
    },
  };
}
