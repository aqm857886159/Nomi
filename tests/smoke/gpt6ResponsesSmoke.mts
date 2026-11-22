// GPT-6 两行走 Responses 的接入冒烟（设计卡 docs/plan/2026-11-22-gpt6-responses.md ★9「付费冒烟」）。
//
// 一条 APIMart 管道的 Agent 多步带工具任务：种子行 → `nomiModelConfigFor` → Agent lane（真 pi）→ 出网。不起窗口。
// 量四样：①每次请求去的网址；②上游返回过的推理条目（`encrypted_content`），在后面的请求里有没有原样带回；
// ③工具调用写对几次 / 共几次；④整轮成没成。判过 = 全部请求都去 /v1/responses、≥3 次请求、≥2 次工具调用且都不是错误、
// 返回过的每条推理条目（id + encrypted_content 非空）都在之后每一次请求里原样出现、没有 4xx、最后一句话到了。
// 上游一条推理条目都没返回时回放没被检验到，单列「部分」，不算过。
//
//   免费演练（默认）：对端是本机假上游（回环 Responses 夹具），一分钱不花：
//     NO_PROXY=127.0.0.1,localhost npx tsx tests/smoke/gpt6ResponsesSmoke.mts [--model gpt-6-astra|gpt-6.1-sol] [--out <目录>]
//   真付费（协调跑，只跑一次）：对端是 https://api.apimart.ai，key 只从环境变量 APIMART_API_KEY 读、不写进任何输出：
//     NOMI_SPEND_OK=1 APIMART_API_KEY=<key> npx tsx tests/smoke/gpt6ResponsesSmoke.mts --paid --model gpt-6.1-sol --out <目录>
//   预计 3 次请求（每次输出上限 600 token，GPT-6.1 Sol 的价目约一两分钱以内）；CI 里拒跑；没设 NOMI_SPEND_OK=1 拒跑；
//   拒跑发生在任何出网之前，且种子行上没有 `textProtocol: openai-responses`（= 修复不在这份代码里）也拒跑。
import fs from "node:fs";
import { makeTempDir } from "../../scripts/_test-temp.mjs";
import path from "node:path";
import { createHttpFixture } from "../agent-runtime/httpFixture.mjs";
import { createDocumentPort } from "../agent-runtime/laneFixture.mjs";
import { createDocumentLaneTools } from "../../electron/agentLane/laneDocumentTools";
import { openLane } from "../../electron/agentLane/laneHost.mjs";
import { nomiModelConfigFor } from "../../electron/ai/vendorModelConnection";
import { applyBuiltinSeeds } from "../../electron/catalog/seedBuiltins";
import { readModelDeclaration } from "../../electron/catalog/modelDeclaration";

/** 本刀的修复标记：产物里必须能看到的事实——这一行的声明（不是名字表）把协议定成了 Responses。 */
const FIX_MARKER = "textProtocol=openai-responses(declared-on-row)";
const PAID_REQUEST_BUDGET = 3;

type Json = Record<string, unknown>;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => { const at = args.indexOf(name); return at >= 0 && args[at + 1] ? args[at + 1]! : fallback; };
const paid = flag("--paid");
const modelKey = option("--model", "gpt-6.1-sol");
const outDir = option("--out", makeTempDir("gpt6-responses-smoke-"));
const PROMPT = "Use read_script with scope full to read the script, then call read_script again with scope selection, then answer with one short sentence.";

function refuse(reason: string): never {
  console.error(`[smoke] 拒跑（一分钱没花、没出网）：${reason}`);
  process.exit(2);
}

if (paid) {
  if (process.env.CI) refuse("CI 环境不许真付费");
  if (process.env.NOMI_SPEND_OK !== "1") refuse("没设 NOMI_SPEND_OK=1");
  if (!process.env.APIMART_API_KEY?.trim()) refuse("没设 APIMART_API_KEY");
}

const seeded = applyBuiltinSeeds({ version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as never, new Date().toISOString()).state;
const model = seeded.models.find((row) => row.vendorKey === "apimart" && row.modelKey === modelKey && row.kind === "text");
const vendor = seeded.vendors.find((row) => row.key === "apimart");
if (!model || !vendor) refuse(`种子目录里没有 apimart / ${modelKey}`);
const declared = readModelDeclaration(model!.meta).textProtocol;
if (declared !== "openai-responses") refuse(`种子行 ${modelKey} 上没有 textProtocol: openai-responses（修复不在这份代码里）`);

type Seen = { url: string; status?: number; reasoningReplayed: string[]; reasoningReturned: string[]; toolOutputs: number };
const seen: Seen[] = [];

/** 包一层 fetch：只记账（网址、状态码、推理条目的 id + 非空性），不记请求体 / 鉴权头 / 返回正文。 */
function recordingFetch(real: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const entry: Seen = { url, reasoningReplayed: [], reasoningReturned: [], toolOutputs: 0 };
    seen.push(entry);
    try {
      const body = JSON.parse(String(init?.body ?? "{}")) as { input?: Json[] };
      for (const item of body.input ?? []) {
        if (item.type === "reasoning" && typeof item.id === "string" && typeof item.encrypted_content === "string" && item.encrypted_content.length > 0) entry.reasoningReplayed.push(item.id);
        if (item.type === "function_call_output") entry.toolOutputs += 1;
      }
    } catch { /* 请求体不是 JSON：不记 */ }
    const response = await real(input, init);
    entry.status = response.status;
    // 返回正文只看 SSE 里的 `response.output_item.done` 推理条目（克隆一份读，原流照常交给 pi）。
    void response.clone().text().then((text) => {
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6)) as { type?: string; item?: Json };
          const item = event.item;
          if (event.type === "response.output_item.done" && item?.type === "reasoning" && typeof item.id === "string"
            && typeof item.encrypted_content === "string" && item.encrypted_content.length > 0) entry.reasoningReturned.push(item.id);
        } catch { /* 非 JSON 行 */ }
      }
    }).catch(() => undefined);
    return response;
  };
}

