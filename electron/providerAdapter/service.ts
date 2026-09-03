import crypto from "node:crypto";
import type { LanguageModelV1 } from "ai";
import type { OperationLedger } from "../integrationCertification/operationLedger";
import type { PromotionJournal } from "../integrationCertification/promotionJournal";
import {
  AdapterPromotionRecoveryRequiredError,
  AdapterReconciliationRequiredError,
  ProviderAdapterCertificationCoordinator,
  type CertificationStartCheckpoint,
} from "../integrationCertification/providerAdapterCoordinator";
import { certificationModeOperationKey } from "../integrationCertification/modeIdentity";
import { deriveVendorKeyFromBaseUrl } from "../catalog/catalogCommit";
import type { BillingModelKind, Model, Vendor } from "../catalog/types";
import { AdapterNeedsAiError, compileProviderAdapter, repairProviderAdapter } from "./compiler";
import { discoverProviderDocs, type DiscoveredDocs } from "./docsDiscovery";
import { builtinDraftForUndocumentedEndpoint } from "./builtinOpenAiCompatibleDraft";
import {
  connectionFingerprint,
  isTerminalAdapterStage,
  ProviderAdapterStore,
  recoverableAdapterRuns,
} from "./store";
import type {
  AdapterAuthType,
  ProviderAdapterCertificationInput,
  ProviderAdapterCompilation,
  ProviderAdapterCompileFailure,
  ProviderAdapterDraft,
  ProviderAdapterRegisterInput,
  ProviderAdapterRegistration,
  ProviderAdapterRun,
} from "./types";
import { verifyAdapterMode, type AdapterVerificationResult } from "./verifier";
import { redactAdapterSecrets } from "./redaction";
import { defaultCatalog, type LoadedConnection, type ProviderAdapterCatalogPort } from "./serviceCatalog";
import { AdapterWaitError, awaitAdapterStep, deadlineExpired, deadlineFrom } from "./serviceLifecycle";
import {
  compileErrorBanner,
  completedModelCount,
  genericCompilation,
  withTextModels,
} from "./serviceFallback";
import { compileMediaModels } from "./serviceCompilation";
import { normalizeProviderAdapterInput, registerProviderConnection } from "./registration";
import {
  activeRunsSupersededBy,
  adapterRunLineageRoot,
  buildTerminalFailureRun,
  latestRunInLineage,
  planAdapterPromotionFinal,
  staleAdapterRun,
  type ModeResultWithModel,
} from "./serviceRunLifecycle";
import { defaultResolveLanguageModels } from "./serviceLanguageModels";
import {
  initialVerificationState,
  modeResultFromVerification,
  persistedModeResult,
} from "./serviceVerificationResults";

export { adapterModelMetadataForPromotion } from "./promotionMeta";
export { prioritizeCompilerCandidates } from "./compilerCandidatePriority";
export { defaultCatalog } from "./serviceCatalog";
export type { ProviderAdapterCatalogPort } from "./serviceCatalog";

export type ProviderAdapterStartInput = ProviderAdapterCertificationInput;
export type { ProviderAdapterRegisterInput, ProviderAdapterRegistration } from "./types";

