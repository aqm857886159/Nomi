import { ipcMain, webContents as electronWebContents } from "electron";
import type { WebContents } from "electron";
import { runOnboardingTrial } from "./agent";
import type { ModelKind } from "./types";
import type { AiSdkProviderKind } from "../../catalog/types";
import { describeNetworkError } from "../../systemProxy";
import {
  commitManualOpenAiCompatibleModels,
  commitOnboardedModelToCatalog,
  normalizeProviderKind,
  resolveOnboardingAgentFromCatalog,
} from "../../runtime";

// ---------------------------------------------------------------------------
// Onboarding (M5.4) — IPC bridge for the Wizard UI
// ---------------------------------------------------------------------------

type OnboardingSession = {
  trialId: string;
  webContentsId: number;
  cancelled: boolean;
};

const onboardingSessions = new Map<string, OnboardingSession>();

function sendOnboardingEvent(session: OnboardingSession, event: unknown): void {
  const target: WebContents | undefined = electronWebContents.fromId(session.webContentsId) || undefined;
  if (!target || target.isDestroyed()) return;
  target.send("nomi:onboarding:event", { trialId: session.trialId, event });
}

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
    return { ok: false, error: describeNetworkError(error), mismatch: true };
  }
}

export function registerOnboardingIpc(): void {
  ipcMain.handle("nomi:onboarding:start", async (event, payload: Record<string, unknown>) => {
    const docsUrl = String(payload?.docsUrl || "").trim();
    const userApiKey = String(payload?.userApiKey || "").trim();
    if (!docsUrl) throw new Error("docsUrl required");
    if (!userApiKey) throw new Error("userApiKey required");

    // The onboarding doc-reader LLM is resolved in this priority order:
    //   1. payload.agent — explicit override (the Lab CLI passes --agent-* here).
    //   2. a configured TEXT model in the catalog — the product path. This is the
    //      model the user already added in 模型设置 (e.g. dm-fox GPT-5.5); it works
    //      identically in dev and a packaged app, no env / no .secrets needed.
    //   3. NOMI_ONBOARDING_AGENT_* env vars — dev/headless fallback only.
    const agentConfig = (payload?.agent || {}) as Record<string, unknown>;
    const fromCatalog = resolveOnboardingAgentFromCatalog();
    const agent = {
      // 单一归一化器（R1）：不再 `as ProviderKind` 裸 cast——任意脏值流经 normalizeProviderKind 才到工厂。
      providerKind: normalizeProviderKind(
        agentConfig.providerKind || fromCatalog?.providerKind || process.env.NOMI_ONBOARDING_AGENT_PROVIDER,
      ),
      baseUrl: String(agentConfig.baseUrl || fromCatalog?.baseUrl || process.env.NOMI_ONBOARDING_AGENT_BASE_URL || ""),
      modelId: String(agentConfig.modelId || fromCatalog?.modelId || process.env.NOMI_ONBOARDING_AGENT_MODEL || ""),
      apiKey: String(agentConfig.apiKey || fromCatalog?.apiKey || process.env.NOMI_ONBOARDING_AGENT_KEY || ""),
      // Replay the catalog vendor's custom headers so the doc-reader reaches the
      // same relay/proxy gateway the user's text model is behind.
      ...(fromCatalog?.extraHeaders ? { extraHeaders: fromCatalog.extraHeaders } : {}),
    };
    if (!agent.baseUrl || !agent.modelId || !agent.apiKey) {
      throw new Error(
        "Onboarding agent not configured. Add a text model (e.g. GPT/Kimi) in 模型设置 first — it will be used to read the docs.",
      );
    }

    // Optional target kind hint; if absent, the agent infers from the docs.
    const targetKind = (payload?.targetKind as ModelKind) || undefined;

    const trialId = `onboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: OnboardingSession = { trialId, webContentsId: event.sender.id, cancelled: false };
    onboardingSessions.set(trialId, session);

    queueMicrotask(() => {
      void runOnboardingTrial({
        trialId,
        docsUrl,
        targetKind: targetKind ?? ("image" as ModelKind), // initial seed; the agent overrides it via set_model_kind after reading the docs
        userApiKey,
        agent,
        // Async APIs legitimately need ~11 tool calls (create + query stage),
        // and a self-corrected 404 can eat one more. 10 was too tight and left
        // drafts "partial" (test passed, query stage never wired). 14 gives margin.
        maxSteps: Number(payload?.maxSteps) || 14,
        onEvent: (evt) => sendOnboardingEvent(session, evt),
      })
        .then((outcome) => {
          // Auto-commit on success so the wizard's "success" event already shows the persisted model.
          let committedModel: unknown = null;
          if (outcome.status === "success") {
            try {
              committedModel = commitOnboardedModelToCatalog({ outcome, userApiKey });
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              sendOnboardingEvent(session, { type: "commit-error", message });
            }
          }
          sendOnboardingEvent(session, { type: "result", outcome, committedModel });
          sendOnboardingEvent(session, { type: "done", reason: "finished" });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          sendOnboardingEvent(session, { type: "error", message });
          sendOnboardingEvent(session, { type: "done", reason: "error" });
        })
        .finally(() => {
          onboardingSessions.delete(trialId);
        });
    });

    return { trialId };
  });

  ipcMain.handle("nomi:onboarding:cancel", async (_event, payload: { trialId: string }) => {
    const session = onboardingSessions.get(payload.trialId);
    if (!session) return { ok: false, error: "session not found" };
    // True cancellation requires plumbing AbortSignal through generateText.
    // For now flag the session; the next "done" emit will see cancelled=true.
    session.cancelled = true;
    sendOnboardingEvent(session, { type: "cancelled" });
    return { ok: true };
  });

  // PRIMARY model-adding path — manual provider entry (BaseURL + key + models).
  // Deterministic openai-compatible text commit; reuses the single catalog write
  // path. No forced connectivity test (aligns with opencode; see test-connection).
  ipcMain.handle("nomi:onboarding:manual-commit", async (_event, payload: Record<string, unknown>) => {
    try {
      // R1：走唯一 normalizeProviderKind（接受 openai-responses），不再 2 值 clamp。
      const providerKind = normalizeProviderKind(payload?.providerKind);
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
          ? (payload.models as Array<Record<string, unknown>>).map((m) => ({
              id: String(m?.id || ""),
              displayName: m?.displayName ? String(m.displayName) : undefined,
            }))
          : [],
      });
      return { ok: true, vendorKey: result.vendorKey, committed: result.committed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
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
    try {
      // openai-compatible baseUrl already ends in /v1 → /models; anthropic baseUrl
      // is the host root → /v1/models.
      const url =
        providerKind === "anthropic" ? `${baseUrl}/v1/models` : `${baseUrl}/models`;
      const headers: Record<string, string> =
        providerKind === "anthropic"
          ? {
              "anthropic-version": "2023-06-01",
              ...(apiKey ? { "x-api-key": apiKey } : {}),
              ...extraHeaders,
            }
          : {
              ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
              ...extraHeaders,
            };
      const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}` };
      }
      const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
      const models = Array.isArray(json?.data)
        ? json!.data.map((m) => String(m?.id || "").trim()).filter(Boolean)
        : [];
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: describeNetworkError(error) };
    } finally {
      clearTimeout(timeout);
    }
  });
}
