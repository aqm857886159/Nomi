import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalTaskJobs, withTaskOwner } from "./localTaskJobs";

type Sender = EventEmitter & { id: number };
type Handler = (event: { sender: Sender }, payload?: unknown) => unknown;
type QuitEvent = { preventDefault: () => void };
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(), quitHandler: undefined as undefined | ((event: QuitEvent) => void),
  guard: vi.fn(), quit: vi.fn(), cancel: vi.fn(), cancelOwner: vi.fn(), cancelAll: vi.fn(), grant: vi.fn(),
  runCandidate: vi.fn(), cancelCandidate: vi.fn(), failCandidateEnvelope: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, fn: Handler) => mocks.handlers.set(name, fn) },
  app: { on: (name: string, fn: (event: QuitEvent) => void) => { if (name === "will-quit") mocks.quitHandler = fn; }, quit: mocks.quit },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: mocks.guard }));
vi.mock("../spendGrant", () => ({ mintSpendGrant: mocks.grant }));
vi.mock("../submissionLedger", () => ({ runTaskWithIdempotency: (_payload: unknown, run: () => unknown) => run() }));
vi.mock("./taskIpcGuard", () => ({ runTaskIpcGuard: (_payload: unknown, run: () => unknown) => run() }));
vi.mock("../catalog/antigravityImageOperation", () => ({ antigravityImageJobs: {
  cancel: mocks.cancel, cancelOwner: mocks.cancelOwner, cancelAll: mocks.cancelAll,
} }));
vi.mock("./comfyCandidateTest", () => ({
  runComfyCandidateTest: mocks.runCandidate,
  cancelComfyCandidateTest: mocks.cancelCandidate,
  failComfyCandidateEnvelope: mocks.failCandidateEnvelope,
}));

import { registerTaskIpcHandlers } from "./taskIpcHandlers";
type Runtime = Awaited<ReturnType<Parameters<typeof registerTaskIpcHandlers>[0]>>;
const sender = (id: number): Sender => Object.assign(new EventEmitter(), { id });
const call = (action: string, owner: Sender, payload?: unknown) => mocks.handlers.get(`nomi:tasks:${action}`)!({ sender: owner }, payload);