export type ProviderAdapterServiceDependencies = {
  catalog: ProviderAdapterCatalogPort;
  schedule?: (runId: string) => void;
  discover: (input: { baseUrl: string; modelKeys: readonly string[]; proxyUrl?: string; signal?: AbortSignal }) => Promise<DiscoveredDocs>;
  resolveLanguageModels: (connection: LoadedConnection) => readonly LanguageModelV1[];
  compile: (input: {
    languageModels: readonly LanguageModelV1[];
    providerBaseUrl: string;
    authType: AdapterAuthType;
    selectedModels: Array<{ modelKey: string; label: string; kind: BillingModelKind }>;
    docs: DiscoveredDocs["sources"];
    signal?: AbortSignal;
  }) => Promise<ProviderAdapterCompilation>;
  repair: (input: {
    languageModels: readonly LanguageModelV1[];
    providerBaseUrl: string;
    selectedModelKeys: readonly string[];
    previousDraft: ProviderAdapterDraft;
    failure: { stage: string; message: string; modelKey?: string; taskKind?: string; requestSummary?: unknown };
    docs: DiscoveredDocs["sources"];
    signal?: AbortSignal;
  }) => Promise<ProviderAdapterDraft>;
  verify: (input: {
    vendor: Vendor;
    model: Model;
    apiKey: string;
    mode: ProviderAdapterDraft["models"][number]["modes"][number];
    onRemoteTaskAccepted?: (remoteTaskId: string) => void;
    signal?: AbortSignal;
  }) => Promise<AdapterVerificationResult>;
  reconcile?: (input: {
    vendor: Vendor;
    model: Model;
    apiKey: string;
    mode: ProviderAdapterDraft["models"][number]["modes"][number];
    remoteTaskId: string;
    signal?: AbortSignal;
  }) => Promise<AdapterVerificationResult>;
  operationLedger?: OperationLedger;
  promotionJournal?: PromotionJournal;
  now: () => string;
  id: () => string;
  maxRepairs?: number;
  batchTimeoutMs?: number;
  discoverTimeoutMs?: number;
  compileTimeoutMs?: number;
  repairTimeoutMs?: number;
  verifyTimeoutMs?: number;
  canonicalStartWaitMs?: number;
  certificationCheckpoint?: (checkpoint: CertificationStartCheckpoint) => void | Promise<void>;
};

const defaultDependencies: ProviderAdapterServiceDependencies = {
  catalog: defaultCatalog,
  discover: ({ baseUrl, modelKeys, proxyUrl, signal }) => discoverProviderDocs({ baseUrl, modelKeys, proxyUrl, signal }),
  resolveLanguageModels: defaultResolveLanguageModels,
  compile: (input) => compileProviderAdapter(input),
  repair: (input) => repairProviderAdapter(input),
  verify: (input) => verifyAdapterMode(input),
  now: () => new Date().toISOString(),
  id: () => `adapter-run-${crypto.randomUUID()}`,
  maxRepairs: 2,
  batchTimeoutMs: 5 * 60_000,
  discoverTimeoutMs: 45_000,
  compileTimeoutMs: 120_000,
  repairTimeoutMs: 90_000,
  verifyTimeoutMs: 90_000,
};

export class ProviderAdapterService {
  private readonly dependencies: ProviderAdapterServiceDependencies;
  private readonly active = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly certification: ProviderAdapterCertificationCoordinator;

  constructor(
    private readonly store = new ProviderAdapterStore(),
    dependencies: Partial<ProviderAdapterServiceDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
    this.certification = new ProviderAdapterCertificationCoordinator(
      this.store,
      this.dependencies.catalog,
      this.dependencies.now,
      {
        operationLedger: dependencies.operationLedger,
        promotionJournal: dependencies.promotionJournal,
        canonicalStartWaitMs: dependencies.canonicalStartWaitMs,
      },
    );
  }

  register(rawInput: ProviderAdapterRegisterInput): ProviderAdapterRegistration {
    return registerProviderConnection({
      rawInput,
      catalog: this.dependencies.catalog,
      now: this.dependencies.now,
    });
  }

  async start(rawInput: ProviderAdapterStartInput): Promise<ProviderAdapterRun> {
    const input = normalizeProviderAdapterInput(rawInput, "verify");
    const vendorKey = String(input.catalogVendorKey || "").trim() || deriveVendorKeyFromBaseUrl(input.baseUrl);
    if (!vendorKey) throw new Error("Unable to derive a provider id from the API base URL");
    const id = this.dependencies.id();
    const prepared = await this.certification.prepareStart(input, id, vendorKey);
    if (prepared.duplicate) return prepared.duplicate;
    const timestamp = this.dependencies.now();
    if (!prepared.operation) throw new Error("Certification start reservation is missing");
    const { run, staged } = await this.certification.completePreparedStart({
      connection: input,
      operation: prepared.operation,
      sourceVendorKey: vendorKey,
      connectionFingerprint: connectionFingerprint({
        baseUrl: input.baseUrl,
        authType: input.authType,
        apiKey: input.apiKey,
        selectedModelKeys: input.models.map((model) => model.modelKey),
        headers: input.headers,
        proxyUrl: input.proxyUrl,
      }),
      deadlineAt: deadlineFrom(timestamp, this.dependencies.batchTimeoutMs ?? 5 * 60_000),
      checkpoint: this.dependencies.certificationCheckpoint,
    });
    this.supersedeActiveLineageRuns(
      run.id,
      staged.lineageRootVendorKey,
      new Set(staged.supersededVendorKeys),
      timestamp,
    );
    this.schedule(run.id);
    return run;
  }

