import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { retryOnSharingViolation, renameSyncWithRetry } from "./jsonFile";
import { saveWithSharingRetry, SAVE_RETRY_BUDGET_MS, ProjectSaveInUseError } from "./projects/saveRetry";
import { projectSaveFailure } from "./shared/contracts/projectSaveFailure";
import {
  delaysFromTable,
  retryOnSharingViolationAsync,
  saveRetryDelayMs,
  SHARING_RETRY_LONG_DELAYS_MS,
} from "./sharingRetry";
import { bindWorkspaceLocation, REGISTRY_TOUCH_INTERVAL_MS } from "./workspace/workspaceRegistry";
import { createWorkspaceProject, saveWorkspaceProject } from "./workspace/workspaceRepository";

const dirs: string[] = [];
const tmp = (): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nomi-sharing-retry-")));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const errno = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(`injected ${code}`), { code, ...extra });
/** 「持续 ms 毫秒的占用」：从第一次调用起 ms 毫秒内抛 code，之后放行。 */
function occupiedFor(ms: number, code: string): () => void {
  let first: number | null = null;
  return () => {
    first ??= Date.now();
    if (Date.now() - first < ms) throw errno(code);
  };
}
async function maxLoopDelayMs<T>(work: () => Promise<T>): Promise<{ value: T; maxMs: number }> {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  try {
    const value = await work();
    return { value, maxMs: histogram.max / 1e6 };
  } finally {
    histogram.disable();
  }
}

describe("同步调用方（结构上只能同步的那几类）：持续 300ms 占用仍然最终成功，容忍没变差", () => {
  it.each(["EBUSY", "EPERM"])("retryOnSharingViolation 在 %s 持续 300ms 后成功", (code) => {
    const operation = occupiedFor(300, code);
    expect(retryOnSharingViolation(() => { operation(); return "ok"; })).toBe("ok");
  });

  it("renameSyncWithRetry 在 EPERM 持续 300ms 后成功", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "a"), "x");
    const blocked = occupiedFor(300, "EPERM");
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { blocked(); return rename(from, to); });
    renameSyncWithRetry(path.join(dir, "a"), path.join(dir, "b"));
    expect(fs.existsSync(path.join(dir, "b"))).toBe(true);
  });
});

