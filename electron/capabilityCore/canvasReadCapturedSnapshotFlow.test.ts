import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { AgentChatV2Hooks } from "../ai/agentChatV2";
import type { AgentChatResponse } from "../harness/agentChatContracts";
import type { ProjectAgentHostState } from "../shared/projectAgentContracts";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>(),
  run: vi.fn(),
  landing: vi.fn(),
  captureSurface: vi.fn(),
  sealSurfaceSnapshot: vi.fn(),
  listeners: new Map<string, (event: unknown) => void>(),
  rendererEvent: null as IpcMainInvokeEvent | null,
  surfaceBinding: null as unknown,
  desktopBridge: null as unknown,
  projectAgentEventListener: null as ((event: unknown) => void) | null,
  projectAgentPatchListener: null as ((patch: unknown) => void) | null,
  projectAgentCleanup: null as (() => void) | null,
  activeProjectId: "project-a",
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown) => {
      state.handlers.set(channel, handler);
    },
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined }));
vi.mock("../events/agentChatTrace", () => ({
  beginTurnTrace: () => undefined,
  traceChatEvent: () => undefined,
  traceToolDecision: () => undefined,
  traceGateDenied: () => undefined,
}));
vi.mock("../i18n", () => ({ desktopT: () => "confirmation expired" }));
vi.mock("../ai/agentChatV2", () => ({
  runAgentChatV2: state.run,
  seedAgentChatV2History: vi.fn(),
  agentChatV2HasHistory: vi.fn(),
  clearAgentChatV2History: vi.fn(),
}));
vi.mock("../../src/workbench/capability/multiShotCanvasLanding", () => ({
  handleMultiShotCanvasLandingOp: state.landing,
}));
vi.mock("../../src/workbench/project/workbenchProjectSession", () => ({
  getActiveWorkbenchProjectId: () => state.activeProjectId,
}));
vi.mock("../../src/workbench/project/projectCanvasReadSurface", () => ({
  captureCurrentProjectCanvasReadSurfaceBinding: state.captureSurface,
  sealCurrentProjectCanvasReadSnapshot: state.sealSurfaceSnapshot,
}));
vi.mock("../../src/workbench/generationCanvas/agent/availableModels", () => ({
  listAvailableModelsForAgent: async () => [],
  formatAvailableModelsForPrompt: () => "",
  resolveStoryboardImageDefault: async () => ({}),
  resolveStoryboardVideoDefault: async () => ({}),
}));
vi.mock("../../src/workbench/ai/assistantModelPref", () => ({
  getAssistantModelPref: () => null,
}));
vi.mock("../../src/workbench/ai/agentUsageStore", () => ({
  useAgentUsageStore: { getState: () => ({ addUsage: () => undefined }) },
}));
vi.mock("../../src/desktop/bridge", () => ({
  getDesktopBridge: () => state.desktopBridge,
}));

import { registerAgentChatV2Ipc } from "../ai/agentChatV2Ipc";
import { canvasReadResultSchema } from "../shared/agentCapabilities/canvasRead";
import { formatCanvasForAgent } from "../shared/agentCapabilities/canvasReadCompact";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import { createCapturedCanvasReadSnapshotRegistry } from "./canvasReadCapturedSnapshotRegistry";
import { createCanvasReadPortResolver } from "./canvasReadPortResolver";
import { registerCanvasReadSurfaceIpc } from "./canvasReadSurfaceIpc";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createPiCanvasReadIpcCapture } from "./canvasReadTransportAdapters";
import { createProjectAgentExecutionCoordinator } from "../projectAgentHost/projectAgentExecutionCoordinator";
import { createProjectAgentRepositoryRouter } from "../projectAgentHost/projectAgentRepositoryRouter";
import {
  PROJECT_AGENT_COMMAND_CHANNEL,
  PROJECT_AGENT_EVENT_CHANNEL,
  PROJECT_AGENT_OPEN_CHANNEL,
  PROJECT_AGENT_PATCH_CHANNEL,
  PROJECT_AGENT_RELEASE_CHANNEL,
  PROJECT_AGENT_SNAPSHOT_CHANNEL,
  registerProjectAgentIpc,
} from "../projectAgentHost/projectAgentIpc";
import { projectAgentProjectionStore } from "../../src/workbench/ai/projectAgentProjectionStore";
import { handleCapabilityApply } from "../../src/workbench/capability/capabilityApplyHandler";
import { useGenerationCanvasStore } from "../../src/workbench/generationCanvas/store/generationCanvasStore";

