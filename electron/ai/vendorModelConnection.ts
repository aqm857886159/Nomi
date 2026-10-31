/**
 * [INPUT]: 依赖 catalog/catalogStore 的 normalizeProviderKind / extractVendorExtraHeaders，依赖模型 meta.adapter.modes 上认证写下的 wireProtocol
 * [OUTPUT]: 对外提供 vendorModelConnection、nomiModelConfigFor、anthropicBaseUrl、isProviderKindPinned
 * [POS]: 目录 → 模型调用的唯一连接规则；Agent lane、文本任务、说明卡编译器、文本预热、认证时的协议探测都从这里拿连接
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { extractVendorExtraHeaders, normalizeProviderKind } from '../catalog/catalogStore';
import type { AiSdkProviderKind, Model, Vendor } from '../catalog/types';
import type { NomiModelConfig } from '../shared/agentLane/laneModelConfig';
import { modelContextWindow } from '../shared/modelContextWindow';

function resolveSdkBaseUrl(vendor: Vendor): string {
  const base = (vendor.baseUrlHint || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error(`Base URL missing: ${vendor.key}`);
  try {
    const url = new URL(base);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
      return url.toString();
    }
  } catch {
    // Keep the configured value so the existing request/configuration error remains authoritative.
  }
  return base;
}

/**
 * Anthropic 的 base 必须带版本段：pi 的 Anthropic 适配（laneModelProvider.mts 的 anthropicFetch）认的是「配置里已有 /v1」，
 * 然后把 SDK 拼出的 `{base}/v1/messages` 改写回 `{base}/messages`。而接入页探测协议时会把末尾的 /v1 去掉、只存根
 * （`https://api.anthropic.com`）——不在读的时候补回来，请求就会打到 `{root}/messages` → 404
 * （2026-08-28「接入能过、画布 404」同一类）。在两台发动机共用的这一处规范化，存量只存了根的接入一起救回来。
 */
export function anthropicBaseUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  return /\/v\d+$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** 用户在接入页「高级 → 接口协议」亲手选过协议。预设带的协议不算（providerAdapter/types.ts 的 providerKindPinned）。 */
export function isProviderKindPinned(vendor: Vendor): boolean {
  return asRecord(vendor.meta)?.providerKindPinned === true;
}

/** 认证时为这个文本模型判定的协议（providerAdapter/textProtocolProbe.ts 写进 meta.adapter.modes 的 chat 一档）。 */
function probedWireProtocol(model: Model): AiSdkProviderKind | undefined {
  const modes = asRecord(asRecord(model.meta)?.adapter)?.modes;
  if (!Array.isArray(modes)) return undefined;
  const chat = modes.map(asRecord).find((mode) => mode?.taskKind === 'chat');
  return chat?.wireProtocol === 'openai-responses' ? 'openai-responses' : undefined;
}

/**
 * 这次调用走哪种协议。连接上写的是 openai-compatible（预设 / 自动）且用户没亲手选时，
 * 认证探出支持 Responses 的模型改走 Responses（2026-10-27 用户拍板：默认 Responses，不支持再回 Chat）。
 * ⚠ 只升不降：anthropic、用户亲手选的协议、没探过的老数据，都照连接上的 providerKind 走。
 */
function connectionKind(vendor: Vendor, model: Model): AiSdkProviderKind {
  const kind = normalizeProviderKind(vendor.providerKind);
  if (kind !== 'openai-compatible' || isProviderKindPinned(vendor)) return kind;
  return probedWireProtocol(model) ?? kind;
}

/** Catalog connection rules shared by every model call (Agent lane, text tasks, adapter compiler). */
export function vendorModelConnection(vendor: Vendor, model: Model, apiKey: string) {
  const kind = connectionKind(vendor, model);
  const headers = extractVendorExtraHeaders(vendor);
  return {
    kind,
    baseURL: kind === 'anthropic'
      ? anthropicBaseUrl((vendor.baseUrlHint || '').trim() || 'https://api.anthropic.com/v1')
      : resolveSdkBaseUrl(vendor),
    apiKey,
    authType: vendor.authType,
    modelId: (model.modelAlias || model.modelKey).trim(),
    ...(headers ? { headers } : {}),
  };
}

/**
 * 目录里的一行（vendor + model + 解开的 key）→ 一次模型调用的连接配置。**唯一一份**：Agent lane 选完模型、
 * 文本任务、接入说明卡编译器都从这里拿，同一个模型在三处的请求体规矩（上下文窗、输出上限、价目、鉴权）不会漂。
 */
export function nomiModelConfigFor(vendor: Vendor, model: Model, apiKey: string): NomiModelConfig {
  const connection = vendorModelConnection(vendor, model, apiKey);
  const contextWindow = modelContextWindow(model.meta, connection.modelId);
  const maxOutputTokens = (model.meta as Record<string, unknown> | undefined)?.maxOutputTokens;
  return {
    ...connection, providerId: vendor.key, authType: vendor.authType === 'none' ? 'none' : 'api-key',
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens >= 1
      ? { maxOutputTokens: Math.floor(maxOutputTokens) } : {}),
    ...(model.tokenPricing ? { tokenPricing: model.tokenPricing } : {}),
    ...(model.free ? { free: true as const } : {}),
  };
}
