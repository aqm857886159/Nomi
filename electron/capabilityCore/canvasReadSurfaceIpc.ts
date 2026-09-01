import {
  ipcMain,
  type Event as ElectronEvent,
  type IpcMainInvokeEvent,
  type WebContents,
  type WebContentsDidStartNavigationEventParams,
  type WebFrameMain,
} from "electron";

import { assertTrustedSender } from "../ipcSenderGuard";
import {
  type CanvasReadSurfaceRegistry,
  type CapturedCanvasReadPort,
  type SurfaceOwnerAuthorityRuntime,
  type SurfaceOwnerDescriptor,
  type SurfaceOwnerEvidence,
  type SurfacePortBinding,
  type SurfaceSuspension,
  SurfacePortError,
} from "./canvasReadSurfaceRegistry";
import {
  type CapturedCanvasReadSnapshotPort,
  type CapturedCanvasReadSnapshotRegistry,
} from "./canvasReadCapturedSnapshotRegistry";
import type { ProjectBinding } from "../shared/projectAgentContracts";

export const SURFACE_SUSPEND_CHANNEL = "nomi:surface:suspend";
export const SURFACE_COMMIT_CANVAS_READ_CHANNEL = "nomi:surface:commitCanvasRead";
export const SURFACE_RELEASE_CHANNEL = "nomi:surface:release";
export const SURFACE_CAPTURE_CANVAS_READ_SNAPSHOT_CHANNEL = "nomi:surface:captureCanvasReadSnapshot";

type OwnerRecord = Readonly<{
  contents: WebContents;
  frame: WebFrameMain;
  evidence: SurfaceOwnerEvidence;
  cleanup(): void;
}>;

type NavigationQuarantine = Readonly<{
  cleanup(): void;
}>;

/** Narrow bridge for other trusted main IPC handlers; it cannot mint owners. */
export type CanvasReadSurfaceIpcCapture = Readonly<{
  captureCanvasReadPort(event: IpcMainInvokeEvent, binding: unknown): CapturedCanvasReadPort;
  captureCommittedCanvasReadPort(event: IpcMainInvokeEvent, binding: ProjectBinding): CapturedCanvasReadPort;
  consumeCapturedCanvasReadSnapshot(
    event: IpcMainInvokeEvent,
    handle: unknown,
    projectId: string,
  ): CapturedCanvasReadSnapshotPort;
  releaseCapturedCanvasReadSnapshot(captured: CapturedCanvasReadSnapshotPort): void;
}>;

function normalizedOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" ? "file://" : parsed.origin;
  } catch {
    return "";
  }
}

function surfaceInstanceId(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const value = (input as Record<string, unknown>).surfaceInstanceId;
  return typeof value === "string" ? value : "";
}

function projectId(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const value = (input as Record<string, unknown>).projectId;
  return typeof value === "string" ? value : "";
}

function field(input: unknown, name: string): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return (input as Record<string, unknown>)[name];
}

/**
 * Registers the single app-main Surface lifecycle. A second live top-level
 * owner is rejected rather than becoming an implicit "last window wins"
 * project authority.
 */
