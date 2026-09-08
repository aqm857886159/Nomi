// Test-only reservation boundary. Prices are fetched from APIMart, never inferred from labels.
export const REAL_MODELS = Object.freeze({ text: 'gpt-5-nano', image: 'gpt-image-2', video: 'MiniMax-H3' })
export const CNY_PER_USD = 7 // Conservative budget conversion; report USD billing separately.
export const BUDGET_CNY = 8
export function publicPrices(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/g)]
    .map((m) => JSON.parse(m[1])).filter((a) => typeof a[1] === 'string').map((a) => a[1]).join('')
  const result = new Map()
  for (const match of chunks.matchAll(/\{"id":"([^"\n]+)","name":/g)) {
    let depth = 0, quoted = false, escaped = false
    for (let i = match.index; i < chunks.length; i++) {
      const ch = chunks[i]
      if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false }
      else if (ch === '"') quoted = true
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        const item = JSON.parse(chunks.slice(match.index, i + 1))
        result.set(item.id, item)
        break
      }
    }
  }
  return result
}
function positive(n) { if (!Number.isFinite(n) || n <= 0) throw new Error('C0_PRICE_UNKNOWN'); return n }
export function quoteC0(prices) {
  const fixed = (model, dimension, unit) => {
    const value = prices.get(model)?.fixed_prices
    if (value?.unit !== unit) throw new Error('C0_PRICE_UNIT_UNKNOWN')
    const item = value.items.find((i) => i.key === dimension)
    return positive(Math.max(item?.original_price ?? NaN, item?.after_discount ?? NaN))
  }
  const text = prices.get(REAL_MODELS.text)?.pricing
  if (text?.unit !== 'usd_per_million_tokens' || text?.tier_count !== 1) throw new Error('C0_TEXT_PRICE_UNKNOWN')
  const input = positive(text.rates?.input), output = positive(text.rates?.output)
  const videoPerSecondUsd = fixed(REAL_MODELS.video, '768P', 'usd_per_second')
  const imageUsd = fixed(REAL_MODELS.image, '1K', 'usd_per_image')
  // Whole published context+output limit reserved for each text request. No tokenizer estimate.
  const maxInputTokens = positive(text.limits?.max_input_tokens)
  const maxOutputTokens = positive(text.limits?.max_output_tokens)
  const textRequestUsd = (maxInputTokens * input + maxOutputTokens * output) / 1e6
  return { models: REAL_MODELS, videoPerSecondUsd, imageUsd, textRequestUsd, maxInputTokens, maxOutputTokens,
    totalUpperCny: (64 * videoPerSecondUsd + 2 * imageUsd + 16 * textRequestUsd) * CNY_PER_USD,
    source: 'https://apimart.ai/pricing', checkedAt: new Date().toISOString(), currency: 'USD', cnyPerUsd: CNY_PER_USD }
}
export function assertAffordable(quote) {
  if (!Number.isFinite(quote.totalUpperCny) || quote.totalUpperCny > BUDGET_CNY) throw new Error('C0_BLOCKED_BUDGET')
}
export function requestQuote(url, method, body, quote) {
  const target = new URL(url)
  if (target.origin !== 'https://api.apimart.ai' || target.search) throw new Error('C0_OUTBOUND_REFUSED')
  if (method === 'GET' && /^\/v1\/tasks\/[a-zA-Z0-9_-]+$/.test(target.pathname)) return null
  if (method !== 'POST' || !body || typeof body !== 'object') throw new Error('C0_OUTBOUND_REFUSED')
  if (target.pathname === '/v1/chat/completions' && body.model === REAL_MODELS.text) {
    if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > quote.maxOutputTokens)
      throw new Error('C0_OUTPUT_LIMIT_REQUIRED')
    return { path: target.pathname, model: body.model, maxTokens: body.max_tokens, upperUsd: quote.textRequestUsd }
  }
  if (target.pathname === '/v1/videos/generations' && body.model === REAL_MODELS.video
    && body.resolution === '768P' && body.duration === 8 && body.aspect_ratio === '16:9'
    && !body.video_urls?.length && !body.audio_urls?.length && !body.image_urls?.length
    && !body.first_frame_image && !body.last_frame_image && !body.webhook && (body.n ?? 1) === 1) {
    return { path: target.pathname, model: body.model, duration: 8, resolution: '768P', upperUsd: 8 * quote.videoPerSecondUsd }
  }
  if (target.pathname === '/v1/images/generations' && body.model === REAL_MODELS.image
    && body.resolution === '1k' && body.size === '16:9' && (body.n ?? 1) === 1
    && !body.image && !body.image_urls?.length && !body.webhook) {
    return { path: target.pathname, model: body.model, resolution: '1k', upperUsd: quote.imageUsd }
  }
  throw new Error('C0_UNQUOTED_REQUEST')
}
export function reserve(ledger, entry, persist) {
  const next = ledger.reservedCny + positive(entry.upperUsd) * CNY_PER_USD
  if (!Number.isFinite(next) || next > BUDGET_CNY) throw new Error('C0_BLOCKED_BUDGET')
  // Synchronous persistence precedes sending, including concurrent calls and retries.
  ledger.reservedCny = next
  ledger.requests.push({ ...entry, started: new Date().toISOString() })
  persist(ledger)
  return ledger.requests.at(-1)
}

export const budgetedFetch = ({ send, quote, ledger, persist }) => async (input, init) => {
    const request = new Request(input instanceof Request ? input.clone() : input, init)
    const target = new URL(request.url)
    // Asset downloads retain the app's original SSRF checks; authenticated APIs are APIMart only.
    if (request.method === 'GET' && target.origin !== 'https://api.apimart.ai'
      && target.protocol === 'https:' && !request.headers.has('authorization')) return send(input, init)
    let body
    try { body = request.method === 'POST' ? await request.clone().json() : undefined }
    catch { throw new Error('C0_BODY_REFUSED') }
    // Restrict output before reservation. No response/tool result is synthesized or rewritten.
    if (body?.model === REAL_MODELS.text && target.pathname === '/v1/chat/completions') {
      body.max_tokens = Math.min(body.max_tokens ?? quote.maxOutputTokens, quote.maxOutputTokens)
      if (body.max_completion_tokens !== undefined) throw new Error('C0_UNQUOTED_OUTPUT_LIMIT')
      init = { ...init, body: JSON.stringify(body), redirect: 'error' }
    }
    const entry = requestQuote(request.url, request.method, body, quote)
    if (!entry) return send(input, { ...init, redirect: 'error' })
    const row = reserve(ledger, entry, persist)
    try {
      const response = await send(input, { ...init, redirect: 'error' })
      row.httpStatus = response.status
      persist()
      return response
    } catch {
      row.transportFailed = true
      persist()
      throw new Error('C0_PROVIDER_REQUEST_FAILED')
    }
  }
