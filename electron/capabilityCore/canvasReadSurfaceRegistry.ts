import crypto from "node:crypto";

import {
  SURFACE_PORT_BINDING_VERSION,
  type SurfacePortBindingWire,
  type SurfacePortWireErrorCode,
  type SurfaceSuspensionWire,
} from "../shared/surfacePortBinding";
import type { ProjectBinding } from "../shared/projectBinding";
import type { WorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";

export { SURFACE_PORT_BINDING_VERSION };
export type SurfacePortErrorCode = SurfacePortWireErrorCode;

export class SurfacePortError extends Error {
  constructor(readonly code: SurfacePortErrorCode) {
    super(code);
    this.name = "SurfacePortError";
  }
}

const issuedCanvasReadSurfaceRegistries = new WeakSet<object>();

export function assertCanvasReadSurfaceRegistry(value: unknown): asserts value is CanvasReadSurfaceRegistry {
  if (!value || typeof value !== "object" || !issuedCanvasReadSurfaceRegistries.has(value)) {
    throw new SurfacePortError("surface_owner_mismatch");
  }
}

export type CommittedSurfaceProjectSelection = Readonly<
  ProjectBinding & {
    canonicalRootDigest: string;
  }
>;

export type SurfaceOwnerDescriptor = Readonly<{
  contents: object;
  frame: object;
  webContentsId: number;
  processId: number;
  frameRoutingId: number;
  origin: string;
  isLive: () => boolean;
}>;

declare const surfaceOwnerEvidenceBrand: unique symbol;
export type SurfaceOwnerEvidence = Readonly<{
  readonly [surfaceOwnerEvidenceBrand]: never;
}>;

export type SurfaceOwnerAuthorityState = Readonly<{
  resolve(owner: unknown): SurfaceOwnerDescriptor;
}>;

export type SurfaceOwnerAuthority = Readonly<{
  capture(descriptor: SurfaceOwnerDescriptor): SurfaceOwnerEvidence;
}>;

export type SurfaceOwnerAuthorityRuntime = SurfaceOwnerAuthority & SurfaceOwnerAuthorityState;

export function createSurfaceOwnerAuthority(): SurfaceOwnerAuthorityRuntime {
  const owners = new WeakMap<object, SurfaceOwnerDescriptor>();
  return Object.freeze({
    capture(descriptor: SurfaceOwnerDescriptor): SurfaceOwnerEvidence {
      const normalized: SurfaceOwnerDescriptor = Object.freeze({
        contents: descriptor.contents,
        frame: descriptor.frame,
        webContentsId: requiredPositiveInteger(descriptor.webContentsId),
        processId: requiredPositiveInteger(descriptor.processId),
        frameRoutingId: requiredPositiveInteger(descriptor.frameRoutingId),
        origin: requiredString(descriptor.origin),
        isLive: descriptor.isLive,
      });
      const evidence = Object.freeze({}) as SurfaceOwnerEvidence;
      owners.set(evidence, normalized);
      return evidence;
    },
    resolve(owner: unknown): SurfaceOwnerDescriptor {
      if (!owner || typeof owner !== "object") throw new SurfacePortError("surface_owner_mismatch");
      const descriptor = owners.get(owner);
      if (!descriptor) throw new SurfacePortError("surface_owner_mismatch");
      return descriptor;
    },
  });
}

declare const surfaceSuspensionBrand: unique symbol;
export type SurfaceSuspension = Readonly<
  SurfaceSuspensionWire & {
    readonly [surfaceSuspensionBrand]: never;
  }
>;

declare const surfacePortBindingBrand: unique symbol;
export type SurfacePortBinding = Readonly<
  Omit<SurfacePortBindingWire, "binding"> & {
    binding: ProjectBinding;
    readonly [surfacePortBindingBrand]: never;
  }
>;

declare const capturedCanvasReadPortBrand: unique symbol;
export type CapturedCanvasReadPort = Readonly<{
  readonly [capturedCanvasReadPortBrand]: never;
}>;

export type CapturedCanvasReadPortDispatch = Readonly<{
  owner: SurfaceOwnerDescriptor;
  binding: SurfacePortBinding;
}>;

export type VerifiedCanvasReadProjectTarget = Readonly<{
  binding: ProjectBinding;
  canonicalRootDigest: string;
}>;

export type CanvasReadSurfaceRegistry = Readonly<{
  suspend(owner: SurfaceOwnerEvidence, input: Readonly<{ surfaceInstanceId: string }>): SurfaceSuspension;
  commitCanvasRead(
    owner: SurfaceOwnerEvidence,
    input: Readonly<{ projectId: string; suspension: SurfaceSuspension }>,
  ): Promise<SurfacePortBinding>;
  release(owner: SurfaceOwnerEvidence, input: Readonly<{ authority: SurfaceSuspension | SurfacePortBinding }>): void;
  invalidateOwner(owner: SurfaceOwnerEvidence): void;
  resolveSuspensionWire(owner: SurfaceOwnerEvidence, suspension: unknown): SurfaceSuspension;
  resolveBindingWire(owner: SurfaceOwnerEvidence, binding: unknown): SurfacePortBinding;
  resolveReleaseWire(owner: SurfaceOwnerEvidence, authority: unknown): SurfaceSuspension | SurfacePortBinding;
  captureCanvasReadPort(owner: SurfaceOwnerEvidence, binding: unknown): CapturedCanvasReadPort;
  captureCommittedCanvasReadPort(target: VerifiedCanvasReadProjectTarget): CapturedCanvasReadPort | null;
  resolveCapturedCanvasReadPort(captured: CapturedCanvasReadPort): CapturedCanvasReadPortDispatch;
  assertCanvasReadPortReply(captured: CapturedCanvasReadPort, binding: unknown): Promise<SurfacePortBinding>;
  getCommittedProjectSelection(): CommittedSurfaceProjectSelection | null;
}>;

type LifecycleState = {
  epoch: number;
  owner: SurfaceOwnerEvidence;
  ownerDescriptor: SurfaceOwnerDescriptor;
  surfaceInstanceId: string;
  suspension: SurfaceSuspension;
  status: "suspended" | "committing" | "committed";
  binding: SurfacePortBinding | null;
  selection: CommittedSurfaceProjectSelection | null;
};

type CapturedState = Readonly<{
  epoch: number;
  owner: SurfaceOwnerEvidence;
  binding: SurfacePortBinding;
}>;

type ReleasedState = Readonly<{
  owner: SurfaceOwnerEvidence;
  ownerDescriptor: SurfaceOwnerDescriptor;
  authority: SurfaceSuspension | SurfacePortBinding;
}>;

function requiredString(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new SurfacePortError("surface_port_stale");
  return normalized;
}

function requiredPositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new SurfacePortError("surface_owner_mismatch");
  return Number(value);
}

