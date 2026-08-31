import { ipcMain } from "electron";
import { appFetch } from "../../appFetch";
import type { AiSdkProviderKind } from "../../catalog/types";
import { describeIllegalHeader, findIllegalHeader, findNonHeaderSafeChar, mergeHeadersCaseInsensitive } from "../../jsonUtils";
import { guessModelKind, type GuessableModelKind } from "../../catalog/modelKindHeuristic";
import {
  buildAuthHeaders,
  describeNetworkErrorLazy,
  fetchModelList,
  readExtraHeaders,
  upstreamErrorText,
} from "./modelListProbe";
import { normalizeProviderKind } from "../../catalog/catalogStore";
import { checkVendorHealth } from "./vendorHealth";
import { createExplicitProxyDispatcher } from "../../systemProxy";

import { assertTrustedSender } from "../../ipcSenderGuard";
import { registerAntigravityIpc } from "../antigravityIpc";
import type { Dispatcher } from "undici";
// ---------------------------------------------------------------------------
// Onboarding — 中转拉取式接入 IPC（手填地址+key → 拉模型 → 按 id 分类 → 保存）。
// 「AI 读文档」子系统已下线（Issue #8：各家中转参数不一，读文档抠参数不可靠）。
// ---------------------------------------------------------------------------

/** 单协议探测结果。mismatch=true 表示像「路由/协议不对」（可换下一个协议试）。 */
type ProtocolProbe = { ok: boolean; status?: number; error?: string; mismatch?: boolean };

/**
 * 用极小请求体探测一个 wire protocol 是否接受。三协议各自的 URL/认证/body 形状：
 *  - anthropic        : host root + /v1/messages，x-api-key + anthropic-version，messages 体（剥尾随 /v1 防双拼）
 *  - openai-responses : {baseUrl}/responses，bearer，{input, max_output_tokens}（非 messages！）
 *  - openai-compatible: {baseUrl}/chat/completions，bearer，{messages, max_tokens}
 */
async function probeOneProtocol(
  kind: AiSdkProviderKind,
  rawBaseUrl: string,
  apiKey: string,
  modelId: string,
  extraHeaders: Record<string, string>,
  signal: AbortSignal,
  proxyUrl?: string,
): Promise<ProtocolProbe> {
  let url: string;
  const headers = mergeHeadersCaseInsensitive({ "content-type": "application/json" }, buildAuthHeaders(kind, apiKey, extraHeaders));
  let body: Record<string, unknown>;
  if (kind === "anthropic") {
    const root = (rawBaseUrl || "https://api.anthropic.com").replace(/\/v1$/i, "");
    url = `${root}/v1/messages`;
    body = { model: modelId || "claude-3-5-haiku-latest", max_tokens: 1, messages: [{ role: "user", content: "ping" }] };
  } else if (kind === "openai-responses") {
    url = `${rawBaseUrl}/responses`;
    body = { model: modelId || "gpt-4o-mini", input: "ping", max_output_tokens: 16 };
  } else {
    url = `${rawBaseUrl}/chat/completions`;
    body = { model: modelId || "gpt-3.5-turbo", messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
  }
  let dispatcher: Dispatcher | undefined;
  try {
    dispatcher = proxyUrl ? createExplicitProxyDispatcher(proxyUrl) : undefined;
    const res = await appFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal, ...(dispatcher ? { dispatcher } : {}) });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    // 404/405/501/502/503 多为「路由/协议不对」→ 换下一个协议；401/403/400 多为鉴权/请求问题（不是协议错）。
    const mismatch = [404, 405, 501, 502, 503].includes(res.status);
    return { ok: false, status: res.status, error: upstreamErrorText(text, res.status), mismatch };
  } catch (error) {
    return { ok: false, error: await describeNetworkErrorLazy(error), mismatch: true };
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => undefined);
  }
}
export function registerOnboardingIpc(): void {
  registerAntigravityIpc();
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

  // 接口协议探测（auto-probe）+ 连接测试。非阻塞，永不 gate 保存。
  // 真实用户接不进来的根因是「不知道选哪个协议」（P4）——默认让主进程替他试：
  // chat↔responses 共享 /v1 baseURL + bearer，只 path/body 不同，挨个发极小请求探测；
  // anthropic（host root + x-api-key）仅当 hostname 像 anthropic 或地址留空时纳入。
  // 专家在表单展开「接口协议」强制指定时，payload.providerKind 给定 → 只测那一个。
  ipcMain.handle("nomi:onboarding:test-connection", async (event, payload: Record<string, unknown>) => {
    assertTrustedSender(event);
    const rawBaseUrl = String(payload?.baseUrl || "").trim().replace(/\/+$/, "");
    const apiKey = String(payload?.apiKey || "").trim();
    const modelId = String(payload?.modelId || "").trim();
    const forcedKind = payload?.providerKind ? normalizeProviderKind(payload.providerKind) : undefined;
    const autoProbe = payload?.autoProbe === true && !forcedKind;
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
      const kind = forcedKind ?? "openai-compatible";
      const headers = buildAuthHeaders(kind, apiKey, extraHeaders);
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
    // 候选协议：强制 → 只它；自动 → chat+responses（+anthropic 当 hostname 像 anthropic 或地址留空）。
    let candidates: AiSdkProviderKind[];
    if (forcedKind) {
      candidates = [forcedKind];
    } else if (autoProbe) {
      const host = (() => {
        try { return new URL(rawBaseUrl).hostname; } catch { return ""; }
      })();
      const anthropicLikely = !rawBaseUrl || /anthropic|claude/i.test(host);
      candidates = !rawBaseUrl
        ? ["anthropic"]
        : anthropicLikely
          ? ["anthropic", "openai-compatible", "openai-responses"]
          : ["openai-compatible", "openai-responses"];
    } else {
      candidates = ["openai-compatible"];
    }
    // openai-* 必须有 http(s) 地址；anthropic 可留空（托管默认）。无地址且无 anthropic 候选 → 直接报错。
    if (!/^https?:\/\//i.test(rawBaseUrl) && !candidates.includes("anthropic")) {
      return { ok: false, error: "接入地址需以 http:// 或 https:// 开头" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      let best: (ProtocolProbe & { kind: AiSdkProviderKind }) | null = null;
      for (const kind of candidates) {
        // openai-* 没地址就跳过（避免 fetch 无效 URL）。
        if (kind !== "anthropic" && !/^https?:\/\//i.test(rawBaseUrl)) continue;
        const r = await probeOneProtocol(kind, rawBaseUrl, apiKey, modelId, extraHeaders, controller.signal, proxyUrl);
        if (r.ok) return { ok: true, status: r.status, detectedKind: kind };
        // 留住「最该报给用户」的错：非 mismatch（鉴权/请求错，可操作）优先于 mismatch（换协议）。
        if (!best || (best.mismatch && !r.mismatch)) best = { ...r, kind };
      }
      return { ok: false, status: best?.status, error: best?.error || "连接失败", detectedKind: forcedKind };
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
    const headers = buildAuthHeaders(providerKind, apiKey, extraHeaders);
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
