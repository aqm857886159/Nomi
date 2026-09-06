// 文件写手：按天换文件、大小上限滚动、保留期清理。
//
// 这三条都是「本地肉眼看不出、要等几天/等日志涨到 4MB 才会显形」的一族，
// 所以必须用假时钟 + 临时目录当场钉住，不能靠"跑一阵子看看"。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  archivePathFor,
  createLogFileSink,
  dailyLogFileName,
  isoDay,
  listLogFilesForBundle,
  pruneExpiredLogs,
} from "./logFiles";

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-logfiles-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("按天换文件", () => {
  it("文件名跟着本地日期走（用户说「昨天那次」指的是他的昨天）", () => {
    expect(dailyLogFileName(new Date(2026, 8, 6, 23, 30))).toBe("nomi-2026-09-06.log");
    expect(isoDay(new Date(2026, 0, 1))).toBe("2026-01-01");
  });

  it("跨天时换文件，并给新文件补一行会话表头", () => {
    let day = new Date(2026, 8, 6);
    const sink = createLogFileSink({
      resolvePath: () => path.join(dir, dailyLogFileName(day)),
      maxBytes: 1024 * 1024,
      rotate: "archive",
    });
    sink.append("first");
    day = new Date(2026, 8, 7);
    sink.append("second");

    const first = fs.readFileSync(path.join(dir, "nomi-2026-09-06.log"), "utf8");
    const second = fs.readFileSync(path.join(dir, "nomi-2026-09-07.log"), "utf8");
    expect(first).toContain("first");
    expect(first).not.toContain("second");
    // 两个文件各自带表头：滚动后半段日志无版本可归属，等于没有证据。
    expect(first).toContain("--- session nomi=");
    expect(second).toContain("--- session nomi=");
    expect(second).toContain("second");
  });
});

describe("大小上限", () => {
  it("archive：超限改名留一代，正文重新开始", () => {
    const file = path.join(dir, "nomi-2026-09-06.log");
    const sink = createLogFileSink({ resolvePath: () => file, maxBytes: 64, rotate: "archive" });
    sink.append("x".repeat(200));
    sink.append("after-rotate");

    expect(fs.readFileSync(archivePathFor(file), "utf8")).toContain("x".repeat(200));
    const current = fs.readFileSync(file, "utf8");
    expect(current).toContain("after-rotate");
    expect(current).not.toContain("x".repeat(200));
    expect(current).toContain("--- session nomi=");
  });

  it("truncate：崩溃道就地清空（旧的那一代对定位当前崩溃没有价值）", () => {
    const file = path.join(dir, "nomi-crash.log");
    const sink = createLogFileSink({ resolvePath: () => file, maxBytes: 64, rotate: "truncate" });
    sink.append("y".repeat(200));
    sink.append("after-truncate");

    expect(fs.existsSync(archivePathFor(file))).toBe(false);
    const current = fs.readFileSync(file, "utf8");
    expect(current).toContain("after-truncate");
    expect(current).not.toContain("y".repeat(200));
  });
});

describe("保留期", () => {
  it("按文件名里的日期删，不按 mtime（同步/备份还原都会改 mtime）", () => {
    for (const name of [
      "nomi-2026-09-06.log",
      "nomi-2026-09-06.1.log",
      "nomi-2026-08-30.log",
      "nomi-2026-08-31.log",
      "nomi-crash.log",
      "unrelated.txt",
    ]) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    // 全部文件此刻 mtime 都是"现在"——按 mtime 判会一个都删不掉。
    const removed = pruneExpiredLogs(dir, 7, new Date(2026, 8, 6));
    expect(removed.sort()).toEqual(["nomi-2026-08-30.log"]);
    expect(fs.existsSync(path.join(dir, "nomi-2026-08-31.log"))).toBe(true);
    // 崩溃道与无关文件不归保留期管。
    expect(fs.existsSync(path.join(dir, "nomi-crash.log"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "unrelated.txt"))).toBe(true);
  });

  it("跨天写入时自动清理（不另起定时器——桌面 app 多半等不到它触发）", () => {
    fs.writeFileSync(path.join(dir, "nomi-2026-08-01.log"), "old");
    const day = new Date(2026, 8, 6);
    const sink = createLogFileSink({
      resolvePath: () => path.join(dir, dailyLogFileName(day)),
      maxBytes: 1024,
      rotate: "archive",
      onNewFile: (file) => void pruneExpiredLogs(path.dirname(file), 7, day),
    });
    sink.append("today");
    expect(fs.existsSync(path.join(dir, "nomi-2026-08-01.log"))).toBe(false);
  });
});

describe("诊断包取文件", () => {
  it("崩溃道排最前，其余按新到旧（超总量时先丢最旧的）", () => {
    for (const name of ["nomi-2026-09-04.log", "nomi-2026-09-06.log", "nomi-crash.log", "readme.md"]) {
      fs.writeFileSync(path.join(dir, name), "x");
    }
    expect(listLogFilesForBundle(dir)).toEqual([
      "nomi-crash.log",
      "nomi-2026-09-06.log",
      "nomi-2026-09-04.log",
    ]);
  });

  it("目录不存在时返回空数组而不是抛", () => {
    expect(listLogFilesForBundle(path.join(dir, "nope"))).toEqual([]);
    expect(pruneExpiredLogs(path.join(dir, "nope"), 7, new Date())).toEqual([]);
  });
});
