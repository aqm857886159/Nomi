import { firstString, isJsonRecord } from "../jsonUtils";
import { attachCanvasRun, attachedCanvasRunId, canvasRunIdFor } from "../productionRun/canvasShotRunIndex";
import type { ProductionRun } from "../productionRun/productionRunTypes";
import { createSubmissionIntent } from "../productionRun/submissionIntent";
import { jobAwaitsRetrieval, productionJobOpenAs } from "../shared/productionShotPhase";
import { submissionActions } from "../shared/productionSubmissionActions";
import type { CanvasShotSubmitInput } from "./appIntegrationCanvasShot";
import { latestJob } from "./canvasShotResult";
import type { CanvasTaskResult } from "./canvasTransportProvider";

function derivedIntent(projectRoot: string, { request, vendor }: CanvasShotSubmitInput) {
  const params = isJsonRecord(request.params) ? request.params : {};
  const extras = request.extras ?? {};
  const sourceTaskId = firstString(extras.draft_task_id, params.draft_task_id, extras.source_task_id, params.source_task_id);
  if (!sourceTaskId) return;
  return createSubmissionIntent({ root: projectRoot, scope: ["canvas-derived", vendor, sourceTaskId] });
}

type TaskReply = Promise<CanvasTaskResult>;
type CommitApproval = (approve: () => void) => TaskReply | undefined;
export type CanvasShotDispatch = (input: CanvasShotSubmitInput, runId: string, consent: ProductionRun | null, commit: CommitApproval) => TaskReply;

/** Same-click replay, cross-click attachment and paid admission use the original Run as the polling address. */
export function createCanvasShotSubmitter(deps: {
  projectRoot: (projectId: string) => string;
  read: (projectId: string, runId: string) => ProductionRun | null;
  submitting: Map<string, TaskReply>;
  consented: (run: ProductionRun | null) => boolean;
  withdraw: (projectId: string, runId: string) => void;
  replay: (run: ProductionRun, kind: string) => CanvasTaskResult | TaskReply;
  dispatch: CanvasShotDispatch;
  confirm: (input: CanvasShotSubmitInput, previous: ProductionRun) => boolean;
}) {
  // Two clicks can arrive during preview, before the approved Run and intent are written.
  const preparing = new Map<string, string>();
  return async (input: CanvasShotSubmitInput): TaskReply => {
    const { projectId, request } = input;
    const root = deps.projectRoot(projectId);
    const click = canvasRunIdFor(input.runRecordId);
    const read = (id: string) => deps.read(projectId, id);
    const key = (id: string) => `${projectId}\u0000${id}`;
    const follow = async (owner: string): TaskReply => {
      const work = deps.submitting.get(key(owner));
      if (work) return work;
      const run = read(owner);
      if (!run) throw new Error(`Canvas generation run not found: ${owner}`);
      const job = latestJob(run);
      if (owner !== click && job) {
        const awaitingHandle = !job.providerTaskId && (job.status === "authorized" || productionJobOpenAs(job.status) === "in_flight");
        if (awaitingHandle || jobAwaitsRetrieval(job))
          return { id: job.providerTaskId ?? owner, kind: request.kind, status: "queued", assets: [], raw: {} };
      }
      return deps.replay(run, request.kind);
    };
    // Only derived clicks can be attached. Ordinary submissions must reserve the node before yielding.
    const intent = derivedIntent(root, input);
    const linked = intent ? await attachedCanvasRunId(root, click) : click;
    const existing = read(click);
    if (linked !== click || deps.submitting.has(key(click)) || (existing && !deps.consented(existing))) return follow(linked);

    const attach = (owner: string) => {
      if (deps.consented(existing)) deps.withdraw(projectId, click);
      attachCanvasRun(root, click, owner);
      return follow(owner);
    };
    const mayReplace = (owner: string): boolean => {
      const previous = read(owner);
      const job = previous && latestJob(previous);
      if (!job) throw new Error("Derived submission intent has no approved job");
      if (submissionActions(job).accepted === "not_sent") return true;
      if (job.status === "ready" || job.status === "adopted" || previous.status === "completed") {
        if (input.gesture && !existing && deps.confirm(input, previous)) return true;
        // The renderer handles this admission signal by asking decideResend(true).
        throw Object.assign(new Error("node_generation_in_flight: resend_confirmation_required"),
          { code: "node_generation_in_flight", reason: "resend_confirmation_required", action: "ask" });
      }
      return false;
    };
    const scope = intent && key(intent.intentId);
    if (intent && scope) {
      const pending = preparing.get(scope);
      if (pending) return attach(pending);
      const previous = intent.projectRunOwner();
      if (previous && !mayReplace(previous)) return attach(previous);
      preparing.set(scope, click);
    }
    try {
      const work = deps.dispatch(input, click, existing, approve => {
        if (!intent) { approve(); return; }
        const owner = intent.claimProjectRun(click, mayReplace, approve);
        if (owner !== click) return attach(owner);
      });
      deps.submitting.set(key(click), work);
      return await work;
    } finally {
      deps.submitting.delete(key(click));
      if (scope) preparing.delete(scope);
    }
  };
}
