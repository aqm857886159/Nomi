// 渲染层发起的文本调用方，从真入口走完整条真路：渲染层 generateText / runWorkbenchTextTaskStream → 真 preload 桥
// → 真主进程 IPC handler（任务 / 文本流两扇门都注册着）
// → 真 runtime 准入 → 真执行器 → 真 pi-ai → 真 HTTP（本机假上游，零额度、不出网）。只换掉三样：Electron 的 IPC 传输
// （进程内转发，形状照 Electron：主进程 rejection 包一层 "Error invoking remote method"）、目录（一条假的文本模型）、项目盘。
//
// 为什么要它（2026-10-21）：调用方矩阵（textTaskCallers.integration.test.ts）直接调执行器，绕过了 runtime 的准入。
// 改写选区走 `nomi:tasks:run` 一次性门，撞上令牌付费闸（TOKEN_ADMISSION），而画布自「发动机收敛第一刀」起不再铸令牌——
// 每次改写都 SpendNotAuthorizedError，矩阵全绿、整机演练才暴露。paidNodeLedger 早已定了「文本不进 Run、不要授权、
// 走它自己的流式口」，改写只是没对齐。这里从按钮背后那个函数一路走到 HTTP，任何一层把文本送错门都会红。
// 调用方矩阵的每一行都要在 entry 里写明它的真入口测试（就是这份）或缺口——见 textTaskCallerHarness 的 CALLERS。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, payload?: unknown) => unknown;
type Listener = (event: unknown, payload: unknown) => void;
const ipc = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Set<Listener>>(),
  invoked: [] as string[],
}));

vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  // 渲染窗口：主进程 webContents.send 推的事件经它到 ipcRenderer 的监听者。
  const sender = Object.assign(new Emitter(), {
    id: 7,
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => {
      for (const listener of [...(ipc.listeners.get(channel) ?? [])]) listener({}, payload);
    },
  });
  const event = { sender, senderFrame: { routingId: 1, origin: "app://nomi" } };
  return {
    app: { getPath: () => process.cwd(), getAppPath: () => process.cwd(), on: () => undefined },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
    ipcMain: { handle: (channel: string, fn: Handler) => ipc.handlers.set(channel, fn) },
    webContents: { fromId: (id: number) => (id === sender.id ? sender : undefined), getAllWebContents: () => [sender] },
    ipcRenderer: {
      // Electron 把主进程 handler 的 rejection 包成这一句交给渲染层（结构化标记照样穿过来）。
      invoke: async (channel: string, payload: unknown) => {
        ipc.invoked.push(channel);
        const handler = ipc.handlers.get(channel);
        if (!handler) throw new Error(`No handler registered for '${channel}'`);
        try {
          return await handler(event, payload);
        } catch (error) {
          const inner = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          throw new Error(`Error invoking remote method '${channel}': ${inner}`, { cause: error });
        }
      },
      on: (channel: string, listener: Listener) => {
        const set = ipc.listeners.get(channel) ?? new Set<Listener>();
        set.add(listener);
        ipc.listeners.set(channel, set);
      },
      removeListener: (channel: string, listener: Listener) => { ipc.listeners.get(channel)?.delete(listener); },
    },
  };
});

const fixture = vi.hoisted(() => ({ baseURL: "" }));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined }));
vi.mock("../events/vendorCallTrace", () => ({ traceVendorCompleted: () => undefined, traceVendorRequested: () => undefined }));
vi.mock("../catalog/validateCandidateCredential", () => ({ revalidatePendingCredential: async () => undefined }));
// 目录：一条启用着的文本模型，key 已解开。别的都走真的（准入、执行器、错误编码）。
vi.mock("../catalog/executableModel", () => {
  const selection = () => ({
    vendor: { key: "fixture-text", name: "fixture", enabled: true, baseUrlHint: fixture.baseURL, providerKind: "openai-compatible", authType: "bearer" },
    model: { modelKey: "fixture-model", vendorKey: "fixture-text", kind: "text", enabled: true },
    apiKey: "sk-fixture-key",
    customConfig: {},
  });
  return { findExecutableModel: selection, findExecutableModelForTask: selection };
});
vi.mock("../catalog/catalogStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../catalog/catalogStore")>()),
  readCatalog: () => ({ vendors: [], models: [], mappings: [], apiKeysByVendor: {} }),
}));