/** 画布单镜 Run 那一半（能力核）：这里只测本地任务的生命周期，窗口关掉时它被告知一声即可。 */
const noCanvasCore = async () => ({ releaseCanvasShotSender: vi.fn() }) as never;
describe("task IPC local operation lifecycle", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.handlers.clear(); mocks.cancelAll.mockResolvedValue(undefined); });
  it("binds submissions and result queries to the actual sender, not a payload owner", async () => {
    const jobs = new LocalTaskJobs<string>();
    const runtime = {
      runTask: () => jobs.start("project", async () => "pixels"),
      fetchTaskResult: (id: string) => jobs.query(id, "project", () => ["nomi-local://result"]),
    };
    registerTaskIpcHandlers(async () => runtime as unknown as Runtime, noCanvasCore);
    const owner = sender(31);
    const id = await call("run", owner, { owner: 99 }) as string;
    await jobs.settled(id);
    expect(() => withTaskOwner(99, () => jobs.query(id, "project", vi.fn()))).toThrow("OWNER_MISMATCH");
    await expect(call("result", sender(32), id)).rejects.toThrow("OWNER_MISMATCH");
    await expect(call("result", owner, id)).resolves.toMatchObject({ status: "succeeded" });
  });
  it("registers one window-destruction cleanup callback across repeated submissions", async () => {
    registerTaskIpcHandlers(async () => ({ runTask: vi.fn() }) as unknown as Runtime, noCanvasCore);
    const owner = sender(31);
    await call("run", owner); await call("run", owner);
    expect(owner.listenerCount("destroyed")).toBe(1);
    owner.emit("destroyed");
    expect(mocks.cancelOwner).toHaveBeenCalledExactlyOnceWith(31);
  });
  it("does not start late work if its window closes during runtime loading", async () => {
    const jobs = new LocalTaskJobs<string>(); const work = vi.fn(async () => "pixels");
    mocks.cancelOwner.mockImplementation((id: number) => jobs.cancelOwner(id));
    let loaded!: (runtime: Runtime) => void;
    registerTaskIpcHandlers(() => new Promise((resolve) => { loaded = resolve; }), noCanvasCore);
    const owner = sender(31);
    const pending = call("run", owner);
    owner.emit("destroyed");
    loaded({ runTask: () => jobs.start("project", work) } as unknown as Runtime);
    await expect(pending).rejects.toThrow("LOCAL_TASK_OWNER_CLOSED");
    expect(work).not.toHaveBeenCalled();
  });
  it("validates cancel IDs and passes only the actual sender identity", async () => {
    registerTaskIpcHandlers(async () => ({}) as Runtime, noCanvasCore);
    const owner = sender(31); const id = "local-11111111-1111-4111-8111-111111111111";
    expect(() => call("cancel", owner, { taskId: id, owner: 99 })).toThrow("LOCAL_TASK_INVALID_ID");
    expect(() => call("cancel", owner, `local-${"-".repeat(36)}`)).toThrow("LOCAL_TASK_INVALID_ID");
    expect(mocks.cancel).not.toHaveBeenCalled();
    await call("cancel", owner, id);
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(id, 31);
    expect(mocks.guard).toHaveBeenCalledTimes(3);
  });
  it("routes exact Comfy candidate test and cancel through trusted dedicated IPC", async () => {
    const runtime = { runTask: vi.fn(), fetchTaskResult: vi.fn() };
    mocks.runCandidate.mockResolvedValue({ ok: true, revisionId: "revision-1", active: { vendorKey: "candidate", modelKey: "model" } });
    mocks.cancelCandidate.mockReturnValue({ ok: true });
    registerTaskIpcHandlers(async () => runtime as unknown as Runtime, noCanvasCore);
    const owner = sender(31); const payload = {
      candidate: { revisionId: "revision-1", modelKey: "model", taskKind: "text_to_video" },
      request: { extras: { comfyCertificationRevisionId: "revision-1" } },
    };
    await expect(call("comfy-candidate-test", owner, payload)).resolves.toMatchObject({ ok: true });
    expect(call("comfy-candidate-cancel", owner, payload.candidate)).toEqual({ ok: true });
    expect(mocks.runCandidate).toHaveBeenCalledWith(payload, expect.objectContaining(runtime));
    expect(mocks.cancelCandidate).toHaveBeenCalledWith(payload.candidate);
  });
  it("returns structured failure and exact cleanup when runtime loading throws before the executor guard", async () => {
    const failure = { ok: false, revisionId: "revision-1", reasonCode: "provider_failed", params: {} };
    mocks.failCandidateEnvelope.mockReturnValue(failure);
    registerTaskIpcHandlers(async () => { throw new Error("runtime load failed"); }, noCanvasCore);
    const owner = sender(31); const payload = {
      candidate: { revisionId: "revision-1", modelKey: "model", taskKind: "text_to_video" },
      request: {},
    };
    await expect(call("comfy-candidate-test", owner, payload)).resolves.toEqual(failure);
    // 真因必须随失败信封一起交出去。这里曾是一个空 catch（`} catch {`），把上游 4xx、余额不足、
    // 乃至我们自己的出站策略拒绝**全部**压成裸码 `provider_failed`，界面照着渲染那个未翻译的码，
    // 用户看不到任何可据以行动的事实。断言绑住第三个参数，空 catch 回来就翻红。
    expect(mocks.failCandidateEnvelope).toHaveBeenCalledWith(
      payload,
      "provider_failed",
      expect.objectContaining({ message: "runtime load failed" }),
    );
  });
  it("cancels and cleans the exact in-flight candidate when its renderer is destroyed", async () => {
    let loaded!: (runtime: Runtime) => void;
    const failure = { ok: false, revisionId: "revision-1", reasonCode: "candidate_cancelled", params: {} };
    mocks.failCandidateEnvelope.mockReturnValue(failure);
    registerTaskIpcHandlers(() => new Promise((resolve) => { loaded = resolve; }), noCanvasCore);
    const owner = sender(31); const payload = {
      candidate: { revisionId: "revision-1", modelKey: "model", taskKind: "text_to_video" },
      request: {},
    };
    const pending = call("comfy-candidate-test", owner, payload);
    owner.emit("destroyed");
    loaded({ runTask: vi.fn(), fetchTaskResult: vi.fn() } as unknown as Runtime);
    await expect(pending).resolves.toMatchObject({ ok: false, revisionId: "revision-1" });
    expect(mocks.cancelCandidate).toHaveBeenCalledWith(payload.candidate);
    expect(mocks.failCandidateEnvelope).toHaveBeenCalledWith(payload, "candidate_cancelled");
    expect(mocks.runCandidate).not.toHaveBeenCalled();
  });
  it("prevents repeated quit events from bypassing process cleanup", async () => {
    let finish!: () => void;
    const cleanup = new Promise<void>((resolve) => { finish = resolve; });
    mocks.cancelAll.mockReturnValue(cleanup);
    registerTaskIpcHandlers(async () => ({}) as Runtime, noCanvasCore);
    const first = { preventDefault: vi.fn() }; const second = { preventDefault: vi.fn() };
    mocks.quitHandler!(first); mocks.quitHandler!(second);
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.cancelAll).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
    finish(); await cleanup; await Promise.resolve();
    expect(mocks.quit).toHaveBeenCalledOnce();
    const completed = { preventDefault: vi.fn() }; mocks.quitHandler!(completed);
    expect(completed.preventDefault).not.toHaveBeenCalled();
  });
});

