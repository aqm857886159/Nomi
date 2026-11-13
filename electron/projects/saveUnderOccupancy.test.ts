import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import { createProject, readProject, saveProject, updateProject } from "./repository";
import { applyCanvasNodePatch } from "./projectCanvasWrite";
import { createDiskGateway } from "../capabilityCore/gateway";
import { writeProjectDocument } from "../capabilityCore/documentSurface";
import { isSharingViolation } from "../sharingRetry";
import { saveWithSharingRetry } from "./saveRetry";
import { findRecentWorkspace } from "../workspace/workspaceRegistry";
import { readWorkspaceSyncBaseline } from "../workspace/workspaceSyncBaseline";
import { ProjectSaveSupersededError, saveWorkspaceProject, settleWorkspacePostCommitWrites } from "../workspace/workspaceRepository";
import { projectSaveFailure } from "../shared/contracts/projectSaveFailure";

// 文件被别的程序（杀毒 / 同步盘）短暂占着时，保存分三段：提交前可以整体重排；清单一旦写上就算成功，提交后各步只在后台补写；
// 每次重排前核修订号，不拿旧快照盖掉占用期间别人已经写上、已经回执过的内容。下面每条都是真文件系统，只在 fs 上注入占用。

const errno = (code: string) => Object.assign(new Error(`injected ${code}`), { code });
/** 从第一次命中起 ms 毫秒内抛 code（ms = Infinity 就一直占着，直到 release()）。 */
function occupy(ms: number, code = "EBUSY") {
  let first: number | null = null;
  let released = false;
  let hits = 0;
  return {
    check() {
      first ??= Date.now();
      if (!released && Date.now() - first < ms) {
        hits += 1;
        throw errno(code);
      }
    },
    release() { released = true; },
    get hits() { return hits; },
  };
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function outcome<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error };
  }
}

let projectsRoot = "";
let settingsRoot = "";
beforeEach(() => {
  projectsRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-occ-proj-")));
  settingsRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-occ-settings-")));
  vi.stubEnv("NOMI_PROJECTS_DIR", projectsRoot);
  vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await settleWorkspacePostCommitWrites();
  vi.unstubAllEnvs();
  fs.rmSync(projectsRoot, { recursive: true, force: true });
  fs.rmSync(settingsRoot, { recursive: true, force: true });
});

function project(payload: unknown = { text: "v0" }) {
  const created = createProject({ name: "P", payload });
  const rootPath = (findRecentWorkspace(settingsRoot, created.id) as { rootPath: string }).rootPath;
  const nomi = path.join(rootPath, ".nomi");
  return { id: created.id, rootPath, nomi, manifest: path.join(nomi, "project.json"), backup: path.join(nomi, "project.backup.json") };
}
const onDisk = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as { revision: number; payload: Record<string, unknown>; name: string };
/** 盘上被「别的进程」直接改写（不经本进程的锁和重试），修订号 +1。 */
function externalWrite(file: string, change: (record: Record<string, unknown>) => void): void {
  const record = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  change(record);
  record.revision = Number(record.revision) + 1;
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}
/** 只对改名到某类目标的操作注入占用（杀毒扫新写的文件时，Windows 上表现为改名 EBUSY / EPERM）。 */
function occupyRenamesTo(match: (target: string) => boolean, occupied: { check(): void }) {
  const rename = fs.renameSync.bind(fs);
  return vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (match(String(to))) occupied.check();
    return rename(from, to);
  });
}

