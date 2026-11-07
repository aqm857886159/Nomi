// 文本任务调用方矩阵的驱动（被两个测试文件共用：electron/ai/textTaskCallers*.integration.test.ts）。
// 每个调用方 = 进门姿势（流式经 nomi:tasks:text:stream / 一次性经 runTaskIpcGuard）+ 请求形状，编号对应设计卡普查表。
// 用它的测试文件必须先声明这几个 vi.mock（工厂取自 ./textTaskCallerState）：electron、../ipcSenderGuard、
// ../events/vendorCallTrace、../catalog/validateCandidateCredential、../assets/localAssetFile、../runtime。
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { Model, Vendor } from "../../../electron/catalog/types";
import type { TaskRequest } from "../../../electron/runtime";
import { startTextUpstream, type UpstreamProtocol, type UpstreamReply } from "./textUpstream";
import { FIXTURE_PNG as PNG, harnessState, type Sender } from "./textTaskCallerState";
import { isRetryableGenerationError } from "../../../src/workbench/generationCanvas/runner/generationRetryPolicy";
import { classifyGenerationError } from "../../../src/workbench/observability/classifyError";
import { registerTextStreamIpc } from "../../../electron/ai/textStreamIpc";
import { executeTextTask } from "../../../electron/textTaskRunner";
import { runTaskIpcGuard } from "../../../electron/tasks/taskIpcGuard";

type Selection = { vendor: Vendor; model: Model; apiKey: string };

/** 交给 fetch 的请求 signal（appFetch 的测试替身在调用时才取 globalThis.fetch，所以 spy 记得到）。 */
function signalsOf(calls: ReadonlyArray<Parameters<typeof globalThis.fetch>>): Array<AbortSignal | undefined> {
  return calls.map(([input, init]) => init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined);
}

const owner = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false }) as Sender;
let registered = false;
function ensureIpc() {
  if (registered) return;
  registerTextStreamIpc();
  registered = true;
}

/**
 * 真入口：这个矩阵从执行器 / IPC handler 往下测，**看不见入口之上的准入**——2026-10-21 改写选区每次都被令牌付费闸挡下，
 * 矩阵全绿、整机演练才暴露。所以每一行还要写明：谁发起（渲染层 / 主进程）、从真入口经准入一路走到 HTTP 的测试是哪份；
 * 没有就写缺口（谁跟、到哪天）。渲染层发起的调用方不许只有缺口（登记的例外除外），见 textTaskCallers.integration.test.ts。
 */
