import crypto from "node:crypto";
import type { ProfileKind } from "../catalog/types";
import type { AdapterVerificationResult } from "../providerAdapter/verifier";
import { redactAdapterSecrets } from "../providerAdapter/redaction";
import { adapterRunLineageRoot } from "../providerAdapter/serviceRunLifecycle";
import type { ProviderAdapterCatalogPort, ProviderAdapterPromotionResult, StagedProviderAdapterCatalog } from "../providerAdapter/serviceCatalog";
import type { ProviderAdapterStore } from "../providerAdapter/store";
import type {
  ProviderAdapterCertificationInput,
  ProviderAdapterConnectionInput,
  ProviderAdapterDraft,
  ProviderAdapterRevision,
  ProviderAdapterRun,
} from "../providerAdapter/types";
import { OperationLedger } from "./operationLedger";
import { certificationModeIdentity } from "./modeIdentity";
import { PromotionJournal } from "./promotionJournal";
import type {
  CertificationContractBinding,
  CertificationModeOperation,
  CertificationOperationRecord,
  CertificationSettledResult,
} from "./types";

export class AdapterReconciliationRequiredError extends Error {
  constructor() {
    super("Provider submission status is unknown and must be reconciled before any retry");
    this.name = "AdapterReconciliationRequiredError";
  }
}

export class AdapterPromotionRecoveryRequiredError extends Error {
  constructor(readonly runIds: readonly string[]) {
    super("Catalog promotion may have committed and requires journal replay before finalization");
    this.name = "AdapterPromotionRecoveryRequiredError";
  }
}

export type CertificationStartCheckpoint =
  | "after_intent"
  | "after_run_write"
  | "after_run_checkpoint"
  | "after_catalog_stage"
  | "after_catalog_checkpoint"
  | "after_commit";

const DEFAULT_CANONICAL_START_WAIT_MS = 3_000;
const CANONICAL_START_POLL_MS = 10;

