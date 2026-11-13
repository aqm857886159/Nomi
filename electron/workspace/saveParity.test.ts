// 保存对外行为对照（设计卡 docs/plan/2026-11-13-save-hotpath-safe-subset.md ★9）：同一批输入跑真 saveWorkspaceProject，
// 把「盘上文件集合 + 每个文件内容、修订号、备份、回执、错误类型和文字、同步等待档位」压成一份指纹，和 origin/main
// （e45202755）上录下的那份逐字比。任何一处不同都红——这份测试只许在「有意改保存行为、并写明等价或已获批」时更新。
// 故障按「项目目录 / 设置目录 + 哪种 fs 调用 + 第几次」注入（同 saveFaultSweep 的写法）；原地睡用假时钟跳过、只记请求的毫秒数。
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDurabilityMode, setDurabilityMode } from "../durability";
import { projectSaveFailure } from "../shared/contracts/projectSaveFailure";
import { createWorkspaceProject, saveWorkspaceProject } from "./workspaceRepository";
import { workspaceProjectFile } from "./workspacePaths";

type Operation = "read" | "rename" | "write";
type Fault = Readonly<{
  operation: Operation;
  /** 只对这个文件名（basename）注入；不给 = 项目目录里这种操作都算。 */
  file?: string;
  /** 只在这个文件名第一次被改名「之后」才注入（「刚写下的文件被杀毒开着」）。 */
  afterRenameOf?: string;
  code: string;
  /** 持续多久（假时钟毫秒，从第一次注入起）；Infinity = 一直占着。 */
  holdMs: number;
}>;

const native = {
  readFileSync: fs.readFileSync.bind(fs),
  renameSync: fs.renameSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
  rmSync: fs.rmSync.bind(fs),
};
const roots: string[] = [];
const previousDurability = getDurabilityMode();

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setDurabilityMode(previousDurability);
  for (const root of roots.splice(0)) native.rmSync(root, { recursive: true, force: true });
});

const sha256 = (bytes: Buffer | string): string => crypto.createHash("sha256").update(bytes).digest("hex");

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else out.push(file);
    }
  };
  walk(root);
  return out.sort();
}

