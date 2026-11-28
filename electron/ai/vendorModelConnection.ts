import { extractVendorExtraHeaders, normalizeProviderKind } from '../catalog/catalogStore';
import { readModelDeclaration } from '../catalog/modelDeclaration';
import type { Model, Vendor } from '../catalog/types';
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

export function googleGenerativeBaseUrl(baseURL: string): string {
  const trimmed = (baseURL || 'https://generativelanguage.googleapis.com/v1beta').trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1beta';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    // Keep the configured value so request/configuration validation remains authoritative.
  }
  return trimmed;
}

/**
 * Catalog connection rules shared by every model call (Agent lane, text tasks, adapter compiler).
 * 协议按行：这一行声明了 `textProtocol` 就走它，没声明 = 连接的协议（高级区手选的那一个）。
 */
export function vendorModelConnection(vendor: Vendor, model: Model, apiKey: string) {
  const kind = readModelDeclaration(model.meta).textProtocol ?? normalizeProviderKind(vendor.providerKind);
  const headers = extractVendorExtraHeaders(vendor);
  return {
    kind,
    baseURL: kind === 'anthropic'
      ? anthropicBaseUrl((vendor.baseUrlHint || '').trim() || 'https://api.anthropic.com/v1')
      : kind === 'google-generative-ai'
        ? googleGenerativeBaseUrl(vendor.baseUrlHint || '')
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
 * 能力声明（推理三格、请求体覆盖）只从 `model.meta` 读，原样往下递；不按模型名猜。
 */
export function nomiModelConfigFor(vendor: Vendor, model: Model, apiKey: string): NomiModelConfig {
  const connection = vendorModelConnection(vendor, model, apiKey);
  const { reasoning, thinkingLevelMap, compat, requestBodyOverrides } = readModelDeclaration(model.meta);
  const contextWindow = modelContextWindow(model.meta, connection.modelId);
  const maxOutputTokens = (model.meta as Record<string, unknown> | undefined)?.maxOutputTokens;
  return {
    ...connection, providerId: vendor.key, authType: vendor.authType === 'none' ? 'none' : 'api-key',
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens >= 1
      ? { maxOutputTokens: Math.floor(maxOutputTokens) } : {}),
    ...(model.tokenPricing ? { tokenPricing: model.tokenPricing } : {}),
    ...(model.free ? { free: true as const } : {}),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(compat ? { compat } : {}),
    ...(requestBodyOverrides ? { requestBodyOverrides } : {}),
  };
}
