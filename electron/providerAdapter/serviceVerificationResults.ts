import type { LoadedConnection } from "./serviceCatalog";
import { primaryTaskKind } from "./serviceFallback";
import type { ModeResultWithModel } from "./serviceRunLifecycle";
import type {
  AdapterModeResult,
  ProviderAdapterCompileFailure,
  ProviderAdapterDraft,
  ProviderAdapterRun,
} from "./types";
import type { AdapterVerificationResult } from "./verifier";

export function initialVerificationState(input: {
  connection: LoadedConnection;
  draft: ProviderAdapterDraft;
  compileFailures: readonly ProviderAdapterCompileFailure[];
  attempt: number;
}): { models: ProviderAdapterRun["models"]; results: ModeResultWithModel[] } {
  const candidates = new Map(input.draft.models.map((model) => [model.modelKey, model]));
  const failures = new Map(input.compileFailures.map((failure) => [failure.modelKey, failure]));
  const models = input.connection.models.map((model) => {
    const candidate = candidates.get(model.modelKey);
    const failure = failures.get(model.modelKey);
    return {
      modelKey: model.modelKey,
      labelZh: candidate?.labelZh || model.labelZh,
      kind: model.kind,
      modes: candidate
        ? candidate.modes.map((mode) => ({ taskKind: mode.taskKind, state: "queued" as const, attempts: input.attempt }))
        : failure
          ? [{
              taskKind: primaryTaskKind(model.kind),
              state: "failed" as const,
              attempts: 1,
              stage: "compile" as const,
              error: failure.error,
              compileFailureReason: failure.reason,
            }]
          : [],
    };
  });
  const results: ModeResultWithModel[] = input.compileFailures.map((failure) => {
    const model = input.connection.models.find((item) => item.modelKey === failure.modelKey);
    return {
      modelKey: failure.modelKey,
      taskKind: primaryTaskKind(model?.kind || "text"),
      state: "failed",
      attempts: 1,
      stage: "compile",
      error: failure.error,
      compileFailureReason: failure.reason,
    };
  });
  return { models, results };
}

export function modeResultFromVerification(input: {
  modelKey: string;
  attempt: number;
  verifiedAt: string;
  verification: AdapterVerificationResult;
}): ModeResultWithModel {
  const result = input.verification;
  return result.ok
    ? {
        modelKey: input.modelKey,
        taskKind: result.taskKind,
        state: "verified",
        attempts: input.attempt,
        verifiedAt: input.verifiedAt,
        ...(result.mediaEvidence ? { mediaEvidence: result.mediaEvidence } : {}),
      }
    : {
        modelKey: input.modelKey,
        taskKind: result.taskKind,
        state: "failed",
        attempts: input.attempt,
        stage: result.stage,
        error: result.error,
        ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
        ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}),
        ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
        ...(result.errorParams ? { errorParams: result.errorParams } : {}),
        ...(result.submissionState === "unknown" ? { submissionState: "unknown" as const } : {}),
      };
}

export function persistedModeResult(result: ModeResultWithModel): AdapterModeResult {
  return {
    taskKind: result.taskKind,
    state: result.state,
    attempts: result.attempts,
    ...(result.stage ? { stage: result.stage } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
    ...(result.compileFailureReason ? { compileFailureReason: result.compileFailureReason } : {}),
    ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}),
    ...(result.verifiedAt ? { verifiedAt: result.verifiedAt } : {}),
    ...(result.mediaEvidence ? { mediaEvidence: result.mediaEvidence } : {}),
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(result.errorParams ? { errorParams: result.errorParams } : {}),
    ...(result.submissionState ? { submissionState: result.submissionState } : {}),
  };
}
