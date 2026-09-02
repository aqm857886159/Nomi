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

import {
  SURFACE_CANVAS_READ_REPLY_CHANNEL,
  SURFACE_CANVAS_READ_REQUEST_CHANNEL,
  SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL,
  SURFACE_CANVAS_WRITE_CAPTURE_REQUEST_CHANNEL,
  SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL,
  SURFACE_CANVAS_WRITE_EXECUTE_REQUEST_CHANNEL,
  SURFACE_DOCUMENT_READ_REPLY_CHANNEL,
  SURFACE_DOCUMENT_READ_REQUEST_CHANNEL,
  SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL,
  SURFACE_DOCUMENT_WRITE_REQUEST_CHANNEL,
  SURFACE_TIMELINE_READ_REPLY_CHANNEL,
  SURFACE_TIMELINE_READ_REQUEST_CHANNEL,
  SURFACE_TIMELINE_WRITE_REPLY_CHANNEL,
  SURFACE_TIMELINE_WRITE_REQUEST_CHANNEL,
  SURFACE_PORT_CANCEL_REQUEST_CHANNEL,
} from "../shared/surfacePortBinding";
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
    replyDocument(payload: unknown) {
      ipc.listeners.get(SURFACE_DOCUMENT_READ_REPLY_CHANNEL)?.(
        { sender: contents, senderFrame: frame } as unknown as IpcMainEvent,
        payload,
      );
    },
    replyDocumentWrite(payload: unknown) {
      ipc.listeners.get(SURFACE_DOCUMENT_WRITE_REPLY_CHANNEL)?.(
        { sender: contents, senderFrame: frame } as unknown as IpcMainEvent,
        payload,
      );
    },
    replyCanvasWriteCapture(payload: unknown) {
      ipc.listeners.get(SURFACE_CANVAS_WRITE_CAPTURE_REPLY_CHANNEL)?.(
        { sender: contents, senderFrame: frame } as unknown as IpcMainEvent,
        payload,
      );
    },
    replyCanvasWriteExecute(payload: unknown) {
      ipc.listeners.get(SURFACE_CANVAS_WRITE_EXECUTE_REPLY_CHANNEL)?.(
        { sender: contents, senderFrame: frame } as unknown as IpcMainEvent,
        payload,
      );
    },
    replyTimelineRead(payload: unknown) {
      ipc.listeners.get(SURFACE_TIMELINE_READ_REPLY_CHANNEL)?.(
        { sender: contents, senderFrame: frame } as unknown as IpcMainEvent,
        payload,
      );
    },
    replyTimelineWrite(payload: unknown) {
      ipc.listeners.get(SURFACE_TIMELINE_WRITE_REPLY_CHANNEL)?.(
        { sender: contents, senderFrame: frame } as unknown as IpcMainEvent,
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

    expect(test.send).toHaveBeenLastCalledWith(SURFACE_PORT_CANCEL_REQUEST_CHANNEL, {
      requestId: "read-5",
      binding,
    });

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

  it("uses a main-captured document id and scope for canonical document.read", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const reading = test.runtime.createDocumentReadPort(captured, "document-a").read({
      scope: "selection",
      signal: new AbortController().signal,
    });
    expect(test.send).toHaveBeenCalledWith(SURFACE_DOCUMENT_READ_REQUEST_CHANNEL, {
      requestId: "read-5",
      binding,
      documentId: "document-a",
      scope: "selection",
    });
    test.replyDocument({ requestId: "read-5", binding: structuredClone(binding), result: { text: "selected", path: "/private" } });
    await expect(reading).resolves.toEqual({ text: "selected", path: "/private" });
  });

  it("keeps document replies on their own channel and cancels a rotated request without fallback", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const controller = new AbortController();
    const reading = test.runtime.createDocumentReadPort(captured, "document-a").read({
      scope: "full",
      signal: controller.signal,
    });
    test.reply({ requestId: "read-5", binding: structuredClone(binding), result: { wrong: true } });
    await Promise.resolve();
    expect(test.send).toHaveBeenCalledWith(SURFACE_DOCUMENT_READ_REQUEST_CHANNEL, expect.anything());
    controller.abort();
    await expect(reading).rejects.toMatchObject({ code: "capability_cancelled" });
    const callsAtAbort = test.resolveProjectIdentity.mock.calls.length;
    test.replyDocument({ requestId: "read-5", binding: structuredClone(binding), result: { late: true } });
    await Promise.resolve();
    expect(test.resolveProjectIdentity).toHaveBeenCalledTimes(callsAtAbort);
  });

  it("fails closed when the captured document surface is rotated before dispatch", async () => {
    const test = setup();
    const { captured } = await test.capture();
    test.setLive(false);
    await expect(
      test.runtime.createDocumentReadPort(captured, "document-a").read({
        scope: "selection",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "surface_port_unavailable" });
    expect(test.send).not.toHaveBeenCalled();
  });

  it("routes reversible document writes with the frozen target and preconditions", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const writing = test.runtime.createDocumentWritePort(captured, "document-a").write({
      operation: "replace",
      content: "new text",
      target: { kind: "document", documentId: "document-a", anchor: { kind: "range", from: 1, to: 3, selectedTextHash: "h" } },
      preconditions: { document: { revision: 4, contentHash: "old" } },
      signal: new AbortController().signal,
    });
    expect(test.send).toHaveBeenCalledWith(SURFACE_DOCUMENT_WRITE_REQUEST_CHANNEL, {
      requestId: "read-5",
      binding,
      documentId: "document-a",
      operation: "replace",
      content: "new text",
      target: { kind: "document", documentId: "document-a", anchor: { kind: "range", from: 1, to: 3, selectedTextHash: "h" } },
      preconditions: { document: { revision: 4, contentHash: "old" } },
    });
    test.replyDocumentWrite({ requestId: "read-5", binding: structuredClone(binding), result: { applied: true, revision: 5, contentHash: "next" } });
    await expect(writing).resolves.toEqual({ applied: true, revision: 5, contentHash: "next" });
  });

  it("captures raw Canvas evidence and executes only main-issued write authority on independent channels", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const port = test.runtime.createCanvasWritePort(captured);
    const controller = new AbortController();

    const capturing = port.capture({ operation: "set_node_prompt", nodeId: "node-alias", signal: controller.signal });
    expect(test.send).toHaveBeenCalledWith(SURFACE_CANVAS_WRITE_CAPTURE_REQUEST_CHANNEL, {
      requestId: "read-5",
      binding,
      operation: "set_node_prompt",
      nodeId: "node-alias",
    });
    const rawEvidence = { node: { id: "node-real" }, groups: [] };
    test.replyCanvasWriteCapture({ requestId: "read-5", binding: structuredClone(binding), result: rawEvidence });
    await expect(capturing).resolves.toEqual(rawEvidence);

    const writing = port.write({
      input: { operation: "set_node_prompt", nodeId: "node-alias", prompt: "new prompt" },
      target: { kind: "canvas", nodeIds: ["node-real"] },
      preconditions: { nodes: [{ nodeId: "node-real", contentHash: "fnv1a-node" }] },
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: "action-a",
      signal: controller.signal,
    });
    expect(test.send).toHaveBeenLastCalledWith(SURFACE_CANVAS_WRITE_EXECUTE_REQUEST_CHANNEL, {
      requestId: "read-6",
      binding,
      input: { operation: "set_node_prompt", nodeId: "node-alias", prompt: "new prompt" },
      target: { kind: "canvas", nodeIds: ["node-real"] },
      preconditions: { nodes: [{ nodeId: "node-real", contentHash: "fnv1a-node" }] },
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: "action-a",
    });
    const result = { applied: true, proposalId: "receipt-a", operation: "set_node_prompt", affectedNodeIds: ["node-real"], reconciliation: { ok: true, deviationCount: 0 } };
    test.replyCanvasWriteExecute({ requestId: "read-6", binding: structuredClone(binding), result });
    await expect(writing).resolves.toEqual(result);
  });

  it("preserves a renderer target-stale outcome on the Canvas write reply boundary", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const capturing = test.runtime.createCanvasWritePort(captured).capture({
      operation: "set_node_prompt",
      nodeId: "node-a",
      signal: new AbortController().signal,
    });
    test.replyCanvasWriteCapture({
      requestId: "read-5",
      binding: structuredClone(binding),
      error: { code: "capability_target_stale" },
    });
    await expect(capturing).rejects.toMatchObject({ code: "capability_target_stale" });

    const executing = test.runtime.createCanvasWritePort(captured).write({
      input: { operation: "set_node_prompt", nodeId: "node-a", prompt: "new" },
      target: { kind: "canvas", nodeIds: ["node-a"] },
      preconditions: {},
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: "action-a",
      signal: new AbortController().signal,
    });
    test.replyCanvasWriteExecute({
      requestId: "read-6",
      binding: structuredClone(binding),
      error: { code: "capability_target_stale" },
    });
    await expect(executing).rejects.toMatchObject({ code: "capability_target_stale" });

    const unknown = test.runtime.createCanvasWritePort(captured).capture({
      operation: "set_node_prompt",
      nodeId: "node-a",
      signal: new AbortController().signal,
    });
    test.replyCanvasWriteCapture({
      requestId: "read-7",
      binding: structuredClone(binding),
      error: { code: "renderer_private_error" },
    });
    await expect(unknown).rejects.toMatchObject({ code: "surface_port_unavailable" });
  });

  it("keeps Timeline reads and approved writes on exact independent Surface channels", async () => {
    const test = setup();
    const { captured, binding } = await test.capture();
    const signal = new AbortController().signal;
    const target = { kind: "timeline", clipIds: ["clip-a"] };
    const preconditions = { timeline: { revision: "revision-a" } };

    const reading = test.runtime.createTimelineReadPort(captured).read({
      input: { operation: "read_timeline" },
      target,
      preconditions,
      signal,
    });
    expect(test.send).toHaveBeenCalledWith(SURFACE_TIMELINE_READ_REQUEST_CHANNEL, {
      requestId: "read-5",
      binding,
      input: { operation: "read_timeline" },
      target,
      preconditions,
    });
    test.replyTimelineWrite({
      requestId: "read-5",
      binding: structuredClone(binding),
      result: { wrongChannel: true },
    });
    await Promise.resolve();
    test.replyTimelineRead({
      requestId: "read-5",
      binding: structuredClone(binding),
      result: { operation: "read_timeline", revision: "revision-a" },
    });
    await expect(reading).resolves.toEqual({ operation: "read_timeline", revision: "revision-a" });

    const input = {
      operation: "undo_timeline_edit" as const,
      undoToken: "timeline-undo:v1:receipt-a",
      expectedRevision: "revision-a",
    };
    const writing = test.runtime.createTimelineWritePort(captured).write({
      input,
      target,
      preconditions,
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: "action-a",
      signal,
    });
    expect(test.send).toHaveBeenLastCalledWith(SURFACE_TIMELINE_WRITE_REQUEST_CHANNEL, {
      requestId: "read-6",
      binding,
      input,
      target,
      preconditions,
      receiptProposalId: "receipt-a",
      approvalId: "approval-a",
      actionHash: "action-a",
    });
    const result = { operation: "undo_timeline_edit", ok: true, undone: true, revision: "revision-b" };
    test.replyTimelineWrite({ requestId: "read-6", binding: structuredClone(binding), result });
    await expect(writing).resolves.toEqual(result);
  });
});