const SNAPSHOT_A = Object.freeze({
  nodes: [
    Object.freeze({
      id: "node-a",
      kind: "image",
      title: "Captured A",
      prompt: "draw A",
      status: "idle" as const,
      position: Object.freeze({ x: 1, y: 2 }),
      locked: false,
      hasResult: false,
    }),
  ],
  edges: Object.freeze([]),
  groups: Object.freeze([]),
  selectedNodeIds: Object.freeze(["node-a"]),
});

function source() {
  const frame = {
    routingId: 2,
    processId: 10,
    url: "file:///nomi/index.html",
    detached: false,
    isDestroyed: () => false,
    send: vi.fn((channel: string, packet: { sessionId?: string; event?: unknown }) => {
      if (channel === "nomi:agents:chatV2:event" && packet?.sessionId) {
        state.listeners.get(packet.sessionId)?.(packet.event);
        return;
      }
      if (channel === PROJECT_AGENT_EVENT_CHANNEL) {
        state.projectAgentEventListener?.(packet);
        return;
      }
      if (channel === PROJECT_AGENT_PATCH_CHANNEL) {
        projectAgentProjectionStore.applyPatch(packet as never);
        state.projectAgentPatchListener?.(packet);
      }
    }),
  };
  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    mainFrame: frame,
    isDestroyed: () => false,
  });
  return { frame, sender, event: { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent };
}

function response(): AgentChatResponse {
  return {
    id: "result",
    text: "done",
    status: "finished",
    finishReason: "stop",
    toolCalls: [],
    artifacts: [],
    usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0, totalTokens: 2 },
  };
}

function invoke(channel: string, event: IpcMainInvokeEvent, payload: unknown) {
  const handler = state.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return Promise.resolve().then(() => handler(event, payload));
}

function connectDesktopBridge(renderer: ReturnType<typeof source>): void {
  state.rendererEvent = renderer.event;
  state.desktopBridge = {
    agents: {
      chatV2Start: (input: unknown) => invoke("nomi:agents:chatV2:start", renderer.event, input),
      confirmTool: (sessionId: string, toolCallId: string, decision: unknown) =>
        invoke("nomi:agents:chatV2:confirmTool", renderer.event, { sessionId, toolCallId, decision }),
      cancelChatV2: (sessionId: string) => invoke("nomi:agents:chatV2:cancel", renderer.event, { sessionId }),
      onChatV2Event: (sessionId: string, listener: (event: unknown) => void) => {
        state.listeners.set(sessionId, listener);
        return () => state.listeners.delete(sessionId);
      },
    },
    projectAgent: {
      open: (binding: unknown) => invoke(PROJECT_AGENT_OPEN_CHANNEL, renderer.event, { binding }),
      snapshot: (subscriptionId: string) => invoke(PROJECT_AGENT_SNAPSHOT_CHANNEL, renderer.event, { subscriptionId }),
      command: (command: unknown) => invoke(PROJECT_AGENT_COMMAND_CHANNEL, renderer.event, command),
      release: (subscriptionId: string) => invoke(PROJECT_AGENT_RELEASE_CHANNEL, renderer.event, { subscriptionId }),
      readProposalReceipt: async () => null,
      writeProposalReceipt: async () => { throw new Error("not used"); },
      transitionProposalReceipt: async () => { throw new Error("not used"); },
      clearProposalReceipt: async () => { throw new Error("not used"); },
      onPatch: (listener: (patch: unknown) => void) => {
        state.projectAgentPatchListener = listener;
        return () => {
          if (state.projectAgentPatchListener === listener) state.projectAgentPatchListener = null;
        };
      },
      onEvent: (listener: (event: unknown) => void) => {
        state.projectAgentEventListener = listener;
        return () => {
          if (state.projectAgentEventListener === listener) state.projectAgentEventListener = null;
        };
      },
    },
  };
}

