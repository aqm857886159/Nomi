import type { CompilerLanguageModel } from "./compiler";
import type { Model } from "../catalog/types";
import { redactAdapterSecrets } from "./redaction";
import type { LoadedConnection } from "./serviceCatalog";
import { AdapterWaitError } from "./serviceLifecycle";
import { appendCompilation, emptyCompilation, genericCompilation, withTextModels } from "./serviceFallback";
import { canHostPublicDocs, type DiscoveredDocs } from "./docsDiscovery";
import type { AdapterRunStage } from "../shared/providerAdapterContract";
import type { ProviderAdapterCompilation, ProviderAdapterDraft, ProviderAdapterRunInput } from "./types";
import { validateProviderAdapterDraft } from "./validator";

export async function compileMediaModels(input: {
  connection: LoadedConnection;
  models: readonly Model[];
  docs: DiscoveredDocs;
  languageModels: readonly CompilerLanguageModel[];
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
  languageModels: readonly CompilerLanguageModel[];
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
 *
 * 选了哪些模型以这次 run 为准，不以卡自己写的为准：卡不能多带用户没选的模型，也不能漏掉选了的
 * 媒体模型。文本模型可以不写（文本接法固定，由 withTextModels 补）。
 */
function externallyCompiledDraft(
  runInput: ProviderAdapterRunInput | undefined,
  connection: LoadedConnection,
): ProviderAdapterDraft | undefined {
  if (!runInput?.draft) return undefined;
  const carded = new Set((runInput.draft.models || []).map((model) => model.modelKey));
  return validateProviderAdapterDraft(runInput.draft, {
    providerBaseUrl: String(connection.vendor.baseUrlHint || ""),
    selectedModelKeys: connection.models
      .filter((model) => model.kind !== "text" || carded.has(model.modelKey))
      .map((model) => model.modelKey),
  });
}

function hostsPublicDocs(connection: LoadedConnection): boolean {
  try {
    return canHostPublicDocs(new URL(String(connection.vendor.baseUrlHint || "")).hostname);
  } catch {
    return true; // 连 URL 都不合法 → 交给原路径如实报错，别在这里吞掉
  }
}

/**
 * 这次 run 用哪张说明卡——**唯一的家**（2026-11-17 收拢；此前 service.process 里先判私网主机、
 * 再读交来的卡，私网主机上交了卡也被内置模板盖掉，而且模板丢了别名和协议）。
 *
 * 顺序就是优先级：
 * 1. 交来了卡（设置向导、接入会话、旧会话恢复）→ 用卡，过统一收件校验；
 * 2. 私网主机（IP / localhost / 内网域）没有公开文档可读 → 内置 OpenAI 兼容模板，带完整身份；
 * 3. 其余 → 抓文档 + 编译媒体模型（`compileMedia` 由 service 交进来，管分阶段与限时）。
 * 文本条目以 withTextModels 为单一真相（私网模板自己就按协议写了文本通道，不再替换）。
 */
export async function prepareRunCompilation(input: {
  connection: LoadedConnection;
  runInput: ProviderAdapterRunInput | undefined;
  compileMedia: (models: readonly Model[]) => Promise<ProviderAdapterCompilation>;
}): Promise<ProviderAdapterCompilation> {
  const { connection } = input;
  const textModels = connection.models.filter((model) => model.kind === "text");
  const withText = (compilation: ProviderAdapterCompilation): ProviderAdapterCompilation => ({
    ...compilation,
    draft: { ...compilation.draft, models: withTextModels(compilation.draft.models, textModels) },
  });
  const supplied = externallyCompiledDraft(input.runInput, connection);
  if (supplied) return withText({ draft: supplied, failures: [] });
  if (!hostsPublicDocs(connection)) return genericCompilation(connection, connection.models);
  const mediaModels = connection.models.filter((model) => model.kind !== "text");
  return withText(mediaModels.length > 0 ? await input.compileMedia(mediaModels) : genericCompilation(connection, []));
}