export type CallerEntry = { from: "renderer" | "main"; test?: string; gap?: string };
/** 调用方 = 进门姿势 + 请求形状 + 真入口。与 docs/plan/2026-10-21-text-tasks-to-pi-ai.md 普查表的编号一一对应。 */
export type Caller = { id: string; door: "stream" | "one-shot"; kind: TaskRequest["kind"]; extras?: Record<string, unknown>; entry: CallerEntry };
const ENTRY_TEST = "electron/ai/textEntries.ipc.integration.test.ts";
const DATA_PNG = `data:image/png;base64,${PNG.toString("base64")}`;
export const CALLERS: readonly Caller[] = [
  { id: "#1 文本节点续写/重写/预设", door: "stream", kind: "chat", entry: { from: "renderer", test: ENTRY_TEST } },
  // 2026-10-21 起改写也走文本流式门（paidNodeLedger：文本不进 Run、不要授权），之前走一次性 nomi:tasks:run 撞令牌闸。
  { id: "#2 文本节点改写选区", door: "stream", kind: "chat", entry: { from: "renderer", test: ENTRY_TEST } },
  { id: "#3 提示词优化", door: "stream", kind: "prompt_refine", entry: { from: "renderer", test: ENTRY_TEST } },
  { id: "#4 提示词翻译", door: "stream", kind: "prompt_refine", entry: { from: "renderer", test: ENTRY_TEST } },
  { id: "#5 AI 起草脚本", door: "stream", kind: "prompt_refine", entry: { from: "renderer", test: ENTRY_TEST } },
  { id: "#6 视频拆解读图", door: "one-shot", kind: "image_to_prompt",
    extras: { temperature: 0.2, maxTokens: 1200, maxRetries: 0, referenceImages: ["nomi-local://frame-1.png", "nomi-local://frame-2.png", "nomi-local://frame-3.png"] },
    entry: { from: "main", gap: "主进程内发起，令牌由拆解开跑前的确认铸出（deconstructSpend）；整机演练补（2026-10-21 本机磁盘满，unverified）" } },
  { id: "#7 浏览器提取提示词", door: "one-shot", kind: "image_to_prompt", extras: { temperature: 0.35, maxTokens: 1600, referenceImages: [DATA_PNG] },
    // 2026-10-27 起整次提取在主进程（browser:prompt-extraction:run）：每次弹卡问人、铸令牌、再发；真入口测试从渲染层 runner 走到本机假上游。
    entry: { from: "renderer", test: "electron/browser/prompt/browserPromptExtraction.ipc.integration.test.ts" } },
  { id: "#8 MCP 试跑文本模型", door: "one-shot", kind: "chat",
    entry: { from: "main", gap: "MCP 工具层（tryModel）经 capabilityCore 的 runTask 发起，准入随工具调度；本线未补真入口测试" } },
  { id: "#9 画布单镜 Run 文本", door: "one-shot", kind: "chat",
    entry: { from: "main", gap: "制作流程单镜 Run 经 canvasTransportProvider 以 RUN_APPROVED_ADMISSION 发起；本线未补真入口测试" } },
];
export const STREAM_CALLERS = CALLERS.filter((caller) => caller.door === "stream");
/** 渲染层发起、却只登记了缺口的调用方——只许这几条（各有到期 / 另线），新增的必须带真入口测试。 */
export const RENDERER_ENTRY_GAP_EXCEPTIONS: readonly string[] = [];

export type Observation = {
  ok: boolean;
  text: string;
  deltas: string;
  /** 渲染层拿到的那句错误（流式：error 事件的 message；一次性：Electron 包过一层的 rejection）。 */
  error: string;
  /** 用户点了停止：既没有 done 也没有 error。 */
  cancelled: boolean;
  requests: number;
  closedEarly: number;
  /** 流式入口：主进程经 nomi:tasks:text:event 发出的原始事件（IPC 契约测试用）。 */
  ipcEvents?: ReadonlyArray<Record<string, unknown>>;
  /** 停止之后：交给传输层的请求 signal 是否全部已 abort。 */
  requestAborted?: boolean;
};

let seq = 0;

async function upstream(protocol: UpstreamProtocol, script: (index: number) => UpstreamReply) {
  const server = await startTextUpstream(protocol, (_request, index) => script(index));
  const key = `fixture-${++seq}`;
  const selection: Selection = {
    vendor: { key, baseUrlHint: server.baseURL, providerKind: protocol, authType: "bearer" } as unknown as Vendor,
    model: { modelKey: "fixture-model", vendorKey: key, kind: "text" } as unknown as Model,
    apiKey: "sk-fixture-key",
  };
  harnessState.selections.set(key, selection);
  return { server, key, selection };
}

function until(check: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => { if (!check()) return; harnessState.listeners.delete(tick); resolve(); };
    harnessState.listeners.add(tick);
    tick();
  });
}

/** 按调用方的姿势跑一次。`stopAfterFirstDelta`：流式入口收到第一段字就点停止。 */
export async function runCaller(caller: Caller, protocol: UpstreamProtocol, script: (index: number) => UpstreamReply,
  options: { stopAfterFirstDelta?: boolean } = {}): Promise<Observation> {
  const { server, key, selection } = await upstream(protocol, script);
  try {
    return await runOn(caller, server, key, selection, options);
  } finally {
    // 每个用例只关自己的假上游（计时类用例并发跑，不能一个用例收尾把别人的上游也关了）。
    await server.close();
  }
}