async function installProjectAgentHost(
  renderer: ReturnType<typeof source>,
  surfaceCapture: ReturnType<typeof registerCanvasReadSurfaceIpc>,
  canvasRead: ReturnType<typeof createPiCanvasReadIpcCapture>,
  binding: { projectId: string; immutableProjectUuid: string; projectGeneration: number },
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-canvas-read-flow-"));
  const repositoryRouter = createProjectAgentRepositoryRouter({ rootDir: root });
  const executionCoordinator = createProjectAgentExecutionCoordinator(
    repositoryRouter,
    () => `subscription-${globalThis.crypto.randomUUID()}`,
    { runAgent: state.run },
  );
  registerProjectAgentIpc({
    runtime: {
      repositoryRouter,
      executionCoordinator,
      attachProject: (projectBinding) => repositoryRouter.attach(projectBinding),
      setGenerationAdapterFactory: () => {},
    },
    surfaceCapture,
    captureCanvasRead: (_event, projectBinding, requestId) => canvasRead.capture(
      renderer.event,
      { surfaceBinding: state.surfaceBinding, projectId: projectBinding.projectId },
      requestId,
    ),
    captureCanvasReadSnapshot: (event, projectBinding, handle, requestId) => canvasRead.capture(
      event,
      { capturedCanvasReadSnapshot: handle, projectId: projectBinding.projectId },
      requestId,
    ),
  });
  const opened = await invoke(PROJECT_AGENT_OPEN_CHANNEL, renderer.event, { binding });
  if (!opened || typeof opened !== "object" || !(opened as { ok?: boolean }).ok) {
    throw new Error("project agent open failed");
  }
  const value = (opened as {
    value: { subscriptionId: string; subscriptionEpoch: number; snapshot: ProjectAgentHostState };
  }).value;
  projectAgentProjectionStore.install(value.subscriptionId, value.subscriptionEpoch, value.snapshot);
  state.projectAgentCleanup = () => {
    void invoke(PROJECT_AGENT_RELEASE_CHANNEL, renderer.event, { subscriptionId: value.subscriptionId });
    fs.rmSync(root, { recursive: true, force: true });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.handlers.clear();
  state.listeners.clear();
  state.rendererEvent = null;
  state.surfaceBinding = null;
  state.desktopBridge = null;
  state.projectAgentEventListener = null;
  state.projectAgentPatchListener = null;
  state.activeProjectId = "project-a";
  state.landing.mockResolvedValue(null);
  state.captureSurface.mockImplementation(() => state.surfaceBinding);
  state.sealSurfaceSnapshot.mockImplementation(async (binding: unknown, snapshot: unknown) => {
    const event = state.rendererEvent;
    const handler = state.handlers.get("nomi:surface:captureCanvasReadSnapshot");
    if (!event || !handler) throw new Error("captured snapshot main bridge unavailable");
    const reply = (await handler(event, { binding, snapshot })) as {
      ok: boolean;
      value?: { handle: unknown };
      error?: { code?: string; message?: string };
    };
    if (!reply.ok || !reply.value) {
      throw Object.assign(new Error(reply.error?.message || "capture failed"), {
        code: reply.error?.code,
      });
    }
    return reply.value.handle;
  });
});

afterEach(() => {
  state.projectAgentCleanup?.();
  state.projectAgentCleanup = null;
  projectAgentProjectionStore.clear();
});

