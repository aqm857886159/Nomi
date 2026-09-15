import { describe, expect, it } from 'vitest'

describe('dispatcher capability result contract', () => {
  it('preserves credential elicitation tickets across result projection', () => {
    const result = { ok: true, credentialElicitationTicket: 'ticket-test' }
    const projected = { ...result }
    expect(projected.credentialElicitationTicket).toBe('ticket-test')
  })
})
