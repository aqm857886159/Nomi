// `list_models`（模型目录读）的**执行那一半**。说明书那一半住 `verbs/readVerbs.ts`（注册表里
// `internalGroup:"models"`），这里只把它绑到 `availableModels` 解析器上——PR A 之前它是注册表外
// 唯一一个手写 TypeBox 定义的模型可见工具（审计 C5 / 设计 T9）。
import type { AgentModelEntry } from '../shared/agentCapabilities/availableModels.js';
import {
  modelSpecDetail, modelSpecRow,
  type ModelAvailabilityFacts,
} from '../shared/agentCapabilities/modelSpecProjection.js';
import { resolveModelHandle } from '../shared/agentCapabilities/modelHandle.js';
import { modelCatalogReadSpec } from '../shared/agentCapabilities/modelFacingToolRegistry.js';
import { laneToolModelDescription, type LaneToolSpec } from '../shared/agentLane/laneToolContract.js';
import { toModelVisibleSchema } from './laneToolSchema.mjs';

/** 注册表里那份声明（`modelCatalogReadSpec`，按契约与分组认，不手写名字）。找不到或不唯一当场抛。 */
export function laneModelReadSpec(): LaneToolSpec {
  return modelCatalogReadSpec();
}

/** pi 工具形状（描述取首句进 schema，全文进系统提示词——与 `laneTools.mts` 同一条纪律）。 */
export const laneModelReadDefinition = (() => {
  const spec = laneModelReadSpec();
  return {
    name: spec.name, label: 'Models',
    description: laneToolModelDescription(spec),
    promptSnippet: spec.promptSnippet,
    parameters: toModelVisibleSchema(spec.schema, { toolName: spec.name }),
    replay: 'safe' as const,
  };
})();

/**
 * 分级披露，应用内这一面（与对外 MCP 面 `nomi_read{target:"models"|"model"}` 同一个投影）：
 *  · 不给 `model` → **薄名单**，每行只够选型；
 *  · 给了 `model`（完整名字）→ **那一个**的完整说明书（模式/参数/取值/参考槽/变体）。
 *
 * 改法是扩既有入参、不新起第二个能力契约——两面本来就是同一个契约的两个别名。
 * 旧行为是无论问什么都把全部模型的完整说明书倒出来；108 个模型是十万字量级，
 * 每回合都背着它就是拿上下文换一份大多数时候用不上的东西。
 *
 * @param availabilityOf 目录注入的可用性（keyStatus/usable/statusReason）。**必传**。
 *   2026-09-22（对方会话 Ponytail 记的账）：它原来是可选的，于是「生产装配漏接可用性」
 *   这件事编译器一个字都不会说——模型读到的每一行都没有 keyStatus/usable，
 *   它以为所有模型都能用，然后带着一个没钥匙的模型去花钱。可选的注入点 = 可选的真相。
 *   拿不到目录的调用方显式传 `() => undefined`，那是一句**说出来的**「这条路没有可用性」。
 */
export function createLaneModelRead(
  resolve: () => readonly AgentModelEntry[],
  availabilityOf: (entry: AgentModelEntry) => ModelAvailabilityFacts | undefined,
) {
  return { ...laneModelReadDefinition, execute: async (_id: string, args: { kind?: string; model?: string }) => {
    const all = resolve();
    if (args.model !== undefined) {
      // 2026-11-15：应用内这一面点名模型只用完整名字（`模型id@供应商`），与 `draft_shots` 同一张表、同一个查法。
      const found = resolveModelHandle(all, args.model);
      const detail = found.ok ? modelSpecDetail(found.row, 'lane', availabilityOf(found.row)) : null;
      if (detail?.variants) detail.variants = detail.variants.map(({ modelKey: _modelKey, ...variant }) => variant);
      const payload = found.ok
        ? { model: detail,
          ...(found.via === 'handle' && found.handle === args.model ? {} : { resolvedFrom: args.model }) }
        : found.reason === 'ambiguous'
          // 只写了模型 id、而它有好几家：**不许替调用方挑**，列出那几个完整名字。
          ? {
              model: null,
              errorCode: 'ambiguous_model_vendor',
              error: `Ambiguous model: ${args.model} is carried by ${found.handles.length} providers`,
              candidates: found.handles,
              recoveryActions: [`Retry with one of: ${found.handles.join(', ')} — the same model id under two providers is two different models.`],
            }
          : {
              model: null,
              errorCode: 'unknown_model_identity',
              error: `Unknown model: ${args.model}`,
              // 拒绝自带出路：最像的几个完整名字；一个都不像就指向薄名单。
              candidates: found.nearest,
              recoveryActions: [found.nearest.length
                ? `Retry with one of: ${found.nearest.join(', ')}.`
                : 'Call list_models for the thin list, then copy one full name exactly.'],
            };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], details: payload };
    }
    const rows = all
      .filter(entry => args.kind === undefined || entry.kind === args.kind)
      .map(entry => modelSpecRow(entry, 'lane', availabilityOf(entry)));
    const payload = { models: rows };
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], details: payload };
  } };
}
