import { describe, expect, it } from 'vitest'
import { presentResidentReference, residentReferenceRole } from './residentReferenceDisplay'

const translate = (key: string, options?: Record<string, unknown>): string => {
  if (!options) return key
  return `${key}(${Object.entries(options).map(([name, value]) => `${name}=${String(value)}`).join(',')})`
}

describe('resident reference presentation', () => {
  it('uses a human-readable role for every supported reference kind', () => {
    expect(residentReferenceRole(translate, 'document')).toBe('agentResident.referenceRoleDocument')
    expect(residentReferenceRole(translate, 'canvas')).toBe('agentResident.referenceRoleCanvas')
    expect(residentReferenceRole(translate, 'preview')).toBe('agentResident.referenceRolePreview')
    expect(residentReferenceRole(translate, 'timeline')).toBe('agentResident.referenceRoleTimeline')
    expect(residentReferenceRole(translate, 'browser')).toBe('agentResident.referenceRoleBrowser')
  })

  it('does not invent a revision/state when the Host has not supplied one', () => {
    const presentation = presentResidentReference(translate, {
      id: 'canvas:selection',
      label: 'agentResident.referenceCanvas',
      kind: 'canvas',
    })
    expect(presentation.role).toBe('agentResident.referenceRoleCanvas')
    expect(presentation.state).toBeUndefined()
    expect(presentation.accessibleLabel).toBe('agentResident.referenceRoleCanvas · agentResident.referenceCanvas')
  })

  it('keeps an explicit role and change state in the progressive disclosure label', () => {
    const presentation = presentResidentReference(translate, {
      id: 'timeline:range',
      label: '00:06–00:14',
      kind: 'timeline',
      intentRole: 'agentResident.referenceRoleTimeline',
      state: 'agentResident.referenceChanged',
    })
    expect(presentation.role).toBe('agentResident.referenceRoleTimeline')
    expect(presentation.state).toBe('agentResident.referenceChanged')
    expect(presentation.accessibleLabel).toContain('agentResident.referenceChanged')
  })
})
