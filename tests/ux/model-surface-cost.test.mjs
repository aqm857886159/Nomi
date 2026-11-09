import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { costError, createModelCostProxy, MODEL_COST } from './_modelSurfaceCostSupport.mjs'

describe('one image cost sample boundary', () => {
  it('forwards at most one matching POST, even after a failed attempt, and rejects other models/endpoints', async () => {
    let forwarded = 0
    const proxy = await createModelCostProxy('http://127.0.0.1:1', { reply: () => { forwarded++; return { status: 500, body: { error: 'synthetic refusal' } } } })
    const body = { model: MODEL_COST.modelKey, prompt: 'one circle', size: MODEL_COST.size, resolution: '1k', quality: 'low', background: 'auto' }
    const post = (route, input) => fetch(proxy.origin + route, { method: 'POST', body: JSON.stringify(input) })
    try {
      expect((await post('/v1/videos/generations', body)).status).toBe(403)
      expect((await post('/v1/images/generations', { ...body, model: 'another-model' })).status).toBe(403)
      expect((await post('/v1/images/generations', { ...body, n: 2 })).status).toBe(403)
      const results = await Promise.all([post('/v1/images/generations', body), post('/v1/images/generations', body)])
      expect(results.map(r => r.status).sort()).toEqual([403, 500])
      expect(forwarded).toBe(1)
      expect(proxy.records).toHaveLength(1)
      expect((await post('/v1/images/generations', body)).status).toBe(403)
      expect(forwarded).toBe(1)
    } finally { await proxy.close() }
  })

  it('records absolute and estimate-denominator percentage without a pass/fail tolerance', () => {
    expect(costError(0.001344, 0.0015).absolute).toBeCloseTo(0.000156, 12)
    expect(costError(0.001344, 0.0015).percentOfEstimate).toBeCloseTo(11.607142857, 7)
    expect(costError(0.001344, 100).percentOfEstimate).toBeGreaterThan(100)
  })

  it('refuses missing opt-in and an expired receipt in the real entry, without granting spend', () => {
    const env = { ...process.env }
    delete env.NOMI_SPEND_OK
    delete env.NOMI_MODEL_COST_REHEARSAL_RECEIPT
    delete env.APIMART_API_KEY
    delete env.CI
    const entry = path.resolve('tests/ux/apimart-model-surfaces-cost.paid.mjs')
    const noOptIn = spawnSync(process.execPath, [entry], { env, encoding: 'utf8' })
    expect(noOptIn.status).not.toBe(0)
    expect(noOptIn.stderr).toContain('NOMI_SPEND_OK=1')
    const root = makeTempDir('nomi-cost-expired-')
    try {
      const file = path.join(root, 'receipt.json')
      fs.writeFileSync(file, JSON.stringify({ status: 'passed', finishedAt: '2000-01-01T00:00:00Z' }))
      const expired = spawnSync(process.execPath, [entry], { env: { ...env, NOMI_MODEL_COST_REHEARSAL_RECEIPT: file }, encoding: 'utf8' })
      expect(expired.status).not.toBe(0)
      expect(expired.stderr).toContain('receipt expired')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
