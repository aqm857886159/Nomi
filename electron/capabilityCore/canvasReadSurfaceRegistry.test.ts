import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  SurfacePortError,
  createCanvasReadSurfaceRegistry,
  createSurfaceOwnerAuthority,
  type SurfaceOwnerDescriptor,
} from "./canvasReadSurfaceRegistry";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function descriptor(input: Partial<SurfaceOwnerDescriptor> = {}): SurfaceOwnerDescriptor {
  const contents = input.contents ?? {};
  const frame = input.frame ?? {};
  return {
    contents,
    frame,
    webContentsId: input.webContentsId ?? 11,
    processId: input.processId ?? 22,
    frameRoutingId: input.frameRoutingId ?? 33,
    origin: input.origin ?? "file://",
    isLive: input.isLive ?? (() => true),
  };
}

function identity(projectId = "project-a", generation = 4) {
  return {
    projectId,
    immutableProjectUuid: `00000000-0000-4000-8000-${projectId === "project-a" ? "000000000001" : "000000000002"}`,
    projectGeneration: generation,
    canonicalRootPath: `/real/${projectId}`,
    canonicalRootDigest: `root-${projectId}-${generation}`,
  };
}

function harness() {
  const ownerAuthority = createSurfaceOwnerAuthority();
  const ownerDescriptor = descriptor();
  const owner = ownerAuthority.capture(ownerDescriptor);
  let currentIdentity = identity();
  const resolveProjectIdentity = vi.fn(async (projectId: string) => {
    if (projectId !== currentIdentity.projectId) throw new Error("missing project");
    return { ...currentIdentity };
  });
  let id = 0;
  const onCommittedProjectChanged = vi.fn();
  const registry = createCanvasReadSurfaceRegistry({
    ownerAuthority,
    resolveProjectIdentity,
    randomId: () => `id-${++id}`,
    onCommittedProjectChanged,
  });
  return {
    registry,
    ownerAuthority,
    ownerDescriptor,
    owner,
    resolveProjectIdentity,
    onCommittedProjectChanged,
    setIdentity: (next: ReturnType<typeof identity>) => {
      currentIdentity = next;
    },
  };
}

function expectSurfaceError(code: SurfacePortError["code"]) {
  return expect.objectContaining({ code, name: "SurfacePortError" });
}

