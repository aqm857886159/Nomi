import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localAssetUrl } from "../../electron/assets/assetPaths.ts";
import { initializeWorkspace, writeWorkspaceManifest } from "../../electron/workspace/workspaceManifest.ts";
import { inspectWorkspaceSync } from "../../electron/workspace/workspaceSync.ts";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  roots.push(root);
  return root;
}

function mirror(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

describe("cross-device continuation contract", () => {
  it("continues a real workspace with assets after a clean handoff", () => {
    const machineA = tempRoot("nomi-machine-a-");
    const machineB = tempRoot("nomi-machine-b-");
    const projectA = path.join(machineA, "Film One");
    const projectB = path.join(machineB, "Film One");
    const imagePath = path.join(projectA, "assets", "imported", "hero.png");
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, "png-bytes", "utf8");
    const initial = initializeWorkspace(projectA, { name: "Film One", payload: { canvas: { nodes: [{ id: "image-1", result: { type: "image", url: localAssetUrl("workspace-1", "assets/imported/hero.png") } }] } } });
    writeWorkspaceManifest(projectA, { ...initial, revision: 1, savedAt: Date.now(), updatedAt: Date.now() });

    mirror(projectA, projectB);
    const report = inspectWorkspaceSync(projectB);
    expect(report.status).toBe("ready");
    expect(report.referencedAssetCount).toBe(1);
    expect(report.missingAssetCount).toBe(0);
    expect(fs.existsSync(path.join(projectB, "assets", "imported", "hero.png"))).toBe(true);
  });

  it("detects an unsafe handoff when the source is changed after the mirror snapshot", () => {
    const machineA = tempRoot("nomi-machine-a-");
    const machineB = tempRoot("nomi-machine-b-");
    const projectA = path.join(machineA, "Film One");
    const projectB = path.join(machineB, "Film One");
    const initial = initializeWorkspace(projectA, { name: "Film One", payload: { title: "first" } });
    mirror(projectA, projectB);
    const snapshot = inspectWorkspaceSync(projectB);
    writeWorkspaceManifest(projectA, { ...initial, revision: 1, savedAt: Date.now(), updatedAt: Date.now(), payload: { title: "second" } });
    expect(inspectWorkspaceSync(projectA, { revision: snapshot.observedRevision ?? 0, contentHash: snapshot.contentHash ?? "" }).status).toBe("external-change");
  });
});
