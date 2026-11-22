import { expect, it } from 'vitest'
import fs from 'node:fs'
import { confirmLockExitSpend, LOCK_EXIT_JOURNEY_CONDITIONS, assertLockExitHostingReceipt } from './_generationLockExitHosting.mjs'

function surface(cards = []) {
  let current = 0
  const events = []
  const page = { locator: selector => ({
    isVisible: async () => selector.includes('data-hosting-disclosure') ? Boolean(cards[current]?.hosting) : Boolean(cards[current]),
    count: async () => cards[current] ? 1 : 0,
    check: async () => events.push('remember'),
    click: async () => { events.push('confirm'); current++ },
    waitFor: async () => {},
  }) }
  return { page, events, done: () => current === cards.length }
}
it('allows no card when the business action completes', async () => {
  const s = surface(), report = {}
  await confirmLockExitSpend(s.page, report, { until: s.done })
  expect(s.events).toEqual([])
})
it('confirms sequential batch cards without hosting consent', async () => {
  const s = surface([{}, {}, {}]), report = {}
  await confirmLockExitSpend(s.page, report, { until: s.done, context: 'batch-storyboard' })
  expect(s.events).toEqual(['confirm', 'confirm', 'confirm'])
  expect(report.observations.batchConfirmations.map(o => o.hostingDisclosure)).toEqual([false, false, false])
  expect(report.observations.hostingConsents).toEqual([])
})
it('requires batch confirmation and rejects a resurrected hosting disclosure', () => {
  const receipt = { report: { observations: { batchConfirmations: [{ hostingDisclosure: false }] }, journeyConditions: { ...LOCK_EXIT_JOURNEY_CONDITIONS } } }
  expect(() => assertLockExitHostingReceipt(receipt)).not.toThrow()
  for (const batchConfirmations of [undefined, [], [{ hostingDisclosure: true }]]) {
    expect(() => assertLockExitHostingReceipt({ report: { ...receipt.report, observations: { batchConfirmations } } })).toThrow()
  }
  expect(() => assertLockExitHostingReceipt({ report: { ...receipt.report, journeyConditions: { ...LOCK_EXIT_JOURNEY_CONDITIONS, anonymousAssetHosting: 'allow' } } })).toThrow()
})
it('paid and free entries consume the same hosting conditions', () => {
  for (const name of ['generation-lock-exit-real.paid.mjs', '_generationLockExitRehearsal.mjs']) {
    const source = fs.readFileSync(new URL(name, import.meta.url), 'utf8')
    expect(source).toContain('LOCK_EXIT_JOURNEY_CONDITIONS')
    expect(source).toContain('applyLockExitJourneyConditions')
  }
})
it('the rehearsal supplier provides real inline image bytes and the local relay stores those bytes', async () => {
  const { createAgentRuntimeFixture, FIXTURE_APIMART_MODEL } = await import('./agent-runtime-fixture.mjs')
  const { startUploadRelay } = await import('./full-walk/uploadRelay.mjs')
  const path = await import('node:path')
  const parent = path.resolve(process.env.NOMI_LOCK_EXIT_OUT || '.tmp/generation-lock-exit')
  fs.mkdirSync(parent, { recursive: true })
  const temp = fs.mkdtempSync(path.join(parent, 'hosting-unit-'))
  let fixture, relay
  try {
    fixture = await createAgentRuntimeFixture({ rootDir: process.cwd(), settingsDir: path.join(temp, 'settings'), generationProvider: 'apimart', userDataDir: path.join(temp, 'user-data'), appName: 'nomi', seedApimartKey: false })
    fixture.setMediaBehavior(() => ({ inlineResult: true }))
    const submitted = await (await fetch(`${fixture.baseURL}/v1/images/generations`, { method: 'POST', body: JSON.stringify({ model: FIXTURE_APIMART_MODEL }) })).json()
    const result = await (await fetch(`${fixture.baseURL}/v1/tasks/${submitted.data[0].task_id}`)).json()
    const url = result.data.result.images[0].url[0]
    expect(url).toMatch(/^data:image\/jpeg;base64,/)
    const bytes = Buffer.from(url.split(',')[1], 'base64')
    expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255])
    relay = await startUploadRelay()
    const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'reference.jpg')
    const uploaded = await (await fetch(relay.env.NOMI_ASSET_RELAY_URL, { method: 'POST', body: form })).json()
    expect(Buffer.from(await (await fetch(uploaded.url)).arrayBuffer())).toEqual(bytes)
    expect(relay.uploads).toHaveLength(1)
  } finally { if (fixture) await fixture.close(); if (relay) await relay.close(); fs.rmSync(temp, { recursive: true, force: true }) }
})
