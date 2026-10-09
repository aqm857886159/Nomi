import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 结构测试：全仓只有 installGate.ts 能调用 electron-updater 的安装（quitAndInstall / install(isSilent, …)）。
// 判忙和调用库必须在同一个同步块里（TOCTOU 是三轮评审的同一类根因）；任何别的文件直接调用，
// 就等于绕开了判忙。读源码断言，不靠人记。
const ROOT = path.resolve(process.cwd(), "electron");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|mts|cts)$/.test(entry.name) && !/\.(test|d)\.[mc]?ts$/.test(entry.name) ? [full] : [];
  });
}

const INSTALL_CALL = /\.quitAndInstall\s*\(|\bquitAndInstallCalled\b|\.install\?\.\(\s*(true|false)\b|\.install\(\s*(true|false)\b/;

describe("唯一安装入口", () => {
  it("只有 electron/update/installGate.ts 调用 quitAndInstall / install(isSilent, …)", () => {
    const callers = sourceFiles(ROOT)
      .filter((file) => INSTALL_CALL.test(fs.readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")))
      .map((file) => path.relative(process.cwd(), file).split(path.sep).join("/"));
    expect(callers).toEqual(["electron/update/installGate.ts"]);
  });

  it("入口函数 installIfIdleNow 是同步的：函数体里没有 await / async", () => {
    const source = fs.readFileSync(path.join(ROOT, "update", "installGate.ts"), "utf8");
    const start = source.indexOf("installIfIdleNow(mode, senderId)");
    const body = source.slice(start, source.indexOf("\n    },\n  };", start))
      .replace(/\/\/.*$/gm, "");
    expect(start).toBeGreaterThan(0);
    expect(body).not.toMatch(/\bawait\b|\basync\b|\.then\(/);
  });

  it("三条路都走它：IPC 立即安装、退出排空、续装重试在 autoUpdater.ts 里只出现 installIfIdleNow", () => {
    const source = fs.readFileSync(path.join(ROOT, "update", "autoUpdater.ts"), "utf8");
    expect(source.match(/installGate\.installIfIdleNow\("restart"/g)).toHaveLength(1);
    expect(source.match(/installGate\.installIfIdleNow\("quit"/g)).toHaveLength(1);
  });
});
