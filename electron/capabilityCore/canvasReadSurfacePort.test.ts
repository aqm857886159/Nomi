import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainEvent } from "electron";

const ipc = vi.hoisted(() => ({
  listeners: new Map<string, (event: IpcMainEvent, payload: unknown) => void>(),
  trust: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    on: (channel: string, listener: (event: IpcMainEvent, payload: unknown) => void) =>
      ipc.listeners.set(channel, listener),
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: ipc.trust }));

import { SURFACE_CANVAS_READ_REPLY_CHANNEL, SURFACE_CANVAS_READ_REQUEST_CHANNEL } from "../shared/surfacePortBinding";
import { CapabilityExecutionError } from "./capabilityExecutorRegistry";
import {
  createCanvasReadSurfaceRegistry,
  createSurfaceOwnerAuthority,
  type SurfaceOwnerDescriptor,
} from "./canvasReadSurfaceRegistry";
import { createCanvasReadSurfacePortRuntime } from "./canvasReadSurfacePort";

function setup() {
  const send = vi.fn();
  const contents = { id: 7 };
  const frame = { send };
  let live = true;
  const ownerDescriptor: SurfaceOwnerDescriptor = {
    contents,
    frame,
    webContentsId: 7,
    processId: 8,
    frameRoutingId: 9,
    origin: "file://",
    isLive: () => live,
  };
  const ownerAuthority = createSurfaceOwnerAuthority();
  const owner = ownerAuthority.capture(ownerDescriptor);
  const identity = {
    projectId: "project-a",
    immutableProjectUuid: "00000000-0000-4000-8000-000000000001",
    projectGeneration: 1,
    canonicalRootPath: "/real/project-a",
    canonicalRootDigest: "root-a",
  };
  const resolveProjectIdentity = vi.fn(async () => ({ ...identity }));
  let sequence = 0;
  const registry = createCanvasReadSurfaceRegistry({
    ownerAuthority,
    resolveProjectIdentity,
    randomId: () => `id-${++sequence}`,
  });
  const runtime = createCanvasReadSurfacePortRuntime({
    registry,
    randomId: () => `read-${++sequence}`,
  });
  return {
    contents,
    frame,
    send,
    registry,
    runtime,
    resolveProjectIdentity,
    setLive(value: boolean) {
      live = value;
    },
    async capture() {
      const suspension = registry.suspend(owner, { surfaceInstanceId: "surface-1" });
      const binding = await registry.commitCanvasRead(owner, { projectId: "project-a", suspension });
      return {
        binding,
        captured: registry.captureCanvasReadPort(owner, binding),
      };
    },
    reply(payload: unknown, source: { contents?: object; frame?: object } = {}) {
      ipc.listeners.get(SURFACE_CANVAS_READ_REPLY_CHANNEL)?.(
        {
          sender: source.contents ?? contents,
          senderFrame: source.frame ?? frame,
        } as unknown as IpcMainEvent,
        payload,
      );
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ipc.listeners.clear();
});

describe("dedicated renderer CanvasReadPort", () => {
  it("targets the exact captured frame and revalidates the echoed binding before returning", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const port = test.runtime.createPort(captured);
    const reading = port.read({ signal: new AbortController().signal });
    expect(test.send).toHaveBeenCalledWith(SURFACE_CANVAS_READ_REQUEST_CHANNEL, {
      requestId: "read-5",
      binding,
    });

    test.reply({
      requestId: "read-5",
      binding: structuredClone(binding),
      result: { nodes: [{ id: "node-a" }] },
    });

    await expect(reading).resolves.toEqual({ nodes: [{ id: "node-a" }] });
    expect(test.resolveProjectIdentity).toHaveBeenCalledTimes(2);
  });

  it("ignores a different sender/frame without consuming the pending exact reply", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const reading = test.runtime.createPort(captured).read({ signal: new AbortController().signal });
    const payload = { requestId: "read-5", binding: structuredClone(binding), result: { exact: true } };

    test.reply(payload, { contents: {} });
    test.reply(payload, { frame: {} });
    await Promise.resolve();
    expect(test.resolveProjectIdentity).toHaveBeenCalledTimes(1);
    test.reply(payload);
    await expect(reading).resolves.toEqual({ exact: true });
  });

  it("ignores a reply rejected by the shared IPC sender boundary", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const reading = test.runtime.createPort(captured).read({ signal: new AbortController().signal });
    ipc.trust.mockImplementationOnce(() => {
      throw new Error("untrusted sender detail");
    });
    test.reply({ requestId: "read-5", binding: structuredClone(binding), result: { ignored: true } });
    await Promise.resolve();
    expect(test.resolveProjectIdentity).toHaveBeenCalledTimes(1);
    test.reply({ requestId: "read-5", binding: structuredClone(binding), result: { exact: true } });
    await expect(reading).resolves.toEqual({ exact: true });
  });

  it("cleans the pending request on abort and discards a late reply without revalidation", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const controller = new AbortController();
    const reading = test.runtime.createPort(captured).read({ signal: controller.signal });
    controller.abort(new Error("private abort reason"));

    await expect(reading).rejects.toEqual(
      expect.objectContaining<Partial<CapabilityExecutionError>>({
        name: "CapabilityExecutionError",
        code: "capability_cancelled",
        message: "capability_cancelled",
      }),
    );
    const callsAtAbort = test.resolveProjectIdentity.mock.calls.length;
    test.reply({ requestId: "read-5", binding: structuredClone(binding), result: { late: true } });
    await Promise.resolve();
    expect(test.resolveProjectIdentity).toHaveBeenCalledTimes(callsAtAbort);
  });

  it("fails closed on stale target, malformed reply, and renderer error without any fallback", async () => {
    const stale = setup();
    const { captured } = await stale.capture();
    stale.setLive(false);
    await expect(
      stale.runtime.createPort(captured).read({ signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: "surface_port_unavailable" });
    expect(stale.send).not.toHaveBeenCalled();

    const malformed = setup();
    const active = await malformed.capture();
    const malformedRead = malformed.runtime.createPort(active.captured).read({
      signal: new AbortController().signal,
    });
    malformed.reply({ requestId: "read-5", binding: { ...active.binding, nonce: "forged" }, result: {} });
    await expect(malformedRead).rejects.toMatchObject({ code: "surface_port_stale" });

    const failed = setup();
    const failedActive = await failed.capture();
    const failedRead = failed.runtime.createPort(failedActive.captured).read({
      signal: new AbortController().signal,
    });
    failed.reply({
      requestId: "read-5",
      binding: structuredClone(failedActive.binding),
      error: { code: "surface_port_suspended", raw: "/private/path" },
    });
    await expect(failedRead).rejects.toEqual(
      expect.objectContaining({
        code: "surface_port_suspended",
        message: "surface_port_suspended",
      }),
    );
  });
});
