import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  broadcastSkillLibraryChanged,
  SKILL_LIBRARY_CHANGED_CHANNEL,
  setSkillLibraryWindowSourceForTests,
  type SkillLibraryWindow,
} from "./skillLibraryBroadcast";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

afterEach(() => setSkillLibraryWindowSourceForTests(null));

describe("技能盘变了的唯一信号来自写盘那一层（2026-09-11）", () => {
  it("广播发给活着的窗口，跳过已销毁的，没有窗口时什么都不做", () => {
    const sent: string[] = [];
    const live = (destroyed: boolean): SkillLibraryWindow => ({
      isDestroyed: () => destroyed,
      webContents: { send: (channel) => sent.push(`${destroyed ? "dead" : "live"}:${channel}`) },
    });
    setSkillLibraryWindowSourceForTests(() => [live(false), live(true), live(false)]);
    broadcastSkillLibraryChanged();
    expect(sent).toEqual([`live:${SKILL_LIBRARY_CHANGED_CHANNEL}`, `live:${SKILL_LIBRARY_CHANGED_CHANNEL}`]);

    // 没有 Electron（MCP 宿主、单测）时是 no-op，不是异常。
    setSkillLibraryWindowSourceForTests(() => []);
    expect(() => broadcastSkillLibraryChanged()).not.toThrow();
  });

  it("两个写盘的函数都发信号，渲染层不再自己喊第二遍", () => {
    const skillPackage = source("electron/skills/skillPackage.ts");
    const preload = source("electron/preload.ts");
    const router = source("src/NomiRouterApp.tsx");
    const workbenchSkills = source("src/workbench/skillLibrary/useWorkbenchSkills.ts");

    // 落盘的两条路——导入（含 Agent 的 author_skill）与删除——各发一次。
    const importBody = skillPackage.slice(skillPackage.indexOf("export function importSkillPackageToUserDir"));
    expect(importBody.slice(0, importBody.indexOf("\n}"))).toContain("broadcastSkillLibraryChanged()");
    const deleteBody = skillPackage.slice(skillPackage.indexOf("export function deleteUserSkill"));
    expect(deleteBody.slice(0, deleteBody.indexOf("\n}"))).toContain("broadcastSkillLibraryChanged()");

    // 主进程 → 渲染层的那一段线：频道名两头必须对得上，且渲染层只在这一个接线点转发。
    expect(preload).toContain(`ipcRenderer.on("${SKILL_LIBRARY_CHANGED_CHANNEL}", listener)`);
    expect(router).toContain("getDesktopBridge()?.skill.onChanged?.(() => notifySkillLibraryChanged())");
    expect(workbenchSkills).not.toContain("notifySkillLibraryChanged");
  });
});
