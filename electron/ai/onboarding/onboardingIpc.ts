import { ipcMain } from "electron";
import type { AiSdkProviderKind } from "../../catalog/types";
import { describeIllegalHeader, findIllegalHeader, findNonHeaderSafeChar } from "../../jsonUtils";
import { guessModelKind } from "../../catalog/modelKindHeuristic";
import { normalizeProviderKind } from "../../catalog/catalogStore";

// ---------------------------------------------------------------------------
// Onboarding — 中转拉取式接入 IPC（手填地址+key → 拉模型 → 按 id 分类 → 保存）。
// 「AI 读文档」子系统已下线（Issue #8：各家中转参数不一，读文档抠参数不可靠）。
// ---------------------------------------------------------------------------

/** 单协议探测结果。mismatch=true 表示像「路由/协议不对」（可换下一个协议试）。 */
type ProtocolProbe = { ok: boolean; status?: number; error?: string; mismatch?: boolean };

async function describeNetworkErrorLazy(error: unknown): Promise<string> {
  const { describeNetworkError } = await import("../../systemProxy");
  return describeNetworkError(error);
}

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
): Promise<ProtocolProbe> {
  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;
  if (kind === "anthropic") {
    const root = (rawBaseUrl || "https://api.anthropic.com").replace(/\/v1$/i, "");
    url = `${root}/v1/messages`;
    headers = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...extraHeaders,
    };
    body = { model: modelId || "claude-3-5-haiku-latest", max_tokens: 1, messages: [{ role: "user", content: "ping" }] };
  } else if (kind === "openai-responses") {
    url = `${rawBaseUrl}/responses`;
    headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders };
    body = { model: modelId || "gpt-4o-mini", input: "ping", max_output_tokens: 16 };
  } else {
    url = `${rawBaseUrl}/chat/completions`;
    headers = { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders };
    body = { model: modelId || "gpt-3.5-turbo", messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
  }
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    // 404/405/501/502/503 多为「路由/协议不对」→ 换下一个协议；401/403/400 多为鉴权/请求问题（不是协议错）。
    const mismatch = [404, 405, 501, 502, 503].includes(res.status);
    return { ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}`, mismatch };
  } catch (error) {
    return { ok: false, error: await describeNetworkErrorLazy(error), mismatch: true };
  }
}

export function registerOnboardingIpc(): void {
  // 「AI 读文档」接入路径已下线（Issue #8：改为中转拉取式接入图片/视频/文本）。

  // PRIMARY model-adding path — manual provider entry (BaseURL + key + models).
  // Deterministic openai-compatible text commit; reuses the single catalog write
  // path. No forced connectivity test (aligns with opencode; see test-connection).
  ipcMain.handle("nomi:onboarding:manual-commit", async (_event, payload: Record<string, unknown>) => {
    try {
      // R1：走唯一 normalizeProviderKind（接受 openai-responses），不再 2 值 clamp。
      const providerKind = normalizeProviderKind(payload?.providerKind);
      const { commitManualOpenAiCompatibleModels } = await import("../../catalog/catalogCommit");
      const headers: Record<string, string> = {};
      if (payload?.headers && typeof payload.headers === "object") {
        for (const [k, v] of Object.entries(payload.headers as Record<string, unknown>)) {
          headers[String(k)] = String(v ?? "");
        }
      }
      const result = commitManualOpenAiCompatibleModels({
        vendorName: String(payload?.vendorName || ""),
        baseUrl: String(payload?.baseUrl || ""),
        apiKey: String(payload?.apiKey || ""),
        providerKind,
        headers,
        models: Array.isArray(payload?.models)
          ? (payload.models as Array<Record<string, unknown>>).map((m) => {
              const k = m?.kind;
              return {
                id: String(m?.id || ""),
                displayName: m?.displayName ? String(m.displayName) : undefined,
                kind: (k === "image" || k === "video" || k === "text" ? k : undefined) as "text" | "image" | "video" | undefined,
              };
            })
          : [],
      });
      return { ok: true, vendorKey: result.vendorKey, committed: result.committed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });

  // 类型启发式（Issue #8）：从 /v1/models 拉到/手填的模型 id 没带类型，主进程按关键词猜
  // 图片/视频/文本（单一真相源 guessModelKind），返回给 UI 预填「类型」下拉，用户可改。
  ipcMain.handle("nomi:onboarding:guess-kinds", async (_event, payload: Record<string, unknown>) => {
    const ids = Array.isArray(payload?.ids) ? (payload.ids as unknown[]).map((x) => String(x || "")) : [];
    const kinds: Record<string, "text" | "image" | "video" | "audio"> = {};
    for (const id of ids) if (id) kinds[id] = guessModelKind(id);
    return { kinds };
  });

  // 接口协议探测（auto-probe）+ 连接测试。非阻塞，永不 gate 保存。
  // 真实用户接不进来的根因是「不知道选哪个协议」（P4）——默认让主进程替他试：
  // chat↔responses 共享 /v1 baseURL + bearer，只 path/body 不同，挨个发极小请求探测；
  // anthropic（host root + x-api-key）仅当 hostname 像 anthropic 或地址留空时纳入。
  // 专家在表单展开「接口协议」强制指定时，payload.providerKind 给定 → 只测那一个。
  ipcMain.handle("nomi:onboarding:test-connection", async (_event, payload: Record<string, unknown>) => {
    const rawBaseUrl = String(payload?.baseUrl || "").trim().replace(/\/+$/, "");
    const apiKey = String(payload?.apiKey || "").trim();
    const modelId = String(payload?.modelId || "").trim();
    const forcedKind = payload?.providerKind ? normalizeProviderKind(payload.providerKind) : undefined;
    const autoProbe = payload?.autoProbe === true && !forcedKind;
    // User-supplied relay/proxy headers replay on every probe so a gateway that gates
    // on them doesn't report a false failure.
    const extraHeaders: Record<string, string> = {};
    if (payload?.headers && typeof payload.headers === "object") {
      for (const [k, v] of Object.entries(payload.headers as Record<string, unknown>)) {
        const key = String(k).trim();
        const value = String(v ?? "").trim();
        if (key && value) extraHeaders[key] = value;
      }
    }
    // 发送前请求头守卫（与 vendorHttp.requestJson 同一判据/措辞）：这条 handler 自带裸 fetch，
    // 不经发送闸——脏 key（含中文/全角）会让 fetch 同步抛原始 ByteString，被 describeNetworkError
    // 误判网络。先识别、说人话、根本不发 fetch（治本，避免「连不上：Cannot convert…」）。
    const keyProblem = apiKey ? findNonHeaderSafeChar(apiKey) : null;
    if (keyProblem) return { ok: false, error: describeIllegalHeader({ name: "API Key", ...keyProblem }).message };
    const headerProblem = findIllegalHeader(extraHeaders);
    if (headerProblem) return { ok: false, error: describeIllegalHeader(headerProblem).message };
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
        const r = await probeOneProtocol(kind, rawBaseUrl, apiKey, modelId, extraHeaders, controller.signal);
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
  ipcMain.handle("nomi:onboarding:list-models", async (_event, payload: Record<string, unknown>) => {
    // R1：唯一归一化器。openai-responses 与 openai-compatible 一样走 GET {baseUrl}/models。
    const providerKind = normalizeProviderKind(payload?.providerKind);
    const rawBaseUrl = String(payload?.baseUrl || "").trim().replace(/\/+$/, "");
    const baseUrl =
      providerKind === "anthropic" && !rawBaseUrl ? "https://api.anthropic.com" : rawBaseUrl;
    const apiKey = String(payload?.apiKey || "").trim();
    if (!/^https?:\/\//i.test(baseUrl)) return { ok: false, error: "接入地址需以 http:// 或 https:// 开头" };
    const extraHeaders: Record<string, string> = {};
    if (payload?.headers && typeof payload.headers === "object") {
      for (const [k, v] of Object.entries(payload.headers as Record<string, unknown>)) {
        const key = String(k).trim();
        const value = String(v ?? "").trim();
        if (key && value) extraHeaders[key] = value;
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const headers: Record<string, string> =
      providerKind === "anthropic"
        ? { "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}), ...extraHeaders }
        : { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders };
    // 发送前请求头守卫（同 test-connection）：自带裸 fetch 绕过发送闸，脏 key 先拦+说人话，不发 fetch。
    const headerProblem = findIllegalHeader(headers);
    if (headerProblem) return { ok: false, error: describeIllegalHeader(headerProblem).message };
    // 候选 URL：openai-compatible baseUrl 通常已含 /v1 → /models；但很多 new-api 后台给的是
    // **裸地址**（不带 /v1）——那样 /models 会 404。鲁棒兜底：依次试 /models 与 /v1/models，
    // 命中即返回（用户填不填 /v1 都能拉到，Issue #8「开箱即用」）。
    const candidates =
      providerKind === "anthropic"
        ? [`${baseUrl}/v1/models`]
        : baseUrl.endsWith("/v1")
          ? [`${baseUrl}/models`, `${baseUrl}/v1/models`]
          : [`${baseUrl}/models`, `${baseUrl}/v1/models`];
    let lastErr = "";
    let lastStatus: number | undefined;
    try {
      for (const url of candidates) {
        let res: Response;
        try { res = await fetch(url, { method: "GET", headers, signal: controller.signal }); }
        catch (e) { lastErr = await describeNetworkErrorLazy(e); continue; }
        if (!res.ok) { lastStatus = res.status; lastErr = (await res.text().catch(() => "")).slice(0, 300) || `HTTP ${res.status}`; continue; }
        const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
        const models = Array.isArray(json?.data) ? json!.data.map((m) => String(m?.id || "").trim()).filter(Boolean) : [];
        return { ok: true, models };
      }
      return { ok: false, status: lastStatus, error: lastErr || "拉取不到模型列表" };
    } finally {
      clearTimeout(timeout);
    }
  });
}