function sha(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizedHeaderIdentity(headers: Record<string, string> | undefined): Array<[string, string]> {
  const normalized = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = rawName.trim().toLowerCase();
    const value = rawValue.trim();
    if (!name || !value) continue;
    const fingerprint = sha(value);
    const existing = normalized.get(name);
    if (existing && existing !== fingerprint) throw new Error(`Conflicting custom header identity: ${name}`);
    normalized.set(name, fingerprint);
  }
  return [...normalized.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function contractIdentity(input: ProviderAdapterConnectionInput, lineageRoot: string, binding: CertificationContractBinding): {
  contractDigest: string;
  credentialFingerprint: string;
  catalogIdentityFingerprint: string;
  customHeaderIdentityFingerprint: string;
} {
  const customHeaders = normalizedHeaderIdentity(input.headers);
  const customHeaderIdentityFingerprint = sha(JSON.stringify(customHeaders));
  const credentialFingerprint = sha(JSON.stringify({
    apiKey: sha(input.apiKey || ""),
    authType: input.authType,
    authHeader: input.authHeader?.trim().toLowerCase() || null,
    authQueryParam: input.authQueryParam?.trim().toLowerCase() || null,
    customHeaderIdentityFingerprint,
  }));
  const catalogIdentityFingerprint = sha(JSON.stringify({
    lineageRoot,
    catalogVendorKey: input.catalogVendorKey?.trim() || lineageRoot,
  }));
  const normalized = {
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    authType: input.authType,
    authHeader: input.authHeader || null,
    authQueryParam: input.authQueryParam || null,
    providerKind: input.providerKind || null,
    proxyUrl: input.proxyUrl?.trim() || null,
    credentialFingerprint,
    catalogIdentityFingerprint,
    customHeaderIdentityFingerprint,
    models: input.models.map((model) => ({ modelKey: model.modelKey, kind: model.kind })).sort((a, b) => a.modelKey.localeCompare(b.modelKey)),
  };
  const actualDigest = sha(JSON.stringify(normalized));
  if (!/^[a-f0-9]{64}$/.test(binding.contractDigest)) throw new Error("Certification contract digest must be a SHA-256 digest");
  if (!binding.idempotencyKey.trim() || binding.idempotencyKey.length > 256 || /[\r\n]/.test(binding.idempotencyKey)) {
    throw new Error("Certification idempotency key is invalid");
  }
  return {
    contractDigest: sha(`${binding.contractDigest}:${actualDigest}`),
    credentialFingerprint,
    catalogIdentityFingerprint,
    customHeaderIdentityFingerprint,
  };
}

function settledResultFromVerification(result: AdapterVerificationResult): CertificationSettledResult {
  return result.ok
    ? { ok: true, taskKind: result.taskKind }
    : {
        ok: false,
        taskKind: result.taskKind,
        stage: result.stage,
        ...(result.errorCategory ? { errorCategory: result.errorCategory } : {}),
        ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
      };
}

export class ProviderAdapterCertificationCoordinator {
  readonly ledger: OperationLedger;
  private readonly journal: PromotionJournal;
  private readonly canonicalStartWaitMs: number;

  constructor(
    private readonly store: ProviderAdapterStore,
    private readonly catalog: ProviderAdapterCatalogPort,
    private readonly now: () => string,
    dependencies: {
      operationLedger?: OperationLedger;
      promotionJournal?: PromotionJournal;
      canonicalStartWaitMs?: number;
    } = {},
  ) {
    this.ledger = dependencies.operationLedger
      || new OperationLedger(store.integrationCertificationPath("operations.json"));
    this.journal = dependencies.promotionJournal
      || new PromotionJournal(store.integrationCertificationPath("promotion-journal.json"));
    this.canonicalStartWaitMs = Math.max(0, Math.min(10_000, Math.trunc(
      dependencies.canonicalStartWaitMs ?? DEFAULT_CANONICAL_START_WAIT_MS,
    )));
  }

  async prepareStart(input: ProviderAdapterCertificationInput, runId: string, lineageRoot: string): Promise<{
    duplicate?: ProviderAdapterRun;
    operation?: CertificationOperationRecord;
    runId: string;
    contractDigest: string;
    idempotencyKey: string;
    credentialFingerprint: string;
    catalogIdentityFingerprint: string;
    customHeaderIdentityFingerprint: string;
  }> {
    const binding = input.certification;
    if (!binding) throw new Error("Canonical certification contract is required");
    const idempotencyKey = binding.idempotencyKey;
    const identity = contractIdentity(input, lineageRoot, binding);
    const { contractDigest } = identity;
    const now = this.now();
    const begun = this.ledger.begin({
      runId,
      contractDigest,
      idempotencyKey,
      lineageRootVendorKey: lineageRoot,
      sourceVendorKey: lineageRoot,
      selectedModels: input.models.map((model) => ({
        modelKey: model.modelKey,
        labelZh: model.labelZh || model.modelKey,
        kind: model.kind,
      })),
      leaseOwner: runId,
      leaseToken: crypto.randomUUID(),
      attempt: 1,
      childRunRef: { runId, revisionDigest: contractDigest },
      providerIdempotency: binding.remoteIdempotency || "unknown",
      credentialFingerprint: identity.credentialFingerprint,
      catalogIdentityFingerprint: identity.catalogIdentityFingerprint,
      customHeaderIdentityFingerprint: identity.customHeaderIdentityFingerprint,
      now,
    });
    if (begun.status === "duplicate") {
      const original = await this.readMaterializingCanonicalRun(begun.canonicalRunId, begun.operation);
      return { duplicate: original, operation: begun.operation, runId: original.id, idempotencyKey, ...identity };
    }
    const operation = begun.operation!;
    return { operation, runId: operation.runId, idempotencyKey, ...identity };
  }

  childRunRef(runId: string): CertificationOperationRecord["childRunRef"] | undefined {
    return this.ledger.childRunRefForRunId(runId);
  }

  sourceVendorKey(runId: string): string | undefined {
    return this.ledger.getByRunId(runId)?.startTransaction.sourceVendorKey;
  }

  private async readMaterializingCanonicalRun(
    canonicalRunId: string,
    reservedOperation: CertificationOperationRecord | undefined,
  ): Promise<ProviderAdapterRun> {
    let run = this.store.getRun(canonicalRunId);
    if (run) return run;
    let operation = reservedOperation || this.ledger.getByRunId(canonicalRunId);
    if (!operation) throw new Error("Certification canonical binding is missing its active start transaction");
    const expiresAt = process.hrtime.bigint() + BigInt(this.canonicalStartWaitMs) * 1_000_000n;
    while (operation.startTransaction.state === "intent" && process.hrtime.bigint() < expiresAt) {
      await new Promise<void>((resolve) => setTimeout(resolve, CANONICAL_START_POLL_MS));
      run = this.store.getRun(canonicalRunId);
      if (run) return run;
      operation = this.ledger.getByRunId(canonicalRunId);
      if (!operation) throw new Error("Certification canonical start transaction disappeared during materialization");
    }
    run = this.store.getRun(canonicalRunId);
    if (run) return run;
    if (operation.startTransaction.state !== "intent") {
      throw new Error(`Certification canonical run is missing after start transaction reached ${operation.startTransaction.state}; restart recovery is required`);
    }
    throw new Error("Timed out waiting for canonical run materialization; retry this idempotent start or run restart recovery");
  }

  checkpointStart(runId: string, input: {
    state: CertificationOperationRecord["startTransaction"]["state"];
    stagedVendorKey?: string;
    lineageRootVendorKey?: string;
  }): CertificationOperationRecord {
    const operation = this.ledger.getByRunId(runId);
    if (!operation) throw new Error("Certification start transaction is missing");
    if (operation.startTransaction.state === input.state) return operation;
    return this.ledger.markStartTransaction(runId, {
      ...input,
      expectedRevision: operation.revision,
      now: this.now(),
    });
  }

  async completePreparedStart(input: {
    connection: ProviderAdapterCertificationInput;
    operation: CertificationOperationRecord;
    sourceVendorKey: string;
    connectionFingerprint: string;
    deadlineAt: string;
    checkpoint?: (checkpoint: CertificationStartCheckpoint) => void | Promise<void>;
  }): Promise<{ run: ProviderAdapterRun; staged: StagedProviderAdapterCatalog }> {
    let operation = input.operation;
    if (input.checkpoint) await input.checkpoint("after_intent");
    const timestamp = this.now();
    let run = this.store.getRun(operation.runId);
    if (!run) {
      run = {
        id: operation.runId,
        vendorKey: input.sourceVendorKey,
        lineageRootVendorKey: input.sourceVendorKey,
        vendorName: input.connection.vendorName || input.sourceVendorKey,
        connectionFingerprint: input.connectionFingerprint,
        selectedModelKeys: input.connection.models.map((model) => model.modelKey),
        stage: "queued",
        completedCount: 0,
        totalCount: input.connection.models.length,
        lastProgressAt: timestamp,
        stageStartedAt: timestamp,
        deadlineAt: input.deadlineAt,
        repairAttempt: 0,
        models: input.connection.models.map((model) => ({
          modelKey: model.modelKey,
          labelZh: model.labelZh || model.modelKey,
          kind: model.kind,
          modes: [],
        })),
        sourceUrls: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.store.upsertRun(run);
      if (input.checkpoint) await input.checkpoint("after_run_write");
    }
    if (operation.startTransaction.state === "intent") {
      operation = this.checkpointStart(operation.runId, { state: "run_persisted" });
    }
    if (input.checkpoint) await input.checkpoint("after_run_checkpoint");
    const staged = this.catalog.stage({ ...input.connection, vendorKey: input.sourceVendorKey, runId: operation.runId });
    if (input.checkpoint) await input.checkpoint("after_catalog_stage");
    run = this.store.upsertRun({
      ...run,
      vendorKey: staged.vendor.key,
      lineageRootVendorKey: staged.lineageRootVendorKey,
      vendorName: staged.vendor.name,
      updatedAt: timestamp,
    });
    if (operation.startTransaction.state === "run_persisted") {
      operation = this.checkpointStart(operation.runId, {
        state: "catalog_staged",
        stagedVendorKey: staged.vendor.key,
        lineageRootVendorKey: staged.lineageRootVendorKey,
      });
    }
    if (input.checkpoint) await input.checkpoint("after_catalog_checkpoint");
    if (operation.startTransaction.state === "catalog_staged") {
      this.checkpointStart(operation.runId, { state: "committed", stagedVendorKey: staged.vendor.key });
    }
    if (input.checkpoint) await input.checkpoint("after_commit");
    return { run, staged };
  }

  recoverPreparedStarts(): void {
    for (let operation of this.ledger.snapshot().operations) {
      let run = this.store.getRun(operation.runId);
      if (operation.startTransaction.state === "rolled_back") continue;
      if (operation.startTransaction.state === "committed") {
        if (!run) {
          const at = this.now();
          this.store.upsertRun({
            id: operation.runId,
            vendorKey: operation.startTransaction.stagedVendorKey || operation.startTransaction.sourceVendorKey,
            lineageRootVendorKey: operation.lineageRootVendorKey,
            vendorName: operation.startTransaction.stagedVendorKey || operation.startTransaction.sourceVendorKey,
            connectionFingerprint: operation.credentialFingerprint || operation.contractDigest,
            selectedModelKeys: operation.startTransaction.selectedModels.map((model) => model.modelKey),
            stage: "failed",
            completedCount: 0,
            totalCount: operation.startTransaction.selectedModels.length,
            repairAttempt: 0,
            models: operation.startTransaction.selectedModels.map((model) => ({ ...model, modes: [] })),
            sourceUrls: [],
            error: "Committed certification lost its canonical run record and was recovered fail-closed.",
            recovery: { reasonCode: "certification_start_rolled_back", userAction: "restart_certification" },
            createdAt: operation.createdAt,
            updatedAt: at,
          });
        }
        continue;
      }
      const staged = operation.startTransaction.state === "catalog_staged"
        ? { vendorKey: operation.startTransaction.stagedVendorKey!, lineageRootVendorKey: operation.lineageRootVendorKey }
        : this.catalog.findStagedRun?.(operation.runId) || null;
      if (!run) {
        const at = this.now();
        run = this.store.upsertRun({
          id: operation.runId,
          vendorKey: staged?.vendorKey || operation.startTransaction.sourceVendorKey,
          lineageRootVendorKey: staged?.lineageRootVendorKey || operation.lineageRootVendorKey,
          vendorName: staged?.vendorKey || operation.startTransaction.sourceVendorKey,
          connectionFingerprint: operation.credentialFingerprint || operation.contractDigest,
          selectedModelKeys: operation.startTransaction.selectedModels.map((model) => model.modelKey),
          stage: "failed",
          completedCount: 0,
          totalCount: operation.startTransaction.selectedModels.length,
          repairAttempt: 0,
          models: operation.startTransaction.selectedModels.map((model) => ({ ...model, modes: [] })),
          sourceUrls: [],
          error: "Certification start was interrupted before its canonical run was persisted.",
          recovery: { reasonCode: "certification_start_rolled_back", userAction: "restart_certification" },
          createdAt: operation.createdAt,
          updatedAt: at,
        });
      }
      if (staged && run.stage !== "failed") {
        this.store.upsertRun({ ...run, vendorKey: staged.vendorKey, lineageRootVendorKey: staged.lineageRootVendorKey, updatedAt: this.now() });
        if (operation.startTransaction.state === "intent") operation = this.checkpointStart(operation.runId, { state: "run_persisted" });
        if (operation.startTransaction.state === "run_persisted") operation = this.checkpointStart(operation.runId, {
          state: "catalog_staged", stagedVendorKey: staged.vendorKey, lineageRootVendorKey: staged.lineageRootVendorKey,
        });
        if (operation.startTransaction.state === "catalog_staged") this.checkpointStart(operation.runId, { state: "committed", stagedVendorKey: staged.vendorKey });
        continue;
      }
      if (run.stage !== "failed") {
        const at = this.now();
        this.store.updateRun(run.id, (current) => ({ ...current, stage: "failed", error: "Certification start was safely rolled back after an interrupted local transaction.",
          recovery: { reasonCode: "certification_start_rolled_back", userAction: "restart_certification" }, updatedAt: at }));
      }
      if (staged) this.catalog.fail(run);
      this.checkpointStart(operation.runId, { state: "rolled_back" });
    }
  }

  cancelBeforeRemoteSettlement(runId: string): boolean {
    const operation = this.ledger.getByRunId(runId);
    if (!operation) return true;
    try {
      this.ledger.cancel(runId, {
        expectedRevision: operation.revision,
        leaseToken: operation.lease.token,
        now: this.now(),
      });
      return true;
    } catch {
      this.markSubmissionUnknown(runId, "submission_unknown");
      return false;
    }
  }

  resumeDisposition(run: ProviderAdapterRun, canReconcile: boolean): "schedule" | "wait" {
    let operation = this.ledger.getByRunId(run.id);
    if (!operation) return "schedule";
    for (const mode of Object.values(operation.modeOperations)) {
      if (mode.submissionState !== "submitting") continue;
      operation = this.ledger.markUnknown(run.id, {
        operationKey: mode.operationKey,
        expectedRevision: operation.revision,
        userAction: "reconcile_or_contact_provider",
        now: this.now(),
      });
    }
    this.syncRunOperationState(run.id, operation);
    const unresolved = Object.values(operation.modeOperations).filter((mode) =>
      mode.submissionState === "submitted" || mode.submissionState === "unknown",
    );
    if (unresolved.length) {
      const allReconcilable = unresolved.every((mode) => Boolean(mode.remoteTaskId));
      this.markSubmissionUnknown(run.id, allReconcilable ? "submission_unknown" : "submission_reconcile_unavailable");
      return allReconcilable && canReconcile ? "schedule" : "wait";
    }
    return "schedule";
  }

  async executeSubmission(input: {
    runId: string;
    operationKey: string;
    modelKey: string;
    taskKind: CertificationModeOperation["taskKind"];
    attempt: number;
    beforeSubmit?: () => void;
    execute: (onRemoteTaskAccepted: (remoteTaskId: string) => void) => Promise<AdapterVerificationResult>;
    reconcile?: (remoteTaskId: string) => Promise<AdapterVerificationResult>;
    reuse: (operation: CertificationModeOperation) => AdapterVerificationResult;
    isUncertainError: (error: unknown) => boolean;
  }): Promise<AdapterVerificationResult> {
    let operation = this.ledger.getByRunId(input.runId);
    if (!operation) throw new Error("Certification operation ledger entry is missing");
    const modeIdentity = certificationModeIdentity(input.modelKey, input.taskKind);
    const existingIndex = operation.modeOperationKeys[modeIdentity];
    let mode = existingIndex ? operation.modeOperations[existingIndex.operationKey] : undefined;
    try {
      let result: AdapterVerificationResult;
      if (mode?.submissionState === "unknown" || mode?.submissionState === "submitted") {
        if (!mode.remoteTaskId || !input.reconcile) {
          this.markSubmissionUnknown(input.runId, mode.remoteTaskId ? "submission_unknown" : "submission_reconcile_unavailable");
          throw new AdapterReconciliationRequiredError();
        }
        if (mode.submissionState === "unknown") {
          operation = this.ledger.markReconciled(input.runId, {
            operationKey: mode.operationKey,
            remoteTaskId: mode.remoteTaskId,
            expectedRevision: operation.revision,
            now: this.now(),
          });
          mode = operation.modeOperations[mode.operationKey];
        }
        result = await input.reconcile(mode.remoteTaskId!);
      } else if (mode?.submissionState === "settled" && input.attempt <= mode.attempt) {
        result = input.reuse(mode);
      } else {
        input.beforeSubmit?.();
        operation = this.ledger.markSubmitting(input.runId, {
          operationKey: input.operationKey,
          modelKey: input.modelKey,
          taskKind: input.taskKind,
          attempt: input.attempt,
          providerIdempotency: operation.providerIdempotency,
          expectedRevision: operation.revision,
          now: this.now(),
        });
        this.syncRunOperationState(input.runId, operation);
        result = await input.execute((remoteTaskId) => {
          const fresh = this.ledger.getByRunId(input.runId);
          const freshMode = fresh?.modeOperations[input.operationKey];
          if (!fresh || !freshMode) throw new Error("Certification mode disappeared before remote checkpoint");
          if (freshMode.submissionState === "submitted" && freshMode.remoteTaskId === remoteTaskId) return;
          const submitted = this.ledger.markSubmitted(input.runId, {
            operationKey: input.operationKey,
            remoteTaskId,
            expectedRevision: fresh.revision,
            now: this.now(),
          });
          this.syncRunOperationState(input.runId, submitted);
        });
      }
      operation = this.ledger.getByRunId(input.runId)!;
      mode = operation.modeOperations[input.operationKey] || operation.modeOperations[operation.modeOperationKeys[modeIdentity]?.operationKey];
      if (!mode) throw new Error("Certification mode operation is missing after verification");
      const unknown = result.submissionState === "unknown"
        || (!result.ok && (result.stage === "create" || result.stage === "poll")
          && (result.errorCategory === "network" || result.errorCategory === "timeout"));
      if (unknown) {
        if (mode.submissionState === "submitting" || mode.submissionState === "submitted") {
          operation = this.ledger.markUnknown(input.runId, {
            operationKey: mode.operationKey,
            expectedRevision: operation.revision,
            userAction: "reconcile_or_contact_provider",
            ...(result.remoteTaskId ? { remoteTaskId: result.remoteTaskId } : {}),
            now: this.now(),
          });
          this.syncRunOperationState(input.runId, operation);
        }
        this.markSubmissionUnknown(input.runId, mode.remoteTaskId || result.remoteTaskId ? "submission_unknown" : "submission_reconcile_unavailable");
        throw new AdapterReconciliationRequiredError();
      }
      if (mode.submissionState === "submitting" && result.remoteTaskId) {
        operation = this.ledger.markSubmitted(input.runId, {
          operationKey: mode.operationKey,
          remoteTaskId: result.remoteTaskId,
          expectedRevision: operation.revision,
          now: this.now(),
        });
        mode = operation.modeOperations[mode.operationKey];
      }
      if (mode.submissionState === "submitting" || mode.submissionState === "submitted") {
        operation = this.ledger.markSettled(input.runId, {
          operationKey: mode.operationKey,
          expectedRevision: operation.revision,
          ...(result.ok && result.mediaEvidence ? { artifactEvidence: result.mediaEvidence } : {}),
          result: settledResultFromVerification(result),
          now: this.now(),
        });
        this.syncRunOperationState(input.runId, operation);
      }
      return result;
    } catch (error) {
      if (error instanceof AdapterReconciliationRequiredError) throw error;
      const inFlight = this.ledger.getByRunId(input.runId);
      const inFlightMode = inFlight?.modeOperations[input.operationKey]
        || (inFlight ? inFlight.modeOperations[inFlight.modeOperationKeys[modeIdentity]?.operationKey] : undefined);
      if (input.isUncertainError(error) && inFlight && inFlightMode
        && (inFlightMode.submissionState === "submitting" || inFlightMode.submissionState === "submitted")) {
        const unknown = this.ledger.markUnknown(input.runId, {
          operationKey: inFlightMode.operationKey,
          expectedRevision: inFlight.revision,
          userAction: "reconcile_or_contact_provider",
          ...(inFlight.remoteTaskId ? { remoteTaskId: inFlight.remoteTaskId } : {}),
          now: this.now(),
        });
        this.syncRunOperationState(input.runId, unknown);
        this.markSubmissionUnknown(input.runId, inFlightMode.remoteTaskId ? "submission_unknown" : "submission_reconcile_unavailable");
        throw new AdapterReconciliationRequiredError();
      }
      throw error;
    }
  }

  private syncRunOperationState(runId: string, operation: CertificationOperationRecord): void {
    if (!this.store.getRun(runId)) return;
    const certificationOperations = Object.fromEntries(Object.entries(operation.modeOperationKeys).map(([identity, index]) => {
      const mode = operation.modeOperations[index.operationKey];
      return [identity, {
        operationKey: index.operationKey,
        submissionState: mode.submissionState,
        ...(mode.settledResult ? { settledResult: mode.settledResult } : {}),
      }];
    }));
    this.store.updateRun(runId, (run) => ({ ...run, certificationOperations }));
  }

  finishWithoutPromotion(run: ProviderAdapterRun): void {
    const operation = this.ledger.getByRunId(run.id);
    if (operation && !["cancelled", "superseded"].includes(operation.checkpoint)) {
      this.ledger.markCheckpoint(run.id, { checkpoint: "finalized", expectedRevision: operation.revision, now: this.now() });
    }
  }

  commitPromotion(input: {
    current: ProviderAdapterRun;
    completedRun: ProviderAdapterRun;
    draft: ProviderAdapterDraft;
    revision: ProviderAdapterRevision;
    verifiedModes: Array<{ modelKey: string; taskKind: ProfileKind }>;
  }): void {
    const operation = this.ledger.getByRunId(input.current.id);
    if (!operation) throw new Error("Certification operation ledger entry is missing before promotion");
    if (input.completedRun.error) {
      this.store.updateRun(input.current.id, (run) => ({ ...run, error: redactAdapterSecrets(input.completedRun.error || "") }));
    }
    this.store.upsertRevision(input.revision);
    this.journal.prepare({
      journalId: `promotion-${input.current.id}`,
      runId: input.current.id,
      lineageRootVendorKey: adapterRunLineageRoot(input.current),
      leaseToken: operation.lease.token,
      ...(input.current.activeRevision ? { expectedActiveRevision: input.current.activeRevision } : {}),
      proposedRevisionId: input.revision.id,
      contractDigest: operation.contractDigest,
      verifiedModes: input.verifiedModes,
      childRunRef: { runId: input.current.id, revisionDigest: input.revision.digest },
      terminalStage: input.completedRun.stage === "partial" ? "partial" : "completed",
      now: this.now(),
    });
    this.ledger.markCheckpoint(input.current.id, {
      checkpoint: "promotion_prepared",
      expectedRevision: operation.revision,
      now: this.now(),
    });
    this.replayPromotions();
    const entry = this.journal.get(`promotion-${input.current.id}`);
    if (entry?.state === "aborted") {
      const staleRun: ProviderAdapterRun = {
        ...input.completedRun,
        stage: "stale",
        activeRevision: entry.expectedActiveRevision,
        error: "A newer verification run replaced this result before promotion committed",
      };
      this.catalog.fail(staleRun);
      this.store.upsertRun(staleRun);
      this.store.deleteRevision(input.revision.id);
      const latest = this.ledger.getByRunId(input.current.id);
      if (latest && latest.checkpoint !== "superseded") {
        this.ledger.markCheckpoint(input.current.id, { checkpoint: "superseded", expectedRevision: latest.revision, now: this.now() });
      }
    }
  }

  replayPromotions(): void {
    const preexistingUnknown = new Set(
      this.journal.pendingEntries().filter((entry) => entry.state === "catalog_committing").map((entry) => entry.runId),
    );
    const catalogAccepted = new Set<string>();
    try {
      this.journal.replay({
        commitCatalog: (entry): ProviderAdapterPromotionResult => {
        const run = this.store.getRun(entry.runId);
        const revision = this.store.getRevision(entry.proposedRevisionId);
        if (!run || !revision) throw new Error("Prepared promotion references missing durable run state");
        const result = this.catalog.promote({
          run: { ...run, stage: entry.terminalStage || "completed", currentModelKey: undefined, activeRevision: entry.proposedRevisionId },
          draft: revision.draft,
          revision,
          verifiedModes: entry.verifiedModes,
        });
        if (result.status === "committed") catalogAccepted.add(entry.runId);
        return result;
      },
      finalizeRun: (entry) => {
        const run = this.store.getRun(entry.runId);
        const revision = this.store.getRevision(entry.proposedRevisionId);
        if (!run || !revision) throw new Error("Committed promotion references missing durable run state");
        const finalizedAt = this.now();
        this.store.finalizePromotion({
          runId: entry.runId,
          expectedActiveRevision: entry.expectedActiveRevision,
          revision,
          verifiedModes: entry.verifiedModes,
          terminalStage: entry.terminalStage || "completed",
          finalizedAt,
        });
        let operation = this.ledger.getByRunId(entry.runId);
        if (operation?.checkpoint === "promotion_prepared") {
          operation = this.ledger.markCheckpoint(entry.runId, { checkpoint: "promotion_committed", expectedRevision: operation.revision, now: finalizedAt });
        }
        if (operation && operation.checkpoint !== "finalized") {
          this.ledger.markCheckpoint(entry.runId, { checkpoint: "finalized", expectedRevision: operation.revision, now: finalizedAt });
        }
      },
      now: this.now,
      });
    } catch (error) {
      const recoveryRunIds = new Set([...preexistingUnknown, ...catalogAccepted]);
      for (const runId of recoveryRunIds) {
        try { this.markPromotionUnknown(runId); } catch { /* journal state remains the durable recovery authority */ }
      }
      if (recoveryRunIds.size) throw new AdapterPromotionRecoveryRequiredError([...recoveryRunIds]);
      throw error;
    }
  }

  private markPromotionUnknown(runId: string): void {
    const current = this.store.getRun(runId);
    if (!current || ["completed", "partial", "stale"].includes(current.stage)) return;
    const updatedAt = this.now();
    this.store.updateRun(runId, (run) => ({
      ...run,
      stage: "reconciling",
      error: "Catalog promotion may have committed. Nomi will replay the durable promotion journal before any further work.",
      recovery: { reasonCode: "promotion_commit_unknown", userAction: "reconcile_or_contact_provider" },
      stageStartedAt: updatedAt,
      lastProgressAt: updatedAt,
      updatedAt,
    }));
  }

  markSubmissionUnknown(runId: string, reasonCode: "submission_unknown" | "submission_reconcile_unavailable"): ProviderAdapterRun | undefined {
    const current = this.store.getRun(runId);
    if (!current) return current;
    const updatedAt = this.now();
    return this.store.updateRun(runId, (run) => ({
      ...run,
      stage: "reconciling",
      error: "Provider submission status is unknown. Nomi will not create another task automatically.",
      recovery: { reasonCode, userAction: "reconcile_or_contact_provider" },
      stageStartedAt: updatedAt,
      lastProgressAt: updatedAt,
      updatedAt,
    }));
  }
}