// 渲染层：桥就是真 preload 的 tasks 面（频道名一字不差），项目盘在内存里。
const disk = vi.hoisted(() => new Map<string, unknown>());
const applyCanvasNodePatch = vi.hoisted(() => vi.fn());
vi.mock("../../src/desktop/bridge", async () => {
  const { runtimeBridge } = await import("../preload/runtimeBridge");
  return { getDesktopBridge: () => ({ tasks: runtimeBridge.tasks, projects: { applyCanvasNodePatch } }) };
});
vi.mock("../../src/workbench/library/localProjectStore", async () => {
  const { testProjectBinding } = await import("../../src/workbench/project/projectSessionTestHarness");
  return {
    readLocalProjectAsync: vi.fn(async (projectId: string) => structuredClone(disk.get(projectId) ?? null)),
    saveLocalProject: vi.fn(async (projectId: string, payload: unknown) => {
      const binding = testProjectBinding(projectId);
      disk.set(projectId, structuredClone({ id: projectId, name: "Rewrite fixture", version: 1, immutableProjectUuid: binding.immutableProjectUuid, projectGeneration: binding.projectGeneration, payload }));
      return disk.get(projectId);
    }),
  };
});

import { startTextUpstream, reply, type UpstreamReply } from "../../tests/fixtures/textTasks/textUpstream";
import * as runtime from "../runtime";
import { registerTaskIpcHandlers } from "../tasks/taskIpcHandlers";
import { registerTextStreamIpc } from "./textStreamIpc";
import { generateText } from "../../src/workbench/generationCanvas/runner/textActions";
import { runGenerationNode } from "../../src/workbench/generationCanvas/runner/generationRunController";
import { runWorkbenchTextTaskStream } from "../../src/workbench/api/taskApi";
import { requestTaskCancel, clearTaskCancel, isLocalTaskCancelledError } from "../../src/workbench/generationCanvas/runner/localTaskControl";
import { useGenerationCanvasStore } from "../../src/workbench/generationCanvas/store/generationCanvasStore";
import { createProjectSessionTestHarness, testProjectBinding, type ProjectSessionTestHarness } from "../../src/workbench/project/projectSessionTestHarness";

import { readCurrentWorkbenchProjectPayload, setActiveWorkbenchProjectSaveTarget } from "../../src/workbench/project/workbenchProjectSession";
import { saveLocalProject } from "../../src/workbench/library/localProjectStore";

let upstream: Awaited<ReturnType<typeof startTextUpstream>>;
let script: (index: number) => UpstreamReply = () => reply.text("改写后的句子。");

beforeAll(async () => {
  upstream = await startTextUpstream("openai-compatible", (_request, index) => script(index));
  fixture.baseURL = upstream.baseURL;
  registerTaskIpcHandlers(async () => runtime, async () => { throw new Error("canvas core is not part of this test"); });
  registerTextStreamIpc();
});
afterAll(async () => { await upstream.close(); });

let session: ProjectSessionTestHarness;
let projectTarget: Awaited<ReturnType<ProjectSessionTestHarness["open"]>>;
beforeEach(async () => {
  ipc.invoked.length = 0;
  upstream.requests.length = 0;
  useGenerationCanvasStore.setState({ nodes: [], edges: [], selectedNodeIds: [], groups: [] });
  session = createProjectSessionTestHarness();
  projectTarget = await session.open("project-rewrite");
  setActiveWorkbenchProjectSaveTarget({ projectId: "project-rewrite", canPersist: () => true,
    persist: () => saveLocalProject("project-rewrite", readCurrentWorkbenchProjectPayload(), testProjectBinding("project-rewrite")),
  });
});
afterEach(() => { setActiveWorkbenchProjectSaveTarget(null); session.dispose(); });

