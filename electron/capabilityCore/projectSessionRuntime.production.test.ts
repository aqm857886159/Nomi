import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const productionState = vi.hoisted(() => ({
  authorityDir: "",
  repositoryRoot: "/projects-a/project-1",
  getRepositoryDeps: vi.fn(),
  resolveProjectRoot: vi.fn(),
  ensureProjectIdentity: vi.fn(),
  readProject: vi.fn(),
}));

vi.mock("../runtimePaths", () => ({
  getWorkspaceRepositoryDeps: productionState.getRepositoryDeps,
}));

vi.mock("../workspace/workspaceRepository", () => ({
  resolveWorkspaceProjectDir: productionState.resolveProjectRoot,
  readWorkspaceProject: productionState.readProject,
}));

vi.mock("../workspace/workspaceProjectIdentity", () => {
  class WorkspaceProjectIdentityUnavailableError extends Error {
    readonly code = "project_identity_unavailable";
  }
  return {
    WorkspaceProjectIdentityUnavailableError,
    ensureWorkspaceProjectIdentity: productionState.ensureProjectIdentity,
  };
});

vi.mock("./security", () => ({
  capabilityCoreDir: () => productionState.authorityDir,
  ensureCapabilitySigningKey: (name: string) => `test-${name}-key`,
}));

import type { WorkspaceProjectRecordV2 } from "../workspace/workspaceTypes";
import type { CurrentProjectSelection } from "./currentProjectResolver";
import type { McpConnectionContext } from "./mcpConnectionContext";
import { createMcpGenerationPolicy } from "./mcpGenerationPolicy";
import { createProductionProjectSessionRuntime } from "./projectSessionRuntime";

const tempDirs: string[] = [];
const projectId = "project-1";
const immutableProjectUuid = "02b6f485-1238-4ab7-a0f4-5c84be59cd3c";

function identityFor(rootPath: string) {
  return {
    projectId,
    immutableProjectUuid,
    projectGeneration: 2,
    canonicalRootPath: rootPath,
    canonicalRootDigest: rootPath.includes("projects-b") ? "root-digest-b" : "root-digest-a",
  };
}

const record: WorkspaceProjectRecordV2 = {
  id: projectId,
  name: "Project 1",
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 0,
  immutableProjectUuid,
  projectGeneration: 2,
  lastKnownRootPath: "/not-authority",
  payload: {},
};

const connection: McpConnectionContext = Object.freeze({
  authenticatedClient: "codex",
  principal: "mcp:codex",
  sessionId: "mcp-session:dynamic-project-root",
  connectionNonce: "dynamic-project-root-nonce",
});

beforeEach(() => {
  vi.clearAllMocks();
  productionState.authorityDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-production-session-runtime-"));
  tempDirs.push(productionState.authorityDir);
  productionState.repositoryRoot = "/projects-a/project-1";
  productionState.getRepositoryDeps.mockImplementation(() => ({
    settingsRoot: "/settings",
    defaultProjectsRoot: productionState.repositoryRoot,
  }));
  productionState.resolveProjectRoot.mockImplementation((_id, deps) => deps.defaultProjectsRoot);
  productionState.ensureProjectIdentity.mockImplementation(async (rootPath) => identityFor(rootPath));
  productionState.readProject.mockReturnValue(record);
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("production project-session runtime repository composition", () => {
  it("resolves repository dependencies afresh after project-location settings change in-process", async () => {
    let committedSelection: CurrentProjectSelection = Object.freeze({
      projectId,
      immutableProjectUuid,
      projectGeneration: 2,
      canonicalRootDigest: "root-digest-a",
    });
    const runtime = createProductionProjectSessionRuntime({
      generationPolicy: createMcpGenerationPolicy({ env: {} }),
      getOpenProjectSelection: () => committedSelection,
      isServerAllowlisted: () => false,
    });
    expect(productionState.getRepositoryDeps).not.toHaveBeenCalled();

    await expect(runtime.authority.open({ bootstrap: { mode: "current_project" } }, connection)).resolves.toMatchObject(
      {
        projectId,
      },
    );
    const repositoryReadsBeforeLocationChange = productionState.getRepositoryDeps.mock.calls.length;

    productionState.repositoryRoot = "/projects-b/project-1";
    committedSelection = Object.freeze({
      projectId,
      immutableProjectUuid,
      projectGeneration: 2,
      canonicalRootDigest: "root-digest-b",
    });

    await expect(runtime.authority.open({ bootstrap: { mode: "current_project" } }, connection)).resolves.toMatchObject(
      {
        projectId,
      },
    );
    expect(productionState.resolveProjectRoot).toHaveBeenLastCalledWith(
      projectId,
      expect.objectContaining({ defaultProjectsRoot: "/projects-b/project-1" }),
    );
    expect(productionState.readProject).toHaveBeenLastCalledWith(
      projectId,
      expect.objectContaining({ defaultProjectsRoot: "/projects-b/project-1" }),
    );
    expect(productionState.getRepositoryDeps.mock.calls.length).toBeGreaterThan(repositoryReadsBeforeLocationChange);
  });
});
