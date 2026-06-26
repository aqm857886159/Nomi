// 渲染层要的 skill 列表 DTO（主进程组装）。按「路 A」：这里只把 manifest 原样给渲染层，
// 能力比对（缺哪个 provider）放渲染层用 getCatalogHealth 做，catalog 一变实时刷新、不耦合。
import { deriveSkillNeeds } from "./skillCapability";
import type { SkillProviderKind } from "./skillManifestSchema";
import { readSkillRecords } from "./skillStore";

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
      description: r.manifest?.description ?? null,
      author: r.manifest?.author ?? null,
      stageLabels: (r.manifest?.stages ?? []).map((s) => s.goal),
      isPlaybook: (r.manifest?.stages ?? []).length > 0,
      neededProviders: needs?.providers ?? [],
      manifestError: r.manifestError ?? null,
      origin: r.origin,
    };
  });
}
