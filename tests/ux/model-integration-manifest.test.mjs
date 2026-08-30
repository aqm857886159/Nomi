import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../../evals/model-integration')
const manifestPath = path.join(root, 'local-automated-2026-08-29.json')

describe('model integration release manifest', () => {
  it('is redacted and keeps live partial evidence distinct from unverified boundaries', () => {
    const raw = fs.readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(raw)
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.evidencePolicy).toContain('redacted')
    expect(raw).not.toMatch(/\b(?:sk-|AIza|AKIA|Bearer\s+[A-Za-z0-9._-]{12,}|apiKey\s*[:=])/i)
    expect(manifest.journeys.J0.unsignedWritesRejected).toBe(true)
    expect(manifest.journeys.J0.credentialBytesInResults).toBe(0)
    expect(manifest.journeys.J1.status).toBe('partial')
    expect(manifest.journeys.J1.selectedModels).toBe(1)
    expect(manifest.journeys.J1.paginationComplete).toBe(false)
    expect(manifest.journeys.J1.capabilities.chat).toMatchObject({
      status: 'pass',
      verifiedModes: 1,
      attempts: 1,
    })
    expect(manifest.journeys.J1.failureReasonCodes).toContain('full_multi_provider_matrix_pending')
    expect(manifest.journeys.J2.status).toBe('unverified')
    expect(manifest.externalHost.workBuddy).toBe('unverified')
  })

  it('records no-spend restart evidence without claiming an upgrade pass', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.journeys.J4.freshProcessReadback).toBe(true)
    expect(manifest.journeys.J4.restartReadback).toBe(true)
    expect(manifest.journeys.J4.upgradeReadback).toBe(false)
    expect(manifest.journeys.J4.duplicateCreateCount).toBe(0)
  })
})
