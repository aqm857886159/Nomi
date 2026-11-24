// 本地文本模型的「能力预检」——一次最小工具调用探针，回答「这个模型带不带得动 Agent」。
//
// 为什么要它（诚实交付 D4）：本地小模型常常能对话、却跑不动 function-calling → Agent 编排空转。
// 连上不等于能用 Agent。这里发一个**最小的、带一个工具定义的** chat/completions 请求，按响应判：
//   · agent      —— 上游回了 tool_calls（或等价的 function_call）→ 支持工具调用，能当 Agent
//   · chat-only  —— 上游正常回了文本、但没触发工具 → 只能对话，带不动 Agent（UI 明确降级提示，不静默）
//   · unknown    —— 请求本身没跑通（连不上/超时/上游拒）→ 探不出来，不假装知道
//
// 判据只看「有没有 tool_calls 结构」，不看它调得对不对——目的是能力面探测，不是正确性评测。
// 无鉴权：不带 Authorization 头（本地服务对空 Bearer 常直接拒，见 builtinOpenAiCompatibleDraft.ts:73）。
import { appFetch } from "../appFetch";
import { isJsonRecord } from "../jsonUtils";

/** 能力预检结论。不是生命周期状态词表，是一次探测的判定结果（三态离散）。 */
type LocalTextCapabilityVerdict = "agent" | "chat-only" | "unknown";

type LocalTextCapabilityResult = {
  verdict: LocalTextCapabilityVerdict;
  /** unknown 时给一句可诊断的原因（HTTP 码/网络错），供 UI 如实展示。 */
  detail?: string;
};

type LocalTextCapabilityProbeInput = {
  /** OpenAI-兼容 baseURL（含 /v1）。 */
  baseUrl: string;
  /** 要探的模型 id。 */
  modelId: string;
};

type LocalTextCapabilityProbeDeps = {
  fetchImpl?: typeof globalThis.fetch;
  /** 探针超时。默认 15s：本地模型首 token 可能慢（冷加载权重）。 */
  timeoutMs?: number;
};

/** 最小工具定义：一个无副作用的 echo 工具，只为看模型肯不肯发 tool_calls。 */
const PROBE_TOOL = {
  type: "function",
  function: {
    name: "report_ready",
    description: "Call this to report that you can call tools.",
    parameters: {
      type: "object",
      properties: { ok: { type: "boolean", description: "always true" } },
      required: ["ok"],
    },
  },
} as const;

/** 从一条 chat/completions 响应里判断有没有触发工具调用。防御式读——各家字段略有出入。 */
function responseTriggeredTool(json: unknown): boolean {
  if (!isJsonRecord(json)) return false;
  const choices = Array.isArray(json.choices) ? json.choices : [];
  for (const choice of choices) {
    if (!isJsonRecord(choice)) continue;
    const message = isJsonRecord(choice.message) ? choice.message : null;
    if (!message) continue;
    // OpenAI 现行：message.tool_calls[]（非空数组）。
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
    // 旧式 function_call：message.function_call.name 非空。
    const legacy = isJsonRecord(message.function_call) ? message.function_call : null;
    if (legacy && typeof legacy.name === "string" && legacy.name.trim()) return true;
  }
  return false;
}

/**
 * 发一次带工具定义的最小请求，判断模型能力面。
 * 只在**请求真正跑通**时给 agent/chat-only；跑不通一律 unknown（不猜）。
 */
export async function probeLocalTextCapability(
  input: LocalTextCapabilityProbeInput,
  deps: LocalTextCapabilityProbeDeps = {},
): Promise<LocalTextCapabilityResult> {
  const fetchImpl = deps.fetchImpl ?? appFetch;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const body = {
    model: input.modelId,
    messages: [
      { role: "user", content: "Call the report_ready tool with ok=true. Do not reply with text." },
    ],
    tools: [PROBE_TOOL],
    tool_choice: "auto",
    max_tokens: 64,
    stream: false,
  };
  try {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { verdict: "unknown", detail: `HTTP ${res.status}` };
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { verdict: "unknown", detail: "invalid_response" };
    }
    return { verdict: responseTriggeredTool(json) ? "agent" : "chat-only" };
  } catch (error) {
    return { verdict: "unknown", detail: error instanceof Error ? error.message : String(error) };
  }
}