function rewriteNode() {
  const store = useGenerationCanvasStore.getState();
  const created = store.addNode({ kind: "text", title: "", prompt: "更口语一点", position: { x: 0, y: 0 } });
  store.updateNode(created.id, {
    meta: { modelVendor: "fixture-text", modelKey: "fixture-model", textGenMode: "rewrite", textGenSelection: "他缓缓地展开了那张纸条。" },
    contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "他缓缓地展开了那张纸条。" }] }] },
  });
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === created.id)!;
}

const pendingApply = (nodeId: string) =>
  useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta?.textPendingSelectionApply;

describe("#1 文本节点续写：真 IPC", () => {
  it("逐段写流式草稿、定稿；走文本流式门", async () => {
    script = () => ({ type: "stream", steps: [{ kind: "text", text: "第二段" }, { kind: "text", text: "接着写。", afterMs: 20 }, { kind: "finish" }] });
    const node = rewriteNode();
    const store = useGenerationCanvasStore.getState();
    store.updateNode(node.id, { meta: { ...(node.meta || {}), textGenMode: "append", textGenSelection: "" } });
    const result = await generateText(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)!, { projectTarget });
    expect(result.text).toBe("第二段接着写。");
    expect(ipc.invoked).toContain("nomi:tasks:text:stream");
    expect(ipc.invoked).not.toContain("nomi:tasks:run");
  });
});

describe("#3 #4 #5 提示词优化 / 翻译 / AI 起草脚本：真 IPC", () => {
  it("三者共用的 runWorkbenchTextTaskStream 逐段收到正文、拿到结果；不走付费令牌闸", async () => {
    script = () => reply.thinkThenText(1, 10, "a cat unrolls a note");
    const deltas: string[] = [];
    const result = await runWorkbenchTextTaskStream("fixture-text", { kind: "prompt_refine", prompt: "猫展开纸条", extras: { modelKey: "fixture-model" } },
      projectTarget.projectId, { onDelta: (delta) => deltas.push(delta) });
    expect(deltas.join("")).toBe("a cat unrolls a note");
    expect(result.status).toBe("succeeded");
    expect(ipc.invoked).not.toContain("nomi:tasks:run");
  });
});

describe("#2 文本节点改写选区：真 IPC + 真准入", () => {
  it("拿到改写结果、交编辑器一次性替换选区；走文本流式门，不走付费令牌闸", async () => {
    script = () => reply.thinkThenText(2, 20, "他慢慢展开纸条。");
    const node = rewriteNode();
    const result = await generateText(node, { projectTarget });
    expect(result.text).toBe("他慢慢展开纸条。");
    expect(pendingApply(node.id)).toBe(result.id);
    expect(upstream.requests).toHaveLength(1);
    expect(ipc.invoked).toContain("nomi:tasks:text:stream");
    expect(ipc.invoked).not.toContain("nomi:tasks:run");
  });

  it("流式期间不往画布写增量草稿（选区只在编辑器里，数据层不碰正文）", async () => {
    script = () => ({ type: "stream", steps: [{ kind: "text", text: "他慢慢" }, { kind: "text", text: "展开纸条。", afterMs: 30 }, { kind: "finish" }] });
    const node = rewriteNode();
    const before = JSON.stringify(node.contentJson);
    const seen: string[] = [];
    const unsubscribe = useGenerationCanvasStore.subscribe((state) => {
      seen.push(JSON.stringify(state.nodes.find((candidate) => candidate.id === node.id)?.contentJson));
    });
    try {
      await generateText(node, { projectTarget });
    } finally {
      unsubscribe();
    }
    expect(seen.every((content) => content === before)).toBe(true);
  });

  it("点停止：主进程那条 HTTP 真断，渲染层按取消收尾，选区不动", async () => {
    script = () => reply.hangAfterHeaders();
    const node = rewriteNode();
    const running = generateText(node, { projectTarget });
    await vi.waitFor(() => expect(upstream.requests).toHaveLength(1));
    const closed = upstream.whenClosedEarly();
    requestTaskCancel({ id: node.id }, () => undefined);
    await expect(running).rejects.toSatisfy(isLocalTaskCancelledError);
    await closed;
    expect(pendingApply(node.id)).toBeFalsy();
    expect(ipc.invoked).toContain("nomi:tasks:text:cancel");
    clearTaskCancel(node.id);
  });
});


