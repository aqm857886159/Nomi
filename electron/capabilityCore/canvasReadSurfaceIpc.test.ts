import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>(),
  trust: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown) =>
      state.handlers.set(channel, handler),
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: state.trust }));

import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from "./canvasReadSurfaceRegistry";
import { createCapturedCanvasReadSnapshotRegistry } from './canvasReadCapturedSnapshotRegistry'
import { registerCanvasReadSurfaceIpc } from "./canvasReadSurfaceIpc";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function source(input: { id?: number; processId?: number; routingId?: number; url?: string } = {}) {
  let destroyed = false;
  let frameDestroyed = false;
  const frame = {
    routingId: input.routingId ?? 7,
    processId: input.processId ?? 5,
    url: input.url ?? "file:///nomi/index.html",
    detached: false,
    isDestroyed: () => frameDestroyed,
  };
  const sender = Object.assign(new EventEmitter(), {
    id: input.id ?? 3,
    mainFrame: frame,
    isDestroyed: () => destroyed,
  });
  const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  return {
    event,
    sender,
    frame,
    destroy: () => {
      destroyed = true;
      frameDestroyed = true;
      sender.emit("destroyed");
    },
  };
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function setup() {
  const ownerAuthority = createSurfaceOwnerAuthority();
  let currentIdentity = {
    projectId: "project-a",
    immutableProjectUuid: "00000000-0000-4000-8000-000000000001",
    projectGeneration: 1,
    canonicalRootPath: "/real/project-a",
    canonicalRootDigest: "root-a",
  };
  const resolveProjectIdentity = vi.fn(async () => ({ ...currentIdentity }));
  const registry = createCanvasReadSurfaceRegistry({
    ownerAuthority,
    resolveProjectIdentity,
    randomId: (() => {
      let id = 0;
      return () => `surface-id-${++id}`;
    })(),
  });
  const capturedSnapshots = createCapturedCanvasReadSnapshotRegistry({
    ownerAuthority,
    randomId: (() => {
      let id = 0
      return () => `captured-id-${++id}`
    })(),
  })
  const capture = registerCanvasReadSurfaceIpc({ registry, ownerAuthority, capturedSnapshots });
  const invoke = (channel: "suspend" | "commitCanvasRead" | "captureCanvasReadSnapshot" | "release", event: IpcMainInvokeEvent, payload: unknown) =>
    Promise.resolve().then(() => state.handlers.get(`nomi:surface:${channel}`)!(event, payload));
  return {
    registry,
    capturedSnapshots,
    capture,
    resolveProjectIdentity,
    invoke,
    setIdentity: (patch: Partial<typeof currentIdentity>) => {
      currentIdentity = { ...currentIdentity, ...patch };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.handlers.clear();
});

describe("Canvas read Surface IPC", () => {
  it('seals canonical snapshot bytes with the same exact owner and survives a later project switch once', async () => {
    const test = setup()
    const owner = source()
    const suspended = await test.invoke('suspend', owner.event, { surfaceInstanceId: 'surface-1' }) as {
      ok: true; value: { suspension: unknown }
    }
    const committed = await test.invoke('commitCanvasRead', owner.event, {
      projectId: 'project-a',
      suspension: copy(suspended.value.suspension),
    }) as { ok: true; value: { binding: unknown } }
    const sealed = await test.invoke('captureCanvasReadSnapshot', owner.event, {
      binding: copy(committed.value.binding),
      snapshot: { nodes: [], edges: [], groups: [], selectedNodeIds: [] },
    }) as { ok: true; value: { handle: unknown } }

    test.setIdentity({ projectId: 'project-b', immutableProjectUuid: 'uuid-b', canonicalRootDigest: 'root-b' })
    const nextSuspension = await test.invoke('suspend', owner.event, { surfaceInstanceId: 'surface-1' }) as {
      ok: true; value: { suspension: unknown }
    }
    await test.invoke('commitCanvasRead', owner.event, {
      projectId: 'project-b',
      suspension: copy(nextSuspension.value.suspension),
    })

    const captured = test.capture.consumeCapturedCanvasReadSnapshot(
      owner.event,
      copy(sealed.value.handle),
      'project-a',
    )
    expect(test.capturedSnapshots.resolve(captured)).toMatchObject({
      binding: { binding: { projectId: 'project-a' } },
      result: { nodes: [], edges: [], groups: [], selectedNodeIds: [] },
    })
    expect(() => test.capture.consumeCapturedCanvasReadSnapshot(
      owner.event,
      copy(sealed.value.handle),
      'project-a',
    )).toThrow(expect.objectContaining({ code: 'surface_port_stale' }))
  })

  it('revokes unconsumed seals on explicit release and all seals on document invalidation', async () => {
    for (const cause of ['release', 'reload', 'render-process-gone', 'destroyed'] as const) {
      const test = setup()
      const owner = source()
      const suspended = await test.invoke('suspend', owner.event, { surfaceInstanceId: 'surface-1' }) as {
        ok: true; value: { suspension: unknown }
      }
      const committed = await test.invoke('commitCanvasRead', owner.event, {
        projectId: 'project-a',
        suspension: copy(suspended.value.suspension),
      }) as { ok: true; value: { binding: unknown } }
      const sealed = await test.invoke('captureCanvasReadSnapshot', owner.event, {
        binding: copy(committed.value.binding),
        snapshot: { nodes: [], edges: [], groups: [], selectedNodeIds: [] },
      }) as { ok: true; value: { handle: unknown } }

      if (cause === 'release') {
        await test.invoke('release', owner.event, { authority: copy(committed.value.binding) })
      } else if (cause === 'reload') {
        owner.sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
      } else if (cause === 'destroyed') {
        owner.destroy()
      } else {
        owner.sender.emit('render-process-gone')
      }
      expect(() => test.capture.consumeCapturedCanvasReadSnapshot(
        owner.event,
        copy(sealed.value.handle),
        'project-a',
      )).toThrow(expect.objectContaining({
        code: expect.stringMatching(/^surface_port_(?:stale|unavailable)$/),
      }))
    }
  })

  it("reuses the lifecycle IPC's exact owner evidence when Agent start captures a port", async () => {
    const test = setup();
    const owner = source();
    const suspended = (await test.invoke("suspend", owner.event, {
      surfaceInstanceId: "surface-1",
    })) as { ok: true; value: { suspension: unknown } };
    const committed = (await test.invoke("commitCanvasRead", owner.event, {
      projectId: "project-a",
      suspension: copy(suspended.value.suspension),
    })) as { ok: true; value: { binding: unknown } };

    const captured = test.capture.captureCanvasReadPort(owner.event, copy(committed.value.binding));

    await expect(
      test.registry.assertCanvasReadPortReply(captured, copy(committed.value.binding)),
    ).resolves.toMatchObject({ binding: { projectId: "project-a" } });
    expect(() =>
      test.capture.captureCanvasReadPort(source({ id: 99 }).event, copy(committed.value.binding)),
    ).toThrow(expect.objectContaining({ code: "surface_owner_mismatch" }));
  });

  it("registers an independent lifecycle and accepts only main-resolved suspension/binding copies", async () => {
    const test = setup();
    const owner = source();
    const suspended = (await test.invoke("suspend", owner.event, {
      surfaceInstanceId: "surface-1",
    })) as { ok: true; value: { suspension: unknown } };
    expect(suspended.ok).toBe(true);
    const committed = (await test.invoke("commitCanvasRead", owner.event, {
      projectId: "project-a",
      suspension: copy(suspended.value.suspension),
      immutableProjectUuid: "renderer-cannot-pick-this",
      projectGeneration: 999,
    })) as { ok: true; value: { binding: { binding: { immutableProjectUuid: string; projectGeneration: number } } } };

    expect(committed.value.binding.binding).toEqual({
      projectId: "project-a",
      immutableProjectUuid: "00000000-0000-4000-8000-000000000001",
      projectGeneration: 1,
    });
    expect(state.trust).toHaveBeenCalledTimes(2);
    await expect(test.invoke("release", owner.event, {
      authority: { ...copy(committed.value.binding), nonce: "renderer-picked" },
    })).resolves.toEqual({ ok: false, error: { code: "surface_port_stale" } });
    await expect(test.invoke("release", owner.event, { authority: copy(committed.value.binding) })).resolves.toEqual({
      ok: true,
      value: { released: true },
    });
  });

  it("captures the exact trusted document synchronously before identity resolution awaits", async () => {
    const test = setup();
    const owner = source();
    const gate = deferred<{
      projectId: string;
      immutableProjectUuid: string;
      projectGeneration: number;
      canonicalRootPath: string;
      canonicalRootDigest: string;
    }>();
    const { value: { suspension } } = (await test.invoke("suspend", owner.event, {
      surfaceInstanceId: "surface-1",
    })) as { ok: true; value: { suspension: unknown } };
    test.resolveProjectIdentity.mockImplementationOnce(() => gate.promise);
    const committing = state.handlers.get("nomi:surface:commitCanvasRead")!(owner.event, {
      projectId: "project-a",
      suspension: copy(suspension),
    });
    Object.defineProperty(owner.event, "senderFrame", { value: null });
    gate.resolve({
      projectId: "project-a",
      immutableProjectUuid: "00000000-0000-4000-8000-000000000001",
      projectGeneration: 1,
      canonicalRootPath: "/real/project-a",
      canonicalRootDigest: "root-a",
    });

    await expect(committing).resolves.toMatchObject({ ok: true, value: { binding: { binding: { projectId: "project-a" } } } });
  });

  it("rejects a different window/process/frame/origin and invalidates on reload, crash, or destroy", async () => {
    for (const cause of ["reload", "render-process-gone", "destroyed"] as const) {
      const test = setup();
      const owner = source();
      const { value: { suspension } } = (await test.invoke("suspend", owner.event, {
        surfaceInstanceId: "surface-1",
      })) as { ok: true; value: { suspension: unknown } };
      const forged = [
        source({ id: 99 }).event,
        source({ processId: 99 }).event,
        source({ routingId: 99 }).event,
        source({ url: "https://evil.test" }).event,
      ];
      for (const event of forged) {
        await expect(test.invoke("commitCanvasRead", event, {
          projectId: "project-a",
          suspension: copy(suspension),
        })).resolves.toEqual({ ok: false, error: { code: "surface_owner_mismatch" } });
      }
      if (cause === "reload") {
        owner.sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      } else {
        owner.sender.emit(cause);
      }
      await expect(test.invoke("commitCanvasRead", owner.event, {
        projectId: "project-a",
        suspension: copy(suspension),
      })).resolves.toEqual({ ok: false, error: { code: "surface_port_unavailable" } });
      expect(test.registry.getCommittedProjectSelection()).toBeNull();
    }
  });

  it("does not invalidate on same-document navigation", async () => {
    const test = setup();
    const owner = source();
    const { value: { suspension } } = (await test.invoke("suspend", owner.event, {
      surfaceInstanceId: "surface-1",
    })) as { ok: true; value: { suspension: unknown } };
    owner.sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    await expect(
      test.invoke("commitCanvasRead", owner.event, {
        projectId: "project-a",
        suspension: copy(suspension),
      }),
    ).resolves.toMatchObject({ ok: true, value: { binding: { binding: { projectId: "project-a" } } } });
  });

  it("blocks the old document from reacquiring authority while a full navigation is in progress", async () => {
    const test = setup();
    const owner = source();
    await test.invoke("suspend", owner.event, { surfaceInstanceId: "surface-1" });

    owner.sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });

    await expect(test.invoke("suspend", owner.event, {
      surfaceInstanceId: "surface-old-document",
    })).resolves.toEqual({ ok: false, error: { code: "surface_port_unavailable" } });

    owner.sender.emit("did-navigate", {});
    await expect(test.invoke("suspend", owner.event, {
      surfaceInstanceId: "surface-new-document",
    })).resolves.toMatchObject({ ok: true, value: { suspension: { surfaceInstanceId: "surface-new-document" } } });
  });

  it("lets the still-running document reacquire after a failed or canceled navigation without leaking quarantine listeners", async () => {
    const test = setup();
    const owner = source();
    await test.invoke("suspend", owner.event, { surfaceInstanceId: "surface-initial" });

    const terminations: Array<readonly [string, ...unknown[]]> = [
      ["did-fail-provisional-load", {}, -3, "ERR_ABORTED", "file:///nomi/index.html", true, 5, 7],
      ["did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "file:///nomi/index.html", true, 5, 7],
      ["did-stop-loading"],
    ];
    for (const [index, [eventName, ...args]] of terminations.entries()) {
      owner.sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      await expect(test.invoke("suspend", owner.event, {
        surfaceInstanceId: `surface-quarantined-${index}`,
      })).resolves.toEqual({ ok: false, error: { code: "surface_port_unavailable" } });

      owner.sender.emit(eventName, ...args);
      await expect(test.invoke("suspend", owner.event, {
        surfaceInstanceId: `surface-recovered-${index}`,
      })).resolves.toMatchObject({
        ok: true,
        value: { suspension: { surfaceInstanceId: `surface-recovered-${index}` } },
      });
      expect(owner.sender.listenerCount("did-navigate")).toBe(0);
      expect(owner.sender.listenerCount("did-fail-provisional-load")).toBe(0);
      expect(owner.sender.listenerCount("did-fail-load")).toBe(0);
      expect(owner.sender.listenerCount("did-stop-loading")).toBe(0);
    }
  });

  it("idempotently ACKs an exact release retry but never lets it clear a newer lifecycle", async () => {
    const test = setup();
    const owner = source();
    const { value: { suspension } } = (await test.invoke("suspend", owner.event, {
      surfaceInstanceId: "surface-1",
    })) as { ok: true; value: { suspension: unknown } };
    const { value: { binding } } = (await test.invoke("commitCanvasRead", owner.event, {
      projectId: "project-a",
      suspension: copy(suspension),
    })) as { ok: true; value: { binding: unknown } };

    await expect(test.invoke("release", owner.event, { authority: copy(binding) })).resolves.toEqual({
      ok: true,
      value: { released: true },
    });
    await expect(test.invoke("release", owner.event, { authority: copy(binding) })).resolves.toEqual({
      ok: true,
      value: { released: true },
    });

    const next = (await test.invoke("suspend", owner.event, {
      surfaceInstanceId: "surface-2",
    })) as { ok: true; value: { suspension: unknown } };
    await expect(test.invoke("release", owner.event, { authority: copy(binding) })).resolves.toEqual({
      ok: false,
      error: { code: "surface_port_stale" },
    });
    await expect(test.invoke("commitCanvasRead", owner.event, {
      projectId: "project-a",
      suspension: copy(next.value.suspension),
    })).resolves.toMatchObject({ ok: true, value: { binding: { surfaceInstanceId: "surface-2" } } });
  });

  it("maps an untrusted sender into the typed owner mismatch envelope", async () => {
    const test = setup();
    state.trust.mockImplementationOnce(() => {
      throw new Error("raw trust detail must not cross IPC");
    });

    await expect(test.invoke("suspend", source().event, {
      surfaceInstanceId: "surface-1",
    })).resolves.toEqual({ ok: false, error: { code: "surface_owner_mismatch" } });
  });
});