export function registerCanvasReadSurfaceIpc(
  input: Readonly<{
    registry: CanvasReadSurfaceRegistry;
    ownerAuthority: SurfaceOwnerAuthorityRuntime;
    capturedSnapshots: CapturedCanvasReadSnapshotRegistry;
  }>,
): CanvasReadSurfaceIpcCapture {
  const ownerRecords = new WeakMap<WebContents, OwnerRecord>();
  const navigationQuarantines = new WeakMap<WebContents, NavigationQuarantine>();

  const quarantineDuringNavigation = (contents: WebContents): void => {
    navigationQuarantines.get(contents)?.cleanup();
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      contents.removeListener("did-navigate", committed);
      contents.removeListener("did-fail-load", failed);
      contents.removeListener("did-fail-provisional-load", failed);
      contents.removeListener("did-stop-loading", stopped);
      if (navigationQuarantines.get(contents) === quarantine) navigationQuarantines.delete(contents);
    };
    const committed = (
      _event: ElectronEvent,
      _url: string,
      _httpResponseCode: number,
      _httpStatusText: string,
    ): void => {
      cleanup();
    };
    const failed = (
      _event: ElectronEvent,
      _errorCode: number,
      _errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean,
      _frameProcessId: number,
      _frameRoutingId: number,
    ): void => {
      if (isMainFrame) cleanup();
    };
    const stopped = (): void => {
      cleanup();
    };
    const quarantine: NavigationQuarantine = Object.freeze({ cleanup });
    navigationQuarantines.set(contents, quarantine);
    contents.on("did-navigate", committed);
    contents.on("did-fail-load", failed);
    contents.on("did-fail-provisional-load", failed);
    contents.on("did-stop-loading", stopped);
  };

  const captureOwnerFromTrustedSender = (event: IpcMainInvokeEvent): SurfaceOwnerEvidence => {
    const contents = event.sender;
    if (navigationQuarantines.has(contents)) {
      throw new SurfacePortError("surface_port_unavailable");
    }
    const frame = event.senderFrame;
    const mainFrame = contents.mainFrame;
    const origin = normalizedOrigin(frame?.url ?? "");
    if (
      !frame ||
      !mainFrame ||
      frame !== mainFrame ||
      frame.detached ||
      frame.isDestroyed() ||
      contents.isDestroyed() ||
      !origin
    ) {
      throw new SurfacePortError("surface_port_unavailable");
    }
    const existing = ownerRecords.get(contents);
    if (existing && existing.frame === frame) return existing.evidence;
    existing?.cleanup();

    const descriptor: SurfaceOwnerDescriptor = Object.freeze({
      contents,
      frame,
      webContentsId: contents.id,
      processId: frame.processId,
      frameRoutingId: frame.routingId,
      origin,
      isLive: () =>
        !contents.isDestroyed() &&
        !frame.detached &&
        !frame.isDestroyed() &&
        contents.mainFrame === frame &&
        normalizedOrigin(frame.url) === origin,
    });
    const evidence = input.ownerAuthority.capture(descriptor);
    let cleaned = false;
    const invalidate = (): void => {
      if (cleaned) return;
      input.registry.invalidateOwner(evidence);
      input.capturedSnapshots.invalidateOwner(evidence);
    };
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      contents.removeListener("did-start-navigation", navigate);
      contents.removeListener("render-process-gone", invalidate);
      contents.removeListener("destroyed", invalidate);
      if (ownerRecords.get(contents)?.evidence === evidence) ownerRecords.delete(contents);
    };
    const invalidateAndCleanup = (): void => {
      invalidate();
      cleanup();
    };
    const navigate = (details: WebContentsDidStartNavigationEventParams): void => {
      if (!details.isMainFrame || details.isSameDocument) return;
      // The old document stays tombstoned until either a new main document
      // commits or the attempted navigation ends without replacing it. The
      // latter must restore availability for the still-running old document,
      // while exact frame/origin checks continue to reject a replaced one.
      quarantineDuringNavigation(contents);
      invalidateAndCleanup();
    };
    contents.on("did-start-navigation", navigate);
    contents.on("render-process-gone", invalidateAndCleanup);
    contents.on("destroyed", invalidateAndCleanup);
    const ownerRecord: OwnerRecord = Object.freeze({ contents, frame, evidence, cleanup });
    ownerRecords.set(contents, ownerRecord);
    return evidence;
  };

  const captureOwner = (event: IpcMainInvokeEvent): SurfaceOwnerEvidence => {
    try {
      assertTrustedSender(event);
    } catch {
      throw new SurfacePortError("surface_owner_mismatch");
    }
    return captureOwnerFromTrustedSender(event);
  };

  const errorEnvelope = (error: unknown): Readonly<{ ok: false; error: { code: string } }> => ({
    ok: false,
    error: {
      code: error instanceof SurfacePortError ? error.code : "surface_port_unavailable",
    },
  });

  ipcMain.handle(SURFACE_SUSPEND_CHANNEL, (event, request: unknown) => {
    try {
      try {
        assertTrustedSender(event);
      } catch {
        throw new SurfacePortError("surface_owner_mismatch");
      }
      const owner = captureOwnerFromTrustedSender(event);
      const suspension = input.registry.suspend(owner, {
        surfaceInstanceId: surfaceInstanceId(request),
      });
      return { ok: true, value: { suspension } } as const;
    } catch (error) {
      return errorEnvelope(error);
    }
  });

  ipcMain.handle(SURFACE_COMMIT_CANVAS_READ_CHANNEL, async (event, request: unknown) => {
    try {
      try {
        assertTrustedSender(event);
      } catch {
        throw new SurfacePortError("surface_owner_mismatch");
      }
      const owner = captureOwnerFromTrustedSender(event);
      const suspension = input.registry.resolveSuspensionWire(owner, field(request, "suspension"));
      const binding = await input.registry.commitCanvasRead(owner, {
        projectId: projectId(request),
        suspension,
      });
      return { ok: true, value: { binding } } as const;
    } catch (error) {
      return errorEnvelope(error);
    }
  });

  ipcMain.handle(SURFACE_CAPTURE_CANVAS_READ_SNAPSHOT_CHANNEL, (event, request: unknown) => {
    try {
      try {
        assertTrustedSender(event);
      } catch {
        throw new SurfacePortError("surface_owner_mismatch");
      }
      const owner = captureOwnerFromTrustedSender(event);
      const binding = input.registry.resolveBindingWire(owner, field(request, "binding"));
      const selection = input.registry.getCommittedProjectSelection();
      if (!selection) throw new SurfacePortError("project_binding_stale");
      const handle = input.capturedSnapshots.seal({
        owner,
        binding,
        selection,
        snapshot: field(request, "snapshot"),
      });
      return { ok: true, value: { handle } } as const;
    } catch (error) {
      return errorEnvelope(error);
    }
  });

  ipcMain.handle(SURFACE_RELEASE_CHANNEL, (event, request: unknown) => {
    try {
      try {
        assertTrustedSender(event);
      } catch {
        throw new SurfacePortError("surface_owner_mismatch");
      }
      const owner = captureOwnerFromTrustedSender(event);
      const authority = field(request, "authority");
      const resolved: SurfaceSuspension | SurfacePortBinding = input.registry.resolveReleaseWire(owner, authority);
      input.registry.release(owner, { authority: resolved });
      input.capturedSnapshots.revokePendingForOwner(owner);
      return { ok: true, value: { released: true } } as const;
    } catch (error) {
      return errorEnvelope(error);
    }
  });

  return Object.freeze({
    captureCanvasReadPort(event: IpcMainInvokeEvent, binding: unknown): CapturedCanvasReadPort {
      const owner = captureOwner(event);
      const resolved = input.registry.resolveBindingWire(owner, binding);
      return input.registry.captureCanvasReadPort(owner, resolved);
    },
    captureCommittedCanvasReadPort(event: IpcMainInvokeEvent, binding: ProjectBinding): CapturedCanvasReadPort {
      const owner = captureOwner(event);
      const selection = input.registry.getCommittedProjectSelection();
      if (
        !selection ||
        selection.projectId !== binding.projectId ||
        selection.immutableProjectUuid !== binding.immutableProjectUuid ||
        selection.projectGeneration !== binding.projectGeneration
      ) throw new SurfacePortError("surface_port_stale");
      const captured = input.registry.captureCommittedCanvasReadPort({
        binding,
        canonicalRootDigest: selection.canonicalRootDigest,
      });
      if (!captured) throw new SurfacePortError("surface_port_unavailable");
      const dispatch = input.registry.resolveCapturedCanvasReadPort(captured);
      if (dispatch.owner !== input.ownerAuthority.resolve(owner)) {
        throw new SurfacePortError("surface_owner_mismatch");
      }
      return captured;
    },
    consumeCapturedCanvasReadSnapshot(event, handle, requestProjectId) {
      const owner = captureOwner(event);
      return input.capturedSnapshots.consume({ owner, handle, projectId: requestProjectId });
    },
    releaseCapturedCanvasReadSnapshot(captured) {
      input.capturedSnapshots.release(captured);
    },
  });
}
