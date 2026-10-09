import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VersionNotes } from "../shared/updateReminder";
import { openUpdateReminderStore } from "./updateReminderStore";

let root = "";
let file = "";
const notes = (version: string): VersionNotes => ({
  version,
  zh: { title: `标题 ${version}`, groups: [{ heading: "组", items: ["条目"] }], hiddenGroups: 0 },
  en: { title: `Title ${version}`, groups: [], hiddenGroups: 0 },
  platforms: null,
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-update-reminder-"));
  file = path.join(root, "update-reminder.json");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("更新提醒的跨重启记忆", () => {
  it("第一次运行：不出「已更新」卡，只记下当前版本", () => {
    const store = openUpdateReminderStore("0.23.0", file);
    expect(store.memory().updatedCard).toBeNull();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).lastRunVersion).toBe("0.23.0");
  });

  it("同意更新后升级：下次启动出一张卡，说明取同意那一刻记下的；只含 (from, to] 之间的版本", () => {
    const before = openUpdateReminderStore("0.22.5", file);
    before.rememberPending({ fromVersion: "0.22.5", toVersion: "0.23.1", notes: [notes("0.23.1"), notes("0.23.0"), notes("0.22.5")] });
    const after = openUpdateReminderStore("0.23.1", file);
    expect(after.memory().updatedCard).toMatchObject({ fromVersion: "0.22.5", toVersion: "0.23.1" });
    expect(after.memory().updatedCard?.notes.map((entry) => entry.version)).toEqual(["0.23.1", "0.23.0"]);
  });

  it("Mac 用户自己在官网下的（没记过说明）也出卡，只是没有条目", () => {
    openUpdateReminderStore("0.23.0", file);
    const card = openUpdateReminderStore("0.23.1", file).memory().updatedCard;
    expect(card).toMatchObject({ fromVersion: "0.23.0", toVersion: "0.23.1", notes: [] });
  });

  it("✕ 之后不再出：重启也不会回来；同版本再启动不重复生成", () => {
    openUpdateReminderStore("0.23.0", file);
    const upgraded = openUpdateReminderStore("0.23.1", file);
    expect(upgraded.memory().updatedCard).not.toBeNull();
    expect(upgraded.dismissUpdatedCard().updatedCard).toBeNull();
    expect(openUpdateReminderStore("0.23.1", file).memory().updatedCard).toBeNull();
  });

  it("热修横幅 ✕ 按版本记，重启后仍记得；降级启动不出卡", () => {
    const store = openUpdateReminderStore("0.23.0", file);
    expect(store.dismissBanner("0.23.1").dismissedBanners).toEqual(["0.23.1"]);
    expect(store.dismissBanner("0.23.1").dismissedBanners).toEqual(["0.23.1"]);
    expect(openUpdateReminderStore("0.23.0", file).memory().dismissedBanners).toEqual(["0.23.1"]);
    expect(openUpdateReminderStore("0.22.9", file).memory().updatedCard).toBeNull();
  });

  it("文件损坏：本次按空记忆运行，不抛", () => {
    fs.writeFileSync(file, "{ not json", "utf8");
    const store = openUpdateReminderStore("0.23.0", file);
    expect(store.memory()).toEqual({ dismissedBanners: [], updatedCard: null });
  });

  it("已下载待安装的目标版本跨重启保留；当前版本到了目标版本就清掉", () => {
    const first = openUpdateReminderStore("0.23.1", file);
    first.rememberDownloaded({ version: "0.24.0", file: "C:/cache/Nomi-Setup-0.24.0.exe" });
    expect(openUpdateReminderStore("0.23.1", file).pendingInstall()).toEqual({ version: "0.24.0", file: "C:/cache/Nomi-Setup-0.24.0.exe" });
    expect(openUpdateReminderStore("0.24.0", file).pendingInstall()).toBeNull();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).pendingInstall).toBeNull();
  });
});
