// 本地文本模型端点探测（接入页「本地模型」预设卡调用）。
//
// 三家本地运行时（Ollama / LM Studio / LocalAI）都开 OpenAI-兼容口，只是默认端口不同。
// 这里做**零供应商专有代码**的通用探测：对每个候选端口 GET {origin}/v1/models，
// 谁回得出一份能解析的模型列表就算探到——命中判据是「解析得出模型列表」而不是「HTTP 200」
// （沿用 modelListResponse 的血泪教训：SPA 会用 200 回一页 index.html 骗过纯状态码判断）。
//
// 只探**文本**：本地图像/视频已归 ComfyUI（comfyuiLocal.ts），不在此开并行版。
// 用 appFetch（undici，不认系统代理）直连 127.0.0.1——对本地服务正是要的，不被 Clash 等代理绕开
// （同 comfyuiProbe.ts 的选择）。
import { appFetch } from "../appFetch";
import { parseModelListResponse } from "../ai/onboarding/modelListResponse";

/** 一个可探测的本地运行时候选（端口 + 展示名 + 官网，供 UI 提示与安装引导）。 */
export type LocalTextRuntimeCandidate = {
  /** 稳定 id，回传给 UI 标「探到的是哪家」。 */
  id: "ollama" | "lmstudio" | "localai";
  /** 展示名（英文技术名，不翻译）。 */
  label: string;
  /** 默认监听端口。 */
  port: number;
  /** 安装/文档主页（UI「去装它」链接）。 */
  homepage: string;
  /** 显式 baseURL 覆盖（仅 env 注入的 stub 用；设了则不按 {host}:{port} 拼装）。 */
  baseUrlOverride?: string;
};

/**
 * 候选运行时清单，**做成可注入常量**（测试要用真 stub 服务器覆盖端口）。
 * Ollama 11434 / LM Studio 1234 / LocalAI 8080 是三家桌面/自托管主流的默认端口。
 */
const LOCAL_TEXT_RUNTIME_CANDIDATES: readonly LocalTextRuntimeCandidate[] = [
  { id: "ollama", label: "Ollama", port: 11434, homepage: "https://ollama.com/download" },
  { id: "lmstudio", label: "LM Studio", port: 1234, homepage: "https://lmstudio.ai" },
  { id: "localai", label: "LocalAI", port: 8080, homepage: "https://localai.io" },
];

/** 单端口探测的返回：探到（带 baseUrl + 模型列表）或没探到（安静，不是错误——本地服务本就常没开）。 */
type LocalTextEndpointHit = {
  id: LocalTextRuntimeCandidate["id"];
  label: string;
  /** 建档要用的 OpenAI-兼容 baseURL（已含 /v1）。 */
  baseUrl: string;
  /** 这台上拉到的模型 id 列表（可能为空 = 服务在但一个模型都没拉/加载）。 */
  models: string[];
};

type LocalTextProbeResult = {
  /** 探到的运行时（按候选顺序）。空数组 = 一个本地端口都没开——UI 安静提示，不报错。 */
  hits: LocalTextEndpointHit[];
};

/** 探测用的注入面（测试传入自定 fetch + 候选表 + 超时；生产用默认）。 */
type LocalTextProbeDeps = {
  fetchImpl?: typeof globalThis.fetch;
  candidates?: readonly LocalTextRuntimeCandidate[];
  /** 单端口超时。默认 1200ms：本地要么秒回、要么根本没开，短超时避免整排卡住。 */
  timeoutMs?: number;
  /** 探测的主机（默认 127.0.0.1；测试用回环 stub）。 */
  host?: string;
};

/** {host}:{port} → OpenAI-兼容 baseURL（含 /v1）。 */
export function localTextBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}/v1`;
}

/**
 * 测试专用覆盖：`NOMI_LOCAL_TEXT_PROBE_BASE_URLS`（逗号分隔的 http baseURL，各含 /v1）让走查把探测
 * 指向随机端口的 stub 服务器，避免占用真实 11434/1234/8080（会和本机真运行时/其它 worktree 抢端口）。
 * 生产不设此 env → 走默认端口扫描，行为不变。解析失败/为空 → 返回 null（回落默认）。
 */
export function candidatesFromEnv(raw: string | undefined): LocalTextRuntimeCandidate[] | null {
  const value = (raw || "").trim();
  if (!value) return null;
  const out: LocalTextRuntimeCandidate[] = [];
  for (const entry of value.split(",")) {
    const url = entry.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    const port = Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
    // env 覆盖只用于把探测指向 stub；固定归到 ollama 身份（走查只验版式，不辨具体家）。
    // baseUrlOverride 保留完整 origin（stub 可能不在 127.0.0.1），并补 /v1。
    const baseUrlOverride = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`.replace(/\/v1$/i, "") + "/v1";
    out.push({ id: "ollama", label: "Ollama", port, homepage: RUNTIME_HOMEPAGES_OLLAMA, baseUrlOverride });
  }
  return out.length > 0 ? out : null;
}

const RUNTIME_HOMEPAGES_OLLAMA = "https://ollama.com/download";

/** 探一个候选端口：GET {baseUrl}/models，解析得出列表才算命中。任何失败（连不上/超时/非列表）都安静返回 null。 */
async function probeOneEndpoint(
  candidate: LocalTextRuntimeCandidate,
  deps: Required<Pick<LocalTextProbeDeps, "fetchImpl" | "timeoutMs" | "host">>,
): Promise<LocalTextEndpointHit | null> {
  const baseUrl = candidate.baseUrlOverride || localTextBaseUrl(deps.host, candidate.port);
  try {
    // 本地无鉴权：不带 Authorization 头（有的本地服务对空 Bearer 直接拒——见 builtinOpenAiCompatibleDraft.ts:73）。
    const res = await deps.fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.text();
    const models = parseModelListResponse(body);
    if (models === null) return null; // 不是合法模型列表（可能 SPA 200 回了 HTML）→ 不算命中
    return { id: candidate.id, label: candidate.label, baseUrl, models };
  } catch {
    return null; // 连不上/超时：本地服务没开，安静跳过
  }
}

/**
 * 并发探测所有候选端口，返回探到的运行时。
 * 没开的端口不产生噪音——UI 据 hits.length===0 显示「没检测到本地服务」的安静态。
 */
export async function probeLocalTextEndpoints(deps: LocalTextProbeDeps = {}): Promise<LocalTextProbeResult> {
  const candidates =
    deps.candidates ??
    candidatesFromEnv(process.env.NOMI_LOCAL_TEXT_PROBE_BASE_URLS) ??
    LOCAL_TEXT_RUNTIME_CANDIDATES;
  const resolved = {
    fetchImpl: deps.fetchImpl ?? appFetch,
    timeoutMs: deps.timeoutMs ?? 1200,
    host: deps.host ?? "127.0.0.1",
  };
  const results = await Promise.all(candidates.map((candidate) => probeOneEndpoint(candidate, resolved)));
  return { hits: results.filter((hit): hit is LocalTextEndpointHit => hit !== null) };
}
