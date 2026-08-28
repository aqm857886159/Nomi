import { beforeEach, describe, expect, it, vi } from "vitest";
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
  registerProjectAgentIpc,
} from "./projectAgentIpc";

const binding = {
  projectId: "project-a",
  immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
  projectGeneration: 1,
} as const;

beforeEach(() => {
  state.handlers.clear();
  state.assertTrustedSender.mockClear();
});

describe("ProjectAgent IPC wire boundary", () => {
  it("injects main-owned identity and rejects raw mutation envelopes", async () => {
    const dispatch = vi.fn(async (_subscriptionId: string, mutation: unknown) => ({
      state: { hostRevision: 1 },
      mutation,
    }));
    const runtime = {
      executionCoordinator: {
        open: vi.fn(() => ({ subscriptionId: "subscription-a", binding, snapshot: { binding } })),
        snapshot: vi.fn(() => ({ binding })),
        dispatch,
        release: vi.fn(),
      },
    };
    const surfaceCapture = { captureCanvasReadPort: vi.fn(() => Object.freeze({})) };
    registerProjectAgentIpc({ runtime: runtime as never, surfaceCapture: surfaceCapture as never });
    const event = {} as IpcMainInvokeEvent;

    const opened = await state.handlers.get(PROJECT_AGENT_OPEN_CHANNEL)!(event, { binding });
    expect(opened).toMatchObject({ ok: true, value: { subscriptionId: "subscription-a" } });
    expect(surfaceCapture.captureCanvasReadPort).toHaveBeenCalledWith(event, binding);

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

  it("releases a captured surface when project preparation fails before host open", async () => {
    const dispose = vi.fn();
    const captureCanvasRead = vi.fn(() => ({ dispose }));
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
        open: vi.fn(() => ({ subscriptionId: "subscription-frame", binding, snapshot: { binding } })),
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
    listener?.({ type: "patch", patch: { binding, previousRevision: 0, hostRevision: 1, changes: [] } });

    expect(frame.send).toHaveBeenCalledWith(
      PROJECT_AGENT_EVENT_CHANNEL.replace(":event", ":patch"),
      expect.objectContaining({ binding, previousRevision: 0, hostRevision: 1 }),
    );
    expect(sender.send).not.toHaveBeenCalled();
  });
});