describe("清单锁的 owner.json 被短暂占用：报可重排的被占用，不判锁丢，不留孤儿锁目录", () => {
  function occupyOwnerReads(p: ReturnType<typeof project>, fromRead: number, occupied: { check(): void }) {
    let reads = 0;
    const read = fs.readFileSync.bind(fs);
    return vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
      if (typeof file === "string" && file.endsWith("owner.json") && file.startsWith(p.nomi)) {
        reads += 1;
        if (reads >= fromRead) occupied.check();
      }
      return read(file, options as never);
    }) as typeof fs.readFileSync);
  }

  it("占用 300ms：保存重排后存上，修订号只 +1，盘上不留锁目录", async () => {
    const p = project();
    const occupied = occupy(300);
    occupyOwnerReads(p, 3, occupied);
    const saved = await saveProject(p.id, { name: "P", payload: { text: "v1" } });
    vi.restoreAllMocks();
    expect(occupied.hits).toBeGreaterThan(0);
    expect(saved.payload).toEqual({ text: "v1" });
    expect(onDisk(p.manifest)).toMatchObject({ revision: 1, payload: { text: "v1" } });
    expect(onDisk(p.backup).payload).toEqual({ text: "v0" });
    await delay(400); // 后台补收（250ms 起）有机会跑完
    expect(fs.readdirSync(p.nomi).filter((name) => name.startsWith("manifest-transaction"))).toEqual([]);
  });

  it("单次保存（不重排）撞上占用：抛的是共享冲突（上层会重排），不是「锁丢了」；自己建的锁目录随后被收掉", async () => {
    const p = project();
    const deps = { settingsRoot, defaultProjectsRoot: projectsRoot };
    const occupied = occupy(100);
    occupyOwnerReads(p, 3, occupied);
    const result = await outcome(() => saveWorkspaceProject(p.id, { payload: { text: "v1" } }, deps));
    expect(result.ok).toBe(false);
    const error = (result as { error: unknown }).error;
    expect(isSharingViolation(error)).toBe(true);
    expect((error as Error).name).not.toBe("WorkspaceManifestLockLostError");
    expect(onDisk(p.manifest).revision).toBe(0);
    await delay(400);
    vi.restoreAllMocks();
    expect(fs.readdirSync(p.nomi).filter((name) => name.startsWith("manifest-transaction"))).toEqual([]);
  });
});

describe("提交只做一次：提交后的步骤撞上占用，不回头重新提交，备份仍是上一版", () => {
  it("同步基线写入被占用 300ms：保存成功，修订号只 +1，备份是上一版；基线随后在后台补上", async () => {
    const p = project();
    const occupied = occupy(300);
    occupyRenamesTo((target) => target.startsWith(settingsRoot) && target.includes("sync-baseline"), occupied);
    const saved = await saveProject(p.id, { name: "P", payload: { text: "v1" } });
    expect(saved.revision).toBe(1);
    expect(onDisk(p.manifest)).toMatchObject({ revision: 1, payload: { text: "v1" } });
    expect(onDisk(p.backup)).toMatchObject({ revision: 0, payload: { text: "v0" } });
    await settleWorkspacePostCommitWrites();
    expect(occupied.hits).toBeGreaterThan(0);
    expect(readWorkspaceSyncBaseline(settingsRoot, p.id, p.rootPath)?.revision).toBe(1);
  });

  it("设置目录持续占用超过 60 秒：保存照样立即成功、只提交一次，备份是上一版；后台补写放弃时只记日志", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const p = project();
    const occupied = occupy(Infinity);
    occupyRenamesTo((target) => target.startsWith(settingsRoot), occupied);
    const saved = await saveProject(p.id, { name: "Renamed", payload: { text: "v1" } }); // 改名 → 注册表也要写
    expect(saved.revision).toBe(1);
    await vi.advanceTimersByTimeAsync(61_000);
    await settleWorkspacePostCommitWrites();
    expect(occupied.hits).toBeGreaterThan(10);
    expect(onDisk(p.manifest)).toMatchObject({ revision: 1, payload: { text: "v1" } });
    expect(onDisk(p.backup)).toMatchObject({ revision: 0, payload: { text: "v0" } });
    // 下一次保存补上注册表和基线
    occupied.release();
    vi.useRealTimers();
    await saveProject(p.id, { name: "Renamed", payload: { text: "v2" } });
    await settleWorkspacePostCommitWrites();
    expect((findRecentWorkspace(settingsRoot, p.id) as { name: string }).name).toBe("Renamed");
    expect(readWorkspaceSyncBaseline(settingsRoot, p.id, p.rootPath)?.revision).toBe(2);
  });
});

