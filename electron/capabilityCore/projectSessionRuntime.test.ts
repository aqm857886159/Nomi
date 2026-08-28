import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceProjectRecordV2 } from "../workspace/workspaceTypes";
import type { McpConnectionContext } from "./mcpConnectionContext";
import { createMcpGenerationPolicy } from "./mcpGenerationPolicy";
import { createProjectSessionRuntime } from "./projectSessionRuntime";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const identity = {
  projectId: "project-1",
  immutableProjectUuid: "02b6f485-1238-4ab7-a0f4-5c84be59cd3c",
  projectGeneration: 2,
  canonicalRootPath: "/real/project-1",
  canonicalRootDigest: "root-digest-1",
};

const record: WorkspaceProjectRecordV2 = {
  id: identity.projectId,
  name: "Project 1",
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 0,
  immutableProjectUuid: identity.immutableProjectUuid,
  projectGeneration: identity.projectGeneration,
  lastKnownRootPath: "/not-used-as-authority",
  payload: {},
};

const directConnection: McpConnectionContext = Object.freeze({
  authenticatedClient: "codex",
  principal: "mcp:codex",
  sessionId: "mcp-session:direct-1",
  connectionNonce: "direct-nonce-1",
});

const loopbackConnection: McpConnectionContext = Object.freeze({
  authenticatedClient: "claude",
  principal: "mcp:claude",
  sessionId: "mcp-session:loopback-1",
  connectionNonce: "loopback-nonce-1",
});

describe("project-session production runtime factory", () => {
  it("shares one immutable per-token authority store across direct and loopback runtimes without a shared RMW lock", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-session-runtime-"));
    tempDirs.push(dir);
    const generationPolicy = createMcpGenerationPolicy({ env: {} });
    let rootAvailable = true;
    const committedSelection = Object.freeze({
      projectId: identity.projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      canonicalRootDigest: identity.canonicalRootDigest,
    });
    const makeRuntime = () =>
      createProjectSessionRuntime({
        generationPolicy,
        leaseFilePath: path.join(dir, "project-leases-v2"),
        leaseMacKey: "shared-lease-key",
        leaseStoreMacKey: "shared-lease-store-key",
        getOpenProjectSelection: () => committedSelection,
        resolveProjectRoot: (projectId) =>
          rootAvailable && projectId === "project-1" ? identity.canonicalRootPath : null,
        ensureProjectIdentity: async () => identity,
        readProject: (projectId) => (projectId === "project-1" ? record : null),
        isServerAllowlisted: () => false,
      });
    const direct = makeRuntime();
    const loopback = makeRuntime();

    const directOpened = await direct.authority.open({ bootstrap: { mode: "current_project" } }, directConnection);
    const loopbackOpened = await loopback.authority.open(
      { bootstrap: { mode: "current_project" } },
      loopbackConnection,
    );

    await expect(
      loopback.authority.verifyLease(directOpened.leaseHandle, {
        connection: directConnection,
        projectHint: "project-1",
        scope: "canvas:read",
      }),
    ).resolves.toMatchObject({ sessionId: directConnection.sessionId });
    await expect(
      direct.authority.verifyLease(loopbackOpened.leaseHandle, {
        connection: loopbackConnection,
        projectHint: "project-1",
        scope: "canvas:read",
      }),
    ).resolves.toMatchObject({ sessionId: loopbackConnection.sessionId });

    rootAvailable = false;
    await expect(
      loopback.authority.verifyLease(directOpened.leaseHandle, {
        connection: directConnection,
        scope: "canvas:read",
      }),
    ).rejects.toMatchObject({ code: "project_identity_unavailable" });
    rootAvailable = true;

    direct.authority.revoke(directOpened.leaseHandle);
    await expect(
      loopback.authority.verifyLease(directOpened.leaseHandle, {
        connection: directConnection,
        scope: "canvas:read",
      }),
    ).rejects.toThrow(/revoked/i);
  });
});
