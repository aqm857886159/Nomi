import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getName: () => "Nomi",
    getPath: (name: string) => path.join(os.tmpdir(), `nomi-b6-electron-${name}`),
  },
}));

import { getWorkspaceRepositoryDeps, PROJECT_ROOT_ENV } from "../runtimePaths";
import { SETTINGS_ROOT_ENV } from "../settings/settingsRoot";
import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  readWorkspaceProject,
  saveWorkspaceProject,
} from "../workspace/workspaceRepository";
import { ensureWorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import { workspaceProjectBackupFile, workspaceProjectFile } from "../workspace/workspacePaths";
import type { CurrentProjectSelection } from "./currentProjectResolver";
import { createMcpConnectionContext } from "./mcpConnectionContext";
import { createMcpGenerationPolicy } from "./mcpGenerationPolicy";
import { ProjectBindingStaleError } from "./projectLease";
import { createProductionProjectSessionRuntime } from "./projectSessionRuntime";
import { CAPABILITY_DIR_ENV, ensureToken, signMcpClient } from "./security";

const PROJECT_ID = "project-repository-b6";
const tempDirs: string[] = [];
const previousEnvironment = {
  capability: process.env[CAPABILITY_DIR_ENV],
  projects: process.env[PROJECT_ROOT_ENV],
  settings: process.env[SETTINGS_ROOT_ENV],
};

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-session-repository-b6-"));
  tempDirs.push(root);
  process.env[CAPABILITY_DIR_ENV] = path.join(root, "capability");
  process.env[PROJECT_ROOT_ENV] = path.join(root, "projects");
  process.env[SETTINGS_ROOT_ENV] = path.join(root, "settings");
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnvironment(CAPABILITY_DIR_ENV, previousEnvironment.capability);
  restoreEnvironment(PROJECT_ROOT_ENV, previousEnvironment.projects);
  restoreEnvironment(SETTINGS_ROOT_ENV, previousEnvironment.settings);
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function makeProductionHarness(rootName = "original") {
  const deps = getWorkspaceRepositoryDeps();
  const projectRoot = path.join(deps.defaultProjectsRoot, rootName);
  createWorkspaceProject(
    {
      rootPath: projectRoot,
      record: {
        id: PROJECT_ID,
        name: "Repository B6",
        payload: { generationCanvas: { nodes: [], edges: [], groups: [], selectedNodeIds: [] } },
      },
    },
    deps,
  );
  const identity = await ensureWorkspaceProjectIdentity(projectRoot);
  const committedSelection: CurrentProjectSelection = Object.freeze({
    projectId: identity.projectId,
    immutableProjectUuid: identity.immutableProjectUuid,
    projectGeneration: identity.projectGeneration,
    canonicalRootDigest: identity.canonicalRootDigest,
  });
  ensureToken();
  const proof = signMcpClient("codex")!;
  const connection = createMcpConnectionContext({
    client: "codex",
    proof,
    randomSecret: () => "R".repeat(43),
  });
  const runtime = createProductionProjectSessionRuntime({
    generationPolicy: createMcpGenerationPolicy({ env: {} }),
    getOpenProjectSelection: () => committedSelection,
    isServerAllowlisted: () => false,
  });
  return {
    connection,
    deps,
    identity,
    projectRoot,
    runtime,
  };
}

function advanceReplacementGeneration(rootPath: string, generation: number): void {
  for (const filePath of [workspaceProjectFile(rootPath), workspaceProjectBackupFile(rootPath)]) {
    const record = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(filePath, JSON.stringify({ ...record, projectGeneration: generation }), "utf8");
  }
}

describe("production project-session runtime with the real workspace repository", () => {
  it("keeps a live canvas lease valid when a real save changes only revision and timestamps", async () => {
    const harness = await makeProductionHarness();
    const opened = await harness.runtime.authority.open({ bootstrap: { mode: "current_project" } }, harness.connection);
    const before = readWorkspaceProject(PROJECT_ID, harness.deps)!;
    vi.spyOn(Date, "now").mockReturnValue(before.updatedAt + 10_000);

    const after = saveWorkspaceProject(
      PROJECT_ID,
      { name: before.name, payload: structuredClone(before.payload) },
      harness.deps,
    );

    expect(after.revision).toBe(before.revision + 1);
    expect(after.updatedAt).toBe(before.updatedAt + 10_000);
    expect(after.immutableProjectUuid).toBe(before.immutableProjectUuid);
    expect(after.projectGeneration).toBe(before.projectGeneration);
    await expect(
      harness.runtime.authority.verifyLease(opened.leaseHandle, {
        connection: harness.connection,
        projectHint: PROJECT_ID,
        scope: "canvas:read",
      }),
    ).resolves.toMatchObject({
      projectId: PROJECT_ID,
      immutableProjectUuid: harness.identity.immutableProjectUuid,
      projectGeneration: harness.identity.projectGeneration,
    });
  });

  it("invalidates the old lease after a real same-id delete and recreate at a new root", async () => {
    const harness = await makeProductionHarness();
    const opened = await harness.runtime.authority.open({ bootstrap: { mode: "current_project" } }, harness.connection);

    expect(deleteWorkspaceProject(PROJECT_ID, harness.deps)).toEqual({ id: PROJECT_ID, deleted: true });
    const replacementRoot = path.join(harness.deps.defaultProjectsRoot, "replacement");
    createWorkspaceProject(
      {
        rootPath: replacementRoot,
        record: { id: PROJECT_ID, name: "Replacement B6", payload: {} },
      },
      harness.deps,
    );
    advanceReplacementGeneration(replacementRoot, harness.identity.projectGeneration + 1);
    const replacement = await ensureWorkspaceProjectIdentity(replacementRoot);

    expect(replacement.projectId).toBe(PROJECT_ID);
    expect(replacement.immutableProjectUuid).not.toBe(harness.identity.immutableProjectUuid);
    expect(replacement.projectGeneration).toBe(harness.identity.projectGeneration + 1);
    expect(replacement.canonicalRootDigest).not.toBe(harness.identity.canonicalRootDigest);
    await expect(
      harness.runtime.authority.verifyLease(opened.leaseHandle, {
        connection: harness.connection,
        projectHint: PROJECT_ID,
        scope: "canvas:read",
      }),
    ).rejects.toBeInstanceOf(ProjectBindingStaleError);
  });
});