describe("旧快照不许盖掉别人的写入：重排前核修订号", () => {
  const projectFile = (p: ReturnType<typeof project>) => (target: string) => target.startsWith(p.nomi) && /project(\.backup)?\.json$/.test(target);

  it("两份整份快照在占用期间先后发起：只有一份存上，另一份明说被抢先（不回「写上了」之后内容消失）", async () => {
    const p = project();
    const occupied = occupy(1000);
    occupyRenamesTo(projectFile(p), occupied);
    const renderer = outcome(() => saveProject(p.id, { name: "P", payload: { text: "renderer-stale-snapshot" } }));
    await delay(300);
    const agent = outcome(() => saveProject(p.id, { name: "P", payload: { text: "agent-write" } }));
    const results = { renderer: await renderer, agent: await agent };
    vi.restoreAllMocks();
    const ok = Object.entries(results).filter(([, result]) => result.ok);
    expect(ok).toHaveLength(1);
    const [winner] = ok[0];
    expect(onDisk(p.manifest)).toMatchObject({ revision: 1, payload: { text: winner === "renderer" ? "renderer-stale-snapshot" : "agent-write" } });
    const loser = Object.values(results).find((result) => !result.ok) as { error: unknown };
    expect(loser.error).toBeInstanceOf(ProjectSaveSupersededError);
    // 渲染层分得清：走现有的「项目正被别处占用」那一类失败，不是「没权限」或通用失败。
    expect(projectSaveFailure(loser.error, "save-project").kind).toBe("workspace-busy");
  });

  it("占用期间别的进程写上了：渲染层重排时不覆盖，盘上留的是别人的内容", async () => {
    const p = project();
    const occupied = occupy(Infinity);
    occupyRenamesTo(projectFile(p), occupied);
    const renderer = outcome(() => saveProject(p.id, { name: "P", payload: { text: "renderer-stale-snapshot" } }));
    await delay(200);
    externalWrite(p.manifest, (record) => { record.payload = { text: "written-by-agent" }; });
    occupied.release();
    const result = await renderer;
    expect(result.ok).toBe(false);
    expect((result as { error: unknown }).error).toBeInstanceOf(ProjectSaveSupersededError);
    expect(onDisk(p.manifest)).toMatchObject({ revision: 1, payload: { text: "written-by-agent" } });
  });
});