// 批量卡（发动机收敛第一刀第 3 步）：卡上点了确认，卡上列出的每一镜在主进程各开一份出价；排队里去掉 / 整批 × 收回。
// 同一节点「一次只许一笔在途」从这条 IPC 搬到了画布付费口自己的准入里（appIntegrationCanvasShot.test.ts）。
describe("canvas batch consent and withdrawal", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.handlers.clear(); mocks.cancelAll.mockResolvedValue(undefined); });

  function core() {
    const consentCanvasShots = vi.fn(() => ({ runIds: ["canvas-r1"] }));
    const withdrawCanvasShots = vi.fn();
    registerTaskIpcHandlers(async () => ({}) as unknown as Runtime, async () => ({ consentCanvasShots, withdrawCanvasShots, releaseCanvasShotSender: vi.fn() }) as never);
    return { consentCanvasShots, withdrawCanvasShots };
  }

  it("consent passes the validated shots and the real sender, never a payload-claimed owner", async () => {
    const { consentCanvasShots } = core();
    const shot = { nodeId: "node-1", runRecordId: "r1", vendor: "acme", modelKey: "m", kind: "image", senderId: 999 };
    await expect(call("canvas-consent", sender(51), { projectId: "project-a", shots: [shot], senderId: 999 })).resolves.toEqual({ runIds: ["canvas-r1"] });
    expect(consentCanvasShots).toHaveBeenCalledWith({ projectId: "project-a", senderId: 51, shots: [{ nodeId: "node-1", runRecordId: "r1", vendor: "acme", modelKey: "m", kind: "image" }] });
    expect(mocks.guard).toHaveBeenCalled();
  });

  it("consent refuses an empty card or a shot without its identity: nothing is opened", async () => {
    const { consentCanvasShots } = core();
    await expect(call("canvas-consent", sender(52), { projectId: "project-a", shots: [] })).rejects.toThrow(/consent is invalid/);
    await expect(call("canvas-consent", sender(52), { projectId: "project-a", shots: [{ nodeId: "node-1", vendor: "acme", kind: "image" }] })).rejects.toThrow(/consent is invalid/);
    expect(consentCanvasShots).not.toHaveBeenCalled();
  });

  it("withdraw keeps the user's reason (去掉 / ×) and treats anything else as a stop", async () => {
    const { withdrawCanvasShots } = core();
    await call("canvas-withdraw", sender(53), { projectId: "project-a", runRecordIds: ["r1"], by: "removed" });
    await call("canvas-withdraw", sender(53), { projectId: "project-a", runRecordIds: ["r2"], by: "user_closed" });
    await call("canvas-withdraw", sender(53), { projectId: "project-a", runRecordIds: ["r3"], by: "whatever" });
    expect(withdrawCanvasShots.mock.calls.map(([input]) => input)).toEqual([
      { projectId: "project-a", runRecordIds: ["r1"], by: "removed" },
      { projectId: "project-a", runRecordIds: ["r2"], by: "user_closed" },
      { projectId: "project-a", runRecordIds: ["r3"], by: "stopped" },
    ]);
  });
});
