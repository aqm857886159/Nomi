import { describe, expect, it } from 'vitest'
import { COMPOSER_ATTACHMENT_ACCEPT } from './useComposerAttachments'

describe('resident composer attachment input contract', () => {
  it('keeps the picker filters aligned with every advertised attachment family', () => {
    for (const token of ['image/*', 'video/*', 'audio/*', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.md', '.markdown']) {
      expect(COMPOSER_ATTACHMENT_ACCEPT.split(',')).toContain(token)
    }
  })
})