describe("主进程「读 → 改 → 写」：重排单位包含「读」，每次都拿盘上最新的一份再改", () => {
  const canvas = (nodes: Array<Record<string, unknown>>) => ({ generationCanvas: { nodes, edges: [], groups: [] } });
  const projectFile = (p: ReturnType<typeof project>) => (target: string) => target.startsWith(p.nomi) && /project(\.backup)?\.json$/.test(target);

  it("生成结果落盘（applyCanvasNodePatch）占用期间别人加了一张卡：补丁打在最新的一份上，两边都留着", async () => {
    const p = project(canvas([{ id: "n1", title: "old" }]));
    const occupied = occupy(Infinity);
    occupyRenamesTo(projectFile(p), occupied);
    const patch = applyCanvasNodePatch({ projectId: p.id, nodeId: "n1", patch: { title: "generated" } });
    await delay(200);
    externalWrite(p.manifest, (record) => {
      const payload = record.payload as { generationCanvas: { nodes: unknown[] } };
      payload.generationCanvas.nodes.push({ id: "n2", title: "added-meanwhile" });
    });
    occupied.release();
    expect(await patch).toEqual({ applied: true });
    const nodes = (onDisk(p.manifest).payload.generationCanvas as { nodes: Array<{ id: string; title: string }> }).nodes;
    expect(nodes.map((node) => [node.id, node.title])).toEqual([["n1", "generated"], ["n2", "added-meanwhile"]]);
    expect(onDisk(p.manifest).revision).toBe(2);
  });

  it("占用期间节点被删了：回执 applied:false（和现在一样），不把删掉的节点写回去", async () => {
    const p = project(canvas([{ id: "n1", title: "old" }, { id: "n2", title: "keep" }]));
    const occupied = occupy(Infinity);
    occupyRenamesTo(projectFile(p), occupied);
    const patch = applyCanvasNodePatch({ projectId: p.id, nodeId: "n1", patch: { title: "generated" } });
    await delay(200);
    externalWrite(p.manifest, (record) => {
      const payload = record.payload as { generationCanvas: { nodes: Array<{ id: string }> } };
      payload.generationCanvas.nodes = payload.generationCanvas.nodes.filter((node) => node.id !== "n1");
    });
    occupied.release();
    expect(await patch).toEqual({ applied: false });
    const nodes = (onDisk(p.manifest).payload.generationCanvas as { nodes: Array<{ id: string }> }).nodes;
    expect(nodes.map((node) => node.id)).toEqual(["n2"]);
    expect(onDisk(p.manifest).revision).toBe(1);
  });

  it("Agent / MCP 写画布（磁盘网关）占用期间别人改了画布：按最新的一份合并，别人的改动留着", async () => {
    const p = project(canvas([{ id: "n1", kind: "image", title: "A" }]));
    const gateway = createDiskGateway(p.id);
    const base = await gateway.readDoc();
    const next = { ...base, nodes: [...base.nodes, { ...base.nodes[0], id: "agent-node", title: "from-agent" }] };
    const occupied = occupy(Infinity);
    occupyRenamesTo(projectFile(p), occupied);
    const apply = gateway.apply(next as never, base);
    await delay(200);
    externalWrite(p.manifest, (record) => {
      const payload = record.payload as { generationCanvas: { nodes: unknown[] } };
      payload.generationCanvas.nodes.push({ id: "n3", kind: "image", title: "added-meanwhile" });
    });
    occupied.release();
    await apply;
    const ids = (onDisk(p.manifest).payload.generationCanvas as { nodes: Array<{ id: string }> }).nodes.map((node) => node.id);
    expect(ids).toEqual(expect.arrayContaining(["n1", "agent-node", "n3"]));
  });

  it("磁盘网关：项目在占用期间没了 → 照现在一样报「项目不存在」，不凭空写回", async () => {
    const p = project(canvas([{ id: "n1", kind: "image", title: "A" }]));
    const gateway = createDiskGateway(p.id);
    const base = await gateway.readDoc();
    const occupied = occupy(Infinity);
    occupyRenamesTo(projectFile(p), occupied);
    const apply = outcome(() => gateway.apply(base as never, base));
    await delay(200);
    externalWrite(p.manifest, (record) => { record.id = "someone-else"; });
    occupied.release();
    const result = await apply;
    expect(result.ok).toBe(false);
    expect(String((result as { error: Error }).error.message)).toMatch(/项目不存在|not found/);
    expect(readProject(p.id)).toBeNull();
  });

  const docs = (text: string) => ({
    workbenchDocuments: [{ id: "doc-1", contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } }],
    activeDocumentId: "doc-1",
  });
  const docText = (file: string) => {
    const documents = onDisk(file).payload.workbenchDocuments as Array<{ contentJson: { content: Array<{ content?: Array<{ text: string }> }> } }>;
    return documents[0]?.contentJson.content.map((paragraph) => paragraph.content?.[0]?.text ?? "").join("\n");
  };

  it("MCP 写文稿（追加）占用期间别人也追加了一行：追加在最新的文稿后面，回执里的指纹对应最终文字", async () => {
    const p = project(docs("first"));
    const occupied = occupy(Infinity);
    occupyRenamesTo(projectFile(p), occupied);
    const write = writeProjectDocument(p.id, "doc-1", "append", "from-mcp");
    await delay(200);
    externalWrite(p.manifest, (record) => {
      (record.payload as Record<string, unknown>).workbenchDocuments = docs("first\nmeanwhile").workbenchDocuments;
    });
    occupied.release();
    const receipt = await write;
    expect(docText(p.manifest)).toBe("first\nmeanwhile\nfrom-mcp");
    expect(Object.keys(receipt).sort()).toEqual(["applied", "contentHash", "revision"]);
    expect(receipt).toMatchObject({ applied: true, revision: 2 });
  });

  it("MCP 写文稿：文稿在占用期间被删光 → 照现在一样报 document_not_found，不把删掉的文稿写回去", async () => {
    const p = project(docs("first"));
    const occupied = occupy(Infinity);
    occupyRenamesTo(projectFile(p), occupied);
    const write = outcome(() => writeProjectDocument(p.id, "doc-1", "append", "from-mcp"));
    await delay(200);
    externalWrite(p.manifest, (record) => { (record.payload as Record<string, unknown>).workbenchDocuments = []; });
    occupied.release();
    const result = await write;
    expect(result.ok).toBe(false);
    expect((result as { error: { code?: string } }).error.code).toBe("document_not_found");
    expect(onDisk(p.manifest).payload.workbenchDocuments).toEqual([]);
  });

  it("updateProject 的回调每次重排都会再调一次，拿到的是盘上最新的修订号", async () => {
    const p = project();
    const occupied = occupy(Infinity);
    occupyRenamesTo(projectFile(p), occupied);
    const seen: Array<number | undefined> = [];
    const update = updateProject(p.id, (latest) => {
      seen.push(latest?.revision);
      return { next: { ...latest, payload: { text: "updated" } }, result: null };
    });
    await delay(200);
    externalWrite(p.manifest, () => undefined);
    occupied.release();
    await update;
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    expect(onDisk(p.manifest).revision).toBe(2);
  });
});

describe("保存之外：显式没要「不睡」的调用方不受影响", () => {
  it("saveWithSharingRetry 对不是共享冲突的错立刻抛（被抢先不重排）", async () => {
    let calls = 0;
    await expect(saveWithSharingRetry(async () => { calls += 1; throw new ProjectSaveSupersededError(0, 1); })).rejects.toBeInstanceOf(ProjectSaveSupersededError);
    expect(calls).toBe(1);
  });
});
