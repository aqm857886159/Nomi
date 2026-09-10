// 「编译」这一步从「必须用内置文本模型」变成「谁来都行、校验归我们」的那条缝。
//
// 治的是 2026-09-10 盘点出的第二处卡点（鸡生蛋）：读文档写说明卡这一步借的是**用户已经接好的
// 文本模型**（serviceLanguageModels）。一台还没接过任何模型的机器上没有这样的模型，于是
// `AdapterNeedsAiError`——「想接模型，先接一个模型」。而驱动这次接入的 Codex / Claude Code /
// WorkBuddy 本身就是一个能读文档写 JSON 的模型，它只是不知道要写成什么形状。
//
// 对齐 docs/plan/2026-09-03-mcp-integration-q8-seams.md 的「确定性归我们、情境性归模型」：
// 我们交出去的是**确定性的东西**——目标 schema、身份锁定的模型清单、撰写规则；
// 收回来的东西一律过 validateProviderAdapterDraft，再走同一条真实认证。不放宽任何一格。
import { zodToJsonSchema } from "zod-to-json-schema";
import { PROVIDER_ADAPTER_SYSTEM_PROMPT } from "./compiler";
import { adapterSuppliedContractSchema, validateProviderAdapterDraft, type AdapterSuppliedContract } from "./validator";
import type { ProviderAdapterDraft } from "./types";

/** 交件规则与内置编译器用的是同一份提示词——两份必然漂移成「我们要求的」和「我们检查的」不一样。 */
export const ADAPTER_CONTRACT_INSTRUCTIONS = PROVIDER_ADAPTER_SYSTEM_PROMPT;

let cachedSchema: Record<string, unknown> | undefined;

/**
 * 交给驱动 Agent 的目标 schema。懒算 + 缓存：它是纯函数结果，但 zodToJsonSchema 走一遍
 * 整棵 mode 树，不该记在主进程启动时间上。
 */
export function adapterContractJsonSchema(): Record<string, unknown> {
  // 与 mcpTransportSchemaFromZod 同一处理：zod-to-json-schema 的公开签名在这种深度的
  // schema 上会把 tsc 推到 TS2589，转换本身是运行时正确的。
  const convert = zodToJsonSchema as unknown as (schema: unknown, options: Record<string, unknown>) => Record<string, unknown>;
  cachedSchema ||= convert(adapterSuppliedContractSchema, {
    name: "NomiProviderAdapterContract",
    $refStrategy: "none",
    target: "jsonSchema7",
  });
  return cachedSchema;
}

export function parseAdapterSuppliedContract(raw: unknown): AdapterSuppliedContract {
  const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
  return adapterSuppliedContractSchema.parse(decoded);
}

/**
 * 外部交件 → 完整说明卡。`provider` 与每个模型的 `labelZh` / `kind` 由 Nomi 从会话填，
 * 外部只负责 `modes` / `parameters` / `sources`（与内置编译器同一条「身份锁定」纪律）。
 * 出口一律过 validateProviderAdapterDraft，没有任何旁路。
 */
export function draftFromSuppliedContract(input: {
  contract: AdapterSuppliedContract;
  provider: ProviderAdapterDraft["provider"];
  models: ReadonlyArray<{ modelKey: string; kind: ProviderAdapterDraft["models"][number]["kind"]; label?: string }>;
}): ProviderAdapterDraft {
  const identity = new Map(input.models.map((model) => [model.modelKey, model]));
  const models = input.contract.models.map((model) => {
    const locked = identity.get(model.modelKey);
    if (!locked) throw new Error(`Model ${model.modelKey} was not selected by the user`);
    return {
      ...model,
      labelZh: locked.label || model.labelZh || model.modelKey,
      kind: locked.kind,
    };
  });
  return validateProviderAdapterDraft(
    { provider: input.provider, sources: input.contract.sources, models },
    {
      providerBaseUrl: input.provider.baseUrl,
      selectedModelKeys: input.models.map((model) => model.modelKey),
    },
  );
}