function sameOwner(left: SurfaceOwnerDescriptor, right: SurfaceOwnerDescriptor): boolean {
  return (
    left.contents === right.contents &&
    left.frame === right.frame &&
    left.webContentsId === right.webContentsId &&
    left.processId === right.processId &&
    left.frameRoutingId === right.frameRoutingId &&
    left.origin === right.origin
  );
}

function sameProjectSelection(
  selection: CommittedSurfaceProjectSelection,
  identity: WorkspaceProjectIdentity,
): boolean {
  return (
    selection.projectId === identity.projectId &&
    selection.immutableProjectUuid === identity.immutableProjectUuid &&
    selection.projectGeneration === identity.projectGeneration &&
    selection.canonicalRootDigest === identity.canonicalRootDigest
  );
}

function sameVerifiedTarget(
  selection: CommittedSurfaceProjectSelection,
  target: VerifiedCanvasReadProjectTarget,
): boolean {
  return (
    selection.projectId === target.binding.projectId &&
    selection.immutableProjectUuid === target.binding.immutableProjectUuid &&
    selection.projectGeneration === target.binding.projectGeneration &&
    selection.canonicalRootDigest === target.canonicalRootDigest
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sameSuspensionWire(value: unknown, suspension: SurfaceSuspension): boolean {
  const candidate = record(value);
  return Boolean(
    candidate &&
    candidate.version === suspension.version &&
    candidate.suspensionId === suspension.suspensionId &&
    candidate.surfaceInstanceId === suspension.surfaceInstanceId &&
    candidate.portRevision === suspension.portRevision &&
    candidate.nonce === suspension.nonce,
  );
}

function sameBindingWire(value: unknown, binding: SurfacePortBinding): boolean {
  const candidate = record(value);
  const project = record(candidate?.binding);
  return Boolean(
    candidate &&
    project &&
    candidate.version === binding.version &&
    candidate.bindingId === binding.bindingId &&
    project.projectId === binding.binding.projectId &&
    project.immutableProjectUuid === binding.binding.immutableProjectUuid &&
    project.projectGeneration === binding.binding.projectGeneration &&
    candidate.webContentsId === binding.webContentsId &&
    candidate.processId === binding.processId &&
    candidate.frameRoutingId === binding.frameRoutingId &&
    candidate.origin === binding.origin &&
    candidate.surfaceInstanceId === binding.surfaceInstanceId &&
    candidate.portRevision === binding.portRevision &&
    candidate.nonce === binding.nonce,
  );
}

function freezeProjectBinding(identity: WorkspaceProjectIdentity): ProjectBinding {
  if (!Number.isSafeInteger(identity.projectGeneration) || identity.projectGeneration < 1) {
    throw new SurfacePortError("project_identity_unavailable");
  }
  return Object.freeze({
    projectId: requiredString(identity.projectId),
    immutableProjectUuid: requiredString(identity.immutableProjectUuid),
    projectGeneration: identity.projectGeneration,
  });
}

function freezeSelection(identity: WorkspaceProjectIdentity): CommittedSurfaceProjectSelection {
  return Object.freeze({
    ...freezeProjectBinding(identity),
    canonicalRootDigest: requiredString(identity.canonicalRootDigest),
  });
}

export function createCanvasReadSurfaceRegistry(
  input: Readonly<{
    ownerAuthority: SurfaceOwnerAuthorityRuntime;
    resolveProjectIdentity(projectId: string): Promise<WorkspaceProjectIdentity>;
    randomId?: () => string;
    onCommittedProjectChanged?: (selection: CommittedSurfaceProjectSelection | null) => void;
  }>,
): CanvasReadSurfaceRegistry {
  const randomId = input.randomId ?? (() => crypto.randomUUID());
  const issuedSuspensions = new WeakSet<object>();
  const issuedBindings = new WeakSet<object>();
  const captures = new WeakMap<object, CapturedState>();
  let current: LifecycleState | null = null;
  let lastReleased: ReleasedState | null = null;
  let epoch = 0;
  let portRevision = 0;

  const publishSelection = (selection: CommittedSurfaceProjectSelection | null): void => {
    input.onCommittedProjectChanged?.(selection);
  };

  const clearCurrent = (): void => {
    current = null;
    publishSelection(null);
  };

  const ownerDescriptor = (owner: SurfaceOwnerEvidence): SurfaceOwnerDescriptor => {
    const descriptor = input.ownerAuthority.resolve(owner);
    if (!descriptor.isLive()) throw new SurfacePortError("surface_port_unavailable");
    return descriptor;
  };

  const requireCurrentOwner = (owner: SurfaceOwnerEvidence): LifecycleState => {
    if (!current) throw new SurfacePortError("surface_port_unavailable");
    const descriptor = ownerDescriptor(owner);
    if (!sameOwner(current.ownerDescriptor, descriptor)) {
      throw new SurfacePortError("surface_owner_mismatch");
    }
    if (!current.ownerDescriptor.isLive()) {
      clearCurrent();
      throw new SurfacePortError("surface_port_unavailable");
    }
    return current;
  };

  const ensureSuspension = (state: LifecycleState, suspension: unknown): SurfaceSuspension => {
    if (
      !suspension ||
      typeof suspension !== "object" ||
      !issuedSuspensions.has(suspension) ||
      suspension !== state.suspension
    ) {
      throw new SurfacePortError("surface_port_stale");
    }
    return suspension as SurfaceSuspension;
  };

  const ensureBinding = (state: LifecycleState, binding: unknown): SurfacePortBinding => {
    if (!binding || typeof binding !== "object" || !issuedBindings.has(binding) || binding !== state.binding) {
      throw new SurfacePortError("project_binding_stale");
    }
    return binding as SurfacePortBinding;
  };

  const registry: CanvasReadSurfaceRegistry = Object.freeze({
    suspend(owner, request) {
      const descriptor = ownerDescriptor(owner);
      if (current && !sameOwner(current.ownerDescriptor, descriptor)) {
        if (current.ownerDescriptor.isLive()) throw new SurfacePortError("surface_owner_mismatch");
        clearCurrent();
      }
      if (lastReleased && !sameOwner(lastReleased.ownerDescriptor, descriptor)) {
        if (lastReleased.ownerDescriptor.isLive()) throw new SurfacePortError("surface_owner_mismatch");
      }
      // A new lifecycle retires the explicit-release retry tombstone. From
      // this point an old ACK retry is stale and can never clear the new port.
      lastReleased = null;
      const surfaceInstanceId = requiredString(request.surfaceInstanceId);
      const suspension = Object.freeze({
        version: SURFACE_PORT_BINDING_VERSION,
        suspensionId: requiredString(randomId()),
        surfaceInstanceId,
        portRevision: ++portRevision,
        nonce: requiredString(randomId()),
      }) as SurfaceSuspension;
      issuedSuspensions.add(suspension);
      current = {
        epoch: ++epoch,
        owner,
        ownerDescriptor: descriptor,
        surfaceInstanceId,
        suspension,
        status: "suspended",
        binding: null,
        selection: null,
      };
      publishSelection(null);
      return suspension;
    },

    async commitCanvasRead(owner, request) {
      const state = requireCurrentOwner(owner);
      const suspension = ensureSuspension(state, request.suspension);
      if (state.status !== "suspended") throw new SurfacePortError("surface_port_stale");
      const projectId = requiredString(request.projectId);
      const expectedEpoch = state.epoch;
      state.status = "committing";
      let resolved: WorkspaceProjectIdentity;
      try {
        resolved = await input.resolveProjectIdentity(projectId);
      } catch {
        if (current === state && state.epoch === expectedEpoch) state.status = "suspended";
        throw new SurfacePortError("project_identity_unavailable");
      }
      if (current !== state || state.epoch !== expectedEpoch || state.suspension !== suspension) {
        throw new SurfacePortError("surface_port_stale");
      }
      if (!state.ownerDescriptor.isLive()) {
        clearCurrent();
        throw new SurfacePortError("surface_port_unavailable");
      }
      if (resolved.projectId !== projectId) {
        state.status = "suspended";
        throw new SurfacePortError("project_identity_unavailable");
      }
      let project: ProjectBinding;
      let selection: CommittedSurfaceProjectSelection;
      try {
        project = freezeProjectBinding(resolved);
        selection = freezeSelection(resolved);
      } catch {
        state.status = "suspended";
        throw new SurfacePortError("project_identity_unavailable");
      }
      let binding: SurfacePortBinding;
      try {
        binding = Object.freeze({
          version: SURFACE_PORT_BINDING_VERSION,
          bindingId: requiredString(randomId()),
          binding: project,
          webContentsId: state.ownerDescriptor.webContentsId,
          processId: state.ownerDescriptor.processId,
          frameRoutingId: state.ownerDescriptor.frameRoutingId,
          origin: state.ownerDescriptor.origin,
          surfaceInstanceId: state.surfaceInstanceId,
          portRevision: state.suspension.portRevision,
          nonce: requiredString(randomId()),
        }) as SurfacePortBinding;
      } catch (error) {
        state.status = "suspended";
        throw error;
      }
      issuedBindings.add(binding);
      state.binding = binding;
      state.selection = selection;
      state.status = "committed";
      publishSelection(state.selection);
      return binding;
    },

    release(owner, request) {
      if (!current) {
        const descriptor = ownerDescriptor(owner);
        if (!lastReleased) throw new SurfacePortError("surface_port_unavailable");
        if (!sameOwner(lastReleased.ownerDescriptor, descriptor)) {
          throw new SurfacePortError("surface_owner_mismatch");
        }
        if (request.authority !== lastReleased.authority) {
          throw new SurfacePortError("surface_port_stale");
        }
        return;
      }
      const state = requireCurrentOwner(owner);
      const authority = request.authority;
      const matchesSuspension = authority === state.suspension && issuedSuspensions.has(authority);
      const matchesBinding = authority === state.binding && Boolean(authority && issuedBindings.has(authority));
      if (!matchesSuspension && !matchesBinding) throw new SurfacePortError("surface_port_stale");
      lastReleased = Object.freeze({
        owner,
        ownerDescriptor: state.ownerDescriptor,
        authority,
      });
      clearCurrent();
    },

    invalidateOwner(owner) {
      const descriptor = input.ownerAuthority.resolve(owner);
      if (current && sameOwner(current.ownerDescriptor, descriptor)) clearCurrent();
      if (lastReleased && sameOwner(lastReleased.ownerDescriptor, descriptor)) lastReleased = null;
    },

    resolveSuspensionWire(owner, suspension) {
      const state = requireCurrentOwner(owner);
      if (!sameSuspensionWire(suspension, state.suspension)) {
        throw new SurfacePortError("surface_port_stale");
      }
      return state.suspension;
    },

    resolveBindingWire(owner, binding) {
      const state = requireCurrentOwner(owner);
      if (state.status !== "committed" || !state.binding || !sameBindingWire(binding, state.binding)) {
        throw new SurfacePortError("surface_port_stale");
      }
      return state.binding;
    },

    resolveReleaseWire(owner, authority) {
      if (current) {
        const state = requireCurrentOwner(owner);
        if (state.binding && sameBindingWire(authority, state.binding)) return state.binding;
        if (sameSuspensionWire(authority, state.suspension)) return state.suspension;
        throw new SurfacePortError("surface_port_stale");
      }
      const descriptor = ownerDescriptor(owner);
      if (!lastReleased) throw new SurfacePortError("surface_port_unavailable");
      if (!sameOwner(lastReleased.ownerDescriptor, descriptor)) {
        throw new SurfacePortError("surface_owner_mismatch");
      }
      const matches = issuedBindings.has(lastReleased.authority)
        ? sameBindingWire(authority, lastReleased.authority as SurfacePortBinding)
        : sameSuspensionWire(authority, lastReleased.authority as SurfaceSuspension);
      if (!matches) throw new SurfacePortError("surface_port_stale");
      return lastReleased.authority;
    },

    captureCanvasReadPort(owner, binding) {
      const state = requireCurrentOwner(owner);
      if (state.status === "suspended" || state.status === "committing") {
        throw new SurfacePortError("surface_port_suspended");
      }
      const verified = ensureBinding(state, binding);
      const captured = Object.freeze({}) as CapturedCanvasReadPort;
      captures.set(
        captured,
        Object.freeze({
          epoch: state.epoch,
          owner,
          binding: verified,
        }),
      );
      return captured;
    },

    captureCommittedCanvasReadPort(target) {
      const state = current;
      if (!state || state.status !== "committed" || !state.binding || !state.selection) return null;
      if (state.selection.projectId !== target.binding.projectId) return null;
      if (!sameVerifiedTarget(state.selection, target)) {
        throw new SurfacePortError("project_binding_stale");
      }
      return registry.captureCanvasReadPort(state.owner, state.binding);
    },

    resolveCapturedCanvasReadPort(captured) {
      if (!captured || typeof captured !== "object") throw new SurfacePortError("surface_port_stale");
      const capture = captures.get(captured);
      if (!capture) throw new SurfacePortError("surface_port_stale");
      const state = current;
      if (
        !state ||
        state.status !== "committed" ||
        state.epoch !== capture.epoch ||
        state.owner !== capture.owner ||
        state.binding !== capture.binding ||
        !issuedBindings.has(capture.binding)
      ) {
        throw new SurfacePortError("surface_port_stale");
      }
      const descriptor = ownerDescriptor(capture.owner);
      if (!sameOwner(descriptor, state.ownerDescriptor)) {
        throw new SurfacePortError("surface_owner_mismatch");
      }
      return Object.freeze({ owner: descriptor, binding: capture.binding });
    },

    async assertCanvasReadPortReply(captured, replyBinding) {
      if (!captured || typeof captured !== "object") throw new SurfacePortError("surface_port_stale");
      const capture = captures.get(captured);
      if (!capture) throw new SurfacePortError("surface_port_stale");
      const state = current;
      if (
        !state ||
        state.status !== "committed" ||
        state.epoch !== capture.epoch ||
        state.owner !== capture.owner ||
        state.binding !== capture.binding ||
        !sameBindingWire(replyBinding, capture.binding) ||
        !issuedBindings.has(capture.binding)
      ) {
        throw new SurfacePortError("surface_port_stale");
      }
      let fresh: WorkspaceProjectIdentity;
      try {
        fresh = await input.resolveProjectIdentity(capture.binding.binding.projectId);
      } catch {
        if (current === state) clearCurrent();
        throw new SurfacePortError("project_identity_unavailable");
      }
      if (current !== state || state.epoch !== capture.epoch || state.binding !== capture.binding) {
        throw new SurfacePortError("surface_port_stale");
      }
      if (!state.ownerDescriptor.isLive()) {
        clearCurrent();
        throw new SurfacePortError("surface_port_unavailable");
      }
      if (!state.selection || !sameProjectSelection(state.selection, fresh)) {
        clearCurrent();
        throw new SurfacePortError("project_binding_stale");
      }
      return capture.binding;
    },

    getCommittedProjectSelection() {
      if (!current || current.status !== "committed" || !current.selection) return null;
      if (!current.ownerDescriptor.isLive()) {
        clearCurrent();
        return null;
      }
      return current.selection;
    },
  });
  issuedCanvasReadSurfaceRegistries.add(registry);
  return registry;
}
