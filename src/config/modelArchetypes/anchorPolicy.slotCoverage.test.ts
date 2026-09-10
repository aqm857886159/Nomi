import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from './index'
import { SLOT_ACCEPTS } from './anchorPolicy'
import type { ArchetypeReferenceSlotKind } from './types'

// 根因回归测试（R21 class_root）：SLOT_ACCEPTS 是「档案声明的参考槽种类 → 画布真放行的资产类型」
// 唯一共享门岗。档案已经声明了某个 slot kind（如 seedance omni 的 audio_ref），但这道门岗给它配了
// 空数组 → 声明的能力永远进不去、边永远建不上，而且**没有任何编译期或运行期信号**——
// TS 的 Record<ArchetypeReferenceSlotKind, ...> 只保证「每个 key 都在」，保证不了「每个 key 都非空」。
//
// 这条测试扫描全部 archetype 实际声明过的 slot kind，断言每一种都在 SLOT_ACCEPTS 里映到至少一种
// 资产类型——不是只补 audio_ref 这一个例子，而是把「新增一种 slot kind 却忘配 SLOT_ACCEPTS」这整类
// 錯误钉死：以后任何人在 modelArchetypes 里新声明一种槽而漏配门岗，这条测试立刻红。
describe('SLOT_ACCEPTS covers every slot kind any archetype actually declares', () => {
  it('no declared reference slot kind is a dead end (empty accept list)', () => {
    const declaredKinds = new Set<ArchetypeReferenceSlotKind>()
    for (const archetype of MODEL_ARCHETYPES) {
      for (const mode of archetype.modes) {
        for (const slot of mode.slots) declaredKinds.add(slot.kind)
      }
    }
    // 至少要覆盖到已知会用到的几种，防止这条测试本身因为遍历逻辑写错而假绿（誤判「没有任何声明」）。
    expect(declaredKinds.size).toBeGreaterThan(0)
    expect(declaredKinds.has('audio_ref')).toBe(true)
    for (const kind of declaredKinds) {
      expect(SLOT_ACCEPTS[kind], `SLOT_ACCEPTS.${kind} must accept at least one asset kind — an empty list means every archetype declaring this slot is unreachable from the canvas`).not.toHaveLength(0)
    }
  })
})
