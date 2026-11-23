/**
 * 各分类节点在 node.meta 里使用的可选字段 + provenance 标记。
 *
 * 设计原则（spec §3.4 + §5.4）：
 * - 这些字段全部存到 node.meta（Record<string, unknown>），不动顶层 schema
 * - 每个语义字段附带 *Source 标记，区分用户手填 vs AI 提取
 * - AI 重提时不覆盖 source='user' 的字段
 * - 缺失字段在卡片上**不显示对应行**，不显示 '+ 添加' placeholder
 */
import type { GenerationCanvasNode } from './generationCanvasTypes'

/**
 * 字段来源标记。
 * - 'user': 用户手动编辑，AI 重提时不覆盖
 * - { ai: timestamp }: AI 提取，可被新 AI 提取覆盖
 * - undefined: 字段未设置
 */
type FieldProvenance = 'user' | { ai: number }

// ----- 角色 (Cast) -----

export type CharacterMeta = {
  tagline?: string
  taglineSource?: FieldProvenance
  tags?: string[]
  tagsSource?: FieldProvenance
}

export function readCharacterMeta(node: GenerationCanvasNode): CharacterMeta {
  return (node.meta || {}) as CharacterMeta
}

// ----- 场景 (Scene) -----

export type SceneMeta = {
  mood?: string[]
  moodSource?: FieldProvenance
  tags?: string[]
  tagsSource?: FieldProvenance
}

export function readSceneMeta(node: GenerationCanvasNode): SceneMeta {
  return (node.meta || {}) as SceneMeta
}

// ----- 道具 (Prop) -----

export type PropMeta = {
  ownedBy?: string
  ownedBySource?: FieldProvenance
  attributes?: string[]
  attributesSource?: FieldProvenance
}

export function readPropMeta(node: GenerationCanvasNode): PropMeta {
  return (node.meta || {}) as PropMeta
}

// ----- 声音 (Audio) -----

type AudioKindValue = 'bgm' | 'sfx' | 'vo'

export type AudioMeta = {
  audioKind?: AudioKindValue
  audioKindSource?: FieldProvenance
  durationSec?: number
  bpm?: number
}

export function readAudioMeta(node: GenerationCanvasNode): AudioMeta {
  return (node.meta || {}) as AudioMeta
}
