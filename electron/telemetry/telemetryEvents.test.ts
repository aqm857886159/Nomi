import { describe, expect, it } from 'vitest'
import { buildTelemetryEnvelope, durationBucket, isTelemetryEnvelope, isTelemetryProps } from './telemetryEvents'

describe('telemetry event contract', () => {
  it('uses fixed enums and rejects free text or extra fields', () => {
    expect(isTelemetryProps({ featureId: 'generation', result: 'success' }, 'feature.used')).toBe(true)
    expect(isTelemetryProps({ featureId: 'generation', result: 'success', prompt: 'secret' }, 'feature.used')).toBe(false)
    expect(isTelemetryProps({ featureId: 'unknown', result: 'success' }, 'feature.used')).toBe(false)
  })

  it('bucketizes durations and validates the complete envelope', () => {
    expect(durationBucket(0)).toBe('<1s')
    expect(durationBucket(5000)).toBe('1-5s')
    const envelope = buildTelemetryEnvelope({ eventName: 'generation.completed', props: { capability: 'image', durationBucket: '<1s', result: 'success', attemptCountBucket: '1' } }, 'short-session', '1.2.3')
    expect(isTelemetryEnvelope(envelope)).toBe(true)
    expect(isTelemetryEnvelope({ ...envelope, props: { ...envelope.props, prompt: 'secret' } })).toBe(false)
  })
})
