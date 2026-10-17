/**
 * 「这一次请求发到线上的 model 串是哪一个」的唯一判定（owner，2026-10-16）。
 *
 * 起因（应用内反馈，两位用户，0.23.1）：自定义 OpenAI 兼容中转出图，服务商回「No available channel for
 * model gpt-image-2-…-text-to-image」。用户配的是自己中转上的模型名，发出去的却是另一家（kie）把文生图 /
 * 改图拆成两个 id 时用的线上名。链路：档案的 `mode.modelEnum` / `variant.modelKey` 被渲染层塞进
 * `archetypeInput.model`，参数层又用它盖掉了连接的模型名，而中转模板读的正是 `{{request.params.model}}`。
 *
 * 类根因：档案里的模式 / 变体线上名是**某条代码登记的渠道契约**才认的名字，却被当成了与供应商无关的参数，
 * 任何引用 `{{request.params.model}}` 的模板（含用户自建中转、旧目录里的映射、自定义脚本、Agent 那条路）
 * 都会收到它。认证时发的是用户的模型名，真用时发的是档案名——两份身份从来没有在同一处验收。
 *
 * 规则（只此一处）：
 *   1. 这条请求所走的 create op 声明了 `wireModel: "archetype-selection"`（只在内置目录契约的 op 定义处写，
 *      kie / apimart / 火山 / 即梦；类测试锁住「内置 op 引用 params.model 就必须声明、非内置一律没有」）→
 *      按所选变体 > 所选模式的 modelEnum > 连接模型名 取值；
 *   2. 其余一律发**连接自己的模型名**（`modelAlias || modelKey`，与 `{{model.modelKey}}` 同一个表达式）。
 *      自建中转、旧数据里的参数化映射、手写映射、自定义脚本都落在这一档，不猜、不迁移。
 * `extras.model`、`archetypeInput.model`、headless 默认值、Agent 参数里的 `model` 都**不是输入**：
 * 参数层把本函数的结果最后写进 `params.model`，任何参数都盖不掉它。
 *
 * 放在 `electron/shared/modelArchetypes/`（档案领域目录）：渲染层判「变体栏活不活」与主进程决定发什么，问的是同一个谓词。
 */
import { resolveArchetypeForModel, type ArchetypeMode, type ModelArchetype } from "./index";
import { resolveArchetypeVariant } from "./variantResolution";
import { modeTransportFor } from "../videoCapabilities/modeTransport";

/** 线上模型名在参数表里的键（`{{request.params.model}}`）。它是 owner 的输出，不是任何人能传入的参数。 */
export const WIRE_MODEL_PARAM = "model" as const;

/** create op 上的声明值：这条 op 的 `{{request.params.model}}` 收档案所选模式 / 变体的线上名。 */
export const ARCHETYPE_WIRE_MODEL = "archetype-selection" as const;
export type WireModelDeclaration = typeof ARCHETYPE_WIRE_MODEL;

type OperationLike = { wireModel?: unknown } | null | undefined;

/** 这条 op 有没有声明「收档案所选的线上名」。渲染层变体栏与主进程发送共用这一个谓词。 */
export function operationSelectsArchetypeWireModel(operation: OperationLike): boolean {
  return operation?.wireModel === ARCHETYPE_WIRE_MODEL;
}

/** 去掉声明（把内置报文借给非内置连接时用：借的是形状，不是对方认的模型名）。 */
export function withoutArchetypeWireModel<T extends { wireModel?: unknown }>(operation: T): Omit<T, "wireModel"> {
  const { wireModel: _dropped, ...rest } = operation;
  return rest;
}

export type WireModelConnection = {
  vendorKey: string;
  modelKey: string;
  modelAlias?: string | null;
  /** 目录行的 meta（`archetypeId` 在这里）。 */
  modelMeta?: unknown;
};