describe("ProjectBinding dependency layer", () => {
  it("keeps the shared binding shape below both surface and invocation owners", () => {
    const registrySource = readFileSync(new URL("./canvasReadSurfaceRegistry.ts", import.meta.url), "utf8");
    const invocationSource = readFileSync(new URL("./verifiedCapabilityInvocation.ts", import.meta.url), "utf8");
    const wireSource = readFileSync(new URL("../shared/surfacePortBinding.ts", import.meta.url), "utf8");
    const neutralImport = /from\s+["']\.\.\/shared\/projectBinding["']/;

    expect(registrySource).toMatch(neutralImport);
    expect(registrySource).not.toMatch(/from\s+["']\.\/verifiedCapabilityInvocation["']/);
    expect(invocationSource).toMatch(neutralImport);
    expect(wireSource).toMatch(/from\s+["']\.\/projectBinding["']/);
    expect(wireSource).toMatch(/export type ProjectBindingWire = ProjectBinding/);
    const leafSource = readFileSync(new URL("../shared/projectBinding.ts", import.meta.url), "utf8");
    expect(leafSource).toMatch(/export type ProjectBinding = Readonly/);
    expect(leafSource).not.toMatch(/\bfrom\s+["']|\b(?:import|require)\s*\(/);
  });
});

describe("CanvasReadSurfaceRegistry authority lifecycle", () => {
  it("derives and freezes every binding field from main-owned identity and exact owner evidence", async () => {
    const test = harness();
    const suspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    expect(test.registry.getCommittedProjectSelection()).toBeNull();
    expect(test.onCommittedProjectChanged).toHaveBeenLastCalledWith(null);

    const binding = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension,
    });

    expect(binding).toEqual({
      version: 1,
      bindingId: "id-3",
      binding: {
        projectId: "project-a",
        immutableProjectUuid: "00000000-0000-4000-8000-000000000001",
        projectGeneration: 4,
      },
      webContentsId: 11,
      processId: 22,
      frameRoutingId: 33,
      origin: "file://",
      surfaceInstanceId: "surface-1",
      portRevision: 1,
      nonce: "id-4",
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.binding)).toBe(true);
    expect(test.registry.getCommittedProjectSelection()).toEqual({
      ...binding.binding,
      canonicalRootDigest: "root-project-a-4",
    });
    expect(test.onCommittedProjectChanged).toHaveBeenLastCalledWith({
      ...binding.binding,
      canonicalRootDigest: "root-project-a-4",
    });
  });

  it("keeps hydration suspended while identity is pending and after identity failure", async () => {
    const test = harness();
    const gate = deferred<ReturnType<typeof identity>>();
    test.resolveProjectIdentity.mockImplementationOnce(() => gate.promise);
    const suspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const committing = test.registry.commitCanvasRead(test.owner, { projectId: "project-a", suspension });

    expect(test.registry.getCommittedProjectSelection()).toBeNull();
    expect(() => test.registry.captureCanvasReadPort(test.owner, {})).toThrow(
      expectSurfaceError("surface_port_suspended"),
    );
    gate.reject(new Error("manifest missing"));
    await expect(committing).rejects.toEqual(expectSurfaceError("project_identity_unavailable"));
    expect(test.registry.getCommittedProjectSelection()).toBeNull();
    expect(() => test.registry.captureCanvasReadPort(test.owner, {})).toThrow(
      expectSurfaceError("surface_port_suspended"),
    );
  });

  it("rotates on A to B and same-id reload, so old bindings and late replies stay stale", async () => {
    const test = harness();
    const firstSuspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const first = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension: firstSuspension,
    });
    const captured = test.registry.captureCanvasReadPort(test.owner, first);

    const secondSuspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    expect(() => test.registry.captureCanvasReadPort(test.owner, first)).toThrow(
      expectSurfaceError("surface_port_suspended"),
    );
    await expect(test.registry.assertCanvasReadPortReply(captured, first)).rejects.toEqual(
      expectSurfaceError("surface_port_stale"),
    );

    test.setIdentity(identity("project-b", 1));
    const second = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-b",
      suspension: secondSuspension,
    });
    expect(second.binding.projectId).toBe("project-b");

    const reload = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    test.setIdentity(identity("project-b", 1));
    const third = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-b",
      suspension: reload,
    });
    expect(third.bindingId).not.toBe(second.bindingId);
    expect(third.portRevision).toBe(second.portRevision + 1);
  });

  it("revalidates UUID, generation and canonical root before accepting a reply", async () => {
    const test = harness();
    const suspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const binding = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension,
    });
    const captured = test.registry.captureCanvasReadPort(test.owner, binding);
    test.setIdentity({
      ...identity("project-a", 5),
      immutableProjectUuid: binding.binding.immutableProjectUuid,
    });

    await expect(test.registry.assertCanvasReadPortReply(captured, binding)).rejects.toEqual(
      expectSurfaceError("project_binding_stale"),
    );
    expect(test.registry.getCommittedProjectSelection()).toBeNull();
  });

  it("resolves an exact captured dispatch target and accepts only its byte-equal IPC binding echo", async () => {
    const test = harness();
    const suspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const binding = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension,
    });
    const captured = test.registry.captureCanvasReadPort(test.owner, binding);

    expect(test.registry.resolveCapturedCanvasReadPort(captured)).toEqual({
      owner: test.ownerDescriptor,
      binding,
    });
    await expect(test.registry.assertCanvasReadPortReply(captured, structuredClone(binding))).resolves.toBe(binding);
    expect(() => test.registry.resolveCapturedCanvasReadPort({} as typeof captured)).toThrow(
      expectSurfaceError("surface_port_stale"),
    );
    await expect(
      test.registry.assertCanvasReadPortReply(captured, {
        ...structuredClone(binding),
        frameRoutingId: 999,
      }),
    ).rejects.toEqual(expectSurfaceError("surface_port_stale"));
  });

  it("selects a committed renderer port only for the exact verified project identity", async () => {
    const test = harness();
    const suspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const binding = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension,
    });

    const captured = test.registry.captureCommittedCanvasReadPort({
      binding: binding.binding,
      canonicalRootDigest: "root-project-a-4",
    });
    expect(captured).not.toBeNull();
    expect(
      test.registry.captureCommittedCanvasReadPort({
        binding: {
          projectId: "project-b",
          immutableProjectUuid: "00000000-0000-4000-8000-000000000002",
          projectGeneration: 1,
        },
        canonicalRootDigest: "root-project-b-1",
      }),
    ).toBeNull();
    expect(() =>
      test.registry.captureCommittedCanvasReadPort({
        binding: { ...binding.binding, projectGeneration: binding.binding.projectGeneration + 1 },
        canonicalRootDigest: "root-project-a-5",
      }),
    ).toThrow(expectSurfaceError("project_binding_stale"));
  });

  it("rejects structural owner and binding copies plus mismatched window, process, frame and origin", async () => {
    const test = harness();
    const suspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const binding = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension,
    });

    expect(() => test.registry.captureCanvasReadPort({ ...test.owner } as typeof test.owner, binding)).toThrow(
      expectSurfaceError("surface_owner_mismatch"),
    );
    expect(() => test.registry.captureCanvasReadPort(test.owner, { ...binding })).toThrow(
      expectSurfaceError("project_binding_stale"),
    );
    for (const patch of [
      { webContentsId: 99 },
      { processId: 99 },
      { frameRoutingId: 99 },
      { origin: "https://evil.test" },
      { contents: {} },
      { frame: {} },
    ]) {
      const other = test.ownerAuthority.capture(descriptor({ ...test.ownerDescriptor, ...patch }));
      expect(() => test.registry.captureCanvasReadPort(other, binding)).toThrow(
        expectSurfaceError("surface_owner_mismatch"),
      );
    }
  });

  it("rejects a live second owner and clears the exact owner on navigation, process loss or destruction", async () => {
    const test = harness();
    const suspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const binding = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension,
    });
    const other = test.ownerAuthority.capture(descriptor({ webContentsId: 44, contents: {}, frame: {} }));

    expect(() => test.registry.suspend(other, { surfaceInstanceId: "surface-2" })).toThrow(
      expectSurfaceError("surface_owner_mismatch"),
    );
    test.registry.invalidateOwner(test.owner);
    expect(test.registry.getCommittedProjectSelection()).toBeNull();
    expect(() => test.registry.captureCanvasReadPort(test.owner, binding)).toThrow(
      expectSurfaceError("surface_port_unavailable"),
    );
    expect(() => test.registry.suspend(other, { surfaceInstanceId: "surface-2" })).not.toThrow();
  });

  it("requires the current lifecycle token for release so a stale release cannot clear a newer project", async () => {
    const test = harness();
    const firstSuspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const first = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension: firstSuspension,
    });
    const secondSuspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });

    expect(() => test.registry.release(test.owner, { authority: first })).toThrow(
      expectSurfaceError("surface_port_stale"),
    );
    test.setIdentity(identity("project-b", 1));
    const second = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-b",
      suspension: secondSuspension,
    });
    expect(() => test.registry.release(test.owner, { authority: firstSuspension })).toThrow(
      expectSurfaceError("surface_port_stale"),
    );
    test.registry.release(test.owner, { authority: second });
    expect(test.registry.getCommittedProjectSelection()).toBeNull();
  });

  it("fails a delayed commit after a newer hydration rotates the epoch", async () => {
    const test = harness();
    const gate = deferred<ReturnType<typeof identity>>();
    test.resolveProjectIdentity.mockImplementationOnce(() => gate.promise);
    const oldSuspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const oldCommit = test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension: oldSuspension,
    });
    const currentSuspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    gate.resolve(identity());

    await expect(oldCommit).rejects.toEqual(expectSurfaceError("surface_port_stale"));
    const current = await test.registry.commitCanvasRead(test.owner, {
      projectId: "project-a",
      suspension: currentSuspension,
    });
    expect(test.registry.getCommittedProjectSelection()?.projectId).toBe(current.binding.projectId);
  });

  it("advances port revision on every suspend, including retries that never commit", () => {
    const test = harness();
    const first = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const second = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    const third = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });

    expect([first.portRevision, second.portRevision, third.portRevision]).toEqual([1, 2, 3]);
  });

  it("maps malformed resolved identity to identity_unavailable and leaves the lifecycle retryably suspended", async () => {
    const test = harness();
    const suspension = test.registry.suspend(test.owner, { surfaceInstanceId: "surface-1" });
    test.resolveProjectIdentity.mockResolvedValueOnce({
      ...identity(),
      immutableProjectUuid: "",
    });

    await expect(test.registry.commitCanvasRead(test.owner, { projectId: "project-a", suspension })).rejects.toEqual(
      expectSurfaceError("project_identity_unavailable"),
    );
    expect(() => test.registry.captureCanvasReadPort(test.owner, {})).toThrow(
      expectSurfaceError("surface_port_suspended"),
    );
    await expect(
      test.registry.commitCanvasRead(test.owner, { projectId: "project-a", suspension }),
    ).resolves.toMatchObject({ portRevision: suspension.portRevision });
  });
});
