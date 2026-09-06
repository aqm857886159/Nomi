import {
  activeComfyCandidateRevision,
  failComfyCandidateRevision,
  resolveComfyStagedCandidate,
} from "../catalog/comfyuiCandidateLifecycle";
import type { ProfileKind } from "../catalog/types";
import { CertificationMediaError } from "../providerAdapter/certificationMedia";
import type { TaskResult } from "../runtime";
import { redactNetworkMessage } from "../networkErrorDetails";
import { stripNomiErrorCode } from "../shared/nomiErrorCodes";

export type ComfyCandidateTestResult =
  | { ok: true; revisionId: string; active: { vendorKey: string; modelKey: string }; remoteTaskId?: string }
  | { ok: false; revisionId: string; reasonCode: string; params: Readonly<Record<string, string | number | boolean>> };

type CandidatePayload = {
  vendor: string;
  candidate: CandidateEnvelope;
  request: { kind: ProfileKind; prompt: string; extras?: Record<string, unknown> };
};

type CandidateEnvelope = { revisionId: string; modelKey: string; taskKind: ProfileKind };

type CandidateTestDependencies = {
  runTask: (payload: unknown) => Promise<TaskResult>;
  fetchTaskResult: (payload: unknown) => Promise<{ vendor: string; result: TaskResult }>;
  /** Called immediately after the production create response yields its
   * remote prompt/task id, before any poll. A canonical run owner persists
   * this id so a crash can reconcile without another create. */
  onSubmitted?: (remoteTaskId: string) => void | Promise<void>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const inFlight = new Map<string, Promise<ComfyCandidateTestResult>>();
const controllers = new Map<string, AbortController>();

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function candidateEnvelope(payload: unknown): CandidateEnvelope | null {
  const raw = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = raw.candidate && typeof raw.candidate === "object" ? raw.candidate as Record<string, unknown> : raw;
  const revisionId = text(nested.revisionId);
  const modelKey = text(nested.modelKey);
  const taskKind = text(nested.taskKind) as ProfileKind;
  return revisionId && modelKey && taskKind ? { revisionId, modelKey, taskKind } : null;
}

function candidateIntent(payload: unknown): { payload: CandidatePayload; revisionId: string; modelKey: string; taskKind: ProfileKind } {
  const candidate = payload as CandidatePayload;
  const envelope = candidateEnvelope(payload);
  const revisionId = text(candidate?.request?.extras?.comfyCertificationRevisionId);
  const modelKey = text(candidate?.request?.extras?.modelKey) || text(candidate?.request?.extras?.modelAlias);
  if (!envelope || !text(candidate?.vendor) || !revisionId || !modelKey || candidate?.request?.extras?.certifyOutput !== true
    || revisionId !== envelope.revisionId || modelKey !== envelope.modelKey || candidate.request.kind !== envelope.taskKind) {
    throw new Error("Invalid ComfyUI candidate certification request");
  }
  return { payload: candidate, revisionId, modelKey, taskKind: candidate.request.kind };
}

/**
 * `detail` 不是装饰：以前这条出口把**所有**失败压成裸码 `provider_failed`，界面照着渲染，
 * 用户看到的就是一个没翻译的状态码，真因（上游 4xx/余额/我们自己的出站策略拒绝）当场蒸发。
 * 由调用方把真实错误传进来，这里只负责脱敏与截断——出站报文里的 URL/密钥不许进 UI。
 */
export function failComfyCandidateEnvelope(
  payload: unknown,
  reasonCode = "provider_failed",
  cause?: unknown,
): ComfyCandidateTestResult {
  const envelope = candidateEnvelope(payload);
  if (envelope) failComfyCandidateRevision({ ...envelope, reasonCode });
  const rawDetail = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const detail = rawDetail ? redactNetworkMessage(stripNomiErrorCode(rawDetail), [], 200) : "";
  return { ok: false, revisionId: envelope?.revisionId || "", reasonCode, params: detail ? { detail } : {} };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

function safeFailure(revisionId: string, error: unknown, timedOut: boolean): ComfyCandidateTestResult {
  if (error instanceof CertificationMediaError) {
    return { ok: false, revisionId, reasonCode: error.reasonCode, params: error.params };
  }
  if (timedOut) return { ok: false, revisionId, reasonCode: "candidate_timeout", params: {} };
  if (error instanceof Error && error.name === "AbortError") return { ok: false, revisionId, reasonCode: "candidate_cancelled", params: {} };
  return { ok: false, revisionId, reasonCode: "provider_failed", params: {} };
}

async function executeCandidate(
  intent: ReturnType<typeof candidateIntent>,
  dependencies: CandidateTestDependencies,
  controller: AbortController,
): Promise<ComfyCandidateTestResult> {
  const alreadyActive = activeComfyCandidateRevision(intent.revisionId);
  if (alreadyActive) return { ok: true, revisionId: intent.revisionId, active: alreadyActive };
  try {
    resolveComfyStagedCandidate({ revisionId: intent.revisionId, modelKey: intent.modelKey, taskKind: intent.taskKind });
  } catch {
    return { ok: false, revisionId: intent.revisionId, reasonCode: "candidate_stale", params: {} };
  }
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(Object.assign(new Error("candidate timeout"), { name: "AbortError" }));
  }, dependencies.timeoutMs ?? 300_000);
  try {
    let result = await awaitWithAbort(dependencies.runTask(intent.payload), controller.signal);
    // For ComfyUI the task result id is the remote prompt id (the mapping's
    // response_mapping reads prompt_id). Preserve it as soon as the create
    // response crosses the runtime boundary; callers can persist it before
    // polling and therefore reconcile instead of issuing a second /prompt.
    const remoteTaskId = result.status !== "failed" && typeof result.id === "string" && result.id.trim()
      ? result.id.trim()
      : undefined;
    if (remoteTaskId) await dependencies.onSubmitted?.(remoteTaskId);
    while (result.status === "queued" || result.status === "running") {
      await (dependencies.sleep || wait)(dependencies.pollIntervalMs ?? 1_000, controller.signal);
      result = (await awaitWithAbort(dependencies.fetchTaskResult({
        taskId: result.id,
        vendor: intent.payload.vendor,
        taskKind: intent.taskKind,
        modelKey: intent.modelKey,
        comfyCertificationRevisionId: intent.revisionId,
        certifyOutput: true,
        projectId: intent.payload.request.extras?.projectId,
      }), controller.signal)).result;
    }
    if (result.status !== "succeeded" || !result.assets.length) throw new Error("Provider candidate failed");
    const active = activeComfyCandidateRevision(intent.revisionId);
    if (!active) throw new Error("Candidate completed without atomic promotion");
    return { ok: true, revisionId: intent.revisionId, active, ...(remoteTaskId ? { remoteTaskId } : {}) };
  } catch (error) {
    failComfyCandidateRevision({
      revisionId: intent.revisionId,
      modelKey: intent.modelKey,
      taskKind: intent.taskKind,
      ...(error instanceof CertificationMediaError ? { reasonCode: error.reasonCode } : {}),
    });
    return safeFailure(intent.revisionId, error, timedOut);
  } finally { clearTimeout(timeout); }
}

