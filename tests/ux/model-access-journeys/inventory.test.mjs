import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scanProductionInventory } from './inventory.mjs'
import { IGNORED_DRAWER_COMPONENTS, MODEL_ACCESS_JOURNEYS, REQUIRED_PROFILES, REQUIRED_TEST_CAPABILITIES } from './manifest.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const inventory = scanProductionInventory(repoRoot)

function covered(dimension) {
  return new Set(MODEL_ACCESS_JOURNEYS.flatMap((item) => item.covers[dimension] || []))
}

describe('model access production inventory', () => {
  it('is discovered from production sources rather than the journey manifest', () => {
    expect(inventory.billingKinds).toEqual(['audio', 'image', 'model3d', 'text', 'video'])
    expect(inventory.entryComponents.length).toBeGreaterThan(5)
    expect(inventory.providerPresets.length).toBeGreaterThan(10)
  })

  it('assigns every production enum and archetype wire shape to at least one journey', () => {
    for (const dimension of ['billingKinds', 'taskKinds', 'providers', 'auth', 'ingestion', 'slots', 'outputs', 'modeShapes']) {
      const missing = inventory[dimension].filter((value) => !covered(dimension).has(value))
      expect(missing, `${dimension} missing a real user journey`).toEqual([])
    }
  })

  it('owns or explicitly excludes every locally rendered model-drawer component', () => {
    const owned = new Set(MODEL_ACCESS_JOURNEYS.flatMap((item) => item.ownsEntryComponents))
    const unknown = inventory.entryComponents.filter((component) => !owned.has(component) && !IGNORED_DRAWER_COMPONENTS[component])
    expect(unknown, 'new drawer surface needs a journey or a scoped exclusion').toEqual([])
    for (const component of Object.keys(IGNORED_DRAWER_COMPONENTS)) expect(inventory.entryComponents).toContain(component)
  })

  it('covers each production provider-preset class without pretending every brand is a new protocol', () => {
    const classes = new Set(inventory.providerPresets.map((preset) => `${preset.group || 'ungrouped'}:${preset.providerKind}`))
    expect(classes).toEqual(new Set(['official:anthropic', 'official:openai-compatible', 'relay:openai-compatible']))
    for (const preset of inventory.providerPresets) expect(covered('providers')).toContain(preset.providerKind)
  })

  it('gives every mandatory cross-dimensional profile exactly one owner', () => {
    const owners = new Map()
    for (const item of MODEL_ACCESS_JOURNEYS) {
      for (const profile of item.profiles) owners.set(profile, [...(owners.get(profile) || []), item.id])
    }
    for (const profile of REQUIRED_PROFILES) expect(owners.get(profile.id), profile.id).toHaveLength(1)
    expect([...owners.keys()].filter((id) => !REQUIRED_PROFILES.some((profile) => profile.id === id))).toEqual([])
  })

  it('covers protocol, recovery, and proof universes independently declared by the harness', () => {
    expect(new Set(REQUIRED_PROFILES.map((profile) => profile.lifecycle))).toEqual(new Set(REQUIRED_TEST_CAPABILITIES.lifecycles))
    expect(new Set(REQUIRED_PROFILES.map((profile) => profile.proof))).toEqual(new Set(REQUIRED_TEST_CAPABILITIES.resultProofs))
    expect(REQUIRED_TEST_CAPABILITIES.recoveries).toEqual(['auth', 'url', 'model-kind', 'request-shape', 'rate-limit', 'server', 'timeout', 'invalid-response', 'empty-output'])
  })

  it('points every journey at a non-empty executable script', () => {
    for (const item of MODEL_ACCESS_JOURNEYS) {
      const file = path.join(repoRoot, 'tests/ux/model-access-journeys', item.script)
      expect(fs.existsSync(file), `${item.id}: ${item.script}`).toBe(true)
      if (fs.existsSync(file)) expect(fs.statSync(file).size, `${item.id}: empty script`).toBeGreaterThan(0)
    }
  })
})

