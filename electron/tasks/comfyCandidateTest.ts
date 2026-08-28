import {
  activeComfyCandidateRevision,
  failComfyCandidateRevision,
  resolveComfyStagedCandidate,
} from "../catalog/comfyuiCandidateLifecycle";
import type { ProfileKind } from "../catalog/types";
import { CertificationMediaError } from "../providerAdapter/certificationMedia";
import type { TaskResult } from "../runtime";

export type ComfyCandidateTestResult =
  | { ok: true; revisionId: string; active: { vendorKey: string; modelKey: string } }
  | { ok: false; revisionId: string; reasonCode: string; params: Readonly<Record<string, string | number | boolean>> };

type CandidatePayload = {
  vendor: string;
  request: { kind: ProfileKind; prompt: string; extras?: Record<string, unknown> };
};

type CandidateTestDependencies = {
  runTask: (payload: unknown) => Promise<TaskResult>;
  fetchTaskResult: (payload: unknown) => Promise<{ vendor: string; result: TaskResult }>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const inFlight = new Map<string, Promise<ComfyCandidateTestResult>>();
const controllers = new Map<string, AbortController>();

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function candidateIntent(payload: unknown): { payload: CandidatePayload; revisionId: string; modelKey: string; taskKind: ProfileKind } {
  const candidate = payload as CandidatePayload;
  const revisionId = text(candidate?.request?.extras?.comfyCertificationRevisionId);
  const modelKey = text(candidate?.request?.extras?.modelKey) || text(candidate?.request?.extras?.modelAlias);
  if (!text(candidate?.vendor) || !revisionId || !modelKey || candidate?.request?.extras?.certifyOutput !== true) {
    throw new Error("Invalid ComfyUI candidate certification request");
  }
  return { payload: candidate, revisionId, modelKey, taskKind: candidate.request.kind };
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
    while (result.status === "queued" || result.status === "running") {
      await (dependencies.sleep || wait)(dependencies.pollIntervalMs ?? 1_000, controller.signal);
      result = (await awaitWithAbort(dependencies.fetchTaskResult({
        taskId: result.id,
        vendor: intent.payload.vendor,
        taskKind: intent.taskKind,
        modelKey: intent.modelKey,
        projectId: intent.payload.request.extras?.projectId,
      }), controller.signal)).result;
    }
    if (result.status !== "succeeded" || !result.assets.length) throw new Error("Provider candidate failed");
    const active = activeComfyCandidateRevision(intent.revisionId);
    if (!active) throw new Error("Candidate completed without atomic promotion");
    return { ok: true, revisionId: intent.revisionId, active };
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
  const intent = candidateIntent(payload);
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
  const raw = payload as { revisionId?: unknown };
  const revisionId = text(raw?.revisionId);
  if (!revisionId) return { ok: false };
  const controller = controllers.get(revisionId);
  if (!controller || controller.signal.aborted) return { ok: false };
  controller.abort(Object.assign(new Error("candidate cancelled"), { name: "AbortError" }));
  return { ok: true };
}