const fixture = paid ? null : await createHttpFixture([
  { type: "message", parts: [{ type: "responsesReasoning", id: "rs_loop_1", encryptedContent: "ENC_LOOP_ONE" },
    { type: "toolCall", id: "call_loop_1", name: "read_script", arguments: { scope: "full" } }] },
  { type: "message", parts: [{ type: "responsesReasoning", id: "rs_loop_2", encryptedContent: "ENC_LOOP_TWO" },
    { type: "toolCall", id: "call_loop_2", name: "read_script", arguments: { scope: "selection" } }] },
  { type: "text", text: "Read the script twice." },
]);
const origin = paid ? new URL(vendor!.baseUrlHint || "https://api.apimart.ai").origin : new URL(fixture!.baseURL).origin;
const pathname = new URL(vendor!.baseUrlHint || "https://api.apimart.ai/v1").pathname.replace(/\/+$/, "") || "/v1";
const target = { ...vendor!, baseUrlHint: `${origin}${pathname}` };
const config = { ...nomiModelConfigFor(target, model!, paid ? process.env.APIMART_API_KEY!.trim() : "sk-loopback-fake"), maxOutputTokens: 600 };

const projectDir = makeTempDir("gpt6-responses-smoke-project-");
const startedAt = new Date().toISOString();
type Part = { kind: string; isError?: boolean; text?: string };
let turnError: string | undefined;
let projected: Part[] | undefined;
const lane = await openLane({ fetch: recordingFetch(globalThis.fetch), projectDir, systemPrompt: "You are a terse script assistant. Use the tools you are given.",
  model: config, tools: createDocumentLaneTools(createDocumentPort("INT. KITCHEN - DAY\nMara pours coffee.")) });
try {
  await lane.execute({ kind: "prompt", text: PROMPT });
} catch (error) {
  turnError = error instanceof Error ? error.message.replaceAll(process.env.APIMART_API_KEY ?? "\u0000", "[REDACTED]") : String(error);
} finally {
  projected = [...lane.projection().parts] as unknown as Part[];
  await lane.close();
  await fixture?.close();
  fs.rmSync(projectDir, { recursive: true, force: true });
}
await new Promise((resolve) => setTimeout(resolve, 200)); // 让返回正文的克隆读完
const toolResults = (projected ?? []).filter((part) => part.kind === "tool-result");
const finalText = (projected ?? []).filter((part) => part.kind === "assistant-text").at(-1)?.text ?? "";

const returnedBefore = (index: number) => seen.slice(0, index).flatMap((entry) => entry.reasoningReturned);
const replayGaps = seen.flatMap((entry, index) => returnedBefore(index).filter((id) => !entry.reasoningReplayed.includes(id)).map((id) => `request ${index + 1} is missing ${id}`));
const returnedAny = seen.some((entry) => entry.reasoningReturned.length > 0);
const checks = {
  allRequestsToResponses: seen.length > 0 && seen.every((entry) => new URL(entry.url).pathname.endsWith("/v1/responses")),
  atLeastThreeRequests: seen.length >= 3,
  noMoreRequestsThanBudget: !paid || seen.length <= PAID_REQUEST_BUDGET + 1,
  noHttpError: seen.every((entry) => entry.status !== undefined && entry.status < 400),
  atLeastTwoToolCalls: toolResults.length >= 2,
  toolCallsAllRight: toolResults.length > 0 && toolResults.every((result) => !result.isError),
  turnFinished: !turnError && finalText.length > 0,
  returnedReasoningAllReplayed: replayGaps.length === 0,
};
const verdict = Object.values(checks).every(Boolean) ? (returnedAny ? "pass" : "partial-no-reasoning-returned") : "fail";
const report = {
  mode: paid ? "paid" : "loopback-rehearsal", fixMarker: FIX_MARKER, model: modelKey, startedAt, verdict, checks, replayGaps,
  requests: seen.map((entry, index) => ({ n: index + 1, path: new URL(entry.url).pathname, status: entry.status ?? null,
    reasoningReturned: entry.reasoningReturned, reasoningReplayed: entry.reasoningReplayed, toolOutputsInInput: entry.toolOutputs })),
  toolCalls: { right: toolResults.filter((result) => !result.isError).length, total: toolResults.length },
  finalTextChars: finalText.length, turnError: turnError ?? null,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `gpt6-responses-smoke-${paid ? "paid" : "rehearsal"}-${modelKey}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(verdict === "pass" ? 0 : 1);
