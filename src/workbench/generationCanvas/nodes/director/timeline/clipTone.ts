/**
 * [INPUT]: 依赖 ../model/timelineTracks 的 ClipTone
 * [OUTPUT]: 对外提供 ClipDragZone、clipToneClass
 * [POS]: director/timeline 的片段完整配色单一真相：家族底色与文字色成对，选中优先于激活，激活只属于路径；主题无关。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ClipTone } from '../model/timelineTracks'

export type ClipDragZone = 'body' | 'left' | 'right'

// 状态整套选择，不能给 selected 叠普通 hover。
const CLIP_TONES: Record<ClipTone, { normal: string; selected: string }> = {
  trajectory: { normal: 'bg-nomi-clip-path/90 hover:bg-nomi-clip-path-hover/90 text-nomi-clip-path-text', selected: 'bg-nomi-clip-path' },
  action: { normal: 'bg-nomi-clip-action/80 hover:bg-nomi-clip-action-hover/80 text-nomi-clip-action-text', selected: 'bg-nomi-clip-action' },
  pose: { normal: 'bg-nomi-clip-pose/80 hover:bg-nomi-clip-pose-hover/80 text-nomi-clip-pose-text', selected: 'bg-nomi-clip-pose' },
  lookat: { normal: 'bg-nomi-clip-lookat/80 hover:bg-nomi-clip-lookat-hover/80 text-nomi-clip-lookat-text', selected: 'bg-nomi-clip-lookat' },
  closeup: { normal: 'bg-nomi-clip-closeup/90 hover:bg-nomi-clip-closeup-hover/90 text-nomi-clip-closeup-text', selected: 'bg-nomi-clip-closeup' },
}

export function clipToneClass(tone: ClipTone, selected: boolean, active = false): string {
  if (selected) return `${CLIP_TONES[tone].selected} border-nomi-clip-selected text-nomi-clip-selected z-10`
  if (tone === 'trajectory' && active) return 'bg-nomi-clip-path/95 border-nomi-clip-path-active text-nomi-clip-path-active-text z-10'
  return `${CLIP_TONES[tone].normal} border-transparent`
}
