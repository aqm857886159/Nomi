// 补身份是这台机器自己写的：写完同步基线要跟上，下次打开不能冒「另一台电脑有新版本」；
// 但基线和写前不一样（另一台电脑真改过）时不许跟，冲突照报。（2026-11-13 打开不写）
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { workspaceProjectFile } from "./workspacePaths";
import { ensureWorkspaceProjectIdentity } from "./workspaceProjectIdentity";
import { inspectWorkspaceSync } from "./workspaceSync";
import { readWorkspaceSyncBaseline, writeWorkspaceSyncBaseline } from "./workspaceSyncBaseline";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const hashOf = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** 一份没有身份字段的老项目（v0.20 那一代）+ 一个设置根。 */
function legacyProject() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-identity-baseline-"));
  temps.push(base);
  const root = path.join(base, "project");
  const settingsRoot = path.join(base, "settings");
  fs.mkdirSync(settingsRoot, { recursive: true });
  const manifest = workspaceProjectFile(root);
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, `${JSON.stringify({ id: "project-old", name: "Old", version: 2, createdAt: 1, updatedAt: 2, savedAt: 3, revision: 0, payload: { marker: "old" } }, null, 2)}\n`);
  return { root, settingsRoot, manifest, id: "project-old" };
}

describe("补身份后同步基线跟上（只跟这台机器自己那一笔）", () => {
  it("基线 = 写前那份：补完身份基线跟到写后，再查不报另一台电脑改过", async () => {
    const p = legacyProject();
    const before = hashOf(p.manifest);
    writeWorkspaceSyncBaseline(p.settingsRoot, p.id, { rootPath: p.root, revision: 0, contentHash: before });
    await ensureWorkspaceProjectIdentity(p.root, { settingsRoot: p.settingsRoot });
    const after = hashOf(p.manifest);
    expect(after).not.toBe(before);
    const baseline = readWorkspaceSyncBaseline(p.settingsRoot, p.id, p.root);
    expect(baseline?.contentHash).toBe(after);
    const inspection = await inspectWorkspaceSync(p.root, p.id, baseline ?? undefined);
    expect(inspection.status).not.toBe("external-change");
  });

  it("基线 ≠ 写前那份（另一台电脑真改过）：基线不动，冲突照报", async () => {
    const p = legacyProject();
    writeWorkspaceSyncBaseline(p.settingsRoot, p.id, { rootPath: p.root, revision: 0, contentHash: "hash-from-before-the-other-machine-edited" });
    await ensureWorkspaceProjectIdentity(p.root, { settingsRoot: p.settingsRoot });
    const baseline = readWorkspaceSyncBaseline(p.settingsRoot, p.id, p.root);
    expect(baseline?.contentHash).toBe("hash-from-before-the-other-machine-edited");
    const inspection = await inspectWorkspaceSync(p.root, p.id, baseline ?? undefined);
    expect(inspection.status).toBe("external-change");
  });

  it("这台机器还没有基线记录：不凭空造一条（第一次检查自己会记）", async () => {
    const p = legacyProject();
    await ensureWorkspaceProjectIdentity(p.root, { settingsRoot: p.settingsRoot });
    expect(readWorkspaceSyncBaseline(p.settingsRoot, p.id, p.root)).toBeNull();
    expect(fs.existsSync(path.join(p.settingsRoot, "workspace-sync-baseline.json"))).toBe(false);
  });

  it("身份已经落定的项目：不写项目文件，基线也不动", async () => {
    const p = legacyProject();
    await ensureWorkspaceProjectIdentity(p.root, { settingsRoot: p.settingsRoot });
    const settled = hashOf(p.manifest);
    writeWorkspaceSyncBaseline(p.settingsRoot, p.id, { rootPath: p.root, revision: 0, contentHash: settled });
    await ensureWorkspaceProjectIdentity(p.root, { settingsRoot: p.settingsRoot });
    expect(hashOf(p.manifest)).toBe(settled);
    expect(readWorkspaceSyncBaseline(p.settingsRoot, p.id, p.root)?.contentHash).toBe(settled);
  });
});