  // Pure pass-through delegators to store/certification (grouped tightly).
  getRun(id: string): ProviderAdapterRun | undefined {
    return this.store.getRun(id);
  }
  certificationChildRunRef(id: string) {
    return this.certification.childRunRef(id);
  }
  certificationSourceVendorKey(id: string) {
    return this.certification.sourceVendorKey(id);
  }
  latestRun(vendorKey: string): ProviderAdapterRun | undefined {
    return this.store.latestRun(vendorKey);
  }
  listRuns(options: { vendorKey?: string; activeOnly?: boolean; limit?: number } = {}): ProviderAdapterRun[] {
    return this.store.listRuns(options);
  }
  cancel(id: string): ProviderAdapterRun | undefined {
    const current = this.store.getRun(id);
    if (!current || isTerminalAdapterStage(current.stage)) return current;
    if (!this.certification.cancelBeforeRemoteSettlement(id)) {
      this.controllers.get(id)?.abort();
      return this.store.getRun(id);
    }
    const run = this.finishTerminal(id, "cancelled", "Adapter verification cancelled by user");
    this.controllers.get(id)?.abort();
    return run;
  }
  resumeInterrupted(): void {
    this.certification.recoverPreparedStarts();
    try {
      this.certification.replayPromotions();
    } catch (error) {
      if (!(error instanceof AdapterPromotionRecoveryRequiredError)) throw error;
    }
    for (const run of recoverableAdapterRuns(this.store.snapshot().runs)) {
      if (run.recovery?.reasonCode === "promotion_commit_unknown") continue;
      if (this.certification.resumeDisposition(run, Boolean(this.dependencies.reconcile)) === "wait") continue;
      const deadlineAt = run.deadlineAt || deadlineFrom(run.createdAt, this.dependencies.batchTimeoutMs ?? 5 * 60_000);
      if (deadlineExpired(deadlineAt, this.dependencies.now())) {
        this.finishTerminal(run.id, "timed_out", "Adapter run deadline expired before it could resume");
        continue;
      }
      this.schedule(run.id);
    }
  }

  async executeRun(id: string): Promise<void> {
    const existing = this.active.get(id);
    if (existing) return existing;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const work = this.process(id).finally(() => {
      this.active.delete(id);
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    });
    this.active.set(id, work);
    return work;
  }

  private schedule(id: string): void {
    if (this.dependencies.schedule) this.dependencies.schedule(id);
    else queueMicrotask(() => void this.executeRun(id));
  }