export function runComfyCandidateTest(payload: unknown, dependencies: CandidateTestDependencies): Promise<ComfyCandidateTestResult> {
  let intent: ReturnType<typeof candidateIntent>;
  try { intent = candidateIntent(payload); }
  catch { return Promise.resolve(failComfyCandidateEnvelope(payload, "candidate_invalid_request")); }
  const existing = inFlight.get(intent.revisionId);
  if (existing) return existing;
  const controller = new AbortController();
  controllers.set(intent.revisionId, controller);
  const execution = executeCandidate(intent, dependencies, controller).finally(() => {
    if (inFlight.get(intent.revisionId) === execution) inFlight.delete(intent.revisionId);
    if (controllers.get(intent.revisionId) === controller) controllers.delete(intent.revisionId);
  });
  inFlight.set(intent.revisionId, execution);
  return execution;
}

export function cancelComfyCandidateTest(payload: unknown): { ok: boolean } {
  const revisionId = candidateEnvelope(payload)?.revisionId || text((payload as { revisionId?: unknown })?.revisionId);
  if (!revisionId) return { ok: false };
  const controller = controllers.get(revisionId);
  if (controller && !controller.signal.aborted) {
    controller.abort(Object.assign(new Error("candidate cancelled"), { name: "AbortError" }));
  }
  return { ok: true };
}
