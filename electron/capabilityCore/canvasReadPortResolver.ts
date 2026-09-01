import type { ProjectBinding } from "../shared/projectBinding";
import type { WorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import { WorkspaceProjectIdentityUnavailableError } from "../workspace/workspaceProjectIdentity";
import {
  CapabilityExecutionError,
  type CanvasReadPort,
  type CanvasReadPortResolver,
} from "./capabilityExecutorRegistry";
import {
  type CanvasReadSurfaceRegistry,
  type CapturedCanvasReadPort,
  SurfacePortError,
} from "./canvasReadSurfaceRegistry";
import type { CanvasReadSurfacePortRuntime } from "./canvasReadSurfacePort";
import type {
  CapturedCanvasReadSnapshotPort,
  CapturedCanvasReadSnapshotRegistry,
} from "./canvasReadCapturedSnapshotRegistry";
import { ProjectBindingStaleError } from "./projectLease";
import { resolveVerifiedCanvasReadExecutionTarget } from "./verifiedCapabilityInvocation";

export type DiskCanvasReadPortDeps = Readonly<{
  resolveProjectIdentity(projectId: string): Promise<WorkspaceProjectIdentity>;
  readCanvas(projectId: string): unknown | Promise<unknown>;
}>;

type VerifiedDiskTarget = Readonly<{
  binding: ProjectBinding;
  canonicalRootDigest: string;
}>;

function sameIdentity(identity: WorkspaceProjectIdentity, target: VerifiedDiskTarget): boolean {
  return (
    identity.projectId === target.binding.projectId &&
    identity.immutableProjectUuid === target.binding.immutableProjectUuid &&
    identity.projectGeneration === target.binding.projectGeneration &&
    identity.canonicalRootDigest === target.canonicalRootDigest
  );
}

async function assertDiskIdentity(target: VerifiedDiskTarget, deps: DiskCanvasReadPortDeps): Promise<void> {
  let identity: WorkspaceProjectIdentity;
  try {
    identity = await deps.resolveProjectIdentity(target.binding.projectId);
  } catch {
    throw new WorkspaceProjectIdentityUnavailableError();
  }
  if (!sameIdentity(identity, target)) throw new ProjectBindingStaleError();
}

export function createDiskCanvasReadPort(target: VerifiedDiskTarget, deps: DiskCanvasReadPortDeps): CanvasReadPort {
  const frozenTarget = Object.freeze({
    binding: target.binding,
    canonicalRootDigest: target.canonicalRootDigest,
  });
  return Object.freeze({
    async read({ signal }) {
      if (signal.aborted) throw new CapabilityExecutionError("capability_cancelled");
      await assertDiskIdentity(frozenTarget, deps);
      if (signal.aborted) throw new CapabilityExecutionError("capability_cancelled");
      let source: unknown;
      try {
        source = await deps.readCanvas(frozenTarget.binding.projectId);
      } catch {
        throw new WorkspaceProjectIdentityUnavailableError();
      }
      if (signal.aborted) throw new CapabilityExecutionError("capability_cancelled");
      await assertDiskIdentity(frozenTarget, deps);
      return source;
    },
  });
}

export function createCanvasReadPortResolver(
  input: Readonly<{
    disk: DiskCanvasReadPortDeps;
    surfaceRegistry?: CanvasReadSurfaceRegistry;
    surfacePortRuntime?: Pick<CanvasReadSurfacePortRuntime, "createPort">;
    capturedSnapshots?: CapturedCanvasReadSnapshotRegistry;
  }>,
): CanvasReadPortResolver {
  const rendererPort = (captured: CapturedCanvasReadPort): CanvasReadPort => {
    if (!input.surfacePortRuntime) throw new SurfacePortError("surface_port_unavailable");
    return input.surfacePortRuntime.createPort(captured);
  };
  const capturedSnapshotPort = (captured: CapturedCanvasReadSnapshotPort): CanvasReadPort => {
    if (!input.capturedSnapshots) throw new SurfacePortError("surface_port_unavailable");
    return Object.freeze({
      async read({ signal }) {
        if (signal.aborted) throw new CapabilityExecutionError("capability_cancelled");
        const dispatch = input.capturedSnapshots!.resolve(captured);
        if (signal.aborted) throw new CapabilityExecutionError("capability_cancelled");
        return dispatch.result;
      },
    });
  };

  return async (invocation) => {
    const target = resolveVerifiedCanvasReadExecutionTarget(invocation);
    if (target.kind === "surface") return rendererPort(target.capturedPort);
    if (target.kind === "captured-snapshot") return capturedSnapshotPort(target.capturedPort);

    const captured =
      input.surfaceRegistry?.captureCommittedCanvasReadPort({
        binding: target.binding,
        canonicalRootDigest: target.canonicalRootDigest,
      }) ?? null;
    if (captured) return rendererPort(captured);
    return createDiskCanvasReadPort(target, input.disk);
  };
}
