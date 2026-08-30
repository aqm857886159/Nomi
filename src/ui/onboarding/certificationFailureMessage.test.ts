import { describe, expect, it } from 'vitest'
import { certificationFailureMessage } from './certificationFailureMessage'

describe('certificationFailureMessage', () => {
  it('maps a stable main-process code through i18n and never renders raw error text', () => {
    const t = ((key: string) => ({
      'modelSetup.existingConnectionError.START_FAILED': '没能启动验证，请重试。',
      'modelSetup.saveFailedHint': '请重试。',
    }[key] || key)) as never
    const rawMainError = 'Provider exploded in English with sk-secret'

    const message = certificationFailureMessage(t, 'START_FAILED')

    expect(message).toBe('没能启动验证，请重试。')
    expect(message).not.toContain(rawMainError)
  })
})
