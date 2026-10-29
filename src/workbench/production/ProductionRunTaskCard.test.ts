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
    completedStages: 1, totalStages: 2, updatedAt: '2026-09-09T00:00:00Z',
    stages: [{ stageId: 'script', title: 'Script', status: 'completed' }, { stageId: 'generate', title: 'Generate', status: 'running' }],
    skills: [{ name: 'brand.promo', version: '1' }],
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

// 界面不谈钱（2026-10-27）：制作详情原来有四个金额格，值是把账本合计现算成货币——合计只加已知价、实付从不回写，
// 印出来的零金额没有依据。详情只剩阶段、技能、更新时间；视图类型里也不再有预算。
describe('production details', () => {
  it('shows stages, skills and update time, and no money cell', () => {
    const html = render(null)
    expect(html, '详情确实渲染出来了').toContain('generationCommon.production.runDetails.stages')
    expect(html).toContain('generationCommon.production.runDetails.skills')
    expect(html).not.toMatch(/runDetails\.(?:authorized|reserved|actual|unsettled)/)
    expect(html, '没有货币符号或货币码').not.toMatch(/[¥￥$€£]|\b(?:USD|CNY|RMB|EUR|JPY|GBP)\b/)
  })
})