async function runSave(fault?: Fault) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
  setDurabilityMode("durable");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-save-parity-")));
  roots.push(root);
  const deps = { settingsRoot: path.join(root, "settings"), defaultProjectsRoot: path.join(root, "projects") };
  fs.mkdirSync(deps.settingsRoot);
  const projectRoot = path.join(deps.defaultProjectsRoot, "project");
  const created = createWorkspaceProject({ rootPath: projectRoot, record: { name: "Parity", payload: { text: "before" } } }, deps);
  const manifest = workspaceProjectFile(projectRoot);
  // 不随机的那一份指纹：把这次跑出来的随机身份、根路径换成占位。
  const before = JSON.parse(native.readFileSync(manifest, "utf8")) as { id: string; immutableProjectUuid?: string };
  const normalize = (text: string): string => {
    let out = text.split(root).join("<root>");
    for (const [value, label] of [[before.id, "<id>"], [before.immutableProjectUuid ?? "", "<uuid>"]] as const) {
      if (value) out = out.split(value).join(label);
    }
    return out.replace(/[a-f0-9]{64}/g, "<sha256>").replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, "<rand>");
  };

  const sleeps: number[] = [];
  const injectedAt: string[] = [];
  const renamed = new Set<string>();
  let firstInjectAt: number | null = null;
  let active = true;
  const inProject = (file: unknown): boolean => String(file).startsWith(projectRoot + path.sep);
  const maybeFail = (operation: Operation, file: unknown): void => {
    if (!active || !fault || fault.operation !== operation || !inProject(file)) return;
    const name = path.basename(String(file));
    if (fault.file && name !== fault.file) return;
    if (fault.afterRenameOf && !renamed.has(fault.afterRenameOf)) return;
    firstInjectAt ??= Date.now();
    if (Date.now() - firstInjectAt >= fault.holdMs) return;
    injectedAt.push(`${operation} ${name}`);
    throw Object.assign(new Error(`injected ${fault.code} ${operation}`), { code: fault.code, syscall: operation === "read" ? "open" : operation });
  };
  vi.spyOn(Atomics, "wait").mockImplementation((_array, _index, _value, timeout) => {
    const ms = Number(timeout);
    if (active) sleeps.push(ms);
    vi.setSystemTime(Date.now() + ms);
    return "timed-out";
  });
  vi.spyOn(fs, "fsyncSync").mockImplementation(() => undefined);
  vi.spyOn(fs, "readFileSync").mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
    maybeFail("read", args[0]);
    return native.readFileSync(...args);
  }) as typeof fs.readFileSync);
  vi.spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
    // 写进 fd 的那一次：按 fd 打开时的临时文件名认不出来，只在给了 file 的故障里按「下一个改名目标」间接注入，这里不认 fd。
    if (typeof args[0] !== "number") maybeFail("write", args[0]);
    return native.writeFileSync(...args);
  });
  vi.spyOn(fs, "renameSync").mockImplementation((...args: Parameters<typeof fs.renameSync>) => {
    maybeFail("rename", args[1]);
    native.renameSync(...args);
    if (inProject(args[1])) renamed.add(path.basename(String(args[1])));
  });

  let error: unknown;
  let saved: unknown;
  const startedAt = Date.now();
  const pending = saveWorkspaceProject(created.id, { payload: { text: "after" } }, deps).then(
    (value) => { saved = value; },
    (reason: unknown) => { error = reason; },
  );
  await vi.runAllTimersAsync();
  await pending;
  const elapsedMs = Date.now() - startedAt;
  active = false;
  vi.restoreAllMocks();

  const files = Object.fromEntries(
    [...listFiles(projectRoot), ...listFiles(deps.settingsRoot)].map((file) => [normalize(path.relative(root, file)), normalize(native.readFileSync(file, "utf8"))]),
  );
  const manifestNow = JSON.parse(native.readFileSync(manifest, "utf8")) as { revision: number };
  const baselineFile = path.join(deps.settingsRoot, "workspace-sync-baseline.json");
  const baseline = fs.existsSync(baselineFile)
    ? (JSON.parse(native.readFileSync(baselineFile, "utf8")) as { projects: Record<string, { revision: number; contentHash: string }> }).projects[created.id]
    : undefined;
  const e = error as { name?: string; code?: string; message?: string } | undefined;
  return {
    files,
    revision: manifestNow.revision,
    baseline: baseline ? { revision: baseline.revision, hashMatchesManifest: baseline.contentHash === sha256(native.readFileSync(manifest)) } : null,
    receipt: saved ? normalize(JSON.stringify(saved)) : null,
    error: e ? { name: e.name, code: e.code ?? null, message: normalize(String(e.message)), ipc: projectSaveFailure(error, "save-project") } : null,
    syncWait: { sleeps, totalMs: sleeps.reduce((sum, ms) => sum + ms, 0), elapsedMs },
    injectedAt,
  };
}

