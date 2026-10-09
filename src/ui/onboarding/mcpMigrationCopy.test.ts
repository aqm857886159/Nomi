import { describe, expect, it } from 'vitest'

import { enOnboardingProviders, zhOnboardingProviders } from '../../i18n/locales/onboardingProviders'
import { FAILURE_I18N } from './McpMigrationPrompt'

const BANNED = /MCP|HTTP|口令|预算|价格|budget|price|token|proof/i
const flat = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(flat) : []

describe('迁移提示文案', () => {
  const locales = { zh: zhOnboardingProviders.assistant, en: enOnboardingProviders.assistant }

  it.each(Object.entries(locales))('%s：不出现协议名、口令、价格这类词', (_name, assistant) => {
    for (const text of [...flat(assistant.migration), assistant.openNomiFirst]) expect(text).not.toMatch(BANNED)
  })

  it.each(Object.entries(locales))('%s：每个失败原因都有人话，且说清原来的连接怎么样', (_name, assistant) => {
    for (const key of new Set(Object.values(FAILURE_I18N))) {
      expect((assistant.migration.failed as Record<string, string>)[key], key).toBeTruthy()
    }
    expect(assistant.migration.failed.unavailable).toMatch(/原来的连接照常可用|old connection keeps working/)
  })
})
