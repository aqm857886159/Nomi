import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import {
  createProductionRunE2ePreflight,
  createProductionRunE2eRenderer,
  isProductionRunE2eFixtureEnabled,
} from './productionRunE2eFixture'

const require = createRequire(import.meta.url)

describe('production Run E2E fixture', () => {
  it('requires both explicit E2E flags and refuses packaged builds', () => {
    expect(isProductionRunE2eFixtureEnabled({}, false)).toBe(false)
    expect(isProductionRunE2eFixtureEnabled({ NOMI_E2E: '1' }, false)).toBe(false)
    expect(isProductionRunE2eFixtureEnabled({ NOMI_E2E_PRODUCTION_FIXTURE: '1' }, false)).toBe(false)
    expect(isProductionRunE2eFixtureEnabled({ NOMI_E2E: '1', NOMI_E2E_PRODUCTION_FIXTURE: '1' }, true)).toBe(false)
    expect(isProductionRunE2eFixtureEnabled({ NOMI_E2E: '1', NOMI_E2E_PRODUCTION_FIXTURE: '1' }, false)).toBe(true)
  })

  it('never bypasses provider preflight outside the guarded fixture', () => {
    expect(createProductionRunE2ePreflight({}, false)).toBeNull()
    expect(createProductionRunE2ePreflight({ NOMI_E2E: '1' }, false)).toBeNull()
    expect(createProductionRunE2ePreflight({ NOMI_E2E_PRODUCTION_FIXTURE: '1' }, false)).toBeNull()
    expect(createProductionRunE2ePreflight({
      NOMI_E2E: '1',
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
    }, true)).toBeNull()
    expect(createProductionRunE2ePreflight({
      NOMI_E2E: '1',
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
    }, false)).toBeTypeOf('function')
  })

  it('can reproduce a provider becoming unavailable between approval and dispatch', () => {
    const preflight = createProductionRunE2ePreflight({
      NOMI_E2E: '1',
      NOMI_E2E_PRODUCTION_FIXTURE: '1',
      NOMI_E2E_PRODUCTION_FAIL_PROVIDER_AFTER_PREFLIGHT: 'broken-relay',
    }, false)
    expect(preflight).toBeTypeOf('function')
    expect(() => preflight?.({ provider: 'broken-relay', model: 'shared-image' })).not.toThrow()
    expect(() => preflight?.({ provider: 'broken-relay', model: 'shared-image' }))
      .toThrow('E2E provider unavailable before submission: broken-relay')
    expect(() => preflight?.({ provider: 'working-relay', model: 'shared-image' })).not.toThrow()
  })

  it('materializes a playable local clip and a valid MP4 export without a provider', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-fixture-'))
    const renderer = createProductionRunE2eRenderer({ projectRootResolver: () => root })
    const plan = await renderer('production.plan-storyboard', {
      projectId: 'project-fixture', runId: 'run-fixture', brief: { goal: 'Truthful Nomi promo' },
    }, 1_000) as { plan?: { shots?: unknown[] } }
    expect(plan.plan?.shots).toHaveLength(1)

    const generated = await renderer('production.generate-node', {
      projectId: 'project-fixture', runId: 'run-fixture', jobId: 'job:run-fixture:shot-1',
    }, 30_000) as { assets?: Array<{ url?: string; thumbnailUrl?: string }> }
    expect(generated.assets?.[0]?.url).toBe('nomi-local://asset/project-fixture/assets/generated/fixture-run-fixture.mp4')
    expect(generated.assets?.[0]?.thumbnailUrl).toBe('nomi-local://asset/project-fixture/assets/generated/fixture-run-fixture.jpg')

    const exported = await renderer('production.export', {
      projectId: 'project-fixture', runId: 'run-fixture', outputName: 'nomi-run-fixture.mp4',
    }, 30_000) as { relativePath?: string }
    const exportPath = path.join(root, exported.relativePath || '')
    expect(fs.statSync(exportPath).size).toBeGreaterThan(1_000)

    const ffprobe = (require('@ffprobe-installer/ffprobe') as { path: string }).path
    const probe = JSON.parse(execFileSync(ffprobe, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', exportPath,
    ], { encoding: 'utf8' })) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string }> }
    expect(Number(probe.format?.duration)).toBeGreaterThan(0)
    expect(probe.streams?.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264')).toBe(true)
    expect(probe.streams?.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac')).toBe(true)
  }, 30_000)
})
