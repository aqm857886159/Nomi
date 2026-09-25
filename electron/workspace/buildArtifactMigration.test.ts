// 清单事务上的构建产物地址迁移（2026-09-25）：旧的「示例：修好一个小机器人」项目里存着 v0.16.7–v0.18.0 写进去的
// app.asar / dev server 地址。打开（加锁读）即迁成项目资产；之后任何写入都不许再带新的构建产物地址进来。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerOnboardingDemoAssetSourceDir } from "../onboarding/demoAssetSource";
import { BuildArtifactUrlPersistError } from "./buildArtifactMigration";
import { readWorkspaceManifest, readWorkspaceManifestSnapshot, writeWorkspaceManifest } from "./workspaceManifest";
import { workspaceProjectFile } from "./workspacePaths";
import type { WorkspaceProjectRecordV2 } from "./workspaceTypes";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEMO_DIR = path.join(REPO_ROOT, "resources", "onboarding-demo");
const PACKAGED_KID = "file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/assets/kid-Bv5PJ3l5.jpg";
const DEV_KID = "http://127.0.0.1:5273/src/workbench/onboarding/assets/robot/kid.jpg";
const PACKAGED_SHOT = "file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/assets/shot-3-Qw3rTy12.jpg";

const tempRoots: string[] = [];
beforeEach(() => registerOnboardingDemoAssetSourceDir(DEMO_DIR));
afterEach(() => {
  registerOnboardingDemoAssetSourceDir(null);
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function legacyDemoProject(payload: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-build-artifact-"));
  tempRoots.push(root);
  const record = { id: "demo-project", name: "示例：修好一个小机器人", version: 2, createdAt: 1, updatedAt: 2, savedAt: 3, revision: 1, payload };
  fs.mkdirSync(path.dirname(workspaceProjectFile(root)), { recursive: true });
  fs.writeFileSync(workspaceProjectFile(root), JSON.stringify(record, null, 2));
  return root;
}

function demoPayload() {
  return {
    generationCanvas: {
      nodes: [
        { id: "kid", result: { id: "demo-kid", type: "image", url: PACKAGED_KID }, history: [{ id: "demo-kid", type: "image", url: DEV_KID }] },
        { id: "shot-3", result: { id: "demo-shot-3", type: "image", url: PACKAGED_SHOT }, prompt: `参考 @[asset:${encodeURIComponent(DEV_KID)}]` },
      ],
    },
    timeline: { tracks: [{ id: "imageTrack", clips: [{ id: "c1", url: PACKAGED_SHOT }] }] },
  };
}

describe("旧项目里的引导示例图构建地址 → 项目资产", () => {
  it("打开（加锁读）即迁移：结果、历史、时间轴、@ 引用里的构建地址全部换成本项目 nomi-local 资产", () => {
    const root = legacyDemoProject(demoPayload());
    const record = readWorkspaceManifest(root) as WorkspaceProjectRecordV2;
    const text = JSON.stringify(record);
    expect(text).not.toMatch(/app\.asar|127\.0\.0\.1:5273/);
    expect(text).not.toContain(encodeURIComponent(DEV_KID));
    const nodes = (record.payload as ReturnType<typeof demoPayload>).generationCanvas.nodes;
    expect(nodes[0].result.url).toMatch(/^nomi-local:\/\/asset\/demo-project\/assets\/generated\/.+\/kid\.jpg$/);
    expect(nodes[0].history[0].url).toBe(nodes[0].result.url);
    // 落盘的是随包原图、带 onboarding-demo sidecar（与引导 seed 同形，重看引导会复用）。
    const relative = decodeURIComponent(nodes[0].result.url.replace("nomi-local://asset/demo-project/", ""));
    const file = path.join(root, relative);
    expect(fs.readFileSync(file).equals(fs.readFileSync(path.join(DEMO_DIR, "kid.jpg")))).toBe(true);
    expect(JSON.parse(fs.readFileSync(`${file}.meta`, "utf8"))).toEqual({ kind: "onboarding-demo", originalName: "kid.jpg" });
    // 迁移结果已写回磁盘：快照读取也拿到干净记录。
    expect(fs.readFileSync(workspaceProjectFile(root), "utf8")).not.toMatch(/app\.asar/);
    expect(JSON.stringify(readWorkspaceManifestSnapshot(root))).toBe(text);
  });

  it("同一张图在记录里出现多次只落一份；重读不再落新文件", () => {
    const root = legacyDemoProject(demoPayload());
    readWorkspaceManifest(root);
    readWorkspaceManifest(root);
    const generated = fs.readdirSync(path.join(root, "assets"), { recursive: true }).map(String).filter((name) => name.endsWith(".jpg"));
    expect(generated.map((name) => path.basename(name)).sort()).toEqual(["kid.jpg", "shot-3.jpg"]);
  });

  it("快照读取遇到构建产物地址不返回旧记录（交给加锁读去迁移，项目库封面也跟着好）", () => {
    const root = legacyDemoProject(demoPayload());
    expect(readWorkspaceManifestSnapshot(root)).toBeNull();
  });
});

describe("写入口：不许带新的构建产物地址进项目", () => {
  it("新写入里认不出的构建产物地址直接拒绝（fail-closed），磁盘不变", () => {
    const root = legacyDemoProject({ generationCanvas: { nodes: [] } });
    const current = readWorkspaceManifest(root) as WorkspaceProjectRecordV2;
    const before = fs.readFileSync(workspaceProjectFile(root), "utf8");
    const leaked = "file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/assets/logo-AbCd1234.png";
    expect(() => writeWorkspaceManifest(root, { ...current, payload: { generationCanvas: { nodes: [{ id: "n", result: { url: leaked } }] } } })).toThrow(BuildArtifactUrlPersistError);
    expect(fs.readFileSync(workspaceProjectFile(root), "utf8")).toBe(before);
  });

  it("新写入里的引导示例图地址照样迁成资产，不拒", () => {
    const root = legacyDemoProject({ generationCanvas: { nodes: [] } });
    const current = readWorkspaceManifest(root) as WorkspaceProjectRecordV2;
    const saved = writeWorkspaceManifest(root, { ...current, payload: { generationCanvas: { nodes: [{ id: "n", result: { url: DEV_KID } }] } } });
    expect(JSON.stringify(saved)).toMatch(/nomi-local:\/\/asset\/demo-project\/.+kid\.jpg/);
  });

  it("记录里原来就有的、找不回字节的构建地址：保留不动，项目照常能存（不因一个坏地址砖化）", () => {
    const legacyUnknown = "file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/assets/old-AbCd1234.png";
    const root = legacyDemoProject({ generationCanvas: { nodes: [{ id: "n", result: { url: legacyUnknown } }] } });
    const current = readWorkspaceManifest(root) as WorkspaceProjectRecordV2;
    expect(JSON.stringify(current)).toContain(legacyUnknown);
    const saved = writeWorkspaceManifest(root, { ...current, name: "改个名" });
    expect(saved.name).toBe("改个名");
  });

  it("随包原图读不到（目录没登记）时，示例地址也按找不回处理：新写入拒绝", () => {
    registerOnboardingDemoAssetSourceDir(null);
    const root = legacyDemoProject({ generationCanvas: { nodes: [] } });
    const current = readWorkspaceManifest(root) as WorkspaceProjectRecordV2;
    expect(() => writeWorkspaceManifest(root, { ...current, payload: { url: PACKAGED_KID } })).toThrow(BuildArtifactUrlPersistError);
  });
});
