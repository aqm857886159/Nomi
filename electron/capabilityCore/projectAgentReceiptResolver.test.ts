import { describe, expect, it, vi } from "vitest";

import { createDesktopProposalReceiptResolver } from "./projectAgentReceiptResolver";

const binding = {
  projectId: "project-1",
  immutableProjectUuid: "6b0f4a39-1ae4-4e1e-8b2e-0b9460a67a51",
  projectGeneration: 1,
} as const;
const repositoryDeps = { settingsRoot: "/settings", defaultProjectsRoot: "/projects" };
const service = { binding, read: vi.fn(), write: vi.fn(), transition: vi.fn(), clear: vi.fn() };

function dependencies() {
  return {
    getWorkspaceRepositoryDeps: vi.fn(() => repositoryDeps),
    resolveWorkspaceProjectDir: vi.fn((_projectId: string, _deps: typeof repositoryDeps): string | null => "/projects/project-1"),
    createProjectAgentProposalReceiptService: vi.fn(() => service),
  };
}

describe("desktop Project Agent proposal receipt resolver", () => {
  it("creates a receipt service for a live project binding", () => {
    const deps = dependencies();
    const resolve = createDesktopProposalReceiptResolver(deps);

    expect(resolve(binding)).toBe(service);
    expect(deps.getWorkspaceRepositoryDeps).toHaveBeenCalledOnce();
    expect(deps.resolveWorkspaceProjectDir).toHaveBeenCalledWith("project-1", repositoryDeps);
    expect(deps.createProjectAgentProposalReceiptService).toHaveBeenCalledWith({
      projectRoot: "/projects/project-1",
      binding,
    });
  });

  it.each([
    ["empty root", () => ""],
    ["missing root", () => null],
  ])("returns no service when the workspace has an %s", (_label, resolveRoot) => {
    const deps = dependencies();
    deps.resolveWorkspaceProjectDir.mockImplementation(resolveRoot);
    const resolve = createDesktopProposalReceiptResolver(deps);

    expect(resolve(binding)).toBeUndefined();
    expect(deps.createProjectAgentProposalReceiptService).not.toHaveBeenCalled();
  });

  it.each([undefined, null])("returns no service when the binding is %s", (missingBinding) => {
    const deps = dependencies();
    const resolve = createDesktopProposalReceiptResolver(deps);

    expect(resolve(missingBinding)).toBeUndefined();
    expect(deps.getWorkspaceRepositoryDeps).not.toHaveBeenCalled();
    expect(deps.resolveWorkspaceProjectDir).not.toHaveBeenCalled();
  });

  it("rejects a malformed binding before resolving a project root", () => {
    const deps = dependencies();
    const resolve = createDesktopProposalReceiptResolver(deps);

    expect(() => resolve({ projectId: "" } as unknown as typeof binding)).toThrow("invalid_project_binding");
    expect(deps.getWorkspaceRepositoryDeps).not.toHaveBeenCalled();
  });

  it("propagates a workspace resolver error instead of fabricating a receipt service", () => {
    const deps = dependencies();
    deps.resolveWorkspaceProjectDir.mockImplementation(() => {
      throw new Error("workspace lookup failed");
    });
    const resolve = createDesktopProposalReceiptResolver(deps);

    expect(() => resolve(binding)).toThrow("workspace lookup failed");
    expect(deps.createProjectAgentProposalReceiptService).not.toHaveBeenCalled();
  });

  it("propagates a receipt service construction error", () => {
    const deps = dependencies();
    deps.createProjectAgentProposalReceiptService.mockImplementation(() => {
      throw new Error("receipt construction failed");
    });
    const resolve = createDesktopProposalReceiptResolver(deps);

    expect(() => resolve(binding)).toThrow("receipt construction failed");
  });
});
