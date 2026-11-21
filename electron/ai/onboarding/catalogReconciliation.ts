/**
 * 拉模型列表、对账「暂未列出」——启动时一次、之后每天一次。
 *
 * 这里原来是「供应商连接健康」：打开模型面板就探一次 `/models`，把结果说成「连得上 / 连不上」。
 * D-1117-delete-verification（用户 2026-11-17、协调 2026-11-18 批）把那个判断整套删了：它的唯一产出
 * 是「这家行不行」，而真发一次才是最好的检查；错地址等第一次真生成在节点上报错，是用户接受的代价。
 * 留下的只是拉列表这件事本身——它产出的是数据（哪些模型供应商现在没列），不是判断。
 *
 * 为什么在主进程：明文 key 在 `apiKeysByVendor` 里加密存着，只有主进程能自取。
 */
import { providerProxyUrl } from "../../providerNetwork";
import { logWarn } from "../../logging/logger";
import { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import type { AiSdkProviderKind } from "../../catalog/types";
import { readCatalog, normalizeProviderKind, mutateCatalog } from "../../catalog/catalogStore";
import { decryptApiKeyRecord } from "../../catalog/secrets";
import { isJsonRecord, mergeHeadersCaseInsensitive } from "../../jsonUtils";
import { authHeaders, authQueryParams } from "../requestPipeline";
import { userVendorBaseUrl } from "../../catalog/userVendorBase";
import { vendorAuthSpec } from "../../catalog/vendorAuthSpec";
import { fetchModelList, readExtraHeaders } from "./modelListProbe";
import { modelListReconciliation } from "../../catalog/modelListReconcile";

const PROBE_TIMEOUT_MS = 12_000;

type Entry = {
  /** 凭证/地址/协议的指纹——任一变化即作废上一次的 ETag 和在途请求的结果。 */
  fingerprint: string;
  validator?: { url: string; etag: string };
  inflight?: Promise<void>;
};

const cache = new Map<string, Entry>();

/** 测试用：清空 ETag 与在途记录。 */
export function resetCatalogReconciliationCache(): void {
  cache.clear();
}

type Target = {
  baseUrl: string;
  providerKind: AiSdkProviderKind;
  headers: Record<string, string>;
  query: Record<string, string>;
  fingerprint: string;
  proxyUrl?: string;
};

/** 取这家的列表请求目标；null = 不该发（无 key / 本地后端 / 没填地址 / 创作者关了 key）。 */
function resolveTarget(vendorKey: string): Target | null {
  const state = readCatalog();
  const vendor = state.vendors.find((v) => v.key === vendorKey);
  if (!vendor || vendor.authType === "none" || !vendor.hasApiKey) return null;
  const baseUrl = userVendorBaseUrl(vendor);
  if (!/^https?:\/\//i.test(baseUrl)) return null;
  const record = state.apiKeysByVendor[vendorKey];
  // 走带开关闸的读口：创作者关掉的 key 不解密、不出门（以前为「复验待验证」开的口子随那一档删了）。
  const apiKey = decryptApiKeyRecord(record) || "";
  if (!apiKey) return null;
  const providerKind = normalizeProviderKind(vendor.providerKind);
  const authType = vendor.authType || (providerKind === "anthropic" ? "x-api-key" : "bearer");
  const headers = mergeHeadersCaseInsensitive(
    providerKind === "anthropic" ? { "anthropic-version": "2023-06-01" } : {},
    authHeaders({ ...vendorAuthSpec(vendor), authType }, apiKey),
    readExtraHeaders(isJsonRecord(vendor.meta) ? vendor.meta.extraHeaders : undefined),
  );
  const query = authQueryParams({ ...vendorAuthSpec(vendor), authType }, apiKey);
  return {
    baseUrl,
    proxyUrl: providerProxyUrl(vendor),
    providerKind,
    headers,
    query,
    fingerprint: createHash("sha256").update(JSON.stringify({
      baseUrl, updatedAt: record?.updatedAt, providerKind, authType,
      authHeader: vendor.authHeader, authQueryParam: vendor.authQueryParam, headers, query, proxyUrl: providerProxyUrl(vendor),
    })).digest("hex"),
  };
}

async function pullModelList(vendorKey: string, target: Target): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const entry = cache.get(vendorKey);
    const res = await fetchModelList(target.providerKind, target.baseUrl, target.headers, controller.signal, {
      query: target.query,
      proxyUrl: target.proxyUrl,
      validator: entry?.fingerprint === target.fingerprint ? entry.validator : undefined,
    });
    // 写之前再读一次：请求途中改了 key / 地址 / 删了这家，这次的列表就不算数。
    if (resolveTarget(vendorKey)?.fingerprint !== target.fingerprint || !res.ok || res.partial) return;
    const current = cache.get(vendorKey);
    if (current?.fingerprint === target.fingerprint) current.validator = res.validator;
    if (!modelListReconciliation(readCatalog().models, vendorKey, res).length) return;
    mutateCatalog((tx, state) => {
      // 只改「暂未列出」，从不改创作者的开关。
      for (const patch of modelListReconciliation(state.models, vendorKey, res)) tx.upsertModel(patch);
    });
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("nomi:model-catalog:changed");
  } finally {
    clearTimeout(timer);
  }
}

/** 对一家拉一次列表；同一家的并发请求合流成一次。拉不到就什么都不说——这里不产出「连不上」。 */
export async function reconcileVendorModelList(vendorKey: string): Promise<void> {
  const target = resolveTarget(vendorKey);
  if (!target) return;
  const entry = cache.get(vendorKey);
  if (entry?.fingerprint === target.fingerprint && entry.inflight) return entry.inflight;
  const inflight = pullModelList(vendorKey, target)
    .catch(() => undefined)
    .finally(() => {
      const current = cache.get(vendorKey);
      if (current?.inflight === inflight) current.inflight = undefined;
    });
  cache.set(vendorKey, { fingerprint: target.fingerprint, validator: entry?.fingerprint === target.fingerprint ? entry.validator : undefined, inflight });
  return inflight;
}

/** 有 key、有文本模型的家逐个对账（文本模型的名单最常变，媒体模型多是种子声明的）。 */
export async function reconcileTextVendorCatalogs(): Promise<void> {
  const state = readCatalog();
  const vendors = state.vendors.filter((vendor) => (
    vendor.hasApiKey && state.models.some((model) => model.vendorKey === vendor.key && model.kind === "text")
  ));
  for (const vendor of vendors) await reconcileVendorModelList(vendor.key);
}

export function startCatalogReconciliation(): () => void {
  const run = (): void => { void reconcileTextVendorCatalogs().catch(() => logWarn("catalog", "reconcile-failed", { reason: "catalog unavailable" })) }
  run()
  const timer = setInterval(run, 24 * 60 * 60_000)
  timer.unref()
  return () => clearInterval(timer)
}
