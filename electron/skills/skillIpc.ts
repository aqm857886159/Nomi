// 渲染层要的 skill 列表 DTO（主进程组装）。按「路 A」：这里只把 manifest 原样给渲染层，
// 能力比对（缺哪个 provider）放渲染层用 getCatalogHealth 做，catalog 一变实时刷新、不耦合。
import { deriveSkillNeeds } from "./skillCapability";
import { ipcMain } from "electron";
import { assertTrustedSender } from "../ipcSenderGuard";
import type { SkillProviderKind } from "./skillManifestSchema";
import { readSkillRecords } from "./skillStore";
import {
  importSkillPackageToUserDir,
  exportSkillPackageByName,
  deleteUserSkill,
} from "./skillPackage";

export type SkillListItem = {
  directoryName: string;
  name: string;
  /** 人话显示名（manifest.label，缺则回退 name）。 */
  label: string;
  description: string | null;
  author: string | null;
  /** 多段 playbook 的阶段标签（卡片/阶段条展示用；单段 skill 为空）。 */
  stageLabels: string[];
  /** 这个 skill 是不是多段 playbook（有 stages）。 */
  isPlaybook: boolean;
  /**
   * 端到端需要的 provider 模态（deriveSkillNeeds 权威算出 = requiredProviders ∪ stages.modelPrefs.kind）。
   * 渲染层只对它做「减去当前可用」的平凡差集得出缺口——能力派生逻辑只在 electron 一处（不违 P1）。
   */
  neededProviders: SkillProviderKind[];
  /** manifest 解析失败的人话原因（加载期诊断）；正常为 null。 */
  manifestError: string | null;
  /** 来源：'user'=可写用户目录（可删/可导出）；'builtin'=安装随附（只读、禁删）。 */
  origin: "builtin" | "user";
  packageVersion: string;
  contentHash: string;
};

export function listSkillsForRenderer(): SkillListItem[] {
  return readSkillRecords()
    // 库只露「用户会浏览、挑来用」的：用户目录的（自己导入/建的，永远显示）∪ 内置 playbook（有 stages，
    // 如品牌宣传片）。藏掉两类不该出现在用户库里的：① 外来工程技能（superpowers 的 brainstorming 等，
    // 无 manifest）；② 幕后管线技能（creation-edit / skill-author / workbench.* 助手，自动路由或按钮触发，
    // 不是浏览挑选项）。口径与创作区技能下拉（ActiveSkillChip 的 isPlaybook 过滤）一致。
    .filter((r) => r.origin === "user" || (r.manifest?.stages?.length ?? 0) > 0)
    .map((r) => {
    const needs = r.manifest ? deriveSkillNeeds(r.manifest) : null;
    return {
      directoryName: r.directoryName,
      name: r.name,
      label: r.manifest?.label || r.name,
      // r.description 已是「manifest 的 ∥ SKILL.md frontmatter 的」（skillStore 算好的单一真相源）。
      // 此前这里只取 manifest → 没有 skill.json 的技能一律显示「暂无说明」，哪怕 frontmatter 里
      // 写着标准的 description（31 本内置只有 7 本带 manifest；用户从生态导入的标准技能全中招）。
      // 2026-08-27 真机走查抓出：导入一个标准 SKILL.md → 落盘成功、卡片却是「暂无说明」。
      description: r.description || r.manifest?.description || null,
      author: r.manifest?.author ?? null,
      stageLabels: (r.manifest?.stages ?? []).map((s) => s.goal),
      isPlaybook: (r.manifest?.stages ?? []).length > 0,
      neededProviders: needs?.providers ?? [],
      manifestError: r.manifestError ?? null,
      origin: r.origin,
      packageVersion: r.packageVersion,
      contentHash: r.contentHash,
    };
  });
}

type RegisterSyncIpc = (channel: string, handler: (...args: unknown[]) => unknown) => void;

/** Register the renderer-facing skill list boundary used by the ref Host wiring. */
export function registerSkillIpc(registerSyncIpc: RegisterSyncIpc): void {
  registerSyncIpc("nomi:skill:list", () => listSkillsForRenderer());
  ipcMain.handle("nomi:skill:list-secure", async (event) => {
    assertTrustedSender(event);
    return listSkillsForRenderer();
  });
  // 三个写操作 handler —— 渲染层用 invokeSync 调，返回值结构与 skillPackage.ts 里的函数一致。
  // 2026-09-03: PR #279 合入了渲染层解析逻辑和主进程落地函数，但忘了在这里注册，
  // 导致渲染层一直收到 "No handler registered" 且 UI 静默（P0 回归）。
  registerSyncIpc("nomi:skill:import", (raw: unknown) =>
    importSkillPackageToUserDir(raw),
  );
  registerSyncIpc("nomi:skill:export", (dirName: unknown) =>
    exportSkillPackageByName(String(dirName ?? ""), Date.now()),
  );
  registerSyncIpc("nomi:skill:delete", (dirName: unknown) =>
    deleteUserSkill(String(dirName ?? "")),
  );
}
