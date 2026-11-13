import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES, specializeArchetypeForVendor } from './index'
import { frameSwapKeepsSendable, modeTakesAllInputs, type ModeInput } from './modeForInputs'
import type { ArchetypeMode, ModelArchetype } from './types'

// 首尾帧「对调」钮（协调 2026-11-12 拍板 A）：对调之后这种方式还发得出去 ⇄ 才可点。
// 穷举：每个有首帧 + 尾帧格的档案方式 × 只放首帧 / 只放尾帧 / 两张都放 × 每个声明过的渠道特化；
// 断言「可点 ⇔ 把对调后的输入交给同一个方式，它收得下」——判据和发送那一头（modeTakesAllInputs）是同一把尺子。

const FIRST: ModeInput = { slots: ['first_frame'], asset: 'image' }
const LAST: ModeInput = { slots: ['last_frame'], asset: 'image' }

function swappedInputs(filled: { first: boolean; last: boolean }): ModeInput[] {
  // 对调：首帧格装原来尾帧的东西，尾帧格装原来首帧的东西。
  return [...(filled.last ? [FIRST] : []), ...(filled.first ? [LAST] : [])]
}

function frameModes(): Array<{ label: string; mode: ArchetypeMode }> {
  const out: Array<{ label: string; mode: ArchetypeMode }> = []
  const vendors = [undefined, 'apimart', 'kie', 'official']
  for (const raw of MODEL_ARCHETYPES as readonly ModelArchetype[]) {
    const seen = new Set<string>()
    for (const vendor of vendors) {
      const archetype = vendor ? specializeArchetypeForVendor(raw, vendor) : raw
      for (const mode of archetype.modes) {
        if (!mode.slots.some((slot) => slot.kind === 'first_frame') || !mode.slots.some((slot) => slot.kind === 'last_frame')) continue
        const key = `${archetype.id}/${mode.id}/${JSON.stringify(mode.slots.map((slot) => [slot.kind, slot.min, slot.max]))}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ label: `${archetype.id}${vendor ? `@${vendor}` : ''}/${mode.id}`, mode })
      }
    }
  }
  return out
}

describe('frameSwapKeepsSendable：对调后发得出去 ⇄ 才可点', () => {
  const modes = frameModes()
  it('至少覆盖到首帧必填 / 尾帧可不放 两种档案（穷举不是空的）', () => {
    expect(modes.length).toBeGreaterThan(3)
    expect(modes.some(({ mode }) => mode.slots.find((slot) => slot.kind === 'last_frame')?.min === 0)).toBe(true)
    expect(modes.some(({ mode }) => mode.slots.find((slot) => slot.kind === 'last_frame')?.min === 1)).toBe(true)
  })
  for (const { label, mode } of modes) {
    for (const filled of [{ first: true, last: false }, { first: false, last: true }, { first: true, last: true }]) {
      it(`${label} · 首帧${filled.first ? '有' : '空'} 尾帧${filled.last ? '有' : '空'}`, () => {
        expect(frameSwapKeepsSendable(mode, filled)).toBe(modeTakesAllInputs(mode, swappedInputs(filled)))
      })
    }
  }
  it('两张都放时任何首尾帧方式都可对调', () => {
    for (const { mode } of modes) expect(frameSwapKeepsSendable(mode, { first: true, last: true })).toBe(true)
  })
  it('反例：首帧必填、尾帧可不放，只放首帧 → 不可点', () => {
    const mode = modes.find(({ mode: m }) => m.slots.find((slot) => slot.kind === 'first_frame')?.min === 1 && m.slots.find((slot) => slot.kind === 'last_frame')?.min === 0)?.mode
    expect(mode).toBeTruthy()
    expect(frameSwapKeepsSendable(mode!, { first: true, last: false })).toBe(false)
  })
  it('没有首尾帧格的方式没有对调', () => {
    const mode = { id: 'x', slots: [{ kind: 'first_frame', label: '首帧', min: 1, max: 1 }], params: [] } as unknown as ArchetypeMode
    expect(frameSwapKeepsSendable(mode, { first: true, last: true })).toBe(false)
  })
})
