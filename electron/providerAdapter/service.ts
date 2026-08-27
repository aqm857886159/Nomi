import crypto from "node:crypto";
import type { LanguageModelV1 } from "ai";
import { buildLanguageModelForVendor } from "../ai/vendorLanguageModel";
import { readCatalog } from "../catalog/catalogStore";
import { deriveVendorKeyFromBaseUrl } from "../catalog/catalogCommit";
import { decryptApiKeyRecord } from "../catalog/secrets";
import type { BillingModelKind, Model, Vendor } from "../catalog/types";
import { humanizeModelKey } from "../catalog/modelLabel";
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
  AdapterModeResult,
  ProviderAdapterConnectionInput,
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
  completedModelCount,
  genericCompilation,
  primaryTaskKind,
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
import { prioritizeCompilerCandidates } from "./compilerCandidatePriority";

export { adapterModelMetadataForPromotion } from "./promotionMeta";
export { prioritizeCompilerCandidates } from "./compilerCandidatePriority";
export { defaultCatalog } from "./serviceCatalog";
export type { ProviderAdapterCatalogPort } from "./serviceCatalog";

export type ProviderAdapterStartInput = ProviderAdapterConnectionInput;
export type { ProviderAdapterRegisterInput, ProviderAdapterRegistration } from "./types";

export type ProviderAdapterServiceDependencies = {
  catalog: ProviderAdapterCatalogPort;
  schedule?: (runId: string) => void;
  discover: (input: { baseUrl: string; modelKeys: readonly string[]; signal?: AbortSignal }) => Promise<DiscoveredDocs>;
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
    signal?: AbortSignal;
  }) => Promise<AdapterVerificationResult>;
  now: () => string;
  id: () => string;
  maxRepairs?: number;
  batchTimeoutMs?: number;
  discoverTimeoutMs?: number;
  compileTimeoutMs?: number;
  repairTimeoutMs?: number;
  verifyTimeoutMs?: number;
};

