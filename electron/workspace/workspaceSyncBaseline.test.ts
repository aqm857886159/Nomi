import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceSyncBaseline, writeWorkspaceSyncBaseline } from "./workspaceSyncBaseline";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-sync-baseline-"));
  roots.push(root);
  return root;
}

describe("workspace sync baseline", () => {
  it("round-trips a device-local baseline for the same project root", () => {
    const settingsRoot = tempRoot();
    const projectRoot = path.join(settingsRoot, "projects", "Film One");
    writeWorkspaceSyncBaseline(settingsRoot, "project-1", { rootPath: projectRoot, revision: 4, contentHash: "hash-4" });

    expect(readWorkspaceSyncBaseline(settingsRoot, "project-1", projectRoot)).toEqual({
      rootPath: path.resolve(projectRoot),
      revision: 4,
      contentHash: "hash-4",
    });
  });

  it("does not reuse a baseline when the project moves to another root", () => {
    const settingsRoot = tempRoot();
    writeWorkspaceSyncBaseline(settingsRoot, "project-1", { rootPath: path.join(settingsRoot, "old"), revision: 1, contentHash: "hash-1" });

    expect(readWorkspaceSyncBaseline(settingsRoot, "project-1", path.join(settingsRoot, "new"))).toBeNull();
  });

  it("ignores malformed persisted entries", () => {
    const settingsRoot = tempRoot();
    fs.writeFileSync(path.join(settingsRoot, "workspace-sync-baseline.json"), JSON.stringify({ schemaVersion: 1, projects: { bad: { rootPath: 1 } } }), "utf8");

    expect(readWorkspaceSyncBaseline(settingsRoot, "bad", path.join(settingsRoot, "project"))).toBeNull();
  });
});