describe("保存热路径（调用方显式传 noWait）：不原地睡", () => {
  it("同步助手立即再试一次就抛，不睡", () => {
    let calls = 0;
    const waitSpy = vi.spyOn(Atomics, "wait");
    expect(() => retryOnSharingViolation(() => { calls += 1; throw errno("EBUSY"); }, { noWait: true })).toThrow(/EBUSY/);
    expect(calls).toBe(2);
    expect(waitSpy).not.toHaveBeenCalled();
  });

  it("没传 noWait 的调用方照旧按表退避（保存之外的行为不变）", () => {
    let calls = 0;
    expect(() => retryOnSharingViolation(() => { calls += 1; throw errno("EBUSY"); })).toThrow(/EBUSY/);
    expect(calls).toBe(6);
  });

  it("注册表锁被别的进程占着且不陈旧：抛 EBUSY，不自旋；保存已累计等够陈旧期才夺", () => {
    const settings = tmp();
    const root = path.join(tmp(), "p");
    const binding = { id: "p1", name: "P", rootPath: root };
    fs.mkdirSync(root);
    const lockDir = path.join(settings, "recent-workspaces.json.lock");
    fs.mkdirSync(lockDir);
    const waitSpy = vi.spyOn(Atomics, "wait");
    expect(() => bindWorkspaceLocation(settings, binding, { noWait: { waitedMs: 0 } })).toThrow(expect.objectContaining({ code: "EBUSY" }));
    expect(waitSpy).not.toHaveBeenCalled();
    waitSpy.mockRestore();
    expect(bindWorkspaceLocation(settings, binding, { noWait: { waitedMs: 3_001 } })).toHaveLength(1);
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it("保存的退避表：50 → 100 → 200 → 400 → 800，之后每秒一次", () => {
    expect([0, 1, 2, 3, 4, 5, 30].map(saveRetryDelayMs)).toEqual([50, 100, 200, 400, 800, 1000, 1000]);
  });
});

describe("已在 async 函数里的调用方：同一个异步重试件，持续 300ms 占用后成功且不卡事件循环", () => {
  it.each(["EBUSY", "EPERM"])("%s 持续 300ms", async (code) => {
    const operation = occupiedFor(300, code);
    const { value, maxMs } = await maxLoopDelayMs(() => retryOnSharingViolationAsync(() => { operation(); return "ok"; }, { delayMs: delaysFromTable(SHARING_RETRY_LONG_DELAYS_MS) }));
    expect(value).toBe("ok");
    expect(maxMs).toBeLessThan(50);
  });

  it("回调返回的 Promise 被拒（异步改名）也接得住：前 2 次 EBUSY、第 3 次成功 → 成功，等的是表里前两档", async () => {
    const waits: number[] = [];
    let calls = 0;
    const value = await retryOnSharingViolationAsync(async () => {
      calls += 1;
      if (calls <= 2) throw errno("EBUSY");
      return "ok";
    }, { delayMs: delaysFromTable(SHARING_RETRY_LONG_DELAYS_MS), wait: async (ms) => { waits.push(ms); } });
    expect(value).toBe("ok");
    expect(calls).toBe(3);
    // 总等待 = 长表前两档之和（直接观测退避件请求的等待，不量墙钟）。
    expect(waits).toEqual(SHARING_RETRY_LONG_DELAYS_MS.slice(0, 2));
  });

  it("回调一直以 Promise 被拒：表用完后抛出的还是原来那个错误码", async () => {
    let calls = 0;
    await expect(retryOnSharingViolationAsync(() => { calls += 1; return Promise.reject(errno("EPERM", { syscall: "rename" })); }, {
      delayMs: delaysFromTable(SHARING_RETRY_LONG_DELAYS_MS), wait: async () => undefined,
    })).rejects.toMatchObject({ code: "EPERM", syscall: "rename" });
    expect(calls).toBe(SHARING_RETRY_LONG_DELAYS_MS.length + 1);
  });

  it("不是共享冲突的错立刻抛，预算用完如实抛最后一次的错", async () => {
    await expect(retryOnSharingViolationAsync(() => { throw errno("ENOENT"); })).rejects.toMatchObject({ code: "ENOENT" });
    let calls = 0;
    await expect(retryOnSharingViolationAsync(() => { calls += 1; throw errno("EBUSY"); }, { wait: async () => undefined })).rejects.toMatchObject({ code: "EBUSY" });
    expect(calls).toBe(6);
  });
});

describe("保存：提交前的占用用定时器重排", () => {
  it("整次保存：项目文件持续 2 秒被占用 → 之后保存成功，盘上是完整的新版，期间事件循环延迟 < 50ms", async () => {
    const root = tmp();
    const deps = { settingsRoot: path.join(root, "settings"), defaultProjectsRoot: path.join(root, "projects") };
    fs.mkdirSync(deps.settingsRoot);
    const projectRoot = path.join(deps.defaultProjectsRoot, "p");
    const created = createWorkspaceProject({ rootPath: projectRoot, record: { name: "P", payload: { text: "before" } } }, deps);
    const blocked = occupiedFor(2000, "EBUSY");
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).startsWith(projectRoot)) blocked();
      return rename(from, to);
    });
    const { value, maxMs } = await maxLoopDelayMs(() => saveWithSharingRetry(() => saveWorkspaceProject(created.id, { payload: { text: "after" } }, deps)));
    expect(value.payload).toEqual({ text: "after" });
    expect(maxMs).toBeLessThan(50);
    vi.restoreAllMocks();
    const onDisk = JSON.parse(fs.readFileSync(path.join(projectRoot, ".nomi", "project.json"), "utf8"));
    expect(onDisk.payload).toEqual({ text: "after" });
    expect(fs.readdirSync(path.join(projectRoot, ".nomi")).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("满 60 秒仍被占用：报「被占用」(in-use)，原错误码照带；总等待不超过预算", async () => {
    let clock = 0;
    const waits: number[] = [];
    const failure = saveWithSharingRetry(async () => { throw errno("EBUSY", { errno: -4082, syscall: "rename" }); }, {
      now: () => clock,
      wait: async (ms) => { waits.push(ms); clock += ms; },
    });
    await expect(failure).rejects.toBeInstanceOf(ProjectSaveInUseError);
    expect(waits.slice(0, 6)).toEqual([50, 100, 200, 400, 800, 1000]);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(SAVE_RETRY_BUDGET_MS);
    const reason = projectSaveFailure(await failure.catch((e: unknown) => e), "save-project");
    expect(reason).toMatchObject({ kind: "in-use", code: "EBUSY", errno: -4082, syscall: "rename" });
  });

  it("真没权限（EACCES 且目录本身不可写）：立刻报 write-denied，不等满 60 秒", async () => {
    const dir = tmp();
    const file = path.join(dir, "project.json");
    fs.chmodSync(dir, 0o555);
    try {
      // 假时钟：去掉「真没权限」判断时这里按断言红（等满预算后报 in-use），不靠真时间、也不会空转到内存耗尽。
      let clock = 0;
      const waits: number[] = [];
      const failure = saveWithSharingRetry(async () => { throw errno("EACCES", { path: file, syscall: "rename" }); }, {
        now: () => clock,
        wait: async (ms) => { waits.push(ms); clock += ms; },
      });
      const error = await failure.catch((e: unknown) => e);
      if (process.getuid?.() === 0) return; // root 不受目录权限限制
      expect(waits).toEqual([]);
      expect(projectSaveFailure(error, "save-project").kind).toBe("write-denied");
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });
});

describe("保存少写：注册表只在名字 / 位置 / 来源变了时写，最近打开时间最多每 60 秒一次", () => {
  const setup = () => {
    const settings = tmp();
    const root = path.join(tmp(), "p");
    fs.mkdirSync(root);
    const binding = { id: "p1", name: "P", rootPath: root };
    bindWorkspaceLocation(settings, binding);
    return { settings, binding, registry: path.join(settings, "recent-workspaces.json") };
  };

  it("什么都没变：不写（连锁都不取）", () => {
    const { settings, binding, registry } = setup();
    const before = fs.readFileSync(registry, "utf8");
    fs.mkdirSync(`${registry}.lock`); // 锁被占着也不会被碰：说明根本没去取锁
    const entries = bindWorkspaceLocation(settings, binding, { touchIntervalMs: REGISTRY_TOUCH_INTERVAL_MS });
    expect(entries).toHaveLength(1);
    expect(fs.readFileSync(registry, "utf8")).toBe(before);
  });

  it("改名后照写；最近打开时间过了 60 秒照写", () => {
    const { settings, binding, registry } = setup();
    const renamed = bindWorkspaceLocation(settings, { ...binding, name: "Renamed" }, { touchIntervalMs: REGISTRY_TOUCH_INTERVAL_MS });
    expect(renamed[0].name).toBe("Renamed");
    expect(JSON.parse(fs.readFileSync(registry, "utf8"))[0].name).toBe("Renamed");
    const entries = JSON.parse(fs.readFileSync(registry, "utf8"));
    entries[0].lastOpenedAt -= REGISTRY_TOUCH_INTERVAL_MS + 1;
    fs.writeFileSync(registry, JSON.stringify(entries));
    const stale = entries[0].lastOpenedAt;
    bindWorkspaceLocation(settings, { ...binding, name: "Renamed" }, { touchIntervalMs: REGISTRY_TOUCH_INTERVAL_MS });
    expect(JSON.parse(fs.readFileSync(registry, "utf8"))[0].lastOpenedAt).toBeGreaterThan(stale);
  });
});
