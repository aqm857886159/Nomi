// 用户为**这一轮**挂的那条技能 → 系统提示词的一段。**全仓唯一的选中技能注入点。**
//
// 信封形状对齐 `pi-coding-agent@1.7.0` 的 `parseSkillBlock` / `_expandSkillCommand`
// （`<skill name="..." location="...">` + `References are relative to ...`），用 `parseSkillBlock`
// 往返校验保证生成的块就是上游认得的标准技能块。正文（`content`）由加载器给出、已去 frontmatter。
import path from 'node:path';

import {
  SELECTED_SKILL_FRAMING,
  SKILL_TOOL_AUTHORITY_PLACEMENT,
  SKILL_TOOL_AUTHORITY_SECTION,
  type SkillToolAuthorityPlacement,
} from '../shared/agentLane/skillPromptPlacement.js';
import type { SkillRecord } from '../skills/skillStore.js';

export type SelectedSkill = Pick<SkillRecord, 'name' | 'description' | 'filePath' | 'content'>;

export function formatPiSkillBlock(skill: Pick<SelectedSkill, 'name' | 'filePath' | 'content'>, additionalInstructions?: string): string {
  const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${path.dirname(skill.filePath)}.\n\n${skill.content}\n</skill>`;
  return additionalInstructions ? `${skillBlock}\n\n${additionalInstructions}` : skillBlock;
}

export function renderSelectedSkillPrompt(
  skill: SelectedSkill,
  placement: SkillToolAuthorityPlacement = SKILL_TOOL_AUTHORITY_PLACEMENT,
): string {
  const envelope = placement === 'after_body'
    ? formatPiSkillBlock(skill, SKILL_TOOL_AUTHORITY_SECTION)
    : formatPiSkillBlock(skill);
  return [
    SELECTED_SKILL_FRAMING,
    '',
    ...(placement === 'before_body' ? [SKILL_TOOL_AUTHORITY_SECTION, ''] : []),
    envelope,
  ].join('\n');
}
