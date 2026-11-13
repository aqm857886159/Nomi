import type { SkillListItemDto } from '../api/skillApi'
import { findSkillRecord } from '../../../electron/shared/skillKey'

/**
 * 一个技能在界面上叫什么。**只此一份**。
 *
 * 这句 `curation?.title[locale] ?? label` 之前在三个地方各写了一遍（技能库画廊、composer 的
 * `/` 菜单、以及本次要加的转录 chip）。三份的后果不是难维护，是**同一个技能在三处叫不同名字**：
 * 用户在菜单里选的是「分镜规划」，发出去之后气泡上却印 `workbench.storyboard.planner`——
 * 他没法确认自己挂的就是刚才那个（R14.1 要横扫的「同一语义多份定义」）。
 */
export function skillDisplayTitle(skill: SkillListItemDto, language: string): string {
  return skill.curation?.title[language.startsWith('zh') ? 'zh-CN' : 'en'] ?? skill.label
}

/**
 * 一个技能 **key** 在界面上叫什么。查不到就原样印 key——「有这么个技能、但它现在不在这台机器上」是真话，
 * 把 chip 藏掉等于抹掉用户做过的操作。
 *
 * 技能在 store、转录、恢复草稿里一律**只存 key**（外加钉版本的 contentHash），名字每次渲染时从这里派生。
 * 另存一份名字就是多一个会漂的 owner：2026-09-19 那次（8e89e19ce）把主进程快照里的 `name`——SKILL.md 的
 * 标识，和 key 同值——当显示名印了出来，composer 上挂的「分镜规划」发出去变成 `workbench-storyboard-planner`，
 * 而恢复草稿、技能库「使用」各自存的那份名字也各是各的。
 */
export function skillLabelForKey(skills: readonly SkillListItemDto[], key: string, language: string): string {
  const found = skillForKey(skills, key)
  return found ? skillDisplayTitle(found, language) : key
}

/**
 * 一个技能 key 指技能库里的哪一个。和主进程「这一轮注入哪份 SKILL.md」是**同一份查找**（`electron/shared/skillKey.ts`）：
 * 2026-11-08 之前这里按 `name` 精确比，主进程按归一比——分镜启动器发的点号 key `workbench.storyboard.planner`
 * 主进程认得、技能照常注入，界面却认不得，气泡小签和「已载入技能：」都印成了 key。
 */
export function skillForKey(skills: readonly SkillListItemDto[], key: string): SkillListItemDto | null {
  return findSkillRecord(key, '', skills)
}
