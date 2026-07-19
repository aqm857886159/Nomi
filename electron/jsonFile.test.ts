import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readJsonFile, renameSyncWithRetry, writeJsonFileAtomic } from "./jsonFile";

const tempRoots: string[] = [];

afterEach(() => {
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
});

describe("renameSyncWithRetry（Windows EPERM 文件锁重试，2026-07-17 模型启停连点撞锁根因）", () => {
  afterEach(() => vi.restoreAllMocks());

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

  it("非锁类错误（如 ENOENT）不重试、立刻抛", () => {
    let calls = 0;
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      calls += 1;
      const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });
    expect(() => renameSyncWithRetry("missing", "b")).toThrow(/ENOENT/);
    expect(calls).toBe(1);
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
