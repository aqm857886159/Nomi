import type { BillingModelKind, Model, ProfileKind } from "../catalog/types";
import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";
import type { LoadedConnection } from "./serviceCatalog";
import type {
  AdapterModelDraft,
  AdapterModeResult,
  ProviderAdapterCompilation,
  ProviderAdapterCompileFailure,
  ProviderAdapterDraft,
  ProviderAdapterRun,
} from "./types";

export const TEXT_PRODUCTION_PATH_CREATE = { method: "POST", path: "/chat/completions" } as const;
/**
 * 折叠在「看原始报错」里的**诊断**文本（英文技术描述，给来求助的人和 AI 看）。
 * 用户看到的解释不是这句——那句由 compileFailureReason 走 i18n（why.noGenericContract），
 * 见 adapterFailureAdvice。这句不许再当人话直接摆给用户（R15）。
 */
export const MANUAL_CONTRACT_ERROR = "No safe generic contract exists for this model kind; configure a manual call script";

export function primaryTaskKind(kind: BillingModelKind): ProfileKind {
  if (kind === "image") return "text_to_image";
  if (kind === "video") return "text_to_video";
  if (kind === "audio") return "text_to_audio";
  if (kind === "model3d") return "text_to_3d";
  return "chat";
}

export function emptyCompilation(connection: LoadedConnection): ProviderAdapterCompilation {
  return {
    draft: {
      provider: {
        baseUrl: String(connection.vendor.baseUrlHint || ""),
        authType: connection.vendor.authType || "bearer",
        ...(connection.vendor.providerKind ? { providerKind: connection.vendor.providerKind } : {}),
      },
      sources: [],
      models: [],
    },
    failures: [],
  };
}

export function genericCompilation(
  connection: LoadedConnection,
  models: readonly Model[],
): ProviderAdapterCompilation {
  const draft = buildOpenAiCompatibleDraft({
    baseUrl: String(connection.vendor.baseUrlHint || ""),
    authType: connection.vendor.authType || "bearer",
    ...(connection.vendor.providerKind ? { providerKind: connection.vendor.providerKind } : {}),
    models: models.map((model) => ({ modelKey: model.modelKey, labelZh: model.labelZh, kind: model.kind })),
  });
  const usable = draft.models.filter((model) => model.modes.length > 0);
  const unusable = draft.models.filter((model) => model.modes.length === 0);
  return {
    draft: { ...draft, models: usable },
    // 零 modes = 这个 kind 在 OpenAI 兼容面上没有标准端点（当前只有 model3d，见 modesForKind）。
    // 带上结构化原因，界面才能把「我们没接」和「它坏了」讲清楚，并指向真正走得通的那条路。
    failures: unusable.map((model) => ({
      modelKey: model.modelKey,
      error: MANUAL_CONTRACT_ERROR,
      reason: "no_generic_contract" as const,
    })),
  };
}

/**
 * run.error 在界面上是**原样**渲染的一条红色横幅（AdapterVerificationScreen），没有 i18n 可言。
 * 「这个 kind 没有通用协议」这一类已经在每张模型卡上用用户的语言解释清楚了（why.noGenericContract
 * + 「我自己接」按钮），再把同一件事以英文技术串重复到横幅上，对中文用户只是一句看不懂的噪音，
 * 而且恰好出现在他最需要指引的那一刻（R15）。英文原文仍留在该模型卡的「看原始报错」折叠里，
 * 求助时不丢证据。真正需要横幅的是「我们没读懂这家文档」那一类——它不针对某个模型，无处可说。
 */
export function compileErrorBanner(failures: readonly ProviderAdapterCompileFailure[]): string | undefined {
  const banner = failures.filter((failure) => failure.reason !== "no_generic_contract");
  return banner.length ? banner.map((failure) => `${failure.modelKey}: ${failure.error}`).join("; ") : undefined;
}

export function appendCompilation(
  current: ProviderAdapterCompilation,
  addition: ProviderAdapterCompilation,
  modelKey?: string,
): ProviderAdapterCompilation {
  const selectedModels = modelKey
    ? addition.draft.models.filter((model) => model.modelKey === modelKey)
    : addition.draft.models;
  const selectedFailures = modelKey
    ? addition.failures.filter((failure) => failure.modelKey === modelKey)
    : addition.failures;
  const sourceKey = (source: ProviderAdapterDraft["sources"][number]) => `${source.url}\0${source.evidence}`;
  const sources = [...current.draft.sources];
  const seenSources = new Set(sources.map(sourceKey));
  for (const source of addition.draft.sources) {
    if (seenSources.has(sourceKey(source))) continue;
    seenSources.add(sourceKey(source));
    sources.push(source);
  }
  return {
    draft: { ...current.draft, sources, models: [...current.draft.models, ...selectedModels] },
    failures: [...current.failures, ...selectedFailures],
  };
}

export function withTextModels(
  compiled: readonly AdapterModelDraft[],
  textModels: readonly Model[],
): AdapterModelDraft[] {
  const textModelKeys = new Set(textModels.map((model) => model.modelKey));
  return [
    ...compiled.filter((model) => !textModelKeys.has(model.modelKey)),
    ...textModels.map((model) => ({
      modelKey: model.modelKey,
      labelZh: model.labelZh,
      kind: "text" as const,
      modes: [{ taskKind: "chat" as const, create: TEXT_PRODUCTION_PATH_CREATE, testParams: {}, sourceUrls: [] }],
    })),
  ];
}

export function completedModelCount(models: readonly ProviderAdapterRun["models"][number][]): number {
  return models.filter((model) =>
    model.modes.length > 0 && model.modes.every((mode) => mode.state === "verified" || mode.state === "failed"),
  ).length;
}

export function failUnfinishedModes(
  models: ProviderAdapterRun["models"],
  stage: NonNullable<AdapterModeResult["stage"]>,
  error: string,
): ProviderAdapterRun["models"] {
  return models.map((model) => ({
    ...model,
    modes: model.modes.length === 0
      ? [{ taskKind: primaryTaskKind(model.kind), state: "failed", attempts: 1, stage, error }]
      : model.modes.map((mode) =>
          mode.state === "verified" || mode.state === "failed"
            ? mode
            : { ...mode, state: "failed", stage, error }),
  }));
}
