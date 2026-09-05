import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>>(),
  assertTrustedSender: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>) =>
      state.handlers.set(channel, handler),
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: state.assertTrustedSender }));

import {
  PROJECT_AGENT_COMMAND_CHANNEL,
  PROJECT_AGENT_EVENT_CHANNEL,
  PROJECT_AGENT_OPEN_CHANNEL,
  PROJECT_AGENT_PROPOSAL_RECEIPT_CLEAR_CHANNEL,
  PROJECT_AGENT_PROPOSAL_RECEIPT_READ_CHANNEL,
  PROJECT_AGENT_PROPOSAL_RECEIPT_TRANSITION_CHANNEL,
  PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL,
  PROJECT_AGENT_RELEASE_CHANNEL,
  registerProjectAgentIpc,
} from "./projectAgentIpc";
import { createProjectAgentProposalReceiptService } from "./projectAgentProposalReceiptStore";
import type { ProjectBinding } from "../shared/projectAgentContracts";

const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;
const proposal = {
  proposalId: "proposal-a",
  summary: "created node",
  stepLabels: ["created node"],
  compensation: [{ kind: "delete-nodes", nodeIds: ["node-a"] }],
  watchNodes: [{ nodeId: "node-a", title: "Node A", prompt: "prompt" }],
  reconciliationOk: true,
  anchorMessageId: "assistant-a",
  anchorTextOffset: 12,
} as const;
let receiptRoot = "";

beforeEach(() => {
  state.handlers.clear();
  state.assertTrustedSender.mockClear();
});

afterEach(() => {
  if (receiptRoot) fs.rmSync(receiptRoot, { recursive: true, force: true });
  receiptRoot = "";
});