describe("production captured canvas read through real main interception", () => {
  it("keeps the real production prompt and main tool read on one canonical snapshot after selection and project switch", async () => {
    const renderer = source();
    connectDesktopBridge(renderer);
    const ownerAuthority = createSurfaceOwnerAuthority();
    const identities = new Map([
      [
        "project-a",
        {
          projectId: "project-a",
          immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
          projectGeneration: 1,
          canonicalRootPath: "/projects/a",
          canonicalRootDigest: "root-a",
        },
      ],
      [
        "project-b",
        {
          projectId: "project-b",
          immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
          projectGeneration: 1,
          canonicalRootPath: "/projects/b",
          canonicalRootDigest: "root-b",
        },
      ],
    ]);
    let id = 0;
    const surfaceRegistry = createCanvasReadSurfaceRegistry({
      ownerAuthority,
      resolveProjectIdentity: async (projectId) => ({ ...identities.get(projectId)! }),
      randomId: () => `surface-${++id}`,
    });
    const capturedSnapshots = createCapturedCanvasReadSnapshotRegistry({
      ownerAuthority,
      randomId: () => `captured-${++id}`,
    });
    const surfaceCapture = registerCanvasReadSurfaceIpc({
      registry: surfaceRegistry,
      ownerAuthority,
      capturedSnapshots,
    });
    const readDisk = vi.fn();
    const executor = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: createCanvasReadPortResolver({
        capturedSnapshots,
        disk: {
          resolveProjectIdentity: async (projectId) => ({ ...identities.get(projectId)! }),
          readCanvas: readDisk,
        },
      }),
    });
    const canvasRead = createPiCanvasReadIpcCapture({
      surfaceCapture,
      registry: surfaceRegistry,
      capturedSnapshots,
      executor,
    });
    registerAgentChatV2Ipc({ canvasRead });

    const suspendedA = (await invoke("nomi:surface:suspend", renderer.event, {
      surfaceInstanceId: "surface-a",
    })) as { ok: true; value: { suspension: unknown } };
    const committedA = (await invoke("nomi:surface:commitCanvasRead", renderer.event, {
      projectId: "project-a",
      suspension: structuredClone(suspendedA.value.suspension),
    })) as {
      ok: true;
      value: { binding: { binding: { projectId: string; immutableProjectUuid: string; projectGeneration: number } } };
    };
    state.surfaceBinding = committedA.value.binding;
    await installProjectAgentHost(renderer, surfaceCapture, canvasRead, committedA.value.binding.binding as {
      projectId: string;
      immutableProjectUuid: string;
      projectGeneration: number;
    });
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        {
          id: "node-a",
          kind: "image",
          title: "Captured A",
          prompt: "draw A",
          position: { x: 1, y: 2 },
          result: {
            id: "result-a",
            type: "image",
            url: "https://secret.invalid/result.png",
            createdAt: 1,
          },
        },
      ],
      edges: [],
      groups: [],
      selectedNodeIds: ["node-a"],
    });
    useGenerationCanvasStore.setState({ selectedNodeIds: ["node-a"] });

    let releaseLanding!: () => void;
    state.landing.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseLanding = () => resolve(null);
      }),
    );
    const plan = {
      title: "Captured plan",
      anchors: [],
      shots: [
        {
          index: 1,
          shotId: "shot-1",
          shotKind: "video" as const,
          durationSec: 3,
          anchorIds: [],
          prompt: "rain",
        },
      ],
    };
    let compactA = "";
    let readDecision: unknown;
    let proposalDecision: unknown;
    state.run.mockImplementationOnce(async (request, hooks: AgentChatV2Hooks) => {
      expect(request.prompt).toContain(compactA);
      expect(request.prompt).not.toContain("Later live B");
      readDecision = await hooks.awaitToolConfirmation(
        {
          toolCallId: "read-captured-a",
          toolName: "read_canvas_state",
          args: {},
        },
        hooks.abortSignal!,
      );
      proposalDecision = await hooks.awaitToolConfirmation(
        {
          toolCallId: "propose-captured-a",
          toolName: "propose_storyboard_plan",
          args: plan,
        },
        hooks.abortSignal!,
      );
      return response();
    });

    const pending = handleCapabilityApply("production.plan-storyboard", {
      projectId: "project-a",
      runId: "run-a",
      operationId: "operation-a",
      brief: { goal: "make A" },
    });
    await vi.waitFor(() => expect(state.landing).toHaveBeenCalledOnce());
    const canonicalA = state.sealSurfaceSnapshot.mock.calls[0]![1] as typeof SNAPSHOT_A & {
      nodes: Array<
        (typeof SNAPSHOT_A.nodes)[number] & {
          currentResultId?: string;
          resultIds?: string[];
        }
      >;
    };
    expect(canonicalA.selectedNodeIds).toEqual([]);
    expect(canonicalA.nodes[0]).toMatchObject({
      id: "node-a",
      hasResult: true,
      currentResultId: "result-a",
      resultIds: ["result-a"],
    });
    compactA = formatCanvasForAgent(canvasReadResultSchema.parse(canonicalA));

    const suspendedB = (await invoke("nomi:surface:suspend", renderer.event, {
      surfaceInstanceId: "surface-b",
    })) as { ok: true; value: { suspension: unknown } };
    await invoke("nomi:surface:commitCanvasRead", renderer.event, {
      projectId: "project-b",
      suspension: structuredClone(suspendedB.value.suspension),
    });
    state.activeProjectId = "project-b";
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{ id: "node-b", kind: "image", title: "Later live B", position: { x: 0, y: 0 } }],
      edges: [],
      groups: [],
      selectedNodeIds: [],
    });
    releaseLanding();

    await expect(pending).resolves.toMatchObject({ text: "done", plan: { title: "Captured plan" } });
    expect(readDecision).toEqual({ ok: true, result: compactA, silent: true });
    expect(proposalDecision).toMatchObject({
      ok: true,
      result: { title: "Captured plan", anchorCount: 0, shotCount: 1 },
      silent: true,
    });
    expect(readDisk).not.toHaveBeenCalled();
    expect(renderer.frame.send.mock.calls.some(([channel]) => channel === "nomi:surface:canvasRead:request")).toBe(
      false,
    );
  });

  it("keeps prompt and tool read on sealed A after live Surface switches to B, then rejects replay", async () => {
    const renderer = source();
    const ownerAuthority = createSurfaceOwnerAuthority();
    const identities = new Map([
      [
        "project-a",
        {
          projectId: "project-a",
          immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
          projectGeneration: 1,
          canonicalRootPath: "/projects/a",
          canonicalRootDigest: "root-a",
        },
      ],
      [
        "project-b",
        {
          projectId: "project-b",
          immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
          projectGeneration: 1,
          canonicalRootPath: "/projects/b",
          canonicalRootDigest: "root-b",
        },
      ],
    ]);
    let id = 0;
    const surfaceRegistry = createCanvasReadSurfaceRegistry({
      ownerAuthority,
      resolveProjectIdentity: async (projectId) => ({ ...identities.get(projectId)! }),
      randomId: () => `surface-${++id}`,
    });
    const capturedSnapshots = createCapturedCanvasReadSnapshotRegistry({
      ownerAuthority,
      randomId: () => `captured-${++id}`,
    });
    const surfaceCapture = registerCanvasReadSurfaceIpc({
      registry: surfaceRegistry,
      ownerAuthority,
      capturedSnapshots,
    });
    const readDisk = vi.fn();
    const executor = createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: createCanvasReadPortResolver({
        capturedSnapshots,
        disk: {
          resolveProjectIdentity: async (projectId) => ({ ...identities.get(projectId)! }),
          readCanvas: readDisk,
        },
      }),
    });
    const canvasRead = createPiCanvasReadIpcCapture({
      surfaceCapture,
      registry: surfaceRegistry,
      capturedSnapshots,
      executor,
    });
    registerAgentChatV2Ipc({ canvasRead });

    const suspendedA = (await invoke("nomi:surface:suspend", renderer.event, {
      surfaceInstanceId: "surface-a",
    })) as { ok: true; value: { suspension: unknown } };
    const committedA = (await invoke("nomi:surface:commitCanvasRead", renderer.event, {
      projectId: "project-a",
      suspension: structuredClone(suspendedA.value.suspension),
    })) as {
      ok: true;
      value: { binding: { binding: { projectId: string; immutableProjectUuid: string; projectGeneration: number } } };
    };
    state.surfaceBinding = committedA.value.binding;
    await installProjectAgentHost(renderer, surfaceCapture, canvasRead, committedA.value.binding.binding as {
      projectId: string;
      immutableProjectUuid: string;
      projectGeneration: number;
    });
    const sealedA = (await invoke("nomi:surface:captureCanvasReadSnapshot", renderer.event, {
      binding: structuredClone(committedA.value.binding),
      snapshot: structuredClone(SNAPSHOT_A),
    })) as { ok: true; value: { handle: unknown } };

    const suspendedB = (await invoke("nomi:surface:suspend", renderer.event, {
      surfaceInstanceId: "surface-b",
    })) as { ok: true; value: { suspension: unknown } };
    await invoke("nomi:surface:commitCanvasRead", renderer.event, {
      projectId: "project-b",
      suspension: structuredClone(suspendedB.value.suspension),
    });

    const prompt = formatCanvasForAgent(canvasReadResultSchema.parse(SNAPSHOT_A));
    let toolDecision: unknown;
    state.run.mockImplementationOnce(async (request, hooks: AgentChatV2Hooks) => {
      expect(request.prompt).toBe(prompt);
      toolDecision = await hooks.awaitToolConfirmation(
        {
          toolCallId: "read-captured-a",
          toolName: "read_canvas_state",
          args: {},
        },
        hooks.abortSignal!,
      );
      return response();
    });
    const start = {
      requestId: "production-a-1",
      request: {
        prompt,
        capability: "storyboard",
        projectId: "project-a",
        history: { kind: "ephemeral" },
      },
      capturedCanvasReadSnapshot: structuredClone(sealedA.value.handle),
    };

    await expect(invoke("nomi:agents:chatV2:start", renderer.event, start)).resolves.toEqual({
      sessionId: "production-a-1",
    });
    await vi.waitFor(() => expect(toolDecision).toEqual({ ok: true, result: prompt, silent: true }));
    await vi.waitFor(() => expect(state.run).toHaveBeenCalledOnce());
    expect(readDisk).not.toHaveBeenCalled();
    expect(renderer.frame.send.mock.calls.some(([channel]) => channel === "nomi:surface:canvasRead:request")).toBe(
      false,
    );

    await expect(
      invoke("nomi:agents:chatV2:start", renderer.event, {
        ...start,
        requestId: "production-a-replay",
        capturedCanvasReadSnapshot: structuredClone(sealedA.value.handle),
      }),
    ).rejects.toMatchObject({ code: "surface_port_stale" });
    expect(state.run).toHaveBeenCalledOnce();
  });
});
