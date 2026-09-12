import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { LaneDesktopResult, LaneSingleShotRequest } from "../shared/agentLane/laneDesktopContracts";
import { LANE_IPC_CHANNELS } from "../shared/agentLane/laneContracts";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>(),
  landing: vi.fn(),
  captureSurface: vi.fn(),
  sealSurfaceSnapshot: vi.fn(),
  rendererEvent: null as IpcMainInvokeEvent | null,
  surfaceBinding: null as unknown,
  desktopBridge: null as unknown,
  activeProjectId: "project-a",
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown) => {
      state.handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => state.handlers.delete(channel),
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined }));
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

import { canvasReadResultSchema } from "../shared/agentCapabilities/canvasRead";
import { formatCanvasForAgent } from "../shared/agentCapabilities/canvasReadCompact";
import { createMainCapabilityExecutorRegistry } from "./capabilityExecutorRegistry";
import { createCapturedCanvasReadSnapshotRegistry } from "./canvasReadCapturedSnapshotRegistry";
import { createCanvasReadPortResolver } from "./canvasReadPortResolver";
import { registerCanvasReadSurfaceIpc } from "./canvasReadSurfaceIpc";
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createPiCanvasReadIpcCapture } from "./canvasReadTransportAdapters";
import { registerAgentLaneIpc, type LaneIpcDependencies } from "../agentLane/laneIpc";
import { runLaneSingleShot } from "../agentLane/laneSingleShot.mjs";
import { createHttpFixture } from "../../tests/agent-runtime/httpFixture.mjs";
import { laneClient } from "../../src/workbench/ai/lane/laneClient";
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
    send: vi.fn(),
  };
  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    mainFrame: frame,
    isDestroyed: () => false,
  });
  return { frame, sender, event: { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent };
}

function invoke(channel: string, event: IpcMainInvokeEvent, payload: unknown) {
  const handler = state.handlers.get(channel);
  if (!handler) throw new Error(`missing handler: ${channel}`);
  return Promise.resolve().then(() => handler(event, payload));
}

const cleanups: Array<() => Promise<unknown>> = [];

function connectDesktopBridge(renderer: ReturnType<typeof source>): void {
  state.rendererEvent = renderer.event;
  laneClient.connect({
    send: async (command) => await invoke(LANE_IPC_CHANNELS.command, renderer.event, command) as LaneDesktopResult,
    onProjection: () => () => undefined,
  });
}

function installLaneSingleShot(singleShot: LaneIpcDependencies['singleShot']): void {
  const unexpected = () => { throw new Error('Planning must not open or mutate a conversation'); };
  const registration = registerAgentLaneIpc({ singleShot, openWorkspace: unexpected, validate: unexpected,
    configure: unexpected, receipt: unexpected, updatePolicy: unexpected, restoreInput: unexpected });
  cleanups.push(() => registration.dispose());
}

beforeEach(() => {
  vi.clearAllMocks();
  state.handlers.clear();
  state.rendererEvent = null;
  state.surfaceBinding = null;
  state.desktopBridge = null;
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

afterEach(async () => {
  laneClient.connect(undefined);
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("production captured canvas read through real main interception", () => {
  it("keeps the production single-shot prompt and sealed main read on canonical A after a project switch without canvas writes", async () => {
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
    const http = await createHttpFixture([{ type: 'text', text: JSON.stringify(plan) }]);
    cleanups.push(http.close);
    installLaneSingleShot(async (event, wire, signal) => {
      const request = wire as LaneSingleShotRequest;
      expect(request.prompt).toContain(compactA);
      expect(request.prompt).not.toContain("Later live B");
      expect(request.featureKey).toMatch(/^nomi:production-planner:project-a:/);
      if (request.projectId !== 'project-a') throw new Error('Unexpected fixture project');
      // The planner returns JSON IR with no tools. Independently exercise the
      // same sealed read capability in main; it cannot read the later live B.
      const handle = await state.sealSurfaceSnapshot.mock.results[0]!.value;
      const adapter = canvasRead.capture(event, { capturedCanvasReadSnapshot: handle, projectId: request.projectId }, 'production-a-1');
      try {
        readDecision = await adapter.tryExecute({ toolCallId: 'read-captured-a', toolName: 'nomi_canvas_read', args: {} }, signal);
      } finally { adapter.dispose(); }
      return runLaneSingleShot({ fetch: globalThis.fetch, model: { kind: 'openai-compatible', providerId: 'fixture', modelId: 'fixture',
        baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture' }, prompt: request.prompt, signal });
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

    await expect(pending).resolves.toMatchObject({ text: JSON.stringify(plan), plan: { title: "Captured plan" } });
    expect(readDecision).toEqual({ ok: true, result: canvasReadResultSchema.parse(canonicalA), silent: true });
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]!.body.tools ?? []).toEqual([]);
    const promptBody = JSON.stringify(http.requests[0]!.body);
    expect(promptBody).toContain('Captured A');
    expect(promptBody).not.toContain('Later live B');
    expect(promptBody).not.toContain('secret.invalid');
    expect(useGenerationCanvasStore.getState().nodes.map(node => node.id)).toEqual(['node-b']);
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

    // Main's sealed capability remains single-use and read-only, independent
    // of the planner's tool-free JSON request or the later live Surface.
    const capturedAdapter = canvasRead.capture(
      renderer.event,
      { capturedCanvasReadSnapshot: structuredClone(sealedA.value.handle), projectId: "project-a" },
      "production-a-1",
    );
    await expect(
      capturedAdapter.tryExecute(
        { toolCallId: "read-captured-a", toolName: "nomi_canvas_read", args: {} },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ ok: true, result: canvasReadResultSchema.parse(SNAPSHOT_A), silent: true });
    expect(readDisk).not.toHaveBeenCalled();
    expect(renderer.frame.send.mock.calls.some(([channel]) => channel === "nomi:surface:canvasRead:request")).toBe(
      false,
    );

    // A sealed handle is single use: replaying the same bytes is refused, it does not
    // silently fall back to whatever the live Surface holds now.
    expect(() => canvasRead.capture(
      renderer.event,
      { capturedCanvasReadSnapshot: structuredClone(sealedA.value.handle), projectId: "project-a" },
      "production-a-replay",
    )).toThrow(expect.objectContaining({ code: "surface_port_stale" }));
    capturedAdapter.dispose();
  });
});
