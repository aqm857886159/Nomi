import { ipcMain } from "electron";
import { upsertRendererCatalogVendorApiKey } from "../../catalog/rendererCatalogMutation";
import type { AiSdkProviderKind } from "../../catalog/types";
import { describeIllegalHeader, findIllegalHeader, findNonHeaderSafeChar } from "../../jsonUtils";
import { guessModelKind, type GuessableModelKind } from "../../catalog/modelKindHeuristic";
import {
  buildAuthHeaders,
  fetchModelList,
  readExtraHeaders,
} from "./modelListProbe";
import { normalizeProviderKind } from "../../catalog/catalogStore";
import { credentialProbePlan } from "../../catalog/credentialProbePolicy";
import { connectionAuthSpec } from "../../catalog/vendorAuthSpec";
import type { VendorAuthSpec } from "../requestPipeline";
import { checkVendorHealth } from "./vendorHealth";

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

  // 「这家验一次 key 要不要花钱」——接入页的按钮文案读它（T-MO-10，用户 2026-09-22 拍板）。
  // 判据不在渲染层第二次成立：这里只是把主进程那份唯一策略（credentialProbePolicy）投影出去，
  // 「AI 读文档」接入路径已下线（Issue #8：改为中转拉取式接入图片/视频/文本）。

  // 供应商连接健康：模型面板每次打开时按家自查「现在能不能用」。凭证由主进程自取——
  // renderer 只有 hasApiKey 布尔，这也是旧实现「只在粘贴 key 那一刻能测」的根因。
  ipcMain.handle("nomi:onboarding:vendor-health", async (event, payload: Record<string, unknown>) => {
    assertTrustedSender(event);
    const vendorKey = String(payload?.vendorKey || "").trim();
    if (!vendorKey) return { vendorKey: "", state: "unsupported" as const, checkedAt: Date.now() };
    return checkVendorHealth(vendorKey, payload?.force === true);
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

  // 连接自检只走 credentialProbePolicy 允许的免费探测；自建中转没有内置种子，统一落到 GET /models。
  // 这个按钮不负责猜 openai-compatible 与 openai-responses，真正生成时若协议不对再由现有错误指路。
  ipcMain.handle("nomi:onboarding:test-connection", async (event, payload: Record<string, unknown>) => {
    assertTrustedSender(event);
    const rawBaseUrl = String(payload?.baseUrl || "").trim().replace(/\/+$/, "");
    const apiKey = String(payload?.apiKey || "").trim();
    const forcedKind = payload?.providerKind ? normalizeProviderKind(payload.providerKind) : undefined;
    const vendorKey = String(payload?.vendorKey || "").trim();
    const probePlan = credentialProbePlan(vendorKey);
    // 「接口协议」只管**文本**模型怎么发聊天；图片/视频走 mapping 的自有端点（如 new-api 的
    // /v1/video/generations），压根不读 providerKind。所以当用户一个文本模型都没选时（纯图片/
    // 视频中转），拿模型 id 去发 chat/completions 必然被上游拒——那是我们探错了，不是他接不通。
    // 这种情况改探「地址+Key 通不通」：GET /models 成功即通（零成本、不需要任何模型 id）。
    const reachabilityOnly = payload?.probe === "reachability";
    // User-supplied relay/proxy headers replay on every probe so a gateway that gates
    // on them doesn't report a false failure.
    const extraHeaders = readExtraHeaders(payload?.headers);
    const proxyUrl = typeof payload?.proxyUrl === "string" ? payload.proxyUrl : undefined;
    // 发送前请求头守卫（与 vendorHttp.requestJson 同一判据/措辞）：这条 handler 自带裸 fetch，
    // 不经发送闸——脏 key（含中文/全角）会让 fetch 同步抛原始 ByteString，被 describeNetworkError
    // 误判网络。先识别、说人话、根本不发 fetch（治本，避免「连不上：Cannot convert…」）。
    const keyProblem = apiKey ? findNonHeaderSafeChar(apiKey) : null;
    if (keyProblem) return { ok: false, failureKind: "auth", error: describeIllegalHeader({ name: "API Key", ...keyProblem }).message };
    const headerProblem = findIllegalHeader(extraHeaders);
    if (headerProblem) return { ok: false, failureKind: "auth", error: describeIllegalHeader(headerProblem).message };
    // 纯图片/视频上游：不探协议（探了也白探，它们不走 providerKind），只探地址+Key 通不通。
    if (reachabilityOnly) {
      if (!/^https?:\/\//i.test(rawBaseUrl)) return { ok: false, failureKind: "invalid_response", error: "接入地址需以 http:// 或 https:// 开头" };
      if (probePlan.kind !== "model-list") return { ok: false, failureKind: "unsupported", error: "该连接需要在首次使用时自检" };
      const kind = forcedKind ?? "openai-compatible";
      // 已保存的那条连接可能声明了方案词（Higgsfield 的 `Key id:secret`）。不带它探，
      // 得到的 401 说的是「我们头拼错了」，用户读到的却是「你的 key 不对」。
      const headers = buildAuthHeaders(kind, apiKey, extraHeaders, savedConnectionAuth(rawBaseUrl, kind));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const listed = await fetchModelList(kind, rawBaseUrl, headers, controller.signal, { proxyUrl });
        return listed.ok
          ? { ok: true, reachabilityOnly: true }
          : { ok: false, status: listed.status, failureKind: listed.failureKind, error: listed.error };
      } finally {
        clearTimeout(timeout);
      }
    }
    if (probePlan.kind !== "model-list") return { ok: false, failureKind: "unsupported", error: "该连接需要在首次使用时自检" };
    const host = (() => {
      try { return new URL(rawBaseUrl).hostname; } catch { return ""; }
    })();
    const anthropicLikely = /anthropic|claude/i.test(host);
    const kind: AiSdkProviderKind = forcedKind ?? (anthropicLikely ? "anthropic" : "openai-compatible");
    if (!/^https?:\/\//i.test(rawBaseUrl) && kind !== "anthropic") {
      return { ok: false, error: "接入地址需以 http:// 或 https:// 开头" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const headers = buildAuthHeaders(kind, apiKey, extraHeaders, savedConnectionAuth(rawBaseUrl, kind));
      const listed = await fetchModelList(kind, rawBaseUrl || "https://api.anthropic.com", headers, controller.signal, { proxyUrl });
      return listed.ok
        ? { ok: true, status: listed.statuses.at(-1), ...(kind === "anthropic" ? { detectedKind: "anthropic" as const } : {}) }
        : { ok: false, status: listed.status, failureKind: listed.failureKind, error: listed.error };
    } finally {
      clearTimeout(timeout);
    }
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
    // 发送前请求头守卫（同 test-connection）：自带裸 fetch 绕过发送闸，脏 key 先拦+说人话，不发 fetch。
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
