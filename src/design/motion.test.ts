import { describe, expect, it } from 'vitest'
import { buildNomiTheme } from '../theme/nomiTheme'
import { exitDurationMs, NOMI_DURATION_MS, NOMI_DURATION_VARS } from './motion'

describe('workbench motion scale', () => {
  it('publishes six base tiers and derives each exit, including non-tier input', () => {
    expect(NOMI_DURATION_MS).toEqual({ instant: 0, micro: 110, fast: 150, normal: 220, spatial: 360, morph: 550 })
    expect([0, 150, 220, 360, 410].map(exitDurationMs)).toEqual([0, 100, 150, 240, 270])
    for (const tier of ['fast', 'normal', 'spatial'] as const) {
      expect(NOMI_DURATION_VARS[`--nomi-duration-${tier}-exit`]).toBe(`${exitDurationMs(NOMI_DURATION_MS[tier])}ms`)
    }
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