describe("ProjectAgent IPC wire boundary", () => {
  it("injects main-owned identity and rejects raw mutation envelopes", async () => {
    const dispatch = vi.fn(async (_subscriptionId: string, mutation: unknown) => ({
      state: { hostRevision: 1 },
      mutation,
    }));
    const runtime = {
      executionCoordinator: {
        open: vi.fn(() => ({ subscriptionId: "subscription-a", subscriptionEpoch: 1, binding, snapshot: { binding } })),
        snapshot: vi.fn(() => ({ binding })),
        dispatch,
        release: vi.fn(),
      },
    };
    const surfaceCapture = { captureCanvasReadPort: vi.fn(() => Object.freeze({})) };
    const skillRead = { tryExecute: vi.fn(async () => null), dispose: vi.fn() };
    const captureSkillRead = vi.fn(() => skillRead);
    registerProjectAgentIpc({
      runtime: runtime as never,
      surfaceCapture: surfaceCapture as never,
      captureSkillRead,
    });
    const event = {} as IpcMainInvokeEvent;

    const opened = await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });
    expect(opened).toMatchObject({ ok: true, value: { subscriptionId: "subscription-a" } });
    expect(surfaceCapture.captureCanvasReadPort).toHaveBeenCalledWith(event, binding);
    expect(captureSkillRead).toHaveBeenCalledWith(event, binding, "project-agent-open-project-a");
    expect(runtime.executionCoordinator.open).toHaveBeenCalledWith(
      binding,
      expect.objectContaining({ skillRead }),
    );

    const command = await state.handlers.get(PROJECT_AGENT_COMMAND_CHANNEL)!(event, {
      subscriptionId: "subscription-a",
      clientCommandId: "command-a",
      knownRevision: 0,
      type: "thread.put",
      payload: {
        thread: { threadId: "thread-a", createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" },
      },
    });
    expect(command).toMatchObject({ ok: true });
    expect(dispatch).toHaveBeenCalledWith(
      "subscription-a",
      expect.objectContaining({
        commandId: "command-a",
        expectedRevision: 0,
        binding,
        sender: { kind: "renderer", senderId: "subscription-a" },
      }),
    );

    const rawMutation = await state.handlers.get(PROJECT_AGENT_COMMAND_CHANNEL)!(event, {
      commandId: "raw",
      expectedRevision: 0,
      binding,
      sender: { kind: "renderer", senderId: "forged" },
      type: "thread.put",
      payload: {},
    });
    expect(rawMutation).toMatchObject({ ok: false, error: { code: "project_agent_invalid_request" } });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("P2B-ASSET-001..005 resolves renderer claims through the exact prepared project binding", async () => {
    const enqueue = vi.fn(async (_subscriptionId: string, input: { mutation: unknown; request: unknown }) => ({
      state: { binding, hostRevision: 1 },
      patch: null,
      replayed: false,
      input,
    }));
    const resolvedRef = {
      assetId: "asset-trusted",
      contentHash: "a".repeat(64),
      version: 1,
      display: {
        url: "nomi-local://asset/project-a/assets/imported/reference.png",
        fileName: "reference.png",
        contentType: "image/png",
        sizeBytes: 4,
        kind: "image" as const,
      },
    };
    const resolver = vi.fn((claims: readonly unknown[]) => {
      const claim = claims[0] as Record<string, unknown>;
      if (claim.assetId !== "asset-trusted" || claim.version !== 1 || Object.keys(claim).length !== 2) {
        throw new Error("project_agent_attachment_invalid");
      }
      return [resolvedRef];
    });
    const runtime = {
      executionCoordinator: {
        open: vi.fn(() => ({ subscriptionId: "subscription-asset", subscriptionEpoch: 1, binding, snapshot: { binding } })),
        snapshot: vi.fn(() => ({ binding })),
        dispatch: vi.fn(),
        enqueue,
        release: vi.fn(),
      },
    };
    registerProjectAgentIpc({
      runtime: runtime as never,
      surfaceCapture: { captureCanvasReadPort: vi.fn(() => Object.freeze({}) as never) } as never,
      prepareProject: () => ({ resolveAttachmentClaims: resolver }),
    });
    const event = {} as IpcMainInvokeEvent;
    await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });
    const common = {
      thread: { threadId: "thread-a", createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z" },
      turn: { turnId: "turn-a" },
      userItem: { itemId: "item-a" },
      queueItem: { queueItemId: "queue-a", attachmentRefs: [{ assetId: "renderer-forged" }] },
      request: { prompt: "look", capability: "canvas-chat", history: { kind: "ephemeral" } },
      attachmentClaims: [{ assetId: "asset-trusted", version: 1 }],
    };
    const accepted = await state.handlers.get(PROJECT_AGENT_COMMAND_CHANNEL)!(event, {
      subscriptionId: "subscription-asset",
      clientCommandId: "enqueue-asset",
      knownRevision: 0,
      type: "turn.enqueue",
      payload: common,
    });
    expect(accepted).toMatchObject({ ok: true });
    expect(resolver).toHaveBeenCalledWith([{ assetId: "asset-trusted", version: 1 }]);
    expect(enqueue).toHaveBeenCalledWith(
      "subscription-asset",
      expect.objectContaining({
        mutation: expect.objectContaining({
          payload: expect.objectContaining({
            queueItem: expect.objectContaining({ attachmentRefs: [resolvedRef] }),
          }),
        }),
        request: expect.objectContaining({
          attachments: [{
            url: resolvedRef.display.url,
            contentType: resolvedRef.display.contentType,
            fileName: resolvedRef.display.fileName,
            kind: resolvedRef.display.kind,
          }],
        }),
      }),
    );

    const rejected = await state.handlers.get(PROJECT_AGENT_COMMAND_CHANNEL)!(event, {
      subscriptionId: "subscription-asset",
      clientCommandId: "enqueue-forged",
      knownRevision: 0,
      type: "turn.enqueue",
      payload: { ...common, attachmentClaims: [{ assetId: "asset-trusted", version: 2, contentHash: "f".repeat(64) }] },
    });
    expect(rejected).toMatchObject({ ok: false, error: { code: "project_agent_attachment_invalid" } });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("releases a captured surface when project preparation fails before host open", async () => {
    const dispose = vi.fn();
    const captureCanvasRead = vi.fn(() => ({ tryExecute: vi.fn(async () => null), dispose }));
    const open = vi.fn();
    const runtime = {
      executionCoordinator: {
        open,
        snapshot: vi.fn(),
        dispatch: vi.fn(),
        release: vi.fn(),
      },
    };
    const surfaceCapture = { captureCanvasReadPort: vi.fn() };
    registerProjectAgentIpc({
      runtime: runtime as never,
      surfaceCapture: surfaceCapture as never,
      captureCanvasRead,
      prepareProject: async () => {
        throw new Error("project_binding_stale");
      },
    });

    const event = {} as IpcMainInvokeEvent;
    const opened = await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });

    expect(opened).toMatchObject({ ok: false, error: { code: "project_binding_stale" } });
    expect(captureCanvasRead).toHaveBeenCalledWith(event, binding, "project-agent-open-project-a");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("delivers execution events to the subscribed frame instead of broadcasting by WebContents", async () => {
    const sender = { send: vi.fn() };
    const frame = { send: vi.fn(), detached: false, isDestroyed: () => false };
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    let listener: ((notification: unknown) => void) | undefined;
    const runtime = {
      executionCoordinator: {
        open: vi.fn(() => ({ subscriptionId: "subscription-frame", subscriptionEpoch: 1, binding, snapshot: { binding } })),
        snapshot: vi.fn(() => ({ binding })),
        dispatch: vi.fn(),
        release: vi.fn(),
        subscribe: vi.fn((_subscriptionId: string, next: (notification: unknown) => void) => {
          listener = next;
          return vi.fn();
        }),
      },
    };
    const surfaceCapture = { captureCanvasReadPort: vi.fn(() => Object.freeze({})) };
    registerProjectAgentIpc({ runtime: runtime as never, surfaceCapture: surfaceCapture as never });

    await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });
    listener?.({
      type: "patch",
      subscriptionId: "subscription-frame",
      subscriptionEpoch: 1,
      patch: { binding, previousRevision: 0, hostRevision: 1, changes: [] },
    });

    expect(frame.send).toHaveBeenCalledWith(
      PROJECT_AGENT_EVENT_CHANNEL.replace(":event", ":patch"),
      expect.objectContaining({
        binding,
        previousRevision: 0,
        hostRevision: 1,
      }),
    );
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("revokes only on full main-frame navigation, renderer exit, or destruction", async () => {
    const frame = { send: vi.fn(), detached: false, isDestroyed: () => false };
    const sender = Object.assign(new EventEmitter(), {
      mainFrame: frame,
      isDestroyed: () => false,
      send: vi.fn(),
    });
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const release = vi.fn();
    const unsubscribe = vi.fn();
    const snapshot = vi.fn(() => ({ binding }));
    const dispatch = vi.fn();
    const resolveToolDecision = vi.fn();
    const runtime = {
      executionCoordinator: {
        open: vi.fn(() => ({
          subscriptionId: "subscription-lifecycle",
          subscriptionEpoch: 1,
          binding,
          snapshot: { binding },
        })),
        snapshot,
        dispatch,
        resolveToolDecision,
        release,
        subscribe: vi.fn(() => unsubscribe),
      },
    };
    registerProjectAgentIpc({
      runtime: runtime as never,
      surfaceCapture: { captureCanvasReadPort: vi.fn(() => Object.freeze({})) } as never,
    });
    await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });

    sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    expect(await state.handlers.get("nomi:projectAgent:snapshot")!(event, {
      subscriptionId: "subscription-lifecycle",
    })).toMatchObject({ ok: true });
    expect(release).not.toHaveBeenCalled();

    sender.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    expect(release).not.toHaveBeenCalled();
    sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith("subscription-lifecycle");
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    for (const payload of [
      { subscriptionId: "subscription-lifecycle" },
      {
        subscriptionId: "subscription-lifecycle",
        clientCommandId: "late-command",
        knownRevision: 0,
        type: "thread.put",
        payload: {},
      },
      {
        subscriptionId: "subscription-lifecycle",
        clientCommandId: "late-decision",
        knownRevision: 0,
        type: "tool.decision",
        payload: { turnId: "turn-a", toolCallId: "tool-a", decision: { ok: false } },
      },
    ]) {
      const channel = Object.prototype.hasOwnProperty.call(payload, "type")
        ? PROJECT_AGENT_COMMAND_CHANNEL
        : "nomi:projectAgent:snapshot";
      expect(await state.handlers.get(channel)!(event, payload)).toMatchObject({
        ok: false,
        error: { code: "project_agent_subscription_invalid" },
      });
    }
    expect(dispatch).not.toHaveBeenCalled();
    expect(resolveToolDecision).not.toHaveBeenCalled();

    sender.emit("render-process-gone");
    sender.emit("destroyed");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("supersedes the same frame authority and drops delayed events from the old epoch", async () => {
    const frame = { send: vi.fn(), detached: false, isDestroyed: () => false };
    const sender = Object.assign(new EventEmitter(), {
      mainFrame: frame,
      isDestroyed: () => false,
      send: vi.fn(),
    });
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const subscriptions = [
      { subscriptionId: "subscription-epoch-a", subscriptionEpoch: 1, binding, snapshot: { binding } },
      { subscriptionId: "subscription-epoch-b", subscriptionEpoch: 2, binding, snapshot: { binding } },
    ];
    const eventListeners = new Map<string, (notification: unknown) => void>();
    const release = vi.fn();
    const runtime = {
      executionCoordinator: {
        open: vi.fn(() => subscriptions.shift()!),
        snapshot: vi.fn(() => ({ binding })),
        dispatch: vi.fn(),
        resolveToolDecision: vi.fn(),
        release,
        subscribe: vi.fn((subscriptionId: string, listener: (notification: unknown) => void) => {
          eventListeners.set(subscriptionId, listener);
          return vi.fn();
        }),
      },
    };
    registerProjectAgentIpc({
      runtime: runtime as never,
      surfaceCapture: { captureCanvasReadPort: vi.fn(() => Object.freeze({})) } as never,
    });

    const first = await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });
    const second = await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });
    expect(first).toMatchObject({ ok: true, value: { subscriptionId: "subscription-epoch-a", subscriptionEpoch: 1 } });
    expect(second).toMatchObject({ ok: true, value: { subscriptionId: "subscription-epoch-b", subscriptionEpoch: 2 } });
    expect(release).toHaveBeenCalledWith("subscription-epoch-a");

    eventListeners.get("subscription-epoch-a")?.({
      type: "execution-result",
      subscriptionId: "subscription-epoch-a",
      subscriptionEpoch: 1,
      binding,
      turnId: "turn-same",
      executionToken: "token-same",
      response: {},
    });
    expect(frame.send).not.toHaveBeenCalled();
    eventListeners.get("subscription-epoch-b")?.({
      type: "execution-error",
      subscriptionId: "subscription-epoch-b",
      subscriptionEpoch: 2,
      binding,
      turnId: "turn-same",
      executionToken: "token-same",
      message: "failed",
    });
    expect(frame.send).toHaveBeenCalledWith(
      PROJECT_AGENT_EVENT_CHANNEL,
      expect.objectContaining({
        subscriptionId: "subscription-epoch-b",
        subscriptionEpoch: 2,
        executionToken: "token-same",
      }),
    );
    expect(await state.handlers.get("nomi:projectAgent:snapshot")!(event, {
      subscriptionId: "subscription-epoch-a",
    })).toMatchObject({ ok: false, error: { code: "project_agent_subscription_invalid" } });
  });

  it("does not let a slow older open replace a newer completed open", async () => {
    const frame = { send: vi.fn(), detached: false, isDestroyed: () => false };
    const sender = Object.assign(new EventEmitter(), {
      mainFrame: frame,
      isDestroyed: () => false,
      send: vi.fn(),
    });
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const firstOpen = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondOpen = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    const release = vi.fn();
    const runtime = {
      executionCoordinator: {
        open: vi.fn()
          .mockImplementationOnce(() => firstOpen)
          .mockImplementationOnce(() => secondOpen),
        snapshot: vi.fn(() => ({ binding })),
        dispatch: vi.fn(),
        resolveToolDecision: vi.fn(),
        release,
        subscribe: vi.fn(() => vi.fn()),
      },
    };
    registerProjectAgentIpc({
      runtime: runtime as never,
      surfaceCapture: { captureCanvasReadPort: vi.fn(() => Object.freeze({})) } as never,
    });

    const older = state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });
    await Promise.resolve();
    const newer = state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });
    resolveSecond({
      subscriptionId: "subscription-open-newer",
      subscriptionEpoch: 2,
      binding,
      snapshot: { binding },
    });
    await expect(newer).resolves.toMatchObject({
      ok: true,
      value: { subscriptionId: "subscription-open-newer", subscriptionEpoch: 2 },
    });
    resolveFirst({
      subscriptionId: "subscription-open-older",
      subscriptionEpoch: 1,
      binding,
      snapshot: { binding },
    });
    await expect(older).resolves.toMatchObject({
      ok: false,
      error: { code: "project_agent_subscription_invalid" },
    });
    expect(release).toHaveBeenCalledWith("subscription-open-older");
    expect(release).not.toHaveBeenCalledWith("subscription-open-newer");
  });

  it("binds receipt read/write/clear to the exact live main-frame subscription", async () => {
    receiptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-ipc-receipt-"));
    fs.mkdirSync(path.join(receiptRoot, ".nomi"), { recursive: true });
    const sender = {};
    const frame = { send: vi.fn(), detached: false, isDestroyed: () => false };
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const wrongFrame = { sender, senderFrame: { ...frame } } as unknown as IpcMainInvokeEvent;
    const runtime = {
      executionCoordinator: {
        open: vi.fn((_projectBinding: ProjectBinding, _options?: Readonly<{ proposalReceipt?: () => unknown; proposalReceiptWriter?: unknown }>) => ({
          subscriptionId: "subscription-receipt",
          subscriptionEpoch: 1,
          binding,
          snapshot: { binding },
        })),
        snapshot: vi.fn(() => ({ binding })),
        dispatch: vi.fn(),
        release: vi.fn(),
      },
    };
    const receiptService = createProjectAgentProposalReceiptService({ projectRoot: receiptRoot, binding });
    registerProjectAgentIpc({
      runtime: runtime as never,
      surfaceCapture: { captureCanvasReadPort: vi.fn(() => Object.freeze({})) } as never,
      prepareProject: () => ({ proposalReceipts: receiptService }),
    });

    const opened = await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });
    expect(opened).toMatchObject({ ok: true, value: { proposalReceipt: null } });
    const openOptions = runtime.executionCoordinator.open.mock.calls[0]?.[1] as
      | Readonly<{ proposalReceipt?: () => unknown; proposalReceiptWriter?: unknown }>
      | undefined;
    expect(openOptions?.proposalReceipt).toEqual(expect.any(Function));
    expect(openOptions?.proposalReceipt?.()).toBeNull();
    expect(openOptions?.proposalReceiptWriter).toBe(receiptService);
    const prepared = await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
      subscriptionId: "subscription-receipt",
      expectedRevision: 0,
      proposalId: proposal.proposalId,
      operationId: "prepare-proposal-a",
      lifecycle: "preparing",
      proposal,
    });
    expect(prepared).toMatchObject({ ok: true, value: { binding, revision: 1, lifecycle: "preparing", proposal } });
    const written = await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
      subscriptionId: "subscription-receipt",
      expectedRevision: 1,
      proposalId: proposal.proposalId,
      operationId: "commit-proposal-a",
      lifecycle: "committed",
      proposal,
    });
    expect(written).toMatchObject({ ok: true, value: { binding, revision: 2, lifecycle: "committed", proposal } });
    expect(openOptions?.proposalReceipt?.()).toMatchObject({
      binding,
      revision: 2,
      lifecycle: "committed",
      proposal,
    });
    expect(await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_READ_CHANNEL)!(event, {
      subscriptionId: "subscription-receipt",
    })).toMatchObject({ ok: true, value: { binding, revision: 2, lifecycle: "committed", proposal } });

    for (const attempt of [
      state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(wrongFrame, {
        subscriptionId: "subscription-receipt",
        expectedRevision: 2,
        proposalId: "proposal-b",
        operationId: "wrong-frame",
        lifecycle: "preparing",
        proposal,
      }),
      state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
        subscriptionId: "forged-subscription",
        expectedRevision: 2,
        proposalId: "proposal-b",
        operationId: "forged-subscription",
        lifecycle: "preparing",
        proposal,
      }),
      state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
        subscriptionId: "subscription-receipt",
        expectedRevision: 2,
        proposalId: "proposal-b",
        operationId: "forged-binding",
        lifecycle: "preparing",
        binding: { ...binding, projectId: "other-project" },
        projectRoot: "/tmp/forged",
        sourceHash: "a".repeat(64),
        proposal,
      }),
      state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
        subscriptionId: "subscription-receipt",
        expectedRevision: 2,
        proposalId: proposal.proposalId,
        operationId: "malformed-proposal",
        lifecycle: "preparing",
        proposal: { ...proposal, compensation: [{ kind: "delete-nodes", nodeIds: [42] }] },
      }),
    ]) {
      await expect(attempt).resolves.toMatchObject({ ok: false });
    }

    expect(await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_TRANSITION_CHANNEL)!(event, {
      subscriptionId: "subscription-receipt",
      expectedRevision: 2,
      proposalId: proposal.proposalId,
      operationId: "undo-proposal-a",
      lifecycle: "undoing",
    })).toMatchObject({ ok: true, value: { revision: 3, lifecycle: "undoing" } });
    expect(await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_TRANSITION_CHANNEL)!(event, {
      subscriptionId: "subscription-receipt",
      expectedRevision: 3,
      proposalId: proposal.proposalId,
      operationId: "complete-undo-proposal-a",
      lifecycle: "undone",
    })).toMatchObject({ ok: true, value: { revision: 4, lifecycle: "undone" } });
    expect(await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_CLEAR_CHANNEL)!(event, {
      subscriptionId: "subscription-receipt",
      expectedRevision: 4,
      proposalId: proposal.proposalId,
      operationId: "clear-proposal-a",
    })).toMatchObject({ ok: true, value: { cleared: true, receipt: { revision: 5, lifecycle: "undone" } } });
    expect(receiptService.read()).toMatchObject({ revision: 5, lifecycle: "undone" });

    await state.handlers.get(PROJECT_AGENT_RELEASE_CHANNEL)!(event, { subscriptionId: "subscription-receipt" });
    expect(await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
      subscriptionId: "subscription-receipt",
      expectedRevision: 5,
      proposalId: "proposal-b",
      operationId: "released-subscription",
      lifecycle: "preparing",
      proposal,
    })).toMatchObject({ ok: false });
  });

  it("admits Host receipts only when the claimed approval correlation matches exactly", async () => {
    receiptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-ipc-host-receipt-"));
    fs.mkdirSync(path.join(receiptRoot, ".nomi"), { recursive: true });
    const sender = {};
    const frame = { send: vi.fn(), detached: false, isDestroyed: () => false };
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const approval = {
      ref: {
        approvalId: "approval-host-a",
        receiptProposalId: "receipt-host-a",
        actionHash: "a".repeat(64),
      },
      lifecycle: "claimed",
    };
    const snapshot = { binding, proposalApprovals: [approval] };
    let snapshotBinding: ProjectBinding = binding;
    const runtime = {
      executionCoordinator: {
        open: vi.fn(() => ({ subscriptionId: "subscription-host-receipt", subscriptionEpoch: 1, binding, snapshot })),
        snapshot: vi.fn(() => ({ ...snapshot, binding: snapshotBinding })),
        dispatch: vi.fn(),
        release: vi.fn(),
      },
    };
    const receiptService = createProjectAgentProposalReceiptService({ projectRoot: receiptRoot, binding });
    registerProjectAgentIpc({
      runtime: runtime as never,
      surfaceCapture: { captureCanvasReadPort: vi.fn(() => Object.freeze({})) } as never,
      prepareProject: () => ({ proposalReceipts: receiptService }),
    });
    await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });

    const legacyForClaimedApproval = await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
      subscriptionId: "subscription-host-receipt",
      expectedRevision: 0,
      proposalId: "receipt-host-a",
      operationId: "legacy-prepare",
      lifecycle: "preparing",
      proposal: { ...proposal, proposalId: "receipt-host-a" },
    });
    expect(legacyForClaimedApproval).toMatchObject({ ok: false });

    const correlated = {
      ...proposal,
      proposalId: "receipt-host-a",
      hostApprovalId: "approval-host-a",
      hostActionHash: "a".repeat(64),
    };
    const forged = [
      { id: "binding", binding: { ...binding, projectId: "project-forged" }, proposal: correlated },
      { id: "proposal", binding, proposal: { ...correlated, proposalId: "receipt-forged" } },
      { id: "approval", binding, proposal: { ...correlated, hostApprovalId: "approval-forged" } },
      { id: "action", binding, proposal: { ...correlated, hostActionHash: "b".repeat(64) } },
    ] as const;
    for (const attempt of forged) {
      snapshotBinding = attempt.binding;
      expect(await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
        subscriptionId: "subscription-host-receipt",
        expectedRevision: 0,
        proposalId: "receipt-host-a",
        operationId: `wrong-${attempt.id}-prepare`,
        lifecycle: "preparing",
        proposal: attempt.proposal,
      })).toMatchObject({ ok: false });
    }
    snapshotBinding = binding;

    expect(await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
      subscriptionId: "subscription-host-receipt",
      expectedRevision: 0,
      proposalId: "receipt-host-a",
      operationId: "host-prepare",
      lifecycle: "preparing",
      proposal: correlated,
    })).toMatchObject({ ok: true, value: { lifecycle: "preparing", proposal: correlated } });
    for (const attempt of forged) {
      snapshotBinding = attempt.binding;
      expect(await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
        subscriptionId: "subscription-host-receipt",
        expectedRevision: 1,
        proposalId: "receipt-host-a",
        operationId: `wrong-${attempt.id}-commit`,
        lifecycle: "committed",
        proposal: attempt.proposal,
      })).toMatchObject({ ok: false });
    }
    snapshotBinding = binding;
    expect(await state.handlers.get(PROJECT_AGENT_PROPOSAL_RECEIPT_WRITE_CHANNEL)!(event, {
      subscriptionId: "subscription-host-receipt",
      expectedRevision: 1,
      proposalId: "receipt-host-a",
      operationId: "host-commit",
      lifecycle: "committed",
      proposal: correlated,
    })).toMatchObject({ ok: true, value: { lifecycle: "committed", proposal: correlated } });
  });
});
