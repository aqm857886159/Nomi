import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { readWorkspaceProject, resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";
import {
  ensureWorkspaceProjectIdentity,
  WorkspaceProjectIdentityUnavailableError,
  type WorkspaceProjectIdentity,
} from "../workspace/workspaceProjectIdentity";
import {
  createMainCapabilityExecutorRegistry,
  type CapabilityExecutorRegistry,
} from "./capabilityExecutorRegistry";
import { resolveVerifiedCapabilityExecutionTarget } from "./verifiedCapabilityInvocation";
import {
  createCanvasReadPortResolver,
  type DiskCanvasReadPortDeps,
} from "./canvasReadPortResolver";
import { SurfacePortError, type CanvasReadSurfaceRegistry } from "./canvasReadSurfaceRegistry";
import type { ProjectBinding } from "../shared/projectBinding";
import type { CapturedCanvasReadSnapshotRegistry } from './canvasReadCapturedSnapshotRegistry'
import {
  createCanvasReadSurfacePortRuntime,
  type CanvasReadSurfacePortRuntime,
} from "./canvasReadSurfacePort";

function liveCapturedWritePort(registry: CanvasReadSurfaceRegistry, binding: ProjectBinding) {
  const selection = registry.getCommittedProjectSelection();
  const captured = selection
    ? registry.captureCommittedCanvasReadPort({
        binding,
        canonicalRootDigest: selection.canonicalRootDigest,
      })
    : null;
  if (!captured) throw new SurfacePortError("surface_port_unavailable");
  return captured;
}

export type CanvasReadExecutionRuntime = Readonly<{
  executor: CapabilityExecutorRegistry;
  surfacePortRuntime?: CanvasReadSurfacePortRuntime;
}>;

export async function resolveProductionCanvasReadProjectIdentity(
  projectId: string,
): Promise<WorkspaceProjectIdentity> {
  const root = resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());
  if (!root) throw new WorkspaceProjectIdentityUnavailableError();
  const identity = await ensureWorkspaceProjectIdentity(root);
  if (identity.projectId !== projectId) throw new WorkspaceProjectIdentityUnavailableError();
  return identity;
}

export const productionDiskCanvasReadPortDeps: DiskCanvasReadPortDeps = Object.freeze({
  resolveProjectIdentity: resolveProductionCanvasReadProjectIdentity,
  readCanvas(projectId: string): unknown {
    const project = readWorkspaceProject(projectId, getWorkspaceRepositoryDeps());
    if (!project) throw new WorkspaceProjectIdentityUnavailableError();
    const payload = project.payload;
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).generationCanvas
      : undefined;
  },
});

/** Static GUI-main runtime; call once from registerIpc before any window opens. */
export function registerMainCanvasReadExecutionRuntime(input: Readonly<{
  surfaceRegistry: CanvasReadSurfaceRegistry;
  capturedSnapshots: CapturedCanvasReadSnapshotRegistry;
  disk?: DiskCanvasReadPortDeps;
}>): CanvasReadExecutionRuntime {
  const surfacePortRuntime = createCanvasReadSurfacePortRuntime({ registry: input.surfaceRegistry });
  const resolveCanvasReadPort = createCanvasReadPortResolver({
    disk: input.disk ?? productionDiskCanvasReadPortDeps,
    surfaceRegistry: input.surfaceRegistry,
    surfacePortRuntime,
    capturedSnapshots: input.capturedSnapshots,
  });
  return Object.freeze({
    executor: createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort,
      resolveDocumentReadPort: async (invocation) => {
        const target = resolveVerifiedCapabilityExecutionTarget(invocation);
        if (target.kind !== "document-surface") throw new Error("capability_unsupported");
        return surfacePortRuntime.createDocumentReadPort(target.capturedPort, target.documentId);
      },
      resolveDocumentWritePort: async (invocation) => {
        const target = resolveVerifiedCapabilityExecutionTarget(invocation);
        if (target.kind !== "document-write-surface") throw new Error("capability_unsupported");
        return surfacePortRuntime.createDocumentWritePort(
          liveCapturedWritePort(input.surfaceRegistry, invocation.binding),
          target.documentId,
        );
      },
      resolveCanvasWritePort: async (invocation) => {
        const target = resolveVerifiedCapabilityExecutionTarget(invocation);
        if (target.kind !== "canvas-write-surface") throw new Error("capability_unsupported");
        return surfacePortRuntime.createCanvasWritePort(
          liveCapturedWritePort(input.surfaceRegistry, invocation.binding),
        );
      },
      resolveAssetReadPort: async (invocation) => {
        const target = resolveVerifiedCapabilityExecutionTarget(invocation);
        if (target.kind !== "asset-read-surface") throw new Error("capability_unsupported");
        return surfacePortRuntime.createAssetReadPort(target.capturedPort);
      },
      resolveExportReadPort: async (invocation) => {
        const target = resolveVerifiedCapabilityExecutionTarget(invocation);
        if (target.kind !== "export-read-surface") throw new Error("capability_unsupported");
        return surfacePortRuntime.createExportReadPort(target.capturedPort);
      },
      resolveExportWritePort: async (invocation) => {
        const target = resolveVerifiedCapabilityExecutionTarget(invocation);
        if (target.kind !== "export-write-surface") throw new Error("capability_unsupported");
        return surfacePortRuntime.createExportWritePort(
          liveCapturedWritePort(input.surfaceRegistry, invocation.binding),
        );
      },
      resolveTimelineReadPort: async (invocation) => {
        const target = resolveVerifiedCapabilityExecutionTarget(invocation);
        if (target.kind !== "timeline-read-surface") throw new Error("capability_unsupported");
        return surfacePortRuntime.createTimelineReadPort(target.capturedPort);
      },
      resolveTimelineWritePort: async (invocation) => {
        const target = resolveVerifiedCapabilityExecutionTarget(invocation);
        if (target.kind !== "timeline-write-surface") throw new Error("capability_unsupported");
        return surfacePortRuntime.createTimelineWritePort(
          liveCapturedWritePort(input.surfaceRegistry, invocation.binding),
        );
      },
    }),
    surfacePortRuntime,
  });
}

/** Standalone stdio/host runtime: disk is selected before execution; no renderer exists. */
export function createHeadlessCanvasReadExecutionRuntime(
  disk: DiskCanvasReadPortDeps = productionDiskCanvasReadPortDeps,
): CanvasReadExecutionRuntime {
  return Object.freeze({
    executor: createMainCapabilityExecutorRegistry({
      resolveCanvasReadPort: createCanvasReadPortResolver({ disk }),
    }),
  });
}
