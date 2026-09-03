import type { ArchetypeMode } from '../../../config/modelArchetypes/types'

const SPEAKING_PARAMETER_KEYS = new Set(['audio', 'generate_audio'])

/** 只依据当前模型档案声明判定是否会随视频生成对白音频，不按供应商名猜。 */
export function modeGeneratesDialogue(mode: ArchetypeMode | null | undefined, params: Record<string, unknown> = {}): boolean {
  const control = mode?.params.find((candidate) => candidate.type === 'boolean' && SPEAKING_PARAMETER_KEYS.has(candidate.key))
  if (!control) return false
  const value = params[control.key]
  return value === undefined ? control.defaultValue === true : value === true
}

/** 生成提交层的对白附加段；持久化提示词仍不混入台词，避免编辑态与执行态互相覆盖。 */
export function buildDialoguePromptSuffix(
  mode: ArchetypeMode | null | undefined,
  params: Record<string, unknown>,
  dialogue: unknown,
): string | undefined {
  const text = typeof dialogue === 'string' ? dialogue.trim() : ''
  return text && modeGeneratesDialogue(mode, params) ? `对白：${text}` : undefined
}
