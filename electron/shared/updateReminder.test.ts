import { describe, expect, it } from "vitest";
import { dialogDigest, reduceUpdaterState, UPDATER_INITIAL_STATE, type VersionNotes } from "./updateReminder";

const digest = (title: string | null, heading: string, items: string[], hidden = 0) => ({ title, groups: [{ heading, items }], hiddenGroups: hidden });
const notes = (version: string, zh: ReturnType<typeof digest>, en: ReturnType<typeof digest>): VersionNotes => ({ version, zh, en, platforms: null });

describe("reduceUpdaterState", () => {
  it("checking 重置为干净检查态", () => {
    const dirty = { ...UPDATER_INITIAL_STATE, phase: "error" as const, errorMessage: "旧错误", errorStage: "download" as const, percent: 40 };
    expect(reduceUpdaterState(dirty, { type: "checking" })).toEqual({ ...UPDATER_INITIAL_STATE, phase: "checking" });
  });

  it("available 带出版本号、说明、安装包大小和完整说明地址", () => {
    const next = reduceUpdaterState(UPDATER_INITIAL_STATE, { type: "available", version: "0.11.0", notes: [], sizeBytes: 1024, releaseUrl: "https://x/y" });
    expect(next).toMatchObject({ phase: "available", latestVersion: "0.11.0", sizeBytes: 1024, releaseUrl: "https://x/y" });
  });

  it("progress 累进到 downloading；downloaded 把百分比补满并保留版本说明", () => {
    const avail = reduceUpdaterState(UPDATER_INITIAL_STATE, {
      type: "available",
      version: "0.11.0",
      notes: [notes("0.11.0", digest("z", "g", ["a"]), digest("e", "g", ["a"]))],
      sizeBytes: null,
      releaseUrl: null,
    });
    const downloading = reduceUpdaterState(avail, { type: "progress", percent: 87 });
    expect(downloading).toMatchObject({ phase: "downloading", percent: 87 });
    const done = reduceUpdaterState(downloading, { type: "downloaded", version: "0.11.0" });
    expect(done).toMatchObject({ phase: "downloaded", percent: 100, latestVersion: "0.11.0" });
    expect(done.notes).toHaveLength(1);
  });

  it("下载失败保留版本与说明（重试直接重下，不用先重新检查），并记下是哪一步、什么原因", () => {
    const avail = reduceUpdaterState(UPDATER_INITIAL_STATE, { type: "available", version: "0.11.0", notes: [], sizeBytes: null, releaseUrl: null });
    const failed = reduceUpdaterState(reduceUpdaterState(avail, { type: "progress", percent: 30 }), { type: "error", message: "ENOTFOUND", stage: "download", reason: "network" });
    expect(failed).toMatchObject({ phase: "error", latestVersion: "0.11.0", errorStage: "download", errorReason: "network", errorMessage: "ENOTFOUND" });
  });

  it("up-to-date 不残留上一次的版本号", () => {
    const had = reduceUpdaterState(UPDATER_INITIAL_STATE, { type: "available", version: "0.11.0", notes: [], sizeBytes: null, releaseUrl: null });
    expect(reduceUpdaterState(had, { type: "up-to-date" })).toEqual({ ...UPDATER_INITIAL_STATE, phase: "up-to-date" });
  });
});

describe("dialogDigest", () => {
  const v1 = notes("0.24.0", digest("新标题", "新分组", ["甲"]), digest("New title", "New group", ["A"]));
  const v0 = notes("0.23.1", digest("旧标题", "旧分组", ["乙"], 2), digest(null, "Old group", ["B"]));

  it("只取当前语言；跳了几版就从新到旧接起来，标题取最新一版", () => {
    const zh = dialogDigest([v0, v1], "zh");
    expect(zh.title).toBe("新标题");
    expect(zh.groups.map((group) => group.heading)).toEqual(["新分组", "旧分组"]);
    expect(dialogDigest([v1, v0], "en").title).toBe("New title");
  });

  it("超出 4 组的并进「还有 N 组」", () => {
    const many = notes(
      "0.25.0",
      { title: "t", groups: [1, 2, 3, 4, 5].map((n) => ({ heading: `g${n}`, items: ["x"] })), hiddenGroups: 0 },
      { title: null, groups: [], hiddenGroups: 0 },
    );
    const result = dialogDigest([many], "zh");
    expect(result.groups).toHaveLength(4);
    expect(result.hiddenGroups).toBe(1);
  });

  it("没有可用摘要 → 空分组（界面只显示版本号和完整说明链接）", () => {
    expect(dialogDigest([], "zh")).toEqual({ title: null, groups: [], hiddenGroups: 0 });
  });
});
