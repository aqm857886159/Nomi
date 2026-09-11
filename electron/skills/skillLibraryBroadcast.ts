/**
 * 技能库变了，告诉所有窗口（2026-09-11）。
 *
 * ── 它在解决哪个真实摩擦 ──
 * 渲染层已经有一条「技能库变了就重读」的总线（`src/workbench/skillLibrary/skillLibraryChanged.ts`），
 * 但**派发它的只有渲染层自己的导入/删除**。技能还有第三个写入者：Agent 的 `author_skill`
 * ——它在主进程里落盘，渲染层一无所知。于是「让 Agent 帮我写一个技能」写完了，
 * 用户在技能菜单里找不到它，要重启 App 才撞见。
 *
 * ── 为什么装在这一层 ──
 * 写盘的函数只有两个（`importSkillPackageToUserDir` / `deleteUserSkill`），而调用它们的入口
 * 有三处以上且还会长。把通知挂在**写盘那一层**，新增一个入口不必记得补一行（R28：
 * 防线建在最早能拦住的那层）。范式与 `nomi:model-catalog:changed` 完全一致，不另发明一套。
 *
 * 非 Electron 进程（MCP 的 node 宿主、单测）里拿不到窗口——那里没有人要通知，
 * 静默 no-op 是正确行为，不是被吞掉的错误。
 */

export const SKILL_LIBRARY_CHANGED_CHANNEL = "nomi:skill-library:changed";

/** 一个能收广播的窗口。只写我们真的用到的两个成员，不把 Electron 的类型拖进这一层。 */
export interface SkillLibraryWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string): void };
}

function electronWindows(): readonly SkillLibraryWindow[] {
  try {
    // 动态 require：这个模块被 `skillPackage.ts` 引用，而它也跑在没有 Electron 的进程里
    // （MCP 的 node 宿主、单测）。那里 `require` 本身可能就不存在，所以整段兜住。
    const electron = require("electron") as { BrowserWindow?: { getAllWindows(): SkillLibraryWindow[] } };
    return electron.BrowserWindow?.getAllWindows() ?? [];
  } catch {
    return [];
  }
}

let windowSource: () => readonly SkillLibraryWindow[] = electronWindows;

/** 测试替身。生产代码只走 `electronWindows`，这个口存在只是为了让广播这件事可被观测。 */
export function setSkillLibraryWindowSourceForTests(source: (() => readonly SkillLibraryWindow[]) | null): void {
  windowSource = source ?? electronWindows;
}

export function broadcastSkillLibraryChanged(): void {
  for (const window of windowSource()) {
    if (window.isDestroyed()) continue;
    try { window.webContents.send(SKILL_LIBRARY_CHANGED_CHANNEL); } catch { /* a window closing mid-send is not an error */ }
  }
}