export type WireModelInput = {
  operation: OperationLike;
  connection: WireModelConnection;
  /** 这一次请求的 extras：只读 `archetype`（{id, modeId, variantId}）与 `modelKey`，**不读 model**。 */
  extras?: Record<string, unknown>;
  /** 请求的 taskKind；没有显式 modeId 时（headless）按它找这家这个桶的主模式。 */
  taskKind?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 连接自己的模型名：与 `{{model.modelKey}}` 逐字同源（modelAlias 优先）。 */
export function connectionWireModel(connection: Pick<WireModelConnection, "modelKey" | "modelAlias">): string {
  return text(connection.modelAlias) || text(connection.modelKey);
}

/**
 * 没有显式 modeId 时按 (vendor, taskKind) 选主模式：档案默认模式在这个桶里就用它，否则取桶里首个声明的模式。
 * 与 headless 缺参兜底（gen-archetype-wire-defaults 的「主模式判据」）同一条规则。
 */
function modeForTask(archetype: ModelArchetype, vendorKey: string, taskKind: string): ArchetypeMode | undefined {
  const inBucket = archetype.modes.filter((mode) => modeTransportFor(mode, archetype, vendorKey) === taskKind);
  return inBucket.find((mode) => mode.id === archetype.defaultModeId) ?? inBucket[0];
}

/** 选择记录属于这个档案吗：没写 id（宿主合同只带 modeId / variantId）算；写了别的档案 id（换过模型的旧节点）不算。 */
function selectionBelongsTo(archetype: ModelArchetype, selection: Record<string, unknown>): boolean {
  const id = text(selection.id);
  return !id || id === archetype.id || (archetype.legacyIds ?? []).includes(id);
}

function selectedMode(archetype: ModelArchetype, selection: Record<string, unknown>, vendorKey: string, taskKind: string): ArchetypeMode | undefined {
  const modeId = selectionBelongsTo(archetype, selection) ? text(selection.modeId) : "";
  return (modeId ? archetype.modes.find((mode) => mode.id === modeId) : undefined)
    ?? (taskKind ? modeForTask(archetype, vendorKey, taskKind) : undefined)
    ?? archetype.modes.find((mode) => mode.id === archetype.defaultModeId)
    ?? archetype.modes[0];
}

/**
 * 没有任何 mapping 的兜底报文（runtime 的 `/v1/{images,videos}/generations`）发哪个 model 串：这条路没有 op、
 * 也就没有声明，所以永远是连接名。单独给一个入口，是为了让兜底也问同一个 owner，而不是在巨壳里自己拼
 * `modelAlias || modelKey`（2026-10-16 独立验收 V-1207 抓到的漏门）。
 */
export function noMappingWireModel(
  model: WireModelConnection & { meta?: unknown },
  request: { kind?: string; extras?: Record<string, unknown> },
): string {
  return resolveWireModel({
    operation: null,
    connection: { vendorKey: model.vendorKey, modelKey: model.modelKey, modelAlias: model.modelAlias, modelMeta: model.meta },
    extras: request.extras,
    taskKind: request.kind,
  });
}

/** 这一次请求发到线上的 model 串（见文件头的两条规则）。 */
export function resolveWireModel(input: WireModelInput): string {
  const fallback = connectionWireModel(input.connection);
  if (!operationSelectsArchetypeWireModel(input.operation)) return fallback;
  const extras = input.extras ?? {};
  const selection = record(extras.archetype);
  const rowMeta = record(input.connection.modelMeta);
  // 目录行的 archetypeId 优先、其次节点存的 archetype.id、最后按模型身份——与渲染层同一个解析入口。
  const archetype = resolveArchetypeForModel({
    modelKey: input.connection.modelKey,
    modelAlias: input.connection.modelAlias ?? null,
    vendorKey: input.connection.vendorKey,
    meta: { ...rowMeta, ...(Object.keys(selection).length ? { archetype: selection } : {}) },
  });
  if (!archetype) return fallback;
  const variant = resolveArchetypeVariant(archetype, {
    ...(selectionBelongsTo(archetype, selection) ? { variantId: selection.variantId } : {}),
    modelId: text(extras.modelKey) || input.connection.modelKey,
  });
  const mode = selectedMode(archetype, selection, input.connection.vendorKey, text(input.taskKind));
  return text(variant?.modelKey) || text(mode?.modelEnum) || fallback;
}
