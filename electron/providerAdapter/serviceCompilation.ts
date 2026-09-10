import type { LanguageModelV1 } from "ai";
import type { Model } from "../catalog/types";
import { redactAdapterSecrets } from "./redaction";
import type { LoadedConnection } from "./serviceCatalog";
import { AdapterWaitError } from "./serviceLifecycle";
import { appendCompilation, emptyCompilation, genericCompilation } from "./serviceFallback";
import type { DiscoveredDocs } from "./docsDiscovery";
import type { AdapterRunStage } from "../shared/providerAdapterContract";
import type { ProviderAdapterCompilation, ProviderAdapterDraft, ProviderAdapterRunInput } from "./types";
import { validateProviderAdapterDraft } from "./validator";

export async function compileMediaModels(input: {
  connection: LoadedConnection;
  models: readonly Model[];
  docs: DiscoveredDocs;
  languageModels: readonly LanguageModelV1[];
  onModel: (modelKey: string) => void;
  compileOne: (model: Model) => Promise<ProviderAdapterCompilation>;
}): Promise<{ compilation: ProviderAdapterCompilation; compiledModelKeys: Set<string> }> {
  if (input.docs.sources.length === 0 || !input.docs.corpus.trim() || input.languageModels.length === 0) {
    return { compilation: genericCompilation(input.connection, input.models), compiledModelKeys: new Set() };
  }

  let compilation = emptyCompilation(input.connection);
  const compiledModelKeys = new Set<string>();
  for (const model of input.models) {
    input.onModel(model.modelKey);
    let generated: ProviderAdapterCompilation | undefined;
    try {
      generated = await input.compileOne(model);
    } catch (error) {
      if (error instanceof AdapterWaitError && error.reason !== "step_timeout") throw error;
      const message = redactAdapterSecrets(error instanceof Error ? error.message : String(error));
      const fallback = genericCompilation(input.connection, [model]);
      compilation = appendCompilation(compilation, {
        ...fallback,
        failures: fallback.failures.map((failure) => ({
          ...failure,
          error: `${failure.error} (${message})`,
        })),
      }, model.modelKey);
      continue;
    }

    const candidate = generated.draft.models.find((item) => item.modelKey === model.modelKey && item.modes.length > 0);
    if (candidate) {
      compilation = appendCompilation(compilation, {
        draft: { ...generated.draft, models: [candidate] },
        failures: [],
      }, model.modelKey);
      compiledModelKeys.add(model.modelKey);
      continue;
    }
    compilation = appendCompilation(compilation, genericCompilation(input.connection, [model]), model.modelKey);
  }
  return { compilation, compiledModelKeys };
}

/**
 * 「拿到文档 → 编译媒体模型」这一段完整地住在这里（2026-09-10 从 service.process 抽出）。
 *
 * 抽出的理由不是行数，是**文档来源现在有两种**：用户/驱动 Agent 交进来的（首选）和按域名猜的
 * （兜底）。这个分叉的裁决在 providedDocs.resolveProviderDocs 里，而「拿到之后怎么用」原本
 * 散在 process 的一段长内联里——两者贴在一起才看得出「给了文档时到底喂给编译器的是哪份」。
 * service 只负责把 run 生命周期的四件事（分阶段、限时、记录来源、落 run）以回调交进来。
 */
export async function discoverAndCompileMediaModels(input: {
  connection: LoadedConnection;
  models: readonly Model[];
  providedDocs?: string;
  languageModels: readonly LanguageModelV1[];
  discover: (args: {
    baseUrl: string;
    modelKeys: readonly string[];
    providedDocs?: string;
    proxyUrl?: string;
    signal?: AbortSignal;
  }) => Promise<DiscoveredDocs>;
  compileOne: (model: Model, docs: DiscoveredDocs) => Promise<ProviderAdapterCompilation>;
  // 阶段词表只有一个 owner（electron/shared/providerAdapterContract.ts 的 ADAPTER_RUN_STAGES）。
  // 这里不裁一份「只有两格」的子集类型：子集就是第二份词表，改一处名字时它不会跟着红。
  onStage: (stage: AdapterRunStage, modelKey?: string) => void;
  onDocs: (docs: DiscoveredDocs) => void;
  runStep: <T>(label: string, timeoutMs: number, work: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  discoverTimeoutMs: number;
}): Promise<{ compilation: ProviderAdapterCompilation; compiledModelKeys: Set<string>; docs: DiscoveredDocs }> {
  const baseUrl = String(input.connection.vendor.baseUrlHint || "");
  input.onStage("discovering_docs");
  let docs: DiscoveredDocs = { sources: [], corpus: "" };
  try {
    docs = await input.runStep("Document discovery", input.discoverTimeoutMs, (signal) =>
      input.discover({
        baseUrl,
        modelKeys: input.models.map((model) => model.modelKey),
        ...(input.providedDocs ? { providedDocs: input.providedDocs } : {}),
        ...(input.connection.vendor.network?.proxyUrl ? { proxyUrl: input.connection.vendor.network.proxyUrl } : {}),
        signal,
      }),
    );
  } catch (error) {
    if (error instanceof AdapterWaitError && error.reason !== "step_timeout") throw error;
    docs = { sources: [], corpus: "" };
  }
  if (docs.sources.length > 0 && docs.corpus.trim()) input.onDocs(docs);
  const compiled = await compileMediaModels({
    connection: input.connection,
    models: input.models,
    docs,
    languageModels: input.languageModels,
    onModel: (modelKey) => input.onStage("compiling", modelKey),
    compileOne: (model) => input.compileOne(model, docs),
  });
  return { ...compiled, docs };
}

/**
 * 外部（驱动 Agent）编译好的说明卡。跳过「抓文档 + 叫内置文本模型」，**不跳过校验**：
 * 校验放在执行边界而不是只放在收件处，因为说明卡从 MCP propose、可信 UI、以及重启后恢复的
 * 旧 run 三条路都能进来——只在收件处校验，另外两条就能绕过去。
 */
export function externallyCompiledDraft(
  runInput: ProviderAdapterRunInput | undefined,
  connection: LoadedConnection,
): ProviderAdapterDraft | undefined {
  if (!runInput?.draft) return undefined;
  return validateProviderAdapterDraft(runInput.draft, {
    providerBaseUrl: String(connection.vendor.baseUrlHint || ""),
    selectedModelKeys: runInput.draft.models.map((model) => model.modelKey),
  });
}
