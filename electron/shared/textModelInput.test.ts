import { describe, expect, it } from 'vitest'
import { googleGenerativeBaseUrl, replaceTextModelInputSettings, textModelInputSettings } from './textModelInput'

describe('text model native input settings', () => {
  it('preserves legacy text/image behavior without claiming audio or video support', () => {
    expect(textModelInputSettings(undefined)).toEqual({ providerKind: 'inherit', audio: false, video: false })
    expect(replaceTextModelInputSettings({}, textModelInputSettings(undefined))).not.toHaveProperty('supportsImageInput')
    expect(textModelInputSettings({ supportsImageInput: false })).toMatchObject({ image: false })
    expect(textModelInputSettings({ supportsAudioInput: 'true', supportsVideoInput: 1 })).toMatchObject({ audio: false, video: false })
  })

  it('round trips an explicit native override without replacing unrelated metadata', () => {
    const source = { adapter: { state: 'verified' }, customSetting: 42, textProviderKind: 'openai-compatible' }
    const settings = { providerKind: 'google-generative-ai' as const, image: true, audio: true, video: true }
    const meta = replaceTextModelInputSettings(source, settings)
    expect(textModelInputSettings(meta)).toEqual(settings)
    expect(meta).toMatchObject({ adapter: { state: 'verified' }, customSetting: 42 })
    expect(source.textProviderKind).toBe('openai-compatible')
    expect(replaceTextModelInputSettings(meta, { ...settings, providerKind: 'inherit' })).not.toHaveProperty('textProviderKind')
  })

  it.each([
    ['https://generativelanguage.googleapis.com', 'https://generativelanguage.googleapis.com/v1beta'],
    ['https://relay.example/proxy/v1', 'https://relay.example/proxy/v1beta'],
    ['https://relay.example/proxy/v1beta/', 'https://relay.example/proxy/v1beta'],
    ['https://relay.example/proxy/v1beta/openai', 'https://relay.example/proxy/v1beta'],
    ['https://relay.example/proxy/v1alpha', 'https://relay.example/proxy/v1alpha'],
  ])('normalizes native base %s without losing gateway prefixes', (input, output) => {
    expect(googleGenerativeBaseUrl(input)).toBe(output)
  })
})
