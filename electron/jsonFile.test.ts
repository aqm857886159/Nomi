import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readJsonFile, renameSyncOnce, renameSyncWithRetry, renameWithRetry, writeJsonFileAtomic } from "./jsonFile";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-json-file-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("writeJsonFileAtomic", () => {
  it("writes pretty JSON with a trailing newline that reads back equal", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "project.json");
    const value = { id: "p1", name: "My Film", revision: 4 };

    writeJsonFileAtomic(file, value);

    expect(readJsonFile(file)).toEqual(value);
    expect(fs.readFileSync(file, "utf8")).toBe(`${JSON.stringify(value, null, 2)}\n`);
  });

  it("creates missing parent directories", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "nested", "deep", "project.json");

    writeJsonFileAtomic(file, { ok: true });

    expect(readJsonFile(file)).toEqual({ ok: true });
  });

  it("overwrites an existing file in place", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "project.json");

    writeJsonFileAtomic(file, { revision: 1 });
    writeJsonFileAtomic(file, { revision: 2 });

    expect(readJsonFile(file)).toEqual({ revision: 2 });
  });

  it("leaves no temp files behind after a successful write", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "project.json");

    writeJsonFileAtomic(file, { a: 1 });
    writeJsonFileAtomic(file, { a: 2 });

    const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual(["project.json"]);
  });

  it("preserves the previous file and removes staging if publication fails", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "project.json");
    const previous = '{"revision":1}';
    fs.writeFileSync(file, previous);
    const error = Object.assign(new Error("rename failed"), { code: "EIO" });
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw error; });

    expect(() => writeJsonFileAtomic(file, { revision: 2 })).toThrow(error);
    expect(fs.readFileSync(file, "utf8")).toBe(previous);
    expect(fs.readdirSync(dir)).toEqual(["project.json"]);
  });
});

describe("renameSyncWithRetry（Windows EPERM 文件锁重试，2026-07-17 模型启停连点撞锁根因）", () => {
  function epermError(): NodeJS.ErrnoException {
    const err = new Error("EPERM: operation not permitted, rename") as NodeJS.ErrnoException;
    err.code = "EPERM";
    return err;
  }

  it("EPERM 短暂持锁 → 退避重试后成功（用户不再看到「操作失败」）", () => {
    const dir = makeTempDir();
    const from = path.join(dir, "a.tmp");
    const to = path.join(dir, "target.json");
    fs.writeFileSync(from, "{}", "utf8");
    const real = fs.renameSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      calls += 1;
      if (calls <= 2) throw epermError(); // 模拟杀毒/索引器持锁两拍
      return real(...(args as [fs.PathLike, fs.PathLike]));
    });

    renameSyncWithRetry(from, to);

    expect(calls).toBe(3);
    expect(fs.existsSync(to)).toBe(true);
  });

  it("持锁不放（超过重试预算）→ 如实抛出原错误", () => {
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw epermError();
    });
    expect(() => renameSyncWithRetry("a", "b")).toThrow(/EPERM/);
  });

  it("writeJsonFileAtomic 经由重试路径：EPERM 一拍后仍完成写入", () => {
    const dir = makeTempDir();
    const file = path.join(dir, "model-catalog.json");
    const real = fs.renameSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
      calls += 1;
      if (calls === 1) throw epermError();
      return real(...(args as [fs.PathLike, fs.PathLike]));
    });

    writeJsonFileAtomic(file, { enabled: false });

    expect(readJsonFile(file)).toEqual({ enabled: false });
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

it.each(["EEXIST", "ENOTEMPTY", "ENOENT", "EXDEV"])("preserves %s without retrying either rename API", async (code) => {
  const error = Object.assign(new Error(code), { code });
  const sync = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw error; });
  const asyncRename = vi.spyOn(fs.promises, "rename").mockRejectedValue(error);
  const wait = vi.fn(async () => {});
  const delayMs = vi.fn(() => 10);

  expect(() => renameSyncWithRetry("from", "to")).toThrow(error);
  expect(sync).toHaveBeenCalledTimes(1);
  await expect(renameWithRetry("from", "to", { delayMs, wait })).rejects.toBe(error);
  expect(asyncRename).toHaveBeenCalledTimes(1);
  expect(delayMs).not.toHaveBeenCalled();
  expect(wait).not.toHaveBeenCalled();
});

it("offers a single sync attempt when the caller owns the retry", () => {
  const error = Object.assign(new Error("sharing violation"), { code: "EPERM" });
  const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw error; });

  expect(() => renameSyncOnce("from", "to")).toThrow(error);
  expect(rename).toHaveBeenCalledTimes(1);
});

it("publishes an existing staged file after sharing violations using the shared async backoff", async () => {
  const dir = makeTempDir();
  const from = path.join(dir, "staged.mp4");
  const to = path.join(dir, "output.mp4");
  fs.writeFileSync(from, "new output");
  fs.writeFileSync(to, "previous output");
  const rename = vi.spyOn(fs.promises, "rename")
    .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }))
    .mockRejectedValueOnce(Object.assign(new Error("access denied"), { code: "EACCES" }));
  const wait = vi.fn(async () => {});

  await renameWithRetry(from, to, { wait });

  expect(rename).toHaveBeenCalledTimes(3);
  expect(wait.mock.calls).toEqual([[10], [30]]);
  expect(fs.readFileSync(to, "utf8")).toBe("new output");
  expect(fs.existsSync(from)).toBe(false);
});