  private async process(id: string): Promise<void> {
    let initial = this.store.getRun(id);
    if (!initial || isTerminalAdapterStage(initial.stage)) return;
    if (!initial.deadlineAt) {
      initial = this.store.updateRun(id, (current) => ({
        ...current,
        deadlineAt: deadlineFrom(current.createdAt, this.dependencies.batchTimeoutMs ?? 5 * 60_000),
      }));
    }
    if (deadlineExpired(initial.deadlineAt, this.dependencies.now())) {
      this.finishTerminal(id, "timed_out", "Adapter run deadline expired before execution");
      return;
    }
    if (this.markStaleIfSuperseded(initial)) return;
    const connection = this.dependencies.catalog.load(initial.vendorKey, initial.selectedModelKeys);
    if (!connection) {
      this.finishWithError(id, "failed", "Provider credentials or selected models are no longer available");
      return;
    }
    const fingerprint = connectionFingerprint({
      baseUrl: String(connection.vendor.baseUrlHint || ""),
      authType: connection.vendor.authType || "bearer",
      apiKey: connection.apiKey,
      selectedModelKeys: initial.selectedModelKeys,
      headers: connection.headers,
      proxyUrl: connection.vendor.network?.proxyUrl,
    });
    if (fingerprint !== initial.connectionFingerprint) {
      const staleAt = this.dependencies.now();
      const stale: ProviderAdapterRun = {
        ...initial,
        stage: "stale",
        error: "Provider connection changed before verification completed",
        currentModelKey: undefined,
        stageStartedAt: staleAt,
        lastProgressAt: staleAt,
        updatedAt: staleAt,
      };
      this.dependencies.catalog.fail(stale);
      this.store.upsertRun(stale);
      return;
    }

    try {
      // 自建/局域网端点没有公开文档可读（为什么见 builtinOpenAiCompatibleDraft 头注释）：不猜文档、
      // 不叫 AI，直接用内置 OpenAI 兼容契约进真实验证。必须在下面的分级之前——媒体模型也一样适用。
      const builtinDraft = builtinDraftForUndocumentedEndpoint(connection);
      if (builtinDraft) {
        const builtin = genericCompilation(connection, connection.models);
        const verification = await this.verifyDraft(id, connection, builtin.draft, 1, builtin.failures);
        await this.promoteFinal(
          id,
          builtin.draft,
          verification.results,
          verification.deadlineError,
          Boolean(verification.deadlineError),
        );
        return;
      }
      // 分级（2026-08-12）：只有「Nomi 不知道接法」的模型才值得查文档 + AI 编译。
      // 文本的接法全行业已统一到 OpenAI /v1/chat/completions（DeepSeek、Kimi、GLM、Qwen、
      // 阶跃、MiniMax、豆包、xAI、Mistral 全是；Anthropic、Gemini 也都开了兼容层），
      // 何况文本验证走 streamTextTask（生产同一条路）、根本不读编译出来的草稿——
      // 编译它纯属白花时间，还平添「文档没抓到 / 编译失败」这些真实使用路径没有的失败模式。
      // 旧行为：全部无差别走完整流程，两个 DeepSeek 文本模型烧掉 132 秒后判死。
      const mediaModels = connection.models.filter((model) => model.kind !== "text");
      const needsCompile = mediaModels.length > 0;
      let docs: DiscoveredDocs = { sources: [], corpus: "" };
      let compilation = genericCompilation(connection, []);
      let compiledModelKeys = new Set<string>();
      const languageModels = needsCompile ? this.dependencies.resolveLanguageModels(connection) : [];
      if (needsCompile) {
        this.setStage(id, "discovering_docs");
        try {
          docs = await this.awaitStep(id, "Document discovery", this.dependencies.discoverTimeoutMs ?? 45_000, (signal) =>
            this.dependencies.discover({
              baseUrl: String(connection.vendor.baseUrlHint || ""),
              modelKeys: mediaModels.map((model) => model.modelKey),
              proxyUrl: connection.vendor.network?.proxyUrl,
              signal,
            }),
          );
        } catch (error) {
          if (error instanceof AdapterWaitError && error.reason !== "step_timeout") throw error;
          docs = { sources: [], corpus: "" };
        }
        if (docs.sources.length > 0 && docs.corpus.trim()) {
          this.updateRunIfActive(id, (run) => ({
            ...run,
            sourceUrls: docs.sources.map((source) => source.url),
            lastProgressAt: this.dependencies.now(),
            updatedAt: this.dependencies.now(),
          }));
        }
        const compiled = await compileMediaModels({
          connection,
          models: mediaModels,
          docs,
          languageModels,
          onModel: (modelKey) => this.setStage(id, "compiling", modelKey),
          compileOne: (model) => this.awaitStep(
            id,
            `Adapter compilation for ${model.modelKey}`,
            this.dependencies.compileTimeoutMs ?? 120_000,
            (signal) => this.dependencies.compile({
              languageModels,
              providerBaseUrl: String(connection.vendor.baseUrlHint || ""),
              authType: (connection.vendor.authType || "bearer") as AdapterAuthType,
              selectedModels: [{ modelKey: model.modelKey, label: model.labelZh, kind: model.kind }],
              docs: docs.sources,
              signal,
            }),
          ),
        });
        compilation = compiled.compilation;
        compiledModelKeys = compiled.compiledModelKeys;
      }
      // 文本条目不经 AI：接法固定、模式表也固定（chat）。合进草稿只为让验证与展示有位置。
      // 文本条目**以这里为单一真相**——编译器万一也吐了同名文本条目（误分类/被喂了不该喂的），
      // 一律以这份为准替换掉，否则同一个模型会出现两条、验证跑两遍（有回归钉子）。
      const textModels = connection.models.filter((model) => model.kind === "text");
      let candidate: ProviderAdapterDraft = {
        ...compilation.draft,
        models: withTextModels(compilation.draft.models, textModels),
      };
      let verification = await this.verifyDraft(id, connection, candidate, 1, compilation.failures);
      let results = verification.results;
      if (verification.deadlineError) {
        await this.promoteFinal(id, candidate, results, verification.deadlineError, true);
        return;
      }
      const maxRepairs = this.dependencies.maxRepairs ?? 2;
      let repairError: string | undefined;
      let deadlineReached = false;
      // 自动修复重新生成的是「HTTP 接法草稿」，而文本模型的验证走 streamTextTask（生产同一条路）、
      // 压根不读这份草稿——对文本失败重修等于原样再发一次同样的请求，必然同样失败。
      // 旧行为：白转 2 轮、界面还写着「正在根据真实错误自动修复…」（假的），用户干等 2 分钟拿同一个结果。
      // 只让「修得动的」失败（真正按草稿发请求的非文本模型）触发重修。(2026-08-12)
      const repairableKeys = compiledModelKeys;
      for (let repairAttempt = 1; repairAttempt <= maxRepairs; repairAttempt += 1) {
        const compiledKeys = new Set(candidate.models.map((model) => model.modelKey));
        const failure = results.find(
          (result) => result.state === "failed" && compiledKeys.has(result.modelKey) && repairableKeys.has(result.modelKey),
        );
        if (!failure) break;
        this.setStage(id, "repairing", failure.modelKey, { repairAttempt });
        try {
          // 只让重修碰它修得动的那些模型，修完再把文本条目按单一真相合回去——
          // 否则重修会顺手用 AI 重新生成文本条目，把确定性的那份覆盖掉。
          const repaired = await this.awaitStep(id, "Adapter repair", this.dependencies.repairTimeoutMs ?? 90_000, (signal) =>
            this.dependencies.repair({
              languageModels,
              providerBaseUrl: String(connection.vendor.baseUrlHint || ""),
              selectedModelKeys: candidate.models.filter((model) => repairableKeys.has(model.modelKey)).map((model) => model.modelKey),
              previousDraft: candidate,
              failure: {
                stage: failure.stage || "create",
                message: failure.error || "Unknown verification failure",
                modelKey: failure.modelKey,
                taskKind: failure.taskKind,
              },
              docs: docs.sources,
              signal,
            }),
          );
          candidate = { ...repaired, models: withTextModels(repaired.models, textModels) };
        } catch (error) {
          if (error instanceof AdapterWaitError) {
            if (error.reason === "cancelled" || error.reason === "terminal") throw error;
            repairError = error.message;
            deadlineReached = error.reason === "deadline";
            break;
          }
          repairError = redactAdapterSecrets(error instanceof Error ? error.message : String(error));
          break;
        }
        // Full regression after every repair: a local fix must not break a mode that previously passed.
        verification = await this.verifyDraft(id, connection, candidate, repairAttempt + 1, compilation.failures);
        results = verification.results;
        if (verification.deadlineError) {
          repairError = verification.deadlineError;
          deadlineReached = true;
          break;
        }
      }
      const compileError = compileErrorBanner(compilation.failures);
      await this.promoteFinal(
        id,
        candidate,
        results,
        [compileError, repairError].filter(Boolean).join("; ") || undefined,
        deadlineReached,
      );
    } catch (error) {
      if (error instanceof AdapterWaitError) {
        if (error.reason === "cancelled" || error.reason === "terminal") return;
        this.finishTerminal(id, "timed_out", error.message);
      } else if (error instanceof AdapterReconciliationRequiredError || error instanceof AdapterPromotionRecoveryRequiredError) {
        // The durable ledger is the authority. Keep the candidate staged and wait
        // for an explicit remote reconciliation; never turn uncertainty into retry.
        return;
      } else if (error instanceof AdapterNeedsAiError) this.finishWithError(id, "needs_ai", error.message);
      else this.finishWithError(id, "failed", error instanceof Error ? error.message : String(error));
    }
  }

