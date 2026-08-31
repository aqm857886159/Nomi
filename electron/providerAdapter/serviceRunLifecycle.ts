import { completedModelCount, failUnfinishedModes } from "./serviceFallback";
import { isTerminalAdapterStage, ProviderAdapterRunActiveError, type ProviderAdapterStore } from "./store";
import type {
  AdapterModeResult,
  ProviderAdapterDraft,
  ProviderAdapterRevision,
  ProviderAdapterRun,
} from "./types";
import { adapterRevisionDigest } from "./validator";

export type ModeResultWithModel = AdapterModeResult & { modelKey: string };

export function deleteTerminalAdapterRun(store: ProviderAdapterStore, id: string): ProviderAdapterRun | undefined {
  const current = store.getRun(id);
  if (!current) return undefined;
  if (!isTerminalAdapterStage(current.stage)) throw new ProviderAdapterRunActiveError();
  return store.deleteRun(id);
}

export function planAdapterPromotionFinal(input: {
  current: ProviderAdapterRun;
  draft: ProviderAdapterDraft;
  results: readonly ModeResultWithModel[];
  completedAt: string;
  repairError?: string;
  deadlineReached: boolean;
}): {
  verifiedModes: ProviderAdapterRevision["verifiedModes"];
  revision: ProviderAdapterRevision;
  completedRun: ProviderAdapterRun;
} {
  const verifiedModes = input.results
    .filter((result) => result.state === "verified")
    .map((result) => ({ modelKey: result.modelKey, taskKind: result.taskKind }));
  const digest = adapterRevisionDigest(input.draft);
  const revision: ProviderAdapterRevision = {
    id: `adapter-revision-${digest.slice(0, 20)}`,
    vendorKey: input.current.vendorKey,
    digest,
    draft: input.draft,
    verifiedModes,
    createdAt: input.completedAt,
  };
  const finalStage = input.deadlineReached && verifiedModes.length === 0
    ? "timed_out"
    : verifiedModes.length === 0
      ? "failed"
      : input.results.some((result) => result.state === "failed")
        ? "partial"
        : "completed";
  return {
    verifiedModes,
    revision,
    completedRun: {
      ...input.current,
      stage: finalStage,
      currentModelKey: undefined,
      completedCount: input.current.totalCount ?? input.current.selectedModelKeys.length,
      totalCount: input.current.totalCount ?? input.current.selectedModelKeys.length,
      activeRevision: verifiedModes.length > 0 ? revision.id : input.current.activeRevision,
      ...(input.repairError ? { error: input.repairError.slice(0, 2_000) } : {}),
      stageStartedAt: input.completedAt,
      lastProgressAt: input.completedAt,
      updatedAt: input.completedAt,
    },
  };
}

export function buildTerminalFailureRun(input: {
  existing: ProviderAdapterRun;
  stage: ProviderAdapterRun["stage"];
  failureStage: AdapterModeResult["stage"];
  error: string;
  finishedAt: string;
}): ProviderAdapterRun {
  const models = failUnfinishedModes(input.existing.models, input.failureStage || "promote", input.error);
  return {
    ...input.existing,
    stage: input.stage,
    error: input.error,
    currentModelKey: undefined,
    models,
    completedCount: completedModelCount(models),
    totalCount: input.existing.totalCount ?? input.existing.selectedModelKeys.length,
    stageStartedAt: input.finishedAt,
    lastProgressAt: input.finishedAt,
    updatedAt: input.finishedAt,
  };
}

export function adapterRunLineageRoot(run: ProviderAdapterRun): string {
  return run.lineageRootVendorKey || run.vendorKey.split("--candidate-")[0] || run.vendorKey;
}

export function latestRunInLineage(
  runs: readonly ProviderAdapterRun[],
  lineageRootVendorKey: string,
): ProviderAdapterRun | undefined {
  return [...runs].reverse().find((run) => adapterRunLineageRoot(run) === lineageRootVendorKey);
}

export function staleAdapterRun(run: ProviderAdapterRun, updatedAt: string, error: string): ProviderAdapterRun {
  return {
    ...run,
    stage: "stale",
    error,
    currentModelKey: undefined,
    stageStartedAt: updatedAt,
    lastProgressAt: updatedAt,
    updatedAt,
  };
}

export function activeRunsSupersededBy(input: {
  runs: readonly ProviderAdapterRun[];
  nextRunId: string;
  lineageRootVendorKey: string;
  supersededVendorKeys: ReadonlySet<string>;
}): ProviderAdapterRun[] {
  return input.runs.filter((run) =>
    run.id !== input.nextRunId &&
    !isTerminalAdapterStage(run.stage) &&
    (adapterRunLineageRoot(run) === input.lineageRootVendorKey || input.supersededVendorKeys.has(run.vendorKey)),
  );
}
