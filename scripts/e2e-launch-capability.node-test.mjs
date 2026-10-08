import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { _electron as electron } from 'playwright'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

// Exercise the real assembly boundary; replace only the expensive Electron spawn.
for (const scenario of ['env', 'explicit', 'inherited', 'derived', 'non-isolated']) {
  test(`capability directory has one source: ${scenario}`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-launch-capability-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const inherited = process.env.NOMI_CAPABILITY_DIR
    delete process.env.NOMI_CAPABILITY_DIR
    t.after(() => {
      if (inherited === undefined) delete process.env.NOMI_CAPABILITY_DIR
      else process.env.NOMI_CAPABILITY_DIR = inherited
    })
    const options = {
      tempRoot: root,
      executablePath: '/fixture/Nomi',
      waitForWindow: false,
      env: {},
      allowUntrackedProcessForTest: true,
    }
    let expected
    if (scenario === 'env' || scenario === 'explicit') {
      options.env.NOMI_CAPABILITY_DIR = path.join(root, 'shared')
      process.env.NOMI_CAPABILITY_DIR = path.join(root, 'inherited')
      expected = options.env.NOMI_CAPABILITY_DIR
    }
    if (scenario === 'explicit') {
      options.capabilityDir = path.join(root, 'explicit')
      expected = options.capabilityDir
    }
    if (scenario === 'inherited') {
      process.env.NOMI_CAPABILITY_DIR = path.join(root, 'inherited')
      expected = process.env.NOMI_CAPABILITY_DIR
    }
    if (scenario === 'derived') expected = path.join(root, 'capability')
    if (scenario === 'non-isolated') options.isolate = false
    let launched
    t.mock.method(electron, 'launch', async (launchOptions) => {
      launched = launchOptions
      return { process: () => ({}) }
    })
    const handle = await launchNomiApp(options)
    assert.equal(launched.env.NOMI_CAPABILITY_DIR, expected)
    assert.equal(handle.capabilityDir, expected ?? null)
    if (expected) assert.ok(fs.statSync(expected).isDirectory())
    if (scenario !== 'derived') assert.equal(fs.existsSync(path.join(root, 'capability')), false)
  })
}