  private async verifyDraft(
    id: string,
    connection: LoadedConnection,
    draft: ProviderAdapterDraft,
    attempt: number,
    compileFailures: readonly ProviderAdapterCompileFailure[] = [],
  ): Promise<{ results: ModeResultWithModel[]; deadlineError?: string }> {
    const initial = initialVerificationState({ connection, draft, compileFailures, attempt });
    const testingAt = this.dependencies.now();
    this.updateRunIfActive(id, (run) => ({
      ...run,
      stage: "testing",
      currentModelKey: undefined,
      models: initial.models,
      completedCount: completedModelCount(initial.models),
      totalCount: connection.models.length,
      stageStartedAt: testingAt,
      lastProgressAt: testingAt,
      updatedAt: testingAt,
    }));
    const results = initial.results;
    let deadlineError: string | undefined;
    for (const candidateModel of draft.models) {
      const model = connection.models.find((item) => item.modelKey === candidateModel.modelKey);
      if (!model) throw new Error(`Selected model disappeared during verification: ${candidateModel.modelKey}`);
      for (const mode of candidateModel.modes) {
        this.updateRunIfActive(id, (run) => ({
          ...run,
          currentModelKey: candidateModel.modelKey,
          models: run.models.map((item) =>
            item.modelKey === candidateModel.modelKey
              ? {
                  ...item,
                  modes: item.modes.map((state) =>
                    state.taskKind === mode.taskKind ? { ...state, state: "testing" } : state,
                  ),
                }
              : item,
          ),
          lastProgressAt: this.dependencies.now(),
          updatedAt: this.dependencies.now(),
        }));
        let verified: AdapterVerificationResult;
        try {
          const operationKey = certificationModeOperationKey(candidateModel.modelKey, mode.taskKind, attempt);
          verified = await this.certification.executeSubmission({
            runId: id,
            operationKey,
            modelKey: candidateModel.modelKey,
            taskKind: mode.taskKind,
            attempt,
            beforeSubmit: () => {
              const beforeCreate = this.store.getRun(id);
              if (!beforeCreate || isTerminalAdapterStage(beforeCreate.stage)) {
                throw new AdapterWaitError("terminal", "Model verification", "Model verification ignored because the run is terminal");
              }
              if (deadlineExpired(beforeCreate.deadlineAt, this.dependencies.now())) {
                throw new AdapterWaitError(
                  "deadline",
                  "Model verification",
                  "Model verification stopped because the adapter run deadline was reached",
                );
              }
            },
            execute: (onRemoteTaskAccepted) => this.awaitStep(id, "Model verification", this.dependencies.verifyTimeoutMs ?? 90_000, (signal) =>
              this.dependencies.verify({ vendor: connection.vendor, model, apiKey: connection.apiKey, mode, signal, onRemoteTaskAccepted }),
            ),
            ...(this.dependencies.reconcile
              ? { reconcile: (remoteTaskId: string) => this.awaitStep(
                  id,
                  "Model submission reconciliation",
                  this.dependencies.verifyTimeoutMs ?? 90_000,
                  (signal) => this.dependencies.reconcile!({
                    vendor: connection.vendor,
                    model,
                    apiKey: connection.apiKey,
                    mode,
                    remoteTaskId,
                    signal,
                  }),
                ) }
              : {}),
            reuse: (operation) => {
              const persisted = this.store.getRun(id)?.models
                .find((item) => item.modelKey === candidateModel.modelKey)?.modes
                .find((item) => item.taskKind === mode.taskKind);
              return operation.settledResult?.ok === false || persisted?.state === "failed"
                ? {
                    ok: false as const,
                    taskKind: mode.taskKind,
                    stage: persisted?.stage === "localize_reference" || persisted?.stage === "poll" || persisted?.stage === "verify_asset"
                      ? persisted.stage
                      : operation.settledResult?.stage === "localize_reference"
                        || operation.settledResult?.stage === "poll"
                        || operation.settledResult?.stage === "verify_asset"
                        ? operation.settledResult.stage
                      : "create" as const,
                    error: persisted?.error || "Provider verification failed",
                    errorCategory: persisted?.errorCategory || operation.settledResult?.errorCategory,
                    httpStatus: persisted?.httpStatus,
                    submissionState: "settled" as const,
                  }
                : {
                    ok: true as const,
                    taskKind: mode.taskKind,
                    mediaEvidence: operation.artifactEvidence,
                    remoteTaskId: operation.remoteTaskId,
                    submissionState: "settled" as const,
                  };
            },
            isUncertainError: (error) => error instanceof AdapterWaitError
              && error.reason !== "cancelled" && error.reason !== "terminal",
          });
        } catch (error) {
          if (error instanceof AdapterReconciliationRequiredError) throw error;
          if (!(error instanceof AdapterWaitError)) throw error;
          if (error.reason === "cancelled" || error.reason === "terminal") throw error;
          if (error.reason === "deadline") deadlineError = error.message;
          verified = {
            ok: false,
            taskKind: mode.taskKind,
            stage: "verify_asset",
            error: error.message,
            errorCategory: "network",
          };
        }
        const modeResult = modeResultFromVerification({
          modelKey: candidateModel.modelKey,
          attempt,
          verifiedAt: this.dependencies.now(),
          verification: verified,
        });
        results.push(modeResult);
        const persisted = persistedModeResult(modeResult);
        this.updateRunIfActive(id, (run) => {
          const models = run.models.map((item) =>
            item.modelKey === candidateModel.modelKey
              ? { ...item, modes: item.modes.map((state) => (state.taskKind === mode.taskKind ? persisted : state)) }
              : item);
          const progressAt = this.dependencies.now();
          return {
            ...run,
            models,
            completedCount: completedModelCount(models),
            lastProgressAt: progressAt,
            updatedAt: progressAt,
          };
        });
      }
    }
    return { results, ...(deadlineError ? { deadlineError } : {}) };
  }

