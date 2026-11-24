import { ipcMain } from "electron";
import { upsertRendererCatalogVendorApiKey } from "../../catalog/rendererCatalogMutation";
import type { AiSdkProviderKind } from "../../catalog/types";
import { describeIllegalHeader, findIllegalHeader } from "../../jsonUtils";
import { guessModelKind, type GuessableModelKind } from "../../catalog/modelKindHeuristic";
import {
  buildAuthHeaders,
  fetchModelList,
  readExtraHeaders,
} from "./modelListProbe";
import { normalizeProviderKind, readCatalog } from "../../catalog/catalogStore";
import { connectionAuthSpec } from "../../catalog/vendorAuthSpec";
import type { VendorAuthSpec } from "../requestPipeline";
import { priceQueryFromRequest } from "./vendorPriceRequest";
import { readVendorPricePreview } from "./vendorPricePreview";
import { checkVendorAccountBalance, readModelSettingsAccount, readVendorAccountBalance } from "./vendorAccountBalance";

import { readModelSettingsUsage, readModelUnitPrices } from "./modelSettingsUsage";
import { assertTrustedSender } from "../../ipcSenderGuard";
import { registerAntigravityIpc } from "../antigravityIpc";
// ---------------------------------------------------------------------------
// Onboarding — 中转拉取式接入 IPC（手填地址+key → 拉模型 → 按 id 分类 → 保存）。
// 「AI 读文档」子系统已下线（Issue #8：各家中转参数不一，读文档抠参数不可靠）。
// ---------------------------------------------------------------------------

/**
 * 探测这条地址时该用哪份鉴权说法：全新接入 = 没有已保存的连接 → 按协议缺省；
 * 重测一条已存在的连接 → 用它声明的那份（方案词只住在那里，向导上没有填它的格子）。
 */
function savedConnectionAuth(baseUrl: string, kind: AiSdkProviderKind): VendorAuthSpec {
  return connectionAuthSpec({ baseUrl, authType: kind === "anthropic" ? "x-api-key" : "bearer" });
}

export function registerOnboardingIpc(): void {
  registerAntigravityIpc();
  ipcMain.handle("nomi:model-catalog:vendor-api-key:upsert", async (event, vendorKey: string, payload: unknown) => {
    assertTrustedSender(event);
    try { return { ok: true, value: await upsertRendererCatalogVendorApiKey(vendorKey, payload) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });

  ipcMain.handle("nomi:onboarding:model-unit-prices", (event, vendorKey: string) => {
    assertTrustedSender(event);
    return readModelUnitPrices(vendorKey);
  });

  ipcMain.handle("nomi:onboarding:model-usage", (event, vendorKey: string) => {
    assertTrustedSender(event);
    return readModelSettingsUsage(vendorKey);
  });

  ipcMain.handle("nomi:onboarding:model-account", (event, vendorKey: string, refresh?: boolean) => {
    assertTrustedSender(event);
    return readModelSettingsAccount(vendorKey, refresh === true);
  });

  // 发送键上的约价：渲染层交来最终请求，这里只投影成询价、读公开价目（不带凭据的 GET）。
  // 约价只是显示——这条口不创建任务、不发生成请求、不产生花钱授权。
  ipcMain.handle("nomi:onboarding:vendor-price-preview", (event, payload) => {
    assertTrustedSender(event);
    const query = priceQueryFromRequest(payload, readCatalog());
    return query ? readVendorPricePreview(query) : null;
  });

  // 官方供应商账户余额只读查询（与公开约价解耦，仅在余额不足时提示「还差 N 积分 · 去充值」）。
  ipcMain.handle("nomi:onboarding:vendor-account-balance", (event, payload) => {
    assertTrustedSender(event);
    if (payload?.source === "apimart-connect") {
      return checkVendorAccountBalance({ vendorKey: "apimart" });
    }
    return readVendorAccountBalance(payload);
  });

  // 类型启发式（Issue #8）：从 /v1/models 拉到/手填的模型 id 没带类型，主进程按关键词猜
  // 图片/视频/文本/配音/3D（单一真相源 guessModelKind），返回给 UI 标在每行上，用户可就地改。
  ipcMain.handle("nomi:onboarding:guess-kinds", async (event, payload: Record<string, unknown>) => {
    assertTrustedSender(event);
    const ids = Array.isArray(payload?.ids) ? (payload.ids as unknown[]).map((x) => String(x || "")) : [];
    const kinds: Record<string, GuessableModelKind> = {};
    for (const id of ids) if (id) kinds[id] = guessModelKind(id);
    return { kinds };
  });

  // Auto-discover the endpoint's models via the standard list-models call, so the
  // user picks from real model ids instead of guessing/typing. Relays are usually
  // OpenAI-compatible and expose this; when they don't, the UI falls back to manual
  // id entry (this just returns ok:false and nothing is blocked).
  ipcMain.handle("nomi:onboarding:list-models", async (event, payload: Record<string, unknown>) => {
    assertTrustedSender(event);
    // R1：唯一归一化器。openai-responses 与 openai-compatible 一样走 GET {baseUrl}/models。
    const providerKind = normalizeProviderKind(payload?.providerKind);
    const rawBaseUrl = String(payload?.baseUrl || "").trim().replace(/\/+$/, "");
    const baseUrl =
      providerKind === "anthropic" && !rawBaseUrl ? "https://api.anthropic.com" : rawBaseUrl;
    const apiKey = String(payload?.apiKey || "").trim();
    if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, failureKind: "invalid_response", error: "接入地址需以 http:// 或 https:// 开头" };
    const extraHeaders = readExtraHeaders(payload?.headers);
    const proxyUrl = typeof payload?.proxyUrl === "string" ? payload.proxyUrl : undefined;
    const headers = buildAuthHeaders(providerKind, apiKey, extraHeaders, savedConnectionAuth(baseUrl, providerKind));
    // 发送前请求头守卫：自带裸 fetch 绕过发送闸，脏 key 先拦+说人话，不发 fetch。
    const headerProblem = findIllegalHeader(headers);
    if (headerProblem) return { ok: false, failureKind: "auth", error: describeIllegalHeader(headerProblem).message };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      return await fetchModelList(providerKind, baseUrl, headers, controller.signal, { proxyUrl });
    } finally {
      clearTimeout(timeout);
    }
  });
}
