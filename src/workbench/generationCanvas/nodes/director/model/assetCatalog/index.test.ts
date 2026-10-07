import { describe, expect, it } from 'vitest'
import { DIRECTOR_ASSET_CATALOG, DIRECTOR_PLANNER_ASSETS } from './index'
import { UAL_ACTIONS } from './ualActions'

describe('director A asset catalog', () => {
  it('keeps planner projection compact and one-to-one', () => {
    expect(DIRECTOR_ASSET_CATALOG.length).toBeGreaterThan(15)
    expect(new Set(DIRECTOR_ASSET_CATALOG.map((asset) => asset.id)).size).toBe(DIRECTOR_ASSET_CATALOG.length)
    expect(DIRECTOR_PLANNER_ASSETS).toHaveLength(DIRECTOR_ASSET_CATALOG.length)
    expect(DIRECTOR_ASSET_CATALOG.filter((asset) => asset.kind === 'action')).toHaveLength(45)
    expect(UAL_ACTIONS).toHaveLength(45)
    expect(new Set(UAL_ACTIONS.map((action) => action.id)).size).toBe(45)
    expect(DIRECTOR_PLANNER_ASSETS.every((asset) => !('file' in asset) && !('source' in asset))).toBe(true)
  })
})