  private async promoteFinal(
    id: string,
    draft: ProviderAdapterDraft,
    results: ModeResultWithModel[],
    repairError?: string,
    deadlineReached = false,
  ): Promise<void> {
    const current = this.store.getRun(id);
    if (!current || isTerminalAdapterStage(current.stage) || this.markStaleIfSuperseded(current)) return;
    const { verifiedModes, revision, completedRun } = planAdapterPromotionFinal({
      current,
      draft,
      results,
      repairError,
      deadlineReached,
      completedAt: this.dependencies.now(),
    });
    // A zero-pass run has no publishable contract. Cleanup is the durable result;
    // only persist the terminal run after catalog cleanup succeeds.
    if (verifiedModes.length === 0) {
      this.dependencies.catalog.fail(completedRun);
      this.store.upsertRun(completedRun);
      this.certification.finishWithoutPromotion(completedRun);
      return;
    }
    this.certification.commitPromotion({
      current,
      completedRun,
      draft,
      revision,
      verifiedModes,
    });
  }

  private setStage(
    id: string,
    stage: ProviderAdapterRun["stage"],
    currentModelKey?: string,
    extra: Partial<Pick<ProviderAdapterRun, "repairAttempt">> = {},
  ): void {
    const stageStartedAt = this.dependencies.now();
    this.updateRunIfActive(id, (run) => ({
      ...run,
      ...extra,
      stage,
      currentModelKey,
      stageStartedAt,
      lastProgressAt: stageStartedAt,
      updatedAt: stageStartedAt,
    }));
  }

