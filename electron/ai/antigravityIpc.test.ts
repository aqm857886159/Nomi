import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
type Handler = (event: { sender: EventEmitter & { id: number } }, value?: unknown) => Promise<unknown>;
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), guard: vi.fn(),
  onBeforeQuit: undefined as undefined | (() => void), onWillQuit: undefined as undefined | ((event: { preventDefault: () => void }) => void), quit: vi.fn(),
  status: vi.fn(), test: vi.fn(), cancel: vi.fn(), restore: vi.fn(), sync: vi.fn(), read: vi.fn(() => []), write: vi.fn() }));
vi.mock("electron", () => ({ app: { on: (name: string, fn: (event: { preventDefault: () => void }) => void) => { if (name === "before-quit") mocks.onBeforeQuit = fn as () => void; else mocks.onWillQuit = fn; }, quit: mocks.quit }, ipcMain: { handle: (name: string, fn: Handler) => mocks.handlers.set(name, fn) } }));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: mocks.guard }));
vi.mock("./antigravityConnection", () => ({ antigravityConnection: mocks }));
vi.mock("../catalog/antigravityCatalog", () => ({ syncAntigravityCatalog: mocks.sync }));
vi.mock("./antigravityEvidenceStore", () => ({ readAntigravityEvidence: mocks.read, writeAntigravityEvidence: mocks.write }));
import { registerAntigravityIpc } from "./antigravityIpc";
import { installQuitTeardown, resetQuitTeardownForTests } from "../quitTeardown";
type OwnerEvent = { preventDefault: () => void };
/** The real quit owner driven by a stand-in Electron app; only Electron itself is faked. */
const owner = { listeners: new Map<string, (event: OwnerEvent) => void>(), quit: vi.fn(), exit: vi.fn() };
const emitOwner = (name: "before-quit" | "will-quit", event: OwnerEvent = { preventDefault: vi.fn() }) => { owner.listeners.get(name)?.(event); return event; };
beforeEach(() => {
  vi.resetAllMocks(); mocks.read.mockReturnValue([]); mocks.handlers.clear(); owner.listeners.clear();
  resetQuitTeardownForTests();
  registerAntigravityIpc();
  installQuitTeardown({
    on: (name: string, listener: (...args: never[]) => void) => { owner.listeners.set(name, listener as (event: OwnerEvent) => void); },
    whenReady: () => Promise.resolve(), quit: owner.quit, exit: owner.exit,
  }, { disposeBackgroundLifecycle: vi.fn(), stopDesktopCapabilityCore: vi.fn(), abortAllActiveExports: vi.fn(() => 0), disposeDesktopLaneIpc: vi.fn(async () => undefined) });
});
const sender = (id: number) => Object.assign(new EventEmitter(), { id });
it("validates test payload before any native invocation", async () => {
  await expect(mocks.handlers.get("nomi:antigravity:test")!({ sender: sender(1) }, { capability: "image", modelId: "auto", command: "bad" })).rejects.toThrow("ANTIGRAVITY_INVALID_TEST");
  expect(mocks.guard).toHaveBeenCalledOnce();
  expect(mocks.test).not.toHaveBeenCalled();
});
it("binds cancellation to the initiating window and waits for process settlement", async () => {
  let finish!: (value: unknown) => void;
  const result = { state: "unverified", models: [], checkedAt: 1, loginCommand: "agy", checks: [] };
  mocks.test.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const owner = { sender: sender(1) };
  const pending = mocks.handlers.get("nomi:antigravity:test")!(owner, { capability: "text", modelId: "auto" });
  await vi.waitFor(() => expect(mocks.test).toHaveBeenCalledOnce());
  await expect(mocks.handlers.get("nomi:antigravity:cancel")!({ sender: sender(2) })).rejects.toThrow("ANTIGRAVITY_OWNER_MISMATCH");
  expect(mocks.cancel).not.toHaveBeenCalled();
  let cancelled = false;
  const cancellation = mocks.handlers.get("nomi:antigravity:cancel")!(owner).then(() => { cancelled = true; });
  await Promise.resolve();
  expect(cancelled).toBe(false);
  finish(result);
  await Promise.all([pending, cancellation]);
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(mocks.sync).toHaveBeenCalledWith(result);
  expect(owner.sender.listenerCount("destroyed")).toBe(0);
});
it("registers shutdown draining without owning Electron quit events", () => {
  expect(mocks.onBeforeQuit).toBeUndefined();
  expect(mocks.onWillQuit).toBeUndefined();
});
it("owner quit cancels native verification once across repeated will-quit, refuses new tests, and waits for settlement", async () => {
  let finish!: (value: unknown) => void;
  mocks.test.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const windowOwner = { sender: sender(1) };
  const pending = mocks.handlers.get("nomi:antigravity:test")!(windowOwner, { capability: "image", modelId: "auto" });
  await vi.waitFor(() => expect(mocks.test).toHaveBeenCalledOnce());
  emitOwner("before-quit");
  const first = emitOwner("will-quit"); const second = emitOwner("will-quit");
  expect(first.preventDefault).toHaveBeenCalledOnce();
  expect(second.preventDefault).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
  expect(owner.quit).not.toHaveBeenCalled();
  await expect(mocks.handlers.get("nomi:antigravity:test")!(windowOwner, { capability: "text", modelId: "auto" })).rejects.toThrow("ANTIGRAVITY_SHUTTING_DOWN");
  finish({ state: "unverified", models: [], checkedAt: 1, loginCommand: "agy", checks: [] });
  await pending;
  await vi.waitFor(() => expect(owner.quit).toHaveBeenCalledOnce());
  expect(mocks.cancel).toHaveBeenCalledOnce();
  expect(owner.exit).not.toHaveBeenCalled();
});
it("owner quit waits for persistence even when native work has already finished", async () => {
  let finish!: () => void;
  const persisting = new Promise<void>((resolve) => { finish = resolve; });
  mocks.test.mockResolvedValue({ state: "ready", models: [], checkedAt: 1, loginCommand: "agy", checks: [] });
  mocks.sync.mockReturnValue(persisting);
  const pending = mocks.handlers.get("nomi:antigravity:test")!({ sender: sender(1) });
  await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
  emitOwner("will-quit");
  for (let i = 0; i < 24; i += 1) await Promise.resolve();
  expect(owner.quit).not.toHaveBeenCalled();
  expect(emitOwner("will-quit").preventDefault).toHaveBeenCalledOnce();
  finish(); await pending;
  await vi.waitFor(() => expect(owner.quit).toHaveBeenCalledOnce());
  expect(owner.exit).not.toHaveBeenCalled();
});
it("a cancelled quit lets the user start a new verification again", async () => {
  emitOwner("before-quit");
  await expect(mocks.handlers.get("nomi:antigravity:test")!({ sender: sender(1) }, { capability: "text", modelId: "auto" })).rejects.toThrow("ANTIGRAVITY_SHUTTING_DOWN");
  const { resetQuitRequest } = await import("../quitTeardown");
  resetQuitRequest();
  mocks.test.mockResolvedValue({ state: "ready", models: [], checkedAt: 1, loginCommand: "agy", checks: [] });
  await expect(mocks.handlers.get("nomi:antigravity:test")!({ sender: sender(1) }, { capability: "text", modelId: "auto" })).resolves.toMatchObject({ state: "ready" });
});
it("keeps cancellation and new submissions waiting until the finished result is persisted", async () => {
  let finish!: () => void;
  const persisting = new Promise<void>((resolve) => { finish = resolve; });
  const ready = { state: "ready", models: [], checkedAt: 1, loginCommand: "agy", checks: [] };
  mocks.test.mockResolvedValue(ready); mocks.sync.mockReturnValue(persisting);
  const owner = { sender: sender(1) };
  const pending = mocks.handlers.get("nomi:antigravity:test")!(owner, { capability: "text", modelId: "auto" });
  await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
  let settled = false;
  const cancellation = mocks.handlers.get("nomi:antigravity:cancel")!(owner).then((result) => { settled = true; return result; });
  await Promise.resolve(); await Promise.resolve();
  expect(settled).toBe(false);
  await expect(mocks.handlers.get("nomi:antigravity:test")!(owner)).rejects.toThrow("ANTIGRAVITY_TEST_ACTIVE");
  finish();
  await expect(cancellation).resolves.toEqual(ready);
  await expect(pending).resolves.toEqual(ready);
});
it("returns an owned just-finished result when success wins the cancellation IPC race", async () => {
  const ready = { state: "ready", models: [], checkedAt: 1, loginCommand: "agy", checks: [] };
  mocks.test.mockResolvedValue(ready);
  const owner = { sender: sender(1) };
  await mocks.handlers.get("nomi:antigravity:test")!(owner);
  await expect(mocks.handlers.get("nomi:antigravity:cancel")!(owner)).resolves.toEqual(ready);
  await expect(mocks.handlers.get("nomi:antigravity:cancel")!({ sender: sender(2) })).resolves.toBeUndefined();
  expect(mocks.cancel).not.toHaveBeenCalled();
});
