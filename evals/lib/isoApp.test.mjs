import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { isolatedAppEnv, prepareIsolation } from './isoApp.mjs'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('eval isolation catalog boundary', () => {
  test('allocates a capability directory and propagates it with the other isolated roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-iso-app-'))
    roots.push(root)

    const iso = prepareIsolation(root, { requireCatalog: false })
    const env = isolatedAppEnv(iso, {})

    expect(fs.existsSync(iso.capabilityDir)).toBe(true)
    expect(env.NOMI_CAPABILITY_DIR).toBe(iso.capabilityDir)
    expect(env.NOMI_SETTINGS_DIR).toBe(iso.settingsDir)
  })
})
