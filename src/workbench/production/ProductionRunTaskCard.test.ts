import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { describe, expect, it, vi } from 'vitest'
import { ProductionRunTaskCard } from './ProductionRunTaskCard'
import type { ProductionRunView } from './productionRunView'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))

const view: ProductionRunView = {
  group: 'attention', tone: 'attention', playbookLabelKey: 'generationCommon.production.playbook.brandPromo', titleKey: 'generationCommon.production.status.paused',
  descriptionKey: 'generationCommon.production.description.paused', primaryAction: 'resume-run',
  controls: ['cancel'], decisionHome: 'nomi', originHost: 'nomi',
  details: {
    completedStages: 0, totalStages: 0, stages: [], skills: [], updatedAt: '2026-09-09T00:00:00Z',
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
  },
}
function render(actionError: string | null) {
  return renderToStaticMarkup(React.createElement(MantineProvider, {
    children: React.createElement(ProductionRunTaskCard, {
      projectId: 'project-1', view, actionError, onPrimaryAction: vi.fn(), onControl: vi.fn(),
    }),
  }))
}

describe('production task feedback', () => {
  it('shows the failure beside the retained action, without a dialog', () => {
    const html = render('Revision changed; retry')
    expect(html).toContain('data-production-primary-action')
    expect(html).toContain('data-production-action-error')
    expect(html).toContain('role="status"')
    expect(html).toContain('Revision changed; retry')
    expect(html.indexOf('data-production-primary-action')).toBeLessThan(html.indexOf('data-production-action-error'))
    expect(html).not.toContain('role="dialog"')
  })
  it('removes the old failure when the host clears it for a retry', () => {
    expect(render(null)).not.toContain('data-production-action-error')
  })
})
