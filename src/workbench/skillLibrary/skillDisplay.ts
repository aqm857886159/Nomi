import type { SkillListItemDto } from '../api/skillApi'

/**
 * 一个技能在界面上叫什么。**只此一份**。
 *
 * 这句 `curation?.title[locale] ?? label` 之前在三个地方各写了一遍（技能库画廊、composer 的
 * `/` 菜单、以及本次要加的转录 chip）。三份的后果不是难维护，是**同一个技能在三处叫不同名字**：
 * 用户在菜单里选的是「分镜规划」，发出去之后气泡上却印 `workbench.storyboard.planner`——
 * 他没法确认自己挂的就是刚才那个（R14.1 要横扫的「同一语义多份定义」）。
 *
 * `ProjectAgentResidentShell.tsx:250,257` 还留着一份没并过来：那个文件此刻由 PR #720 占着，
 * 同时改会撞车。它与本函数逐字相同，并入是纯搬运。
 */
export function skillDisplayTitle(skill: SkillListItemDto, language: string): string {
  return skill.curation?.title[language.startsWith('zh') ? 'zh-CN' : 'en'] ?? skill.label
}
