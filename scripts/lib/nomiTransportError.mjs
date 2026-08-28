function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function publicCode(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{1,80}$/.test(value) ? value : null
}

function publicDetail(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= 300 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null
}

/** Convert an RPC/host envelope into one fixed safe Error without retaining a raw cause. */
export function transportErrorFromResponse(body, fallbackMessage) {
  const envelope = record(body)
  const payload = envelope?.error
  if (typeof payload === 'string') return new Error(payload || fallbackMessage)
  const details = record(payload) ?? record(envelope?.errorDetails)
  const code = publicCode(details?.code) ?? publicCode(details?.errorCode)
  if (!code) return new Error(fallbackMessage)
  const nextAction = publicDetail(details?.nextAction)
  const error = new Error(`Nomi 请求失败（${code}）${nextAction ? `。下一步：${nextAction}` : ''}`)
  error.name = 'NomiTransportError'
  error.code = code
  error.errorCode = code
  if (nextAction) error.nextAction = nextAction
  const phase = publicDetail(details?.phase)
  const capability = publicDetail(details?.capability)
  if (phase) error.phase = phase
  if (capability) error.capability = capability
  return error
}

/** One response unwrapper shared by GUI RPC and the one-shot headless host. */
export function unwrapNomiTransportResponse(body, fallbackMessage) {
  const envelope = record(body)
  if (!envelope || envelope.ok !== true) throw transportErrorFromResponse(body, fallbackMessage)
  return envelope.result
}
