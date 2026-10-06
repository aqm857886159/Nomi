import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sameFileIdentity } from "./fileIdentity";

// 类级测试：「被换成另一个文件 / 另一个卷 / 符号链接 / 精度相邻的文件 ID」每一项都必须被拦住，
// 「同一个文件，按路径取和按句柄取」必须放行（含 Windows 旧 libuv 的 dev=0）。
// docs/fixes/2026-10-06-windows-legacy-file-identity.root-cause.json
const big = { bigint: true } as const;
let dir = "";
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-file-identity-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function fake(dev: bigint, ino: bigint): fs.BigIntStats { return { dev, ino } as fs.BigIntStats; }

describe("sameFileIdentity: real files", () => {
  it("accepts the same file by path and by handle", () => {
    const file = path.join(dir, "a.json"); fs.writeFileSync(file, "x");
    const fd = fs.openSync(file, "r");
    try { expect(sameFileIdentity(fs.lstatSync(file, big), fs.fstatSync(fd, big))).toBe(true); }
    finally { fs.closeSync(fd); }
  });
  it("rejects a different file, a file replaced after open, and a missing file", () => {
    const file = path.join(dir, "a.json"); const other = path.join(dir, "b.json");
    fs.writeFileSync(file, "x"); fs.writeFileSync(other, "y");
    const fd = fs.openSync(file, "r");
    try {
      const opened = fs.fstatSync(fd, big);
      expect(sameFileIdentity(opened, fs.lstatSync(other, big))).toBe(false);
      fs.rmSync(file); fs.renameSync(other, file);
      expect(sameFileIdentity(opened, fs.lstatSync(file, big))).toBe(false);
      expect(sameFileIdentity(opened, undefined)).toBe(false);
    } finally { fs.closeSync(fd); }
  });
  it("rejects a directory swapped for another directory", () => {
    const a = path.join(dir, "a"); const b = path.join(dir, "b"); fs.mkdirSync(a); fs.mkdirSync(b);
    const before = fs.lstatSync(a, big);
    fs.rmdirSync(a); fs.renameSync(b, a);
    expect(sameFileIdentity(before, fs.lstatSync(a, big))).toBe(false);
  });
  it("a symlink is a different identity from its target (skipped where unprivileged)", () => {
    const file = path.join(dir, "a.json"); const link = path.join(dir, "link"); fs.writeFileSync(file, "x");
    try { fs.symlinkSync(file, link); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return; throw error;
    }
    expect(sameFileIdentity(fs.lstatSync(file, big), fs.lstatSync(link, big))).toBe(false);
  });
});

describe("sameFileIdentity: reported values (table)", () => {
  const cases: Array<[string, fs.BigIntStats, fs.BigIntStats, boolean]> = [
    ["same dev and ino", fake(7n, 100n), fake(7n, 100n), true],
    ["old libuv Windows: path dev 0, handle dev real, same ino", fake(0n, 100n), fake(7n, 100n), true],
    ["old libuv Windows reversed", fake(7n, 100n), fake(0n, 100n), true],
    ["different ino with dev 0 (file replaced)", fake(0n, 100n), fake(7n, 101n), false],
    ["different ino, same dev", fake(7n, 100n), fake(7n, 101n), false],
    ["same ino on another real volume", fake(7n, 100n), fake(8n, 100n), false],
    ["NTFS ids adjacent above 2^53 (Number would collapse them)", fake(0n, 31525197392414520n), fake(7n, 31525197392414521n), false],
  ];
  it.each(cases)("%s", (_name, left, right, expected) => { expect(sameFileIdentity(left, right)).toBe(expected); });
  it("proves why bigint is mandatory: Number() collapses the adjacent ids", () => {
    expect(Number(31525197392414520n) === Number(31525197392414521n)).toBe(true);
  });
});

describe("class guard: no other module compares dev/ino by hand", () => {
  it("only electron/fileIdentity.ts mentions .ino comparisons in electron/**", () => {
    const root = path.resolve(__dirname);
    const offenders: string[] = [];
    const walk = (current: string): void => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue; }
        if (!/\.(ts|mts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name) || entry.name === "fileIdentity.ts") continue;
        if (/\.ino\s*[!=]==?|[!=]==?\s*\w+\.ino\b/.test(fs.readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
