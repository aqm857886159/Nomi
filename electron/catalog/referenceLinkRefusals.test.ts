import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isConnectionRefused, noteConnectionRefused, referenceLinkRefusalsPath } from "./referenceLinkRefusals";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-reference-link-refusals-"));
  vi.stubEnv("NOMI_SETTINGS_DIR", root);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("referenceLinkRefusals：记在连接上的「模型拉不到临时链接」", () => {
  it("没有文件 = 没有记录", () => {
    expect(isConnectionRefused("apimart")).toBe(false);
    expect(fs.existsSync(referenceLinkRefusalsPath())).toBe(false);
  });

  it("记下一条连接：只有这条连接生效，兄弟连接和别的连接不受影响", () => {
    noteConnectionRefused("relay-a");
    expect(isConnectionRefused("relay-a")).toBe(true);
    expect(isConnectionRefused("relay-a--b2c3")).toBe(false);
    expect(isConnectionRefused("relay-b")).toBe(false);
    expect(isConnectionRefused("")).toBe(false);
    expect(isConnectionRefused(undefined)).toBe(false);
  });

  it("30 天后失效：判据说错一次，这条连接不会从此不再用链接；到期后再被拒就重新记", () => {
    const refusedAt = new Date("2026-11-01T00:00:00.000Z");
    const daysLater = (days: number) => new Date(refusedAt.getTime() + days * 24 * 60 * 60 * 1000);
    noteConnectionRefused("relay-a", refusedAt);
    expect(isConnectionRefused("relay-a", daysLater(29))).toBe(true);
    expect(isConnectionRefused("relay-a", daysLater(31))).toBe(false);
    noteConnectionRefused("relay-a", daysLater(31));
    expect(isConnectionRefused("relay-a", daysLater(60))).toBe(true);
    expect(isConnectionRefused("relay-a", daysLater(62))).toBe(false);
  });

  it("时间读不出来当作没有记录", () => {
    fs.writeFileSync(referenceLinkRefusalsPath(), JSON.stringify({ version: 1, connections: { "relay-a": { refusedAt: "yesterday" }, "relay-b": {} } }));
    expect(isConnectionRefused("relay-a")).toBe(false);
    expect(isConnectionRefused("relay-b")).toBe(false);
  });

  it("未来时间的记录不算：手改文件或时钟错，不会让这条连接一直走上传；再被拒就记成现在", () => {
    fs.writeFileSync(referenceLinkRefusalsPath(), JSON.stringify({ version: 1, connections: { "relay-a": { refusedAt: "2099-01-01T00:00:00.000Z" } } }));
    expect(isConnectionRefused("relay-a")).toBe(false);
    const now = new Date();
    noteConnectionRefused("relay-a", now);
    expect(JSON.parse(fs.readFileSync(referenceLinkRefusalsPath(), "utf8")).connections["relay-a"].refusedAt).toBe(now.toISOString());
  });

  it("落在设置目录的文件里，换一个全新的读取（清内存）仍然生效；重复记不改文件", async () => {
    const refusedAt = new Date();
    noteConnectionRefused("relay-a", refusedAt);
    const before = fs.readFileSync(referenceLinkRefusalsPath(), "utf8");
    vi.resetModules();
    // eslint-disable-next-line no-restricted-syntax -- 重启模拟：全新模块实例证明没有任何进程内记忆，结论只来自设置目录里的文件
    const fresh = await import("./referenceLinkRefusals");
    expect(fresh.isConnectionRefused("relay-a")).toBe(true);
    fresh.noteConnectionRefused("relay-a", new Date(refusedAt.getTime() + 1000));
    expect(fs.readFileSync(referenceLinkRefusalsPath(), "utf8")).toBe(before);
    expect(JSON.parse(before)).toEqual({ version: 1, connections: { "relay-a": { refusedAt: refusedAt.toISOString() } } });
  });

  it("文件损坏当作没有记录，原字节留底，之后照常记得上", () => {
    fs.writeFileSync(referenceLinkRefusalsPath(), "{broken", "utf8");
    expect(isConnectionRefused("relay-a")).toBe(false);
    expect(fs.readdirSync(root).some((name) => name.startsWith("reference-link-refusals.broken-"))).toBe(true);
    noteConnectionRefused("relay-a");
    expect(isConnectionRefused("relay-a")).toBe(true);
  });

  it("形状不对（数组、没有 connections）也当作没有记录", () => {
    fs.writeFileSync(referenceLinkRefusalsPath(), "[]", "utf8");
    expect(isConnectionRefused("relay-a")).toBe(false);
  });

  it("写不成只记日志、不抛：目标路径被目录占着也不影响调用方", () => {
    fs.mkdirSync(referenceLinkRefusalsPath());
    expect(() => noteConnectionRefused("relay-a")).not.toThrow();
    expect(isConnectionRefused("relay-a")).toBe(false);
  });

  it("原型上的名字不会被当成已记录的连接", () => {
    expect(isConnectionRefused("constructor")).toBe(false);
    expect(isConnectionRefused("__proto__")).toBe(false);
  });
});
