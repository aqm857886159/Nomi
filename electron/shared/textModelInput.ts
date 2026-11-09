import { isAiSdkProviderKind, type AI_SDK_PROVIDER_KINDS } from './contracts/modelAccessCapabilities'

export type TextProviderKind = (typeof AI_SDK_PROVIDER_KINDS)[number]
export type TextModelInputSettings = {
  providerKind: TextProviderKind | 'inherit'
  image?: boolean
  audio: boolean
  video: boolean
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Model-local protocol overrides let a mixed relay use native Gemini without changing its other models. */
export function textModelInputSettings(meta: unknown): TextModelInputSettings {
  const source = record(meta)
  return {
    providerKind: isAiSdkProviderKind(source.textProviderKind) ? source.textProviderKind : 'inherit',
    ...(typeof source.supportsImageInput === 'boolean' ? { image: source.supportsImageInput } : {}),
    audio: source.supportsAudioInput === true,
    video: source.supportsVideoInput === true,
  }
}

export function replaceTextModelInputSettings(meta: unknown, settings: TextModelInputSettings): Record<string, unknown> {
  const next = { ...record(meta), ...(settings.image === undefined ? {} : { supportsImageInput: settings.image }), supportsAudioInput: settings.audio, supportsVideoInput: settings.video }
  const result: Record<string, unknown> = next
  if (settings.providerKind === 'inherit') delete result.textProviderKind
  else result.textProviderKind = settings.providerKind
  return result
}

/** Shared native base for discovery and generation, preserving a relay's path prefix. */
export function googleGenerativeBaseUrl(value: string): string {
  const url = new URL(value.trim())
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/v1beta\/openai$/i, '/v1beta').replace(/\/v1$/i, '/v1beta')
  if (!/\/v\d+(?:alpha|beta)?$/i.test(path)) path += '/v1beta'
  url.pathname = path
  return url.toString().replace(/\/$/, '')
}
