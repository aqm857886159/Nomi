// 测试专用：请求体 / 参数投影类测试问的是「给定这种方式，请求体长什么样」，不问「这次按哪种方式发」。
// 它们在 meta 里写好 archetype.modeId 当输入，这里按那个 id 取方式交给按方式投影的函数。
// 生产代码问「这次按哪种方式发」一律走 archetypeMeta.effectiveArchetypeMode（唯一 owner），不许 import 本文件。
import type { ArchetypeMode, ModelArchetype } from '../../../../../electron/shared/modelArchetypes'
import { archetypeModeById } from './archetypeMeta'
import { readModePreference } from './modePreference'

export function modeWrittenInMeta(meta: Record<string, unknown> | undefined, archetype: ModelArchetype): ArchetypeMode {
  return archetypeModeById(archetype, readModePreference(archetype, meta)?.modeId)
}
