import { describe, expect, it, vi } from 'vitest'
import { buildTelemetryEnvelope } from './telemetryEvents'
import { sendAptabaseBatch } from './aptabaseAdapter'

describe('Aptabase adapter', () => {
  it('sends only validated batches to the current endpoint contract', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 202 }))
    const event = buildTelemetryEnvelope({ eventName: 'feature.used', props: { featureId: 'generation', result: 'success' } }, 'session', '1.2.0')
    await sendAptabaseBatch([event], { fetch, appKey: 'A-EU-test', endpoint: 'https://example.test/api/v0/events' })
    expect(fetch).toHaveBeenCalledWith('https://example.test/api/v0/events', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'App-Key': 'A-EU-test' }) }))
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toHaveLength(1)
  })
})