  private finishWithError(id: string, stage: "failed" | "needs_ai", message: string): void {
    this.finishRunWithFailure(id, stage, message);
  }

  private finishTerminal(
    id: string,
    stage: "cancelled" | "timed_out",
    message: string,
  ): ProviderAdapterRun | undefined {
    try {
      return this.finishRunWithFailure(id, stage, message);
    } finally {
      this.controllers.get(id)?.abort();
    }
  }

  private finishRunWithFailure(
    id: string,
    stage: "failed" | "needs_ai" | "cancelled" | "timed_out",
    message: string,
  ): ProviderAdapterRun | undefined {
    const existing = this.store.getRun(id);
    if (!existing || isTerminalAdapterStage(existing.stage)) return existing;
    const failureStage = existing.stage === "discovering_docs"
      ? "docs"
      : existing.stage === "compiling"
        ? "compile"
        : existing.stage === "testing"
          ? "verify_asset"
          : "promote";
    const error = redactAdapterSecrets(message);
    const finishedAt = this.dependencies.now();
    const run = buildTerminalFailureRun({
      existing,
      stage,
      error,
      failureStage,
      finishedAt,
    });
    this.dependencies.catalog.fail(run);
    this.store.upsertRun(run);
    return run;
  }

  private updateRunIfActive(
    id: string,
    update: (current: ProviderAdapterRun) => ProviderAdapterRun,
  ): ProviderAdapterRun | undefined {
    const current = this.store.getRun(id);
    if (!current || isTerminalAdapterStage(current.stage)) return current;
    return this.store.updateRun(id, (fresh) => isTerminalAdapterStage(fresh.stage) ? fresh : update(fresh));
  }