function defaultResolveLanguageModels(connection: LoadedConnection): LanguageModelV1[] {
  const state = readCatalog();
  const candidates: Array<{ vendorKey: string; modelKey: string; languageModel: LanguageModelV1 }> = [];
  for (const model of state.models) {
    if (model.kind !== "text" || !model.enabled) continue;
    const vendor = state.vendors.find((item) => item.key === model.vendorKey && item.enabled && item.baseUrlHint);
    if (!vendor || (vendor.authType && vendor.authType !== "none" && vendor.authType !== "bearer")) continue;
    const apiKey = vendor.authType === "none" ? "" : decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]);
    if (vendor.authType !== "none" && !apiKey) continue;
    candidates.push({
      vendorKey: vendor.key,
      modelKey: model.modelKey,
      languageModel: buildLanguageModelForVendor(vendor, model, apiKey),
    });
  }
  const selectedText = connection.models.find((model) => model.kind === "text");
  if (selectedText) {
    candidates.push({
      vendorKey: connection.vendor.key,
      modelKey: selectedText.modelKey,
      languageModel: buildLanguageModelForVendor(connection.vendor, selectedText, connection.apiKey),
    });
  }
  const seen = new Set<string>();
  return prioritizeCompilerCandidates(candidates, connection.vendor.key)
    .filter((candidate) => {
      const key = `${candidate.vendorKey}\0${candidate.modelKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4)
    .map((candidate) => candidate.languageModel);
}

const defaultDependencies: ProviderAdapterServiceDependencies = {
  catalog: defaultCatalog,
  discover: ({ baseUrl, modelKeys, signal }) => discoverProviderDocs({ baseUrl, modelKeys, signal }),
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

  constructor(
    private readonly store = new ProviderAdapterStore(),
    dependencies: Partial<ProviderAdapterServiceDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  register(rawInput: ProviderAdapterRegisterInput): ProviderAdapterRegistration {
    return registerProviderConnection({
      rawInput,
      catalog: this.dependencies.catalog,
      now: this.dependencies.now,
    });
  }

  start(rawInput: ProviderAdapterStartInput): ProviderAdapterRun {
    const input = normalizeProviderAdapterInput(rawInput, "verify");
    const vendorKey = String(input.catalogVendorKey || "").trim() || deriveVendorKeyFromBaseUrl(input.baseUrl);
    if (!vendorKey) throw new Error("Unable to derive a provider id from the API base URL");
    const id = this.dependencies.id();
    const staged = this.dependencies.catalog.stage({ ...input, vendorKey, runId: id });
    const timestamp = this.dependencies.now();
    this.supersedeActiveLineageRuns(
      id,
      staged.lineageRootVendorKey,
      new Set(staged.supersededVendorKeys),
      timestamp,
    );
    const run: ProviderAdapterRun = {
      id,
      vendorKey: staged.vendor.key,
      lineageRootVendorKey: staged.lineageRootVendorKey,
      vendorName: staged.vendor.name,
      connectionFingerprint: connectionFingerprint({
        baseUrl: input.baseUrl,
        authType: input.authType,
        apiKey: input.apiKey,
        selectedModelKeys: input.models.map((model) => model.modelKey),
        headers: input.headers,
      }),
      selectedModelKeys: input.models.map((model) => model.modelKey),
      stage: "queued",
      completedCount: 0,
      totalCount: input.models.length,
      lastProgressAt: timestamp,
      stageStartedAt: timestamp,
      deadlineAt: deadlineFrom(timestamp, this.dependencies.batchTimeoutMs ?? 5 * 60_000),
      repairAttempt: 0,
      models: input.models.map((model) => ({
        modelKey: model.modelKey,
        labelZh: model.labelZh || humanizeModelKey(model.modelKey),
        kind: model.kind,
        modes: [],
      })),
      sourceUrls: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.upsertRun(run);
    this.schedule(id);
    return run;
  }

  getRun(id: string): ProviderAdapterRun | undefined {
    return this.store.getRun(id);
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
    const run = this.finishTerminal(id, "cancelled", "Adapter verification cancelled by user");
    this.controllers.get(id)?.abort();
    return run;
  }

  resumeInterrupted(): void {
    for (const run of recoverableAdapterRuns(this.store.snapshot().runs)) {
      const deadlineAt = run.deadlineAt || deadlineFrom(run.createdAt, this.dependencies.batchTimeoutMs ?? 5 * 60_000);
      if (deadlineExpired(deadlineAt, this.dependencies.now())) {
        this.finishTerminal(run.id, "timed_out", "Adapter run deadline expired before it could resume");
        continue;
      }
      this.finishWithError(
        run.id,
        "failed",
        "Adapter verification was interrupted by an app restart. Review the saved connection and retry explicitly.",
      );
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
      const compileError = compilation.failures.length
        ? compilation.failures.map((failure) => `${failure.modelKey}: ${failure.error}`).join("; ")
        : undefined;
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
    const candidates = new Map(draft.models.map((model) => [model.modelKey, model]));
    const failures = new Map(compileFailures.map((failure) => [failure.modelKey, failure]));
    const emptyModels = connection.models.map((model) => {
      const candidate = candidates.get(model.modelKey);
      const failure = failures.get(model.modelKey);
      return {
        modelKey: model.modelKey,
        labelZh: candidate?.labelZh || model.labelZh,
        kind: model.kind,
        modes: candidate
          ? candidate.modes.map((mode) => ({ taskKind: mode.taskKind, state: "queued" as const, attempts: attempt }))
          : failure
            ? [{
                taskKind: primaryTaskKind(model.kind),
                state: "failed" as const,
                attempts: 1,
                stage: "compile" as const,
                error: failure.error,
              }]
            : [],
      };
    });
    const testingAt = this.dependencies.now();
    this.updateRunIfActive(id, (run) => ({
      ...run,
      stage: "testing",
      currentModelKey: undefined,
      models: emptyModels,
      completedCount: completedModelCount(emptyModels),
      totalCount: connection.models.length,
      stageStartedAt: testingAt,
      lastProgressAt: testingAt,
      updatedAt: testingAt,
    }));
    const results: ModeResultWithModel[] = compileFailures.map((failure) => {
      const model = connection.models.find((item) => item.modelKey === failure.modelKey);
      return {
        modelKey: failure.modelKey,
        taskKind: primaryTaskKind(model?.kind || "text"),
        state: "failed",
        attempts: 1,
        stage: "compile",
        error: failure.error,
      };
    });
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
          verified = await this.awaitStep(id, "Model verification", this.dependencies.verifyTimeoutMs ?? 90_000, (signal) =>
            this.dependencies.verify({ vendor: connection.vendor, model, apiKey: connection.apiKey, mode, signal }),
          );
        } catch (error) {
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
        const modeResult: ModeResultWithModel = verified.ok
          ? {
              modelKey: candidateModel.modelKey,
              taskKind: mode.taskKind,
              state: "verified",
              attempts: attempt,
              verifiedAt: this.dependencies.now(),
              ...(verified.mediaEvidence ? { mediaEvidence: verified.mediaEvidence } : {}),
            }
          : {
              modelKey: candidateModel.modelKey,
              taskKind: mode.taskKind,
              state: "failed",
              attempts: attempt,
              stage: verified.stage,
              error: verified.error,
              // 归类原样透传（抛出点已查表定好），别让渲染层再去猜。
              ...(verified.errorCategory ? { errorCategory: verified.errorCategory } : {}),
              ...(verified.httpStatus ? { httpStatus: verified.httpStatus } : {}),
              ...(verified.reasonCode ? { reasonCode: verified.reasonCode } : {}), ...(verified.errorParams ? { errorParams: verified.errorParams } : {}),
            };
        results.push(modeResult);
        const persistedModeResult: AdapterModeResult = {
          taskKind: modeResult.taskKind,
          state: modeResult.state,
          attempts: modeResult.attempts,
          ...(modeResult.stage ? { stage: modeResult.stage } : {}),
          ...(modeResult.error ? { error: modeResult.error } : {}),
          ...(modeResult.errorCategory ? { errorCategory: modeResult.errorCategory } : {}),
          ...(modeResult.httpStatus ? { httpStatus: modeResult.httpStatus } : {}),
          ...(modeResult.verifiedAt ? { verifiedAt: modeResult.verifiedAt } : {}),
          ...(modeResult.mediaEvidence ? { mediaEvidence: modeResult.mediaEvidence } : {}), ...(modeResult.reasonCode ? { reasonCode: modeResult.reasonCode } : {}), ...(modeResult.errorParams ? { errorParams: modeResult.errorParams } : {}),
        };
        this.updateRunIfActive(id, (run) => {
          const models = run.models.map((item) =>
            item.modelKey === candidateModel.modelKey
              ? { ...item, modes: item.modes.map((state) => (state.taskKind === mode.taskKind ? persistedModeResult : state)) }
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
      return;
    }

    // The catalog is the user-visible result. A lease miss means a newer lineage
    // revision already superseded this run; never turn that no-op into completed.
    const promotion = this.dependencies.catalog.promote({ run: completedRun, draft, revision, verifiedModes });
    if (promotion.status === "no-lease") {
      const staleRun: ProviderAdapterRun = {
        ...completedRun,
        stage: "stale",
        activeRevision: current.activeRevision,
        error: "A newer verification run replaced this result before promotion committed",
      };
      this.dependencies.catalog.fail(staleRun);
      this.store.upsertRun(staleRun);
      return;
    }
    const committedRevision = { ...revision, verifiedModes: promotion.committedModes };
    this.store.upsertRun({ ...completedRun, activeRevision: committedRevision.id });
    this.store.upsertRevision(committedRevision);
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
