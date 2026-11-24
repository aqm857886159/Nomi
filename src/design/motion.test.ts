import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkMotionMirror } from '../../scripts/lib/motionTokenScan.mjs'
import { buildNomiTheme } from '../theme/nomiTheme'
import { exitDurationMs, NOMI_DURATION_MS, NOMI_DURATION_VARS, NOMI_EASE_VARS } from './motion'

describe('workbench motion scale', () => {
  it('publishes six base tiers and derives each exit, including non-tier input', () => {
    expect(NOMI_DURATION_MS).toEqual({ instant: 0, micro: 110, fast: 150, normal: 220, spatial: 360, morph: 550 })
    expect([0, 150, 220, 360, 410, 550].map(exitDurationMs)).toEqual([0, 100, 150, 240, 270, 370])
    for (const tier of ['fast', 'normal', 'spatial'] as const) {
      expect(NOMI_DURATION_VARS[`--nomi-duration-${tier}-exit`]).toBe(`${exitDurationMs(NOMI_DURATION_MS[tier])}ms`)
    }
  })

  it('keeps every CSS motion declaration in parity, even when a later value would mask drift', () => {
    const css = readFileSync(new URL('../theme/nomi-tokens.css', import.meta.url), 'utf8')
    const expected = { ...NOMI_DURATION_VARS, ...NOMI_EASE_VARS }
    for (const key of Object.keys(NOMI_DURATION_VARS)) {
      const tier = /^--nomi-duration-(.+)-exit$/.exec(key)?.[1]
      if (!tier) continue
      expect(Object.hasOwn(NOMI_DURATION_MS, tier)).toBe(true)
      expected[key] = `${exitDurationMs(NOMI_DURATION_MS[tier as keyof typeof NOMI_DURATION_MS])}ms`
    }
    expect(checkMotionMirror(css, expected)).toEqual([])
    expect(checkMotionMirror(':root { --nomi-duration-fast-exit: 110ms }\n' + css, expected))
      .toContain('✗ motion mirror: --nomi-duration-fast-exit expected 100ms, got 110ms')
  })

  it('passes the same asymmetric timings to overlay consumers', () => {
    const theme = buildNomiTheme()
    expect(theme.respectReducedMotion).toBe(true)
    for (const [name, tier] of Object.entries({ Popover: 'fast', Combobox: 'fast', Menu: 'fast', Modal: 'normal', Drawer: 'normal' } as const)) {
      const duration = NOMI_DURATION_MS[tier]
      expect(theme.components?.[name]?.defaultProps?.transitionProps).toMatchObject({ duration, exitDuration: exitDurationMs(duration) })
    }
  })
})
