/**
 * 技能 key 指的是目录里哪一个技能。**只此一份**：主进程（这一轮注入哪份 SKILL.md、执行凭据）和
 * 渲染层（chip、「已载入技能」上叫什么）都走这里。纯函数、不碰 node，渲染层直接 import。
 *
 * 持久化数据里的 key 有两种写法：收敛前的点号（`workbench.storyboard.planner`，分镜启动器至今还这么发），
 * 和 SKILL.md `name` / 目录名的短横线（`workbench-storyboard-planner`）。之前主进程按归一查、渲染层按 `name`
 * 精确查——同一个 key 主进程认得、技能照常注入，界面却认不得，把 key 原样印在气泡上
 * （2026-11-08：选中一句点「拆成镜头」，气泡上只见那句话和 `workbench.storyboard.planner`）。
 * 两边各写一份查找，就会各认各的；所以查找只住这一处。
 */
export type SkillKeyed = { readonly name: string; readonly directoryName: string }

export function normalizeSkillLookupKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[._\s/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/**
 * 依次：`name` 精确相等 → key 是某技能 `name` 加点号后缀（取最长那个）→ 归一后比 `name` / 目录名
 * （`skillName` 同理，给只知道名字的调用方）。查不到 = null。
 */
export function findSkillRecord<T extends SkillKeyed>(
  skillKey: string,
  skillName: string,
  records: readonly T[],
): T | null {
  if (!records.length) return null;
  const normalizedKey = normalizeSkillLookupKey(skillKey);
  const normalizedName = normalizeSkillLookupKey(skillName);
  const exact = records.find((skill) => skill.name === skillKey);
  if (exact) return exact;
  const prefix = records.filter((skill) => skillKey.startsWith(`${skill.name}.`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (prefix) return prefix;
  return records.find((skill) =>
    normalizeSkillLookupKey(skill.name) === normalizedKey ||
    normalizeSkillLookupKey(skill.directoryName) === normalizedKey ||
    (normalizedName && normalizeSkillLookupKey(skill.name) === normalizedName) ||
    (normalizedName && normalizeSkillLookupKey(skill.directoryName) === normalizedName)) ?? null;
}
