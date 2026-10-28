// 浏览器「提取提示词」从真入口走完整条真路（设计卡 docs/plan/2026-10-27-browser-extract-grant.md ★9）：
// 页内「提取」的 console 行 → 真转发 promptCaptureEventFromConsole → 渲染层真映射与 runner → 真 preload 桥
// → 真主进程 IPC handler（真发送方守卫）→ 真 confirmSpendAndMintGrant（报价 → 问人 → 铸令牌）
// → 渲染层真付费卡（handleCapabilityApply → 查表 → promptExtractionSpendCard → useSpendConfirmStore）
// → 真 runtime 准入（TOKEN_ADMISSION → consumeTaskSpend → assertAndConsumeQuotedSpend）→ 真执行器 → 真 HTTP（本机假上游，零额度、不出网）。
// 只换掉：Electron 的 IPC 传输（进程内转发，rejection 照 Electron 包一层）、目录（一条假的文本模型）、提示词库落盘、
// 抓图 / 截图那两个 IPC（回一张固定的 PNG），以及「问人」这一步的进程间那一跳（直接交给渲染层真 handler）。
//
// 修之前这一份钉的是现状：提取在主进程付费闸被拒，供应商 0 次、不进库、不弹卡（红灯输出存在
// docs/evidence/2026-10-27-browser-extract-grant/extract-ipc-before.txt）。修之后每次提取都弹一张写清读哪张图的卡。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, payload?: unknown) => unknown;
type Listener = (...args: unknown[]) => void;

const harness = vi.hoisted(() => {
  /** 最小 webContents：守卫要的 id / mainFrame / getURL，taskIpcHandlers 要的 once / removeListener。 */
  class FakeWebContents {
    readonly mainFrame = { routingId: 1 };
    private readonly listeners = new Map<string, Set<Listener>>();
    constructor(readonly id: number, public url: string) {}
    isDestroyed(): boolean { return false; }
    getURL(): string { return this.url; }
    send(): void {}
    once(name: string, listener: Listener): this { (this.listeners.get(name) ?? this.listeners.set(name, new Set()).get(name)!).add(listener); return this; }
    on(name: string, listener: Listener): this { return this.once(name, listener); }
    removeListener(name: string, listener: Listener): this { this.listeners.get(name)?.delete(listener); return this; }
  }
  class FakeBrowserWindow {
    static readonly byContents = new Map<FakeWebContents, FakeBrowserWindow>();
    readonly webContents: FakeWebContents;
    constructor(readonly id: number, url: string) {
      this.webContents = new FakeWebContents(id, url);
      FakeBrowserWindow.byContents.set(this.webContents, this);
    }
    isDestroyed(): boolean { return false; }
    once(): this { return this; }
    static fromWebContents(contents: FakeWebContents): FakeBrowserWindow | null { return FakeBrowserWindow.byContents.get(contents) ?? null; }
  }
  // 主窗口（真守卫 assertTrustedSender 只认它的主帧）。
  const mainWindow = new FakeBrowserWindow(1, "file:///app/index.html");
  const eventFrom = (sender: FakeWebContents, routingId = sender.mainFrame.routingId) => ({ sender, senderFrame: { routingId, url: sender.getURL() } });
  return {
    FakeWebContents,
    FakeBrowserWindow,
    mainWindow,
    eventFrom,
    handlers: new Map<string, Handler>(),
    upstreamBaseURL: "",
    upstreamReply: (_index: number): unknown => undefined,
    rendererDecisions: [] as Array<{ kind: string; payload: Record<string, unknown> }>,
    /** 「问人」那一跳：缺省交给渲染层真 handler（测试里换成抛 RendererUnavailableError 等）。 */
    decide: async (_kind: string, _payload: unknown): Promise<unknown> => ({ confirmed: false }),
    rendererErrors: [] as unknown[],
    warnings: [] as string[],
    captured: [] as Array<{ channel: string; payload: unknown }>,
    projectCurrent: true,
    brainModelKey: "fixture-model",
  };
});

vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd(), on: () => undefined },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
  BrowserWindow: harness.FakeBrowserWindow,
  webUtils: { getPathForFile: () => "" },
  ipcMain: { handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn), on: () => undefined },
  webContents: { fromId: () => undefined, getAllWebContents: () => [] },
  ipcRenderer: {
    // Electron 把主进程 handler 的 rejection 包成这一句交给渲染层；原错误挂在 cause 上，供断言看清拒在哪一层。
    invoke: async (channel: string, payload: unknown) => {
      const handler = harness.handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for '${channel}'`);
      try {
        return await handler(harness.eventFrom(harness.mainWindow.webContents), payload);
      } catch (error) {
        const inner = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        throw new Error(`Error invoking remote method '${channel}': ${inner}`, { cause: error });
      }
    },
    on: () => undefined,
    removeListener: () => undefined,
    send: () => undefined,
  },
}));

// 主进程：目录只有一条启用着的文本模型，指向本机假上游；其余（准入、钱闸、执行器、错误编码）全是真的。
vi.mock("../../events/vendorCallTrace", () => ({ traceVendorCompleted: () => undefined, traceVendorRequested: () => undefined }));
vi.mock("../../catalog/validateCandidateCredential", () => ({ revalidatePendingCredential: async () => undefined }));
vi.mock("../../catalog/executableModel", () => {
  // 不论问的是正名还是别名，都解到同一行（runtime 与报价都经它：报价身份 = 执行身份）。
  const selection = () => ({
    vendor: { key: "fixture-text", name: "fixture", enabled: true, baseUrlHint: harness.upstreamBaseURL, providerKind: "openai-compatible", authType: "bearer" },
    model: { modelKey: "fixture-model", vendorKey: "fixture-text", kind: "text", enabled: true },
    apiKey: "sk-fixture-key",
    customConfig: {},
  });
  return { findExecutableModel: selection, findExecutableModelForTask: selection };
});
vi.mock("../../catalog/catalogStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../catalog/catalogStore")>()),
  readCatalog: () => ({ vendors: [], models: [], mappings: [], apiKeysByVendor: {} }),
}));
// 问人的那一步（主进程 → 渲染层的付费确认卡）：记下每一次弹卡请求，交给 harness.decide（缺省 = 渲染层真 handler）。
vi.mock("../../capabilityCore/rendererBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../capabilityCore/rendererBridge")>()),
  requestRendererDecision: async (kind: string, payload: Record<string, unknown>) => {
    harness.rendererDecisions.push({ kind, payload });
    return harness.decide(kind, payload);
  },
}));
// 核销计数：真 assertAndConsumeQuotedSpend 外面包一层计数（行为不变）。
vi.mock("../../spendGrant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../spendGrant")>();
  return { ...actual, assertAndConsumeQuotedSpend: vi.fn(actual.assertAndConsumeQuotedSpend) };
});
vi.mock("../../logging/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../logging/logger")>();
  return { ...actual, logWarn: (scope: string, event: string, ...rest: unknown[]) => { harness.warnings.push(`${scope}:${event}`); return (actual.logWarn as (...args: unknown[]) => void)(scope, event, ...rest); } };
});
// 看门狗的三个预算：缺省就是生产值（判活结构不变）；只有「响应头之后再无动静」那一格临时把思考预算缩到毫秒级。
const watchdog = vi.hoisted(() => ({ firstResponseMs: 0, firstTokenMs: 0, idleMs: 0 }));
vi.mock("../../agentLane/laneProviderGuard.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agentLane/laneProviderGuard.mjs")>();
  Object.assign(watchdog, actual.LANE_STREAM_WATCHDOG);
  return { ...actual, LANE_STREAM_WATCHDOG: watchdog };
});

// 渲染层：桥就是真 preload 的 tasks / browser 面（频道名一字不差）；提示词库落盘换成记录。
const library = vi.hoisted(() => ({ saved: [] as Array<{ title?: string; prompt?: string; referenceImages?: unknown }> }));
vi.mock("../../../src/desktop/bridge", async () => {
  const [{ runtimeBridge }, { mediaBridge }] = await Promise.all([import("../../preload/runtimeBridge"), import("../../preload/mediaBridge")]);
  return { getDesktopBridge: () => ({ tasks: runtimeBridge.tasks, browser: mediaBridge.browser }) };
});
vi.mock("../../../src/workbench/api/promptLibraryApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/workbench/api/promptLibraryApi")>()),
  getTextBrain: async () => ({ vendor: "fixture-text", modelKey: harness.brainModelKey }),
  addUserPrompt: async (entry: { title?: string; prompt?: string }) => { library.saved.push(entry); },
}));
vi.mock("../../../src/desktop/rendererLog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/desktop/rendererLog")>()),
  logRendererError: (_event: string, error: unknown) => { harness.rendererErrors.push(error); },
}));
vi.mock("../../../src/workbench/project/projectCanvasReadSurface", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/workbench/project/projectCanvasReadSurface")>()),
  isProjectExecutionContextCurrent: () => harness.projectCurrent,
}));

// 看门狗预算的生产值由上面那个 vi.mock 的工厂在 laneProviderGuard 第一次被 import 时才填进 watchdog。故障格改预算之前要拍一份快照、
// 事后还原；若此刻还没人 import 过它，快照就是三个 0，还原等于把预算写成 0——后面每一格的请求在 0 秒就被掐掉，上游收到 0 次
// （只单跑故障格时，第一格之后全红；整份按序跑时前面的格子早已把它加载过，所以一直是绿的）。这里静态 import 一次（只为跑工厂），
// 让快照和执行顺序无关；不能放进钩子里 await import（lint 禁：冷转译算在钩子的超时里）。
import "../../agentLane/laneProviderGuard.mjs";
import { startTextUpstream, reply, type UpstreamReply } from "../../../tests/fixtures/textTasks/textUpstream";
import * as runtime from "../../runtime";
import { registerAppWindow, setMainWindow } from "../../appWindowRegistry";
import { RendererUnavailableError } from "../../capabilityCore/rendererBridge";
import { __resetSpendGrantsForTests, __spendGrantCountForTests, assertAndConsumeQuotedSpend } from "../../spendGrant";
import { registerBrowserPromptExtractionIpc } from "./browserPromptExtractionRun";
import { promptCaptureEventFromConsole } from "../core/browserViewUtils";
import { BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX } from "../core/browserViewBridges";
import type { BrowserViewRecord } from "../core/browserViewTypes";
import { decodePromptExtractionSubject } from "../../shared/contracts/browserPromptExtraction";
import { runBrowserPromptExtractionToLibrary } from "../../../src/ui/browser/prompt/browserPromptExtractionRunner";
import { promptCaptureRequestFromBrowserEvent } from "../../../src/ui/browser/dialog/NomiBrowserDialogModel";
import { handleCapabilityApply } from "../../../src/workbench/capability/capabilityApplyHandler";
import { useSpendConfirmStore } from "../../../src/workbench/generationCanvas/spend/spendConfirm";
import { classifyGenerationError } from "../../../src/workbench/observability/classifyError";
import type { BrowserAssetPromptCaptureRequest } from "../../../src/ui/browser/popover/browserAssetPopoverTypes";
import type { ProjectExecutionContext } from "../../../src/workbench/project/projectCanvasReadSurface";
import i18n from "../../../src/i18n";

const RUN_CHANNEL = "browser:prompt-extraction:run";
/** 1×1 PNG：抓图 / 截图的产物，也就是模型真正读的那张。 */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SAVED = { title: "Saved reference", prompt: "A quiet harbor at dawn, soft fog" };
const b = (key: string, values?: Record<string, string>) => i18n.t(`browserAssets.${key}`, values);
const c = (key: string, values?: Record<string, string>) => i18n.t(`runtime.capability.${key}`, values);
const consumed = vi.mocked(assertAndConsumeQuotedSpend);

let upstream: Awaited<ReturnType<typeof startTextUpstream>>;

/** 浏览视图里的一页：网页自己写一行 console（真点也好、伪造也好，主进程分不出来）→ 真转发 → 渲染层真映射。 */
function imageRequestFromPage(viewUrl: string, page: Record<string, unknown>): BrowserAssetPromptCaptureRequest {
  const view = { webContents: { getURL: () => viewUrl } };
  const record = { viewId: 7, tabId: "tab-1", ownerWindowId: 1, view, lastBounds: { x: 0, y: 0, width: 1200, height: 800 }, resourceCaptureEnabled: false } as unknown as BrowserViewRecord;
  const event = promptCaptureEventFromConsole(record, `${BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX}${JSON.stringify(page)}`);
  if (!event?.ok) throw new Error(`forward produced no capture event: ${JSON.stringify(event)}`);
  return promptCaptureRequestFromBrowserEvent(event);
}

const screenshotRequest: BrowserAssetPromptCaptureRequest = {
  requestId: "browser-prompt-screenshot-7", sourceType: "screenshot", extractionMode: "style", viewId: 7,
  title: "Poster", fileName: "browser-selection.png", pageUrl: "https://posters.example/p/1", pageTitle: "Poster",
  sourceRect: { left: 10, top: 10, width: 200, height: 120 },
};

type PendingCard = NonNullable<ReturnType<typeof useSpendConfirmStore.getState>["pending"]>;

/**
 * 等主进程把卡弹到渲染层那张唯一的确认卡上：订阅卡自己的 store，卡一挂上就回。
 * 不设墙钟上限，卡永远不来由 testTimeout 兜底（docs/lessons/fixed-wall-clock-caps-break-when-work-grows.md）。
 */
function nextCard(): Promise<PendingCard> {
  const current = useSpendConfirmStore.getState().pending;
  if (current) return Promise.resolve(current);
  return new Promise((resolve) => {
    const unsubscribe = useSpendConfirmStore.subscribe(({ pending }) => {
      if (!pending) return;
      unsubscribe();
      resolve(pending);
    });
  });
}
const answerCard = (ok: boolean) => useSpendConfirmStore.getState().resolvePending(ok);
const cards = () => harness.rendererDecisions.filter((decision) => decision.kind === "spend.confirm");
const lastTabMessage = (present: ReturnType<typeof vi.fn>) => present.mock.calls.at(-1)?.[0] as string | undefined;

/** 一次完整的提取：发起 → 等卡 → 按 ok 点 → 等 runner 收尾。返回卡（渲染层那张）与标签页收到的话。 */
async function extract(request: BrowserAssetPromptCaptureRequest, ok: boolean, project: ProjectExecutionContext | null = null, beforeAnswer?: () => void) {
  const present = vi.fn();
  const running = runBrowserPromptExtractionToLibrary(request, present, project);
  const card = await nextCard();
  beforeAnswer?.();
  answerCard(ok);
  await running;
  return { card, present };
}

beforeAll(async () => {
  upstream = await startTextUpstream("openai-compatible", (_request, index) => harness.upstreamReply(index) as UpstreamReply);
  harness.upstreamBaseURL = upstream.baseURL;
  // 生产装配：浏览器提取的两扇主进程门照 main.ts 注册（懒加载 runtime 换成同一份真模块）。
  registerBrowserPromptExtractionIpc(async () => runtime);
  // 抓原图 / 截图（主进程真去网页抓）换成回一张固定 PNG，并记下它被要求抓哪个地址。
  harness.handlers.set("browser:view:capture-prompt-image", async (_event, payload) => {
    harness.captured.push({ channel: "image", payload });
    return { dataUrl: PNG, referenceUrl: "nomi-local://captured.png", fileName: "captured.png" };
  });
  harness.handlers.set("browser:view:capture-prompt-screenshot", async (_event, payload) => {
    harness.captured.push({ channel: "screenshot", payload });
    return { dataUrl: PNG, referenceUrl: "nomi-local://shot.png", fileName: "shot.png" };
  });
});
afterAll(async () => { await upstream.close(); });
beforeEach(() => {
  setMainWindow(harness.mainWindow as never);
  upstream.requests.length = 0;
  library.saved.length = 0;
  harness.rendererDecisions.length = 0;
  harness.rendererErrors.length = 0;
  harness.warnings.length = 0;
  harness.captured.length = 0;
  harness.projectCurrent = true;
  harness.brainModelKey = "fixture-model";
  harness.upstreamReply = () => reply.text(JSON.stringify(SAVED));
  harness.decide = (kind, payload) => handleCapabilityApply(kind, payload);
  consumed.mockClear();
  __resetSpendGrantsForTests();
});
afterEach(() => {
  // 卡没被答（某格自己红了）也不许把后面的格子拖住。
  while (useSpendConfirmStore.getState().pending) answerCard(false);
  setMainWindow(null);
});

describe("浏览器提取提示词：每次弹卡问人，确认后恰好请求供应商一次", () => {
  it("确认（原图）：一张卡写清来源页、哪张图、哪个读图模型；供应商恰好 1 次，核销 1 次，没有第二张卡，进库", async () => {
    const request = imageRequestFromPage("https://photos.example/harbor", {
      url: "https://cdn.photos.example/img/harbor%20dawn.jpg", title: "Harbor", pageUrl: "https://photos.example/harbor", extractionMode: "replicate",
    });
    const { card, present } = await extract(request, true);

    // 主进程交给渲染层的那一问：一次调用、一条读图腿、来源页与图片解得开。
    expect(cards()).toHaveLength(1);
    const asked = cards()[0].payload;
    expect(asked).toMatchObject({ intent: "prompt-extraction", callCount: 1, vendor: "fixture-text", modelKey: "fixture-model" });
    expect(asked.legs).toEqual([{ role: "vision", vendor: "fixture-text", modelKey: "fixture-model" }]);
    expect(decodePromptExtractionSubject(asked.prompt)).toEqual({ page: "photos.example", image: "harbor dawn.jpg" });
    // 渲染层那张卡：用户自己点的、写清三行，不是「AI 助手想生成…」。
    expect(card).toMatchObject({ source: "user", title: c("promptExtractionTitle"), confirmLabel: c("confirmPromptExtraction") });
    expect(card.details).toEqual([
      { label: c("promptExtractionPage"), value: "photos.example" },
      { label: c("promptExtractionImage"), value: "harbor dawn.jpg" },
      { label: c("visionModelLine"), value: "fixture-text · fixture-model" },
    ]);

    // 卡上写的那张 = 主进程去抓的那张 = 发给模型的那张。
    expect(harness.captured).toEqual([{ channel: "image", payload: expect.objectContaining({ url: "https://cdn.photos.example/img/harbor%20dawn.jpg" }) }]);
    expect(upstream.requests).toHaveLength(1);
    expect(JSON.stringify(upstream.requests[0].body)).toContain(PNG.slice("data:image/png;base64,".length));
    expect(upstream.requests[0].body).toMatchObject({ temperature: 0.35 });
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(library.saved).toEqual([expect.objectContaining({ title: SAVED.title, prompt: SAVED.prompt })]);
    expect(lastTabMessage(present)).toBe(b("savedToPromptLibraryNamed", { name: SAVED.title }));
    expect(harness.rendererErrors).toEqual([]);
  });

  it("确认（截图）：同一条链；卡上「图片」写页面截图，发给模型的是截图，风格模式的参数由主进程定", async () => {
    const { card } = await extract(screenshotRequest, true);
    expect(decodePromptExtractionSubject(cards()[0].payload.prompt)).toEqual({ page: "posters.example", image: "" });
    expect(card.details).toContainEqual({ label: c("promptExtractionImage"), value: c("promptExtractionScreenshot") });
    expect(harness.captured.map((entry) => entry.channel)).toEqual(["screenshot"]);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0].body).toMatchObject({ temperature: 0.2 });
    expect(JSON.stringify(upstream.requests[0].body)).toContain(PNG.slice("data:image/png;base64,".length));
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(library.saved).toHaveLength(1);
  });

  it("卡上取消：供应商 0 次，一颗令牌都没铸，库里 0 条，标签页说「已取消提取」，不记错误", async () => {
    const { present } = await extract(screenshotRequest, false);
    expect(upstream.requests).toHaveLength(0);
    expect(__spendGrantCountForTests()).toBe(0);
    expect(consumed).not.toHaveBeenCalled();
    expect(library.saved).toEqual([]);
    expect(lastTabMessage(present)).toBe(b("promptExtractionCancelled"));
    expect(harness.rendererErrors).toEqual([]);
  });

  it("网页伪造：网页自己写一行 console（没有任何真实点击）→ 照样只弹一张卡；不确认就什么都不发", async () => {
    const forged = imageRequestFromPage("https://evil.example/x", {
      url: "https://evil.example/bait.png", title: "Free", pageUrl: "https://nomi.app", pageTitle: "Nomi", extractionMode: "style",
    });
    await extract(forged, false);
    expect(cards()).toHaveLength(1);
    expect(upstream.requests).toHaveLength(0);
    expect(library.saved).toEqual([]);
    expect(__spendGrantCountForTests()).toBe(0);
  });

  it("来源页可信：网页自报 pageUrl 是 nomi.app，卡上写的是浏览视图的真实主机 evil.example", async () => {
    const forged = imageRequestFromPage("https://evil.example/x", { url: "https://evil.example/bait.png", pageUrl: "https://nomi.app" });
    expect(forged.pageUrl).toBe("https://evil.example/x");
    const { card } = await extract(forged, false);
    expect(decodePromptExtractionSubject(cards()[0].payload.prompt)?.page).toBe("evil.example");
    expect(card.details).toContainEqual({ label: c("promptExtractionPage"), value: "evil.example" });
  });

  describe("不可信发送方：卡 0 张、令牌 0 颗、供应商 0 次", () => {
    const payload = { vendor: "fixture-text", modelKey: "fixture-model", prompt: "describe", imageUrl: PNG, mode: "replicate", projectId: null, pageUrl: "https://evil.example/x", imageSourceUrl: "https://evil.example/bait.png" };
    const run = (event: unknown) => Promise.resolve().then(() => harness.handlers.get(RUN_CHANNEL)!(event, payload));
    afterEach(() => {
      expect(cards()).toEqual([]);
      expect(__spendGrantCountForTests()).toBe(0);
      expect(upstream.requests).toHaveLength(0);
    });
    it("(a) 浏览视图里网页自己的 webContents", async () => {
      const remotePage = new harness.FakeWebContents(42, "https://evil.example/x");
      await expect(run(harness.eventFrom(remotePage))).rejects.toMatchObject({ name: "UntrustedIpcSenderError" });
    });
    it("(b) 主窗口里的子帧", async () => {
      await expect(run(harness.eventFrom(harness.mainWindow.webContents, 2))).rejects.toMatchObject({ name: "UntrustedIpcSenderError" });
    });
    it("(c) Nomi 自己的辅助窗（app-surface，素材盒浮层那一档）也不行：花钱只认主窗口", async () => {
      const overlay = new harness.FakeBrowserWindow(3, "file:///app/overlay.html");
      registerAppWindow(overlay as never, "app-surface", "file:///app/overlay.html");
      await expect(run(harness.eventFrom(overlay.webContents))).rejects.toMatchObject({ name: "UntrustedIpcSenderError" });
    });
  });

  it("卡开着时再来一个：回 busy、记一行警告、始终只有一张卡；第一张处理完，下一个照常弹新卡", async () => {
    const firstHost = vi.fn();
    const first = runBrowserPromptExtractionToLibrary(screenshotRequest, firstHost, null);
    await nextCard();
    const secondHost = vi.fn();
    await runBrowserPromptExtractionToLibrary({ ...screenshotRequest, requestId: "second" }, secondHost, null);
    expect(lastTabMessage(secondHost)).toBe(b("promptExtractionBusy"));
    expect(harness.warnings.filter((warning) => warning === "browser:prompt-extraction.busy")).toHaveLength(1);
    expect(cards()).toHaveLength(1);
    expect(useSpendConfirmStore.getState().queue).toEqual([]);
    answerCard(false);
    await first;
    const { present } = await extract({ ...screenshotRequest, requestId: "third" }, true);
    expect(cards()).toHaveLength(2);
    expect(lastTabMessage(present)).toBe(b("savedToPromptLibraryNamed", { name: SAVED.title }));
    expect(upstream.requests).toHaveLength(1);
  });

  it("问人那一步渲染层没了：整次报错，令牌 0 颗、供应商 0 次；下一个请求不是 busy", async () => {
    harness.decide = async () => { throw new RendererUnavailableError(); };
    const present = vi.fn();
    await runBrowserPromptExtractionToLibrary(screenshotRequest, present, null);
    expect(__spendGrantCountForTests()).toBe(0);
    expect(upstream.requests).toHaveLength(0);
    expect(harness.rendererErrors).toHaveLength(1);
    harness.decide = (kind, payload) => handleCapabilityApply(kind, payload);
    await extract({ ...screenshotRequest, requestId: "after-gone" }, false);
    expect(cards()).toHaveLength(2);
  });

  it("报价身份 = 执行身份：大脑里存的是别名，报价用解出来的正名，闸上不会再弹第二张卡", async () => {
    harness.brainModelKey = "fixture-alias";
    await extract(screenshotRequest, true);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].payload.modelKey).toBe("fixture-model");
    expect(upstream.requests).toHaveLength(1);
    expect(library.saved).toHaveLength(1);
  });

  describe("故障注入：库里 0 条，标签页是分类器的话（不带 IPC 外壳和结构化标记），令牌只核销一次，不说「没扣」", () => {
    const FAULTS: ReadonlyArray<{ name: string; answer: () => UpstreamReply; budget?: Partial<typeof watchdog> }> = [
      { name: "reset", answer: () => reply.reset() },
      { name: "401", answer: () => reply.http(401, { error: { message: "invalid api key" } }) },
      { name: "500", answer: () => reply.http(500, { error: { message: "upstream exploded" } }) },
      // 响应头之后一个事件都没有：结果未知（供应商可能已受理）。思考预算缩到 300ms，由看门狗真掐断。
      { name: "hangAfterHeaders", answer: () => reply.hangAfterHeaders(), budget: { firstTokenMs: 300 } },
    ];
    it.each(FAULTS)("$name", async ({ answer, budget }) => {
      const production = { ...watchdog };
      // 快照是生产值才还原得对：全是 0 说明工厂还没跑过（文件顶部那行 import "…/laneProviderGuard.mjs" 被拿掉了），后面的格子会在 0 秒被掐。
      expect(production.firstResponseMs, "看门狗生产预算的快照").toBeGreaterThan(0);
      Object.assign(watchdog, budget ?? {});
      try {
        harness.upstreamReply = answer;
        const { present } = await extract(screenshotRequest, true);
        expect(upstream.requests.length).toBeGreaterThan(0);
        expect(consumed).toHaveBeenCalledTimes(1);
        expect(library.saved).toEqual([]);
        const raw = (harness.rendererErrors.at(-1) as Error).message;
        const report = classifyGenerationError(raw);
        const shown = lastTabMessage(present)!;
        expect(shown).toBe(report.hint
          ? b("promptExtractionFailedWithHint", { reason: report.reason, hint: report.hint })
          : b("promptExtractionFailedToast", { error: report.reason }));
        expect(shown).not.toContain("NOMI_VENDOR_ERR_B64::");
        expect(shown).not.toContain("Error invoking remote method");
        expect(shown).not.toMatch(/没扣|未扣|不扣|没有扣|not charged|no charge/i);
      } finally {
        Object.assign(watchdog, production);
      }
    });

    it("空回包：模型没回提示词，原地说清，不进库", async () => {
      harness.upstreamReply = () => reply.empty();
      const { present } = await extract(screenshotRequest, true);
      expect(consumed).toHaveBeenCalledTimes(1);
      expect(library.saved).toEqual([]);
      expect(lastTabMessage(present)).toBe(b("promptExtractionFailedToast", { error: b("promptModelEmpty") }));
    });
  });

  describe("切项目（协调 10-27 定）", () => {
    const project = { binding: { projectId: "project-a" } } as unknown as ProjectExecutionContext;
    beforeEach(() => {
      harness.handlers.set("browser:prompt-extraction-settings:read", async () => ({ ok: true, settings: null }));
    });

    it("卡开着时切走了项目，再点确认：钱已经花了，结果照样存进（全局的）提示词库", async () => {
      const { present } = await extract(screenshotRequest, true, project, () => { harness.projectCurrent = false; });
      expect(upstream.requests).toHaveLength(1);
      expect(library.saved).toHaveLength(1);
      expect(lastTabMessage(present)).toBe(b("savedToPromptLibraryNamed", { name: SAVED.title }));
    });

    it("弹卡之前切走了项目：整次取消，不弹卡、供应商 0 次", async () => {
      harness.handlers.set("browser:prompt-extraction-settings:read", async () => { harness.projectCurrent = false; return { ok: true, settings: null }; });
      await runBrowserPromptExtractionToLibrary(screenshotRequest, vi.fn(), project);
      expect(cards()).toEqual([]);
      expect(upstream.requests).toHaveLength(0);
    });
  });
});