  private async awaitStep<T>(
    id: string,
    step: string,
    timeoutMs: number,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const run = this.store.getRun(id);
    if (!run || isTerminalAdapterStage(run.stage)) {
      throw new AdapterWaitError("terminal", step, `${step} ignored because the run is already terminal`);
    }
    const controller = this.controllers.get(id);
    if (!controller) throw new AdapterWaitError("terminal", step, `${step} has no active execution`);
    const result = await awaitAdapterStep({
      signal: controller.signal,
      deadlineAt: run.deadlineAt,
      now: this.dependencies.now(),
      timeoutMs,
      step,
      operation,
    });
    const latest = this.store.getRun(id);
    if (!latest || isTerminalAdapterStage(latest.stage)) {
      throw new AdapterWaitError("terminal", step, `${step} finished after the run became terminal`);
    }
    return result;
  }

  private markStaleIfSuperseded(run: ProviderAdapterRun): boolean {
    if (isTerminalAdapterStage(run.stage)) return true;
    const lineageRoot = adapterRunLineageRoot(run);
    const latest = latestRunInLineage(this.store.snapshot().runs, lineageRoot);
    if (!latest || latest.id === run.id) return false;
    const staleAt = this.dependencies.now();
    const stale = staleAdapterRun(run, staleAt, "A newer verification run replaced this result");
    this.dependencies.catalog.fail(stale);
    this.store.upsertRun(stale);
    this.controllers.get(run.id)?.abort();
    return true;
  }

  private supersedeActiveLineageRuns(
    nextRunId: string,
    lineageRootVendorKey: string,
    supersededVendorKeys: ReadonlySet<string>,
    staleAt: string,
  ): void {
    const superseded = activeRunsSupersededBy({
      runs: this.store.snapshot().runs,
      nextRunId,
      lineageRootVendorKey,
      supersededVendorKeys,
    });
    for (const current of superseded) {
      const stale = staleAdapterRun(current, staleAt, "A newer verification run replaced this result");
      // stage() removes superseded candidate rows atomically; fail() is an
      // idempotent lifecycle acknowledgement for alternate catalog ports.
      this.dependencies.catalog.fail(stale);
      this.store.upsertRun(stale);
      this.controllers.get(current.id)?.abort();
    }
  }
}

let singleton: ProviderAdapterService | null = null;

export function getProviderAdapterService(): ProviderAdapterService {
  singleton ||= new ProviderAdapterService();
  return singleton;
}