// 独立验收 V-textmigrate F1（10-21）：重试之前那次的 HTTP 事实不许串到这一次的失败上。
// 走真实运行控制器（runGenerationNode：渲染层自动重提就在这里），断言的是**上游被请求了几次**——多一次就是多生成一次、多花一次钱。
describe("重试事实不串台：真运行控制器 + 真 HTTP 次数", () => {
  // 原话带「rate limit」：渲染层的重提判据认关键词，串台时它会被当成可重试的限流再生成一次（独立验收复现的就是这条）。
  const RATE_LIMIT = (status: number) => reply.http(status, { error: { message: `initial rate limit (${status})` } }, { "retry-after-ms": "1" });
  const run = (nodeId: string) => runGenerationNode(nodeId, { target: projectTarget, assetUploadConsent: "not-needed", executor: generateText, retry: { baseDelayMs: 0 } })
    .then((result) => ({ ok: true as const, text: result.text }), (error: unknown) => ({ ok: false as const, error: String(error) }));

  it.each([429, 503])("%i → 重试成功出字后断流：与只有断流时同一个结局（失败、不自动重提），上游一共 2 次", async (status) => {
    script = (index) => index === 0 ? reply.cutAfterText("已经生成了一半") : reply.text("不该有的第二次生成");
    const control = await run(rewriteNode().id);
    expect(control.ok).toBe(false);
    expect(upstream.requests).toHaveLength(1);
    upstream.requests.length = 0;
    ipc.invoked.length = 0;
    script = (index) => index === 0 ? RATE_LIMIT(status) : index === 1 ? reply.cutAfterText("已经生成了一半") : reply.text("不该有的第二次生成");
    const outcome = await run(rewriteNode().id);
    expect(outcome).toEqual(control);
    expect(upstream.requests).toHaveLength(2);
    expect(ipc.invoked.filter((channel) => channel === "nomi:tasks:text:stream")).toHaveLength(1);
  });

  it("429 → 连接被重置：认成「连不上」，与只有连接重置时的结局与请求次数一样（不是额度问题）", async () => {
    script = (index) => index < 3 ? reply.reset() : reply.text("重提之后的结果");
    const control = await run(rewriteNode().id);
    const controlRequests = upstream.requests.length;
    upstream.requests.length = 0;
    script = (index) => index === 0 ? RATE_LIMIT(429) : index < 3 ? reply.reset() : reply.text("重提之后的结果");
    const mixed = await run(rewriteNode().id);
    expect(mixed).toEqual(control);
    expect(upstream.requests).toHaveLength(controlRequests);
  });

  it("429 → 重试成功：拿到结果，上游一共 2 次，只进一次文本流式门", async () => {
    script = (index) => index === 0 ? RATE_LIMIT(429) : reply.text("他慢慢展开纸条。");
    const outcome = await run(rewriteNode().id);
    expect(outcome).toEqual({ ok: true, text: "他慢慢展开纸条。" });
    expect(upstream.requests).toHaveLength(2);
    expect(ipc.invoked.filter((channel) => channel === "nomi:tasks:text:stream")).toHaveLength(1);
  });
});
