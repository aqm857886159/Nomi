import { makeTempDirAsync } from '../../scripts/_test-temp.mjs'
import { test, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { collectNewFeelSurfaces, updateFeelLedger } from '../../scripts/feel-nightly.mjs'
import { applyFeelExemptions, compareFeelBaseline, exemptionEvidenceGrowth, recordNewFeelSurfaces } from './_feel-observer.mjs'

const finding = { rule: 'font-size', target: ['span'], text: ['Badge'], fontSizes: [11] }
const exemptions = { entries: [{ label: 'state', rule: 'font-size', owner: 'typography', reason: 'Reviewed badge', findings: [finding] }] }
const result = (findings, label = 'state') => ({ label, journey: 'agent-panel', screenshotName: label + '.png', findings })

test('reviewed findings remain evidence while unrelated rules, states and smaller text fail', () => {
  const known = applyFeelExemptions(result([finding]), exemptions)
  expect(known.result.findings).toEqual([])
  expect(known.exempted).toEqual([finding])
  for (const changed of [
    { ...finding, rule: 'clipped-content' },
    { ...finding, text: ['New badge'] },
    { ...finding, target: ['button'] },
    { ...finding, fontSizes: [10] },
  ]) {
    const remaining = applyFeelExemptions(result([changed]), exemptions).result
    expect(compareFeelBaseline(remaining, { entries: [{ journey: 'agent-panel', screenshotName: 'state.png', rule: changed.rule, count: 0 }] })[0].kind).toBe('new')
  }
  expect(applyFeelExemptions(result([finding], 'another-state'), exemptions).result.findings).toEqual([finding])
})

test('one reviewed element cannot exempt an additional identical element', () => {
  const reviewed = applyFeelExemptions(result([finding, finding]), exemptions)
  expect(reviewed.exempted).toEqual([finding])
  expect(compareFeelBaseline(reviewed.result, { entries: [{ journey: 'agent-panel', screenshotName: 'state.png', rule: 'font-size', count: 0 }] })).toEqual([
    { rule: 'font-size', actual: 1, allowed: 0, kind: 'new' },
  ])
})

test('unregistered surfaces record while explicit zero and known counts still ratchet', () => {
  const baseline = { entries: [{ journey: 'agent-panel', screenshotName: 'state.png', rule: 'font-size', count: 0 }] }
  expect(compareFeelBaseline(result([finding], 'new-journey'), baseline)).toEqual([])
  expect(compareFeelBaseline(result([{ rule: 'text-overlap' }]), baseline)).toEqual([])
  expect(compareFeelBaseline(result([finding]), baseline)).toEqual([
    { rule: 'font-size', actual: 1, allowed: 0, kind: 'new' },
  ])
  expect(compareFeelBaseline(result([finding, finding]), { entries: [{ journey: 'agent-panel', screenshotName: 'state.png', rule: 'font-size', count: 1 }] })[0].actual).toBe(2)
})

test('nightly collects every run including nested runs without discarding findings', async () => {
  const dir = await makeTempDirAsync('feel-nightly-')
  try {
    const surface = { label: 'new-journey', rule: finding.rule, mode: 'record', findings: [finding], screenshot: 'evidence.png' }
    for (const run of ['run-a', 'nested/run-b']) {
      await fs.mkdir(path.join(dir, run), { recursive: true })
      await fs.writeFile(path.join(dir, run, 'new-surfaces.json'), JSON.stringify([surface]))
    }
    const ledgerPath = path.join(dir, 'first-sweep-ledger.json')
    const seeds = [{ count: 37, evidence: 'original macOS receipt' }]
    await fs.writeFile(ledgerPath, JSON.stringify({ seeds, records: [] }))
    const records = await collectNewFeelSurfaces(dir)
    expect(records).toHaveLength(2)
    for (const record of records) expect(record).toMatchObject(surface)
    expect(new Set(records.map((record) => record.source)).size).toBe(2)
    await updateFeelLedger(dir, records)
    await updateFeelLedger(dir, [records[0]])
    expect(JSON.parse(await fs.readFile(ledgerPath, 'utf8'))).toEqual({ seeds, records })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('shipped smoke registration still rejects an extra reviewed-looking element', async () => {
  const baseline = JSON.parse(await fs.readFile(new URL('./feel-baseline.json', import.meta.url), 'utf8'))
  const reviewed = JSON.parse(await fs.readFile(new URL('./feel-exemptions.json', import.meta.url), 'utf8'))
  const entry = reviewed.entries[0]
  const findings = entry.findings.map((item) => ({ ...item, rule: entry.rule }))
  const clean = applyFeelExemptions({ ...result(findings, entry.label), journey: 'smoke', screenshotName: 'waitForFunction.png' }, reviewed).result
  expect(compareFeelBaseline(clean, baseline)).toEqual([])
  const extra = applyFeelExemptions({ ...result([...findings, findings[0]], entry.label), journey: 'smoke', screenshotName: 'waitForFunction.png' }, reviewed).result
  expect(compareFeelBaseline(extra, baseline)).toEqual([{ rule: entry.rule, actual: 1, allowed: 0, kind: 'new' }])
})


test('only declared journeys ratchet and screenshot budgets never bleed into other steps', () => {
  const baseline = { entries: [{ journey: 'agent-panel', screenshotName: 'one.png', rule: 'font-size', count: 0 }] }
  const scan = { ...result([finding]), journey: 'agent-panel', screenshotName: 'one.png' }
  expect(compareFeelBaseline(scan, baseline)[0].kind).toBe('new')
  expect(compareFeelBaseline({ ...scan, screenshotName: 'two.png' }, baseline)).toEqual([])
  for (const journey of ['eval-iso', 'real-user-test-gates', 'production-mcp', 'agent-panel-imposter']) {
    const real = { ...scan, journey }
    const stale = { entries: [{ ...baseline.entries[0], journey }] }
    expect(compareFeelBaseline(real, stale)).toEqual([])
    expect(recordNewFeelSurfaces(real, stale)).toEqual([expect.objectContaining({ journey, screenshotName: 'one.png', mode: 'record', findings: [finding] })])
  }
})

// 例外证据棘轮按 (target, fontSizes) 计数，文案只是说明（PR #1099：改文案不该被当成「例外变多」）。
test('exemption ratchet: same element with reworded text is not growth', () => {
  const old = [finding]
  expect(exemptionEvidenceGrowth(old, [{ ...finding, text: ['Reworded badge'] }])).toEqual([])
})

test('exemption ratchet: an extra element of the same kind on the surface is still growth', () => {
  const old = [{ rule: 'font-size', target: ['div'], text: ['A'], fontSizes: [11] }]
  const extra = { rule: 'font-size', target: ['div'], text: ['B'], fontSizes: [11] }
  expect(exemptionEvidenceGrowth(old, [old[0], extra])).toEqual([extra])
  expect(exemptionEvidenceGrowth(old, [{ ...old[0], fontSizes: [10] }])).toHaveLength(1)
})
