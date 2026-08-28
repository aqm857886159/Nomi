import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalTaskJobs, withTaskOwner } from "./localTaskJobs";

type Sender = EventEmitter & { id: number };
type Handler = (event: { sender: Sender }, payload?: unknown) => unknown;
type QuitEvent = { preventDefault: () => void };
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(), quitHandler: undefined as undefined | ((event: QuitEvent) => void),
  guard: vi.fn(), quit: vi.fn(), cancel: vi.fn(), cancelOwner: vi.fn(), cancelAll: vi.fn(), grant: vi.fn(),
  runCandidate: vi.fn(), cancelCandidate: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, fn: Handler) => mocks.handlers.set(name, fn) },
  app: { on: (_name: string, fn: (event: QuitEvent) => void) => { mocks.quitHandler = fn; }, quit: mocks.quit },
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
}));

import { registerTaskIpcHandlers } from "./taskIpcHandlers";
type Runtime = Awaited<ReturnType<Parameters<typeof registerTaskIpcHandlers>[0]>>;
const sender = (id: number): Sender => Object.assign(new EventEmitter(), { id });
const call = (action: string, owner: Sender, payload?: unknown) => mocks.handlers.get(`nomi:tasks:${action}`)!({ sender: owner }, payload);

describe("task IPC local operation lifecycle", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.handlers.clear(); mocks.cancelAll.mockResolvedValue(undefined); });
  it("binds submissions and result queries to the actual sender, not a payload owner", async () => {
    const jobs = new LocalTaskJobs<string>();
    const runtime = {
      runTask: () => jobs.start("project", async () => "pixels"),
      fetchTaskResult: (id: string) => jobs.query(id, "project", () => ["nomi-local://result"]),
    };
    registerTaskIpcHandlers(async () => runtime as unknown as Runtime);
    const owner = sender(31);
    const id = await call("run", owner, { owner: 99 }) as string;
    await jobs.settled(id);
    expect(() => withTaskOwner(99, () => jobs.query(id, "project", vi.fn()))).toThrow("OWNER_MISMATCH");
    await expect(call("result", sender(32), id)).rejects.toThrow("OWNER_MISMATCH");
    await expect(call("result", owner, id)).resolves.toMatchObject({ status: "succeeded" });
  });
  it("registers one window-destruction cleanup callback across repeated submissions", async () => {
    registerTaskIpcHandlers(async () => ({ runTask: vi.fn() }) as unknown as Runtime);
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
    registerTaskIpcHandlers(() => new Promise((resolve) => { loaded = resolve; }));
    const owner = sender(31);
    const pending = call("run", owner);
    owner.emit("destroyed");
    loaded({ runTask: () => jobs.start("project", work) } as unknown as Runtime);
    await expect(pending).rejects.toThrow("LOCAL_TASK_OWNER_CLOSED");
    expect(work).not.toHaveBeenCalled();
  });
  it("validates cancel IDs and passes only the actual sender identity", async () => {
    registerTaskIpcHandlers(async () => ({}) as Runtime);
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
    registerTaskIpcHandlers(async () => runtime as unknown as Runtime);
    const owner = sender(31); const payload = { request: { extras: { comfyCertificationRevisionId: "revision-1" } } };
    await expect(call("comfy-candidate-test", owner, payload)).resolves.toMatchObject({ ok: true });
    expect(call("comfy-candidate-cancel", owner, { revisionId: "revision-1" })).toEqual({ ok: true });
    expect(mocks.runCandidate).toHaveBeenCalledWith(payload, expect.objectContaining(runtime));
    expect(mocks.cancelCandidate).toHaveBeenCalledWith({ revisionId: "revision-1" });
  });
  it("prevents repeated quit events from bypassing process cleanup", async () => {
    let finish!: () => void;
    const cleanup = new Promise<void>((resolve) => { finish = resolve; });
    mocks.cancelAll.mockReturnValue(cleanup);
    registerTaskIpcHandlers(async () => ({}) as Runtime);
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
