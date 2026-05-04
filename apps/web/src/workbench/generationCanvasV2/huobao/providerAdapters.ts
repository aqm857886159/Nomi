export const HUOBAO_PROVIDER = 'chatfire'
export const HUOBAO_DEFAULT_BASE_URL = 'https://api.chatfire.site'

export type HuobaoRequestInput = {
  url: string
  method: 'GET' | 'POST'
  data?: unknown
  headers?: Record<string, string>
}

export type HuobaoRequest = (input: HuobaoRequestInput) => Promise<unknown>

export function readHuobaoBaseUrl(): string {
  if (typeof window === 'undefined') return HUOBAO_DEFAULT_BASE_URL
  try {
    const byProvider = JSON.parse(window.localStorage.getItem('base-urls-by-provider') || '{}') as Record<string, unknown>
    const configured = typeof byProvider[HUOBAO_PROVIDER] === 'string' ? byProvider[HUOBAO_PROVIDER].trim() : ''
    return configured || HUOBAO_DEFAULT_BASE_URL
  } catch {
    return HUOBAO_DEFAULT_BASE_URL
  }
}

export function readHuobaoApiKey(): string {
  if (typeof window === 'undefined') return ''
  try {
    const byProvider = JSON.parse(window.localStorage.getItem('api-keys-by-provider') || '{}') as Record<string, unknown>
    const firebaoKey = typeof byProvider[HUOBAO_PROVIDER] === 'string' ? byProvider[HUOBAO_PROVIDER].trim() : ''
    if (firebaoKey) return firebaoKey
  } catch {
    // ignore
  }
  try {
    return window.localStorage.getItem('tapcanvas_public_api_key')?.trim() || ''
  } catch {
    return ''
  }
}

export function buildHuobaoUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const baseUrl = readHuobaoBaseUrl().replace(/\/+$/, '')
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`
  return `${baseUrl}${path}`
}

export async function defaultHuobaoRequest(input: HuobaoRequestInput): Promise<unknown> {
  const apiKey = readHuobaoApiKey()
  if (!apiKey) {
    throw new Error('缺少生成渠道 API Key，请先配置生成渠道密钥')
  }

  const response = await fetch(buildHuobaoUrl(input.url), {
    method: input.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(input.headers || {}),
    },
    body: input.method === 'POST' ? JSON.stringify(input.data || {}) : undefined,
  })

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? String((payload as { message?: unknown }).message || '')
      : ''
    throw new Error(message || `生成渠道请求失败：${response.status}`)
  }
  return payload
}

export function adaptHuobaoImageRequest(params: {
  model: string
  prompt: string
  size?: string
  quality?: string
  style?: string
  image?: string
}): Record<string, unknown> {
  return {
    model: params.model,
    prompt: params.prompt,
    ...(params.size ? { size: params.size } : {}),
    ...(params.quality ? { quality: params.quality } : {}),
    ...(params.style ? { style: params.style } : {}),
    ...(params.image ? { image: params.image } : {}),
  }
}

export function adaptHuobaoVideoRequest(params: {
  model: string
  prompt: string
  resolution?: string
  size?: string
  seconds?: number
  firstFrameImage?: string
  lastFrameImage?: string
  generateAudio?: boolean
}): Record<string, unknown> {
  const model = params.model || ''
  if (model.includes('seedance')) {
    let textPrompt = params.prompt || ''
    if (params.resolution) textPrompt += ` --resolution ${params.resolution}`
    if (params.size) textPrompt += ` --ratio ${params.size}`
    if (params.seconds) textPrompt += ` --dur ${params.seconds}`
    textPrompt += ' --fps 24'
    textPrompt += ' --wm true'
    textPrompt += ' --cf false'

    const content: Array<Record<string, unknown>> = [{ type: 'text', text: textPrompt }]
    if (params.firstFrameImage) {
      content.push({
        type: 'image_url',
        image_url: { url: params.firstFrameImage },
      })
    }
    return {
      model,
      content,
      generate_audio: params.generateAudio !== false,
    }
  }

  return {
    model,
    prompt: params.prompt || '',
    ...(params.firstFrameImage ? { first_frame_image: params.firstFrameImage } : {}),
    ...(params.lastFrameImage ? { last_frame_image: params.lastFrameImage } : {}),
    ...(params.size ? { size: params.size } : {}),
    ...(params.seconds ? { seconds: params.seconds } : {}),
  }
}