async function runOn(caller: Caller, server: Awaited<ReturnType<typeof upstream>>["server"], key: string, selection: Selection,
  options: { stopAfterFirstDelta?: boolean }): Promise<Observation> {
  const request: TaskRequest = { kind: caller.kind, prompt: `${caller.id}：缩短这句话`, extras: { modelKey: "fixture-model", ...(caller.extras || {}) } };
  if (caller.door === "one-shot") {
    try {
      // runtime.runTask 的文本分支 = 付费闸 + executeTextTask；闸不在本测试范围，错误编码层（runTaskIpcGuard）是真的。
      const result = await runTaskIpcGuard({ vendor: key, request }, () => executeTextTask({
        ...selection, kind: caller.kind, request, taskId: `task-${seq}` }));
      const text = textOf(result.raw);
      return { ok: true, text, deltas: "", error: "", cancelled: false, requests: server.requests.length, closedEarly: server.closedEarly };
    } catch (error) {
      // Electron 把主进程 handler 的 rejection 包成这一句交给渲染层。
      const wire = `Error invoking remote method 'nomi:tasks:run': ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
      return { ok: false, text: "", deltas: "", error: wire, cancelled: false, requests: server.requests.length, closedEarly: server.closedEarly };
    }
  }
  ensureIpc();
  const fetchSpy = options.stopAfterFirstDelta ? vi.spyOn(globalThis, "fetch") : undefined;
  const streamId = `text-${key}-0000`;
  harnessState.events.set(streamId, []);
  await harnessState.handlers.get("nomi:tasks:text:stream")!({ sender: owner }, { vendor: key, request, streamId });
  const events = () => harnessState.events.get(streamId)!;
  let requestAborted: boolean | undefined;
  if (options.stopAfterFirstDelta) {
    await until(() => events().some((event) => event.type === "delta"));
    // 主进程那条流收尾的确定信号：textStreamIpc 的 finally 会把挂在发起窗口上的 destroyed 监听解绑。
    // 等它，而不是等墙钟——收尾之后再看有没有补发 done / error。
    const settled = new Promise<void>((resolve) => {
      const check = () => { if (owner.listenerCount("destroyed") > 0) return; owner.off("removeListener", check); resolve(); };
      owner.on("removeListener", check);
    });
    await harnessState.handlers.get("nomi:tasks:text:cancel")!({ sender: owner }, { streamId });
    await settled;
    // 「真掐了 HTTP」= 交给传输层的那次请求的 signal 已 abort（不是只是渲染层不等了）。
    const signals = signalsOf(fetchSpy!.mock.calls);
    fetchSpy!.mockRestore();
    requestAborted = signals.length > 0 && signals.every((signal) => signal?.aborted === true);
  } else {
    await until(() => events().some((event) => event.type === "done" || event.type === "error"));
  }
  const done = events().find((event) => event.type === "done");
  const failed = events().find((event) => event.type === "error");
  return {
    ok: Boolean(done),
    text: done ? textOf((done.result as { raw?: unknown }).raw) : "",
    deltas: events().filter((event) => event.type === "delta").map((event) => event.delta).join(""),
    error: failed?.message ?? "",
    cancelled: !done && !failed,
    ipcEvents: events().map((event) => ({ ...event })),
    ...(requestAborted === undefined ? {} : { requestAborted }),
    requests: server.requests.length,
    closedEarly: server.closedEarly,
  };
}

function textOf(raw: unknown): string {
  const choice = (raw as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0];
  return typeof choice?.message?.content === "string" ? choice.message.content : "";
}

/** 渲染层的两条判据：会不会自动重提（文本节点的运行控制器），错误卡归哪一类。 */
export function rendererVerdict(message: string): { retried: boolean; kind: string } {
  return { retried: isRetryableGenerationError(new Error(message)), kind: classifyGenerationError(message).kind };
}