describe("保存对外行为对照（和 origin/main 录下的指纹逐字相同）", () => {
  it("保存成功", async () => {
    expect(await runSave()).toMatchInlineSnapshot(`
      {
        "baseline": {
          "hashMatchesManifest": true,
          "revision": 1,
        },
        "error": null,
        "files": {
          "projects/project/.nomi/project.backup.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "projects/project/.nomi/project.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 1,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "after"
        }
      }
      ",
          "settings/recent-workspaces.json": "[
        {
          "id": "<id>",
          "name": "Parity",
          "rootPath": "<root>/projects/project",
          "lastOpenedAt": 1794528000000,
          "missing": false,
          "source": "native",
          "nativeRootPath": "<root>/projects"
        }
      ]
      ",
          "settings/workspace-sync-baseline.json": "{
        "schemaVersion": 1,
        "projects": {
          "<id>": {
            "rootPath": "<root>/projects/project",
            "revision": 1,
            "contentHash": "<sha256>"
          }
        }
      }
      ",
        },
        "injectedAt": [],
        "receipt": "{"id":"<id>","name":"Parity","version":2,"createdAt":1794528000000,"updatedAt":1794528000000,"savedAt":1794528000000,"revision":1,"immutableProjectUuid":"<uuid>","projectGeneration":1,"lastKnownRootPath":"<root>/projects/project","payload":{"text":"after"}}",
        "revision": 1,
        "syncWait": {
          "elapsedMs": 0,
          "sleeps": [],
          "totalMs": 0,
        },
      }
    `);
  });

  it("项目目录改名被占 300ms 后成功", async () => {
    expect(await runSave({ operation: "rename", code: "EBUSY", holdMs: 300 })).toMatchInlineSnapshot(`
      {
        "baseline": {
          "hashMatchesManifest": true,
          "revision": 1,
        },
        "error": null,
        "files": {
          "projects/project/.nomi/project.backup.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "projects/project/.nomi/project.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000400,
        "savedAt": 1794528000400,
        "revision": 1,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "after"
        }
      }
      ",
          "settings/recent-workspaces.json": "[
        {
          "id": "<id>",
          "name": "Parity",
          "rootPath": "<root>/projects/project",
          "lastOpenedAt": 1794528000400,
          "missing": false,
          "source": "native",
          "nativeRootPath": "<root>/projects"
        }
      ]
      ",
          "settings/workspace-sync-baseline.json": "{
        "schemaVersion": 1,
        "projects": {
          "<id>": {
            "rootPath": "<root>/projects/project",
            "revision": 1,
            "contentHash": "<sha256>"
          }
        }
      }
      ",
        },
        "injectedAt": [
          "rename owner.json",
          "rename owner.json",
          "rename owner.json",
          "rename owner.json",
          "rename owner.json",
        ],
        "receipt": "{"id":"<id>","name":"Parity","version":2,"createdAt":1794528000000,"updatedAt":1794528000400,"savedAt":1794528000400,"revision":1,"immutableProjectUuid":"<uuid>","projectGeneration":1,"lastKnownRootPath":"<root>/projects/project","payload":{"text":"after"}}",
        "revision": 1,
        "syncWait": {
          "elapsedMs": 400,
          "sleeps": [
            10,
            30,
            60,
            100,
            200,
          ],
          "totalMs": 400,
        },
      }
    `);
  });

  it("项目目录改名一直被占：失败", async () => {
    expect(await runSave({ operation: "rename", code: "EBUSY", holdMs: Infinity })).toMatchInlineSnapshot(`
      {
        "baseline": {
          "hashMatchesManifest": true,
          "revision": 0,
        },
        "error": {
          "code": "EBUSY",
          "ipc": {
            "code": "EBUSY",
            "errno": null,
            "kind": "in-use",
            "stage": "save-project",
            "syscall": "rename",
          },
          "message": "injected EBUSY rename",
          "name": "Error",
        },
        "files": {
          "projects/project/.nomi/project.backup.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "projects/project/.nomi/project.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "settings/recent-workspaces.json": "[
        {
          "id": "<id>",
          "name": "Parity",
          "rootPath": "<root>/projects/project",
          "lastOpenedAt": 1794528000000,
          "missing": false,
          "source": "native",
          "nativeRootPath": "<root>/projects"
        }
      ]
      ",
          "settings/workspace-sync-baseline.json": "{
        "schemaVersion": 1,
        "projects": {
          "<id>": {
            "rootPath": "<root>/projects/project",
            "revision": 0,
            "contentHash": "<sha256>"
          }
        }
      }
      ",
        },
        "injectedAt": [
          "rename owner.json",
          "rename owner.json",
          "rename owner.json",
          "rename owner.json",
          "rename owner.json",
          "rename owner.json",
        ],
        "receipt": null,
        "revision": 0,
        "syncWait": {
          "elapsedMs": 400,
          "sleeps": [
            10,
            30,
            60,
            100,
            200,
          ],
          "totalMs": 400,
        },
      }
    `);
  });

  it("保存到一半抛错：清单改名时磁盘满", async () => {
    expect(await runSave({ operation: "rename", file: "project.json", code: "ENOSPC", holdMs: Infinity })).toMatchInlineSnapshot(`
      {
        "baseline": {
          "hashMatchesManifest": true,
          "revision": 0,
        },
        "error": {
          "code": "ENOSPC",
          "ipc": {
            "code": "ENOSPC",
            "errno": null,
            "kind": "disk-full",
            "stage": "save-project",
            "syscall": "rename",
          },
          "message": "injected ENOSPC rename",
          "name": "Error",
        },
        "files": {
          "projects/project/.nomi/project.backup.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "projects/project/.nomi/project.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "settings/recent-workspaces.json": "[
        {
          "id": "<id>",
          "name": "Parity",
          "rootPath": "<root>/projects/project",
          "lastOpenedAt": 1794528000000,
          "missing": false,
          "source": "native",
          "nativeRootPath": "<root>/projects"
        }
      ]
      ",
          "settings/workspace-sync-baseline.json": "{
        "schemaVersion": 1,
        "projects": {
          "<id>": {
            "rootPath": "<root>/projects/project",
            "revision": 0,
            "contentHash": "<sha256>"
          }
        }
      }
      ",
        },
        "injectedAt": [
          "rename project.json",
        ],
        "receipt": null,
        "revision": 0,
        "syncWait": {
          "elapsedMs": 0,
          "sleeps": [],
          "totalMs": 0,
        },
      }
    `);
  });

  it("刚写下的清单被杀毒开着读不了（读回 / 求指纹那一次）", async () => {
    expect(await runSave({ operation: "read", file: "project.json", afterRenameOf: "project.json", code: "EBUSY", holdMs: Infinity })).toMatchInlineSnapshot(`
      {
        "baseline": {
          "hashMatchesManifest": false,
          "revision": 0,
        },
        "error": {
          "code": "EBUSY",
          "ipc": {
            "code": "EBUSY",
            "errno": null,
            "kind": "in-use",
            "stage": "save-project",
            "syscall": "open",
          },
          "message": "injected EBUSY read",
          "name": "Error",
        },
        "files": {
          "projects/project/.nomi/project.backup.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "projects/project/.nomi/project.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 1,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "after"
        }
      }
      ",
          "settings/recent-workspaces.json": "[
        {
          "id": "<id>",
          "name": "Parity",
          "rootPath": "<root>/projects/project",
          "lastOpenedAt": 1794528000000,
          "missing": false,
          "source": "native",
          "nativeRootPath": "<root>/projects"
        }
      ]
      ",
          "settings/workspace-sync-baseline.json": "{
        "schemaVersion": 1,
        "projects": {
          "<id>": {
            "rootPath": "<root>/projects/project",
            "revision": 0,
            "contentHash": "<sha256>"
          }
        }
      }
      ",
        },
        "injectedAt": [
          "read project.json",
        ],
        "receipt": null,
        "revision": 1,
        "syncWait": {
          "elapsedMs": 0,
          "sleeps": [],
          "totalMs": 0,
        },
      }
    `);
  });

  it("清单改名被占 300ms 后成功", async () => {
    expect(await runSave({ operation: "rename", file: "project.json", code: "EPERM", holdMs: 300 })).toMatchInlineSnapshot(`
      {
        "baseline": {
          "hashMatchesManifest": true,
          "revision": 1,
        },
        "error": null,
        "files": {
          "projects/project/.nomi/project.backup.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "projects/project/.nomi/project.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 1,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "after"
        }
      }
      ",
          "settings/recent-workspaces.json": "[
        {
          "id": "<id>",
          "name": "Parity",
          "rootPath": "<root>/projects/project",
          "lastOpenedAt": 1794528000400,
          "missing": false,
          "source": "native",
          "nativeRootPath": "<root>/projects"
        }
      ]
      ",
          "settings/workspace-sync-baseline.json": "{
        "schemaVersion": 1,
        "projects": {
          "<id>": {
            "rootPath": "<root>/projects/project",
            "revision": 1,
            "contentHash": "<sha256>"
          }
        }
      }
      ",
        },
        "injectedAt": [
          "rename project.json",
          "rename project.json",
          "rename project.json",
          "rename project.json",
          "rename project.json",
        ],
        "receipt": "{"id":"<id>","name":"Parity","version":2,"createdAt":1794528000000,"updatedAt":1794528000000,"savedAt":1794528000000,"revision":1,"immutableProjectUuid":"<uuid>","projectGeneration":1,"lastKnownRootPath":"<root>/projects/project","payload":{"text":"after"}}",
        "revision": 1,
        "syncWait": {
          "elapsedMs": 400,
          "sleeps": [
            10,
            30,
            60,
            100,
            200,
          ],
          "totalMs": 400,
        },
      }
    `);
  });

  it("清单改名一直被占：失败（备份已写）", async () => {
    expect(await runSave({ operation: "rename", file: "project.json", code: "EPERM", holdMs: Infinity })).toMatchInlineSnapshot(`
      {
        "baseline": {
          "hashMatchesManifest": true,
          "revision": 0,
        },
        "error": {
          "code": "EPERM",
          "ipc": {
            "code": "EPERM",
            "errno": null,
            "kind": "write-denied",
            "stage": "save-project",
            "syscall": "rename",
          },
          "message": "injected EPERM rename",
          "name": "Error",
        },
        "files": {
          "projects/project/.nomi/project.backup.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "projects/project/.nomi/project.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "settings/recent-workspaces.json": "[
        {
          "id": "<id>",
          "name": "Parity",
          "rootPath": "<root>/projects/project",
          "lastOpenedAt": 1794528000000,
          "missing": false,
          "source": "native",
          "nativeRootPath": "<root>/projects"
        }
      ]
      ",
          "settings/workspace-sync-baseline.json": "{
        "schemaVersion": 1,
        "projects": {
          "<id>": {
            "rootPath": "<root>/projects/project",
            "revision": 0,
            "contentHash": "<sha256>"
          }
        }
      }
      ",
        },
        "injectedAt": [
          "rename project.json",
          "rename project.json",
          "rename project.json",
          "rename project.json",
          "rename project.json",
          "rename project.json",
        ],
        "receipt": null,
        "revision": 0,
        "syncWait": {
          "elapsedMs": 400,
          "sleeps": [
            10,
            30,
            60,
            100,
            200,
          ],
          "totalMs": 400,
        },
      }
    `);
  });

  it("刚写下的备份被杀毒开着读不了", async () => {
    expect(await runSave({ operation: "read", file: "project.backup.json", afterRenameOf: "project.backup.json", code: "EBUSY", holdMs: Infinity })).toMatchInlineSnapshot(`
      {
        "baseline": {
          "hashMatchesManifest": true,
          "revision": 0,
        },
        "error": {
          "code": "EBUSY",
          "ipc": {
            "code": "EBUSY",
            "errno": null,
            "kind": "in-use",
            "stage": "save-project",
            "syscall": "open",
          },
          "message": "injected EBUSY read",
          "name": "Error",
        },
        "files": {
          "projects/project/.nomi/project.backup.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "projects/project/.nomi/project.json": "{
        "id": "<id>",
        "name": "Parity",
        "version": 2,
        "createdAt": 1794528000000,
        "updatedAt": 1794528000000,
        "savedAt": 1794528000000,
        "revision": 0,
        "immutableProjectUuid": "<uuid>",
        "projectGeneration": 1,
        "lastKnownRootPath": "<root>/projects/project",
        "payload": {
          "text": "before"
        }
      }
      ",
          "settings/recent-workspaces.json": "[
        {
          "id": "<id>",
          "name": "Parity",
          "rootPath": "<root>/projects/project",
          "lastOpenedAt": 1794528000000,
          "missing": false,
          "source": "native",
          "nativeRootPath": "<root>/projects"
        }
      ]
      ",
          "settings/workspace-sync-baseline.json": "{
        "schemaVersion": 1,
        "projects": {
          "<id>": {
            "rootPath": "<root>/projects/project",
            "revision": 0,
            "contentHash": "<sha256>"
          }
        }
      }
      ",
        },
        "injectedAt": [
          "read project.backup.json",
        ],
        "receipt": null,
        "revision": 0,
        "syncWait": {
          "elapsedMs": 0,
          "sleeps": [],
          "totalMs": 0,
        },
      }
    `);
  });
});
