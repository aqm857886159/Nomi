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
import {
  createCanvasReadPortResolver,
  type DiskCanvasReadPortDeps,
} from "./canvasReadPortResolver";
import type { CanvasReadSurfaceRegistry } from "./canvasReadSurfaceRegistry";
import type { CapturedCanvasReadSnapshotRegistry } from './canvasReadCapturedSnapshotRegistry'
import {
  createCanvasReadSurfacePortRuntime,
  type CanvasReadSurfacePortRuntime,
} from "./canvasReadSurfacePort";

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
    executor: createMainCapabilityExecutorRegistry({ resolveCanvasReadPort }),
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
