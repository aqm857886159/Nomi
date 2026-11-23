import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import i18next from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import { enGenerationCommon, zhGenerationCommon } from '../../i18n/locales/generationCommon'
import { ProductionRunTaskCard } from './ProductionRunTaskCard'
import type { ProductionRunView } from './productionRunView'

const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((key: string, opts?: Record<string, unknown>) =>
    opts && typeof opts.count === 'number' ? `${key}#count=${opts.count}` : key),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tSpy, i18n: { language: 'en' } }) }))

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

  it('renders localized QA verdict summary under the QA stage for unverified and all-passed runs', () => {
    const unverifiedView: ProductionRunView = {
      ...view,
      details: {
        ...view.details,
        stages: [
          {
            stageId: 'qa',
            title: 'QA',
            status: 'completed',
            qaReport: { total: 2, passedCount: 0, flaggedCount: 0, unverifiedCount: 2, unverifiedReasons: ['vision_unavailable'] },
          } as ProductionRunView['details']['stages'][number],
        ],
      },
    }
    const htmlUnverified = renderToStaticMarkup(React.createElement(MantineProvider, {
      children: React.createElement(ProductionRunTaskCard, {
        projectId: 'project-1', view: unverifiedView, actionError: null, onPrimaryAction: vi.fn(), onControl: vi.fn(),
      }),
    }))
    expect(htmlUnverified).toContain('data-production-qa-summary')
    expect(htmlUnverified).toContain('generationCommon.production.qa.allUnverified')
    expect(htmlUnverified).toContain('generationCommon.reconcile.unverifiedLabel')
    expect(htmlUnverified).not.toContain('generationCommon.production.runDetails.stageStatus.completed')

    const skippedView: ProductionRunView = {
      ...view,
      details: {
        ...view.details,
        stages: [
          {
            stageId: 'qa',
            title: 'QA',
            status: 'completed',
            qaReport: { total: 0, passedCount: 0, flaggedCount: 0, unverifiedCount: 0, skipped: true },
          } as ProductionRunView['details']['stages'][number],
        ],
      },
    }
    const htmlSkipped = renderToStaticMarkup(React.createElement(MantineProvider, {
      children: React.createElement(ProductionRunTaskCard, {
        projectId: 'project-1', view: skippedView, actionError: null, onPrimaryAction: vi.fn(), onControl: vi.fn(),
      }),
    }))
    expect(htmlSkipped).toContain('generationCommon.reconcile.unverifiedLabel')
    expect(htmlSkipped).not.toContain('generationCommon.production.runDetails.stageStatus.completed')

    const partialView: ProductionRunView = {
      ...view,
      details: {
        ...view.details,
        stages: [
          {
            stageId: 'qa',
            title: 'QA',
            status: 'completed',
            qaReport: { total: 2, passedCount: 1, flaggedCount: 0, unverifiedCount: 1, unverifiedReasons: ['vision_unavailable'] },
          } as ProductionRunView['details']['stages'][number],
        ],
      },
    }
    const htmlPartial = renderToStaticMarkup(React.createElement(MantineProvider, {
      children: React.createElement(ProductionRunTaskCard, {
        projectId: 'project-1', view: partialView, actionError: null, onPrimaryAction: vi.fn(), onControl: vi.fn(),
      }),
    }))
    expect(htmlPartial).toContain('generationCommon.production.qa.partialStatus')
    expect(htmlPartial).not.toContain('generationCommon.production.runDetails.stageStatus.completed')

    const passedView: ProductionRunView = {
      ...view,
      details: {
        ...view.details,
        stages: [
          {
            stageId: 'qa',
            title: 'QA',
            status: 'completed',
            qaReport: { total: 2, passedCount: 2, flaggedCount: 0, unverifiedCount: 0 },
          } as ProductionRunView['details']['stages'][number],
        ],
      },
    }
    const htmlPassed = renderToStaticMarkup(React.createElement(MantineProvider, {
      children: React.createElement(ProductionRunTaskCard, {
        projectId: 'project-1', view: passedView, actionError: null, onPrimaryAction: vi.fn(), onControl: vi.fn(),
      }),
    }))
    expect(htmlPassed).toContain('data-production-qa-summary')
    expect(htmlPassed).toContain('generationCommon.production.qa.allPassed#count=2')
    expect(htmlPassed).toContain('generationCommon.production.runDetails.stageStatus.completed')
  })

  it('resolves creator-friendly zh-CN and English QA summaries with collapsed Why disclosure for 1-shot, 3-shot, and 5-of-12 partial runs', async () => {
    const localI18n = i18next.createInstance()
    await localI18n.init({
      lng: 'en',
      interpolation: { escapeValue: false },
      resources: {
        en: { translation: { generationCommon: enGenerationCommon } },
        'zh-CN': { translation: { generationCommon: zhGenerationCommon } },
      },
    })
    const prev = tSpy.getMockImplementation()
    tSpy.mockImplementation((key: string, opts?: Record<string, unknown>) => String(localI18n.t(key, opts as never)))
    try {
      const renderQa = (qaReport: NonNullable<ProductionRunView['details']['stages'][number]['qaReport']>) =>
        renderToStaticMarkup(React.createElement(MantineProvider, {
          children: React.createElement(ProductionRunTaskCard, {
            projectId: 'project-1',
            view: {
              ...view,
              details: {
                ...view.details,
                stages: [{ stageId: 'qa', title: 'QA', status: 'completed', qaReport }],
              },
            },
            actionError: null,
            onPrimaryAction: vi.fn(),
            onControl: vi.fn(),
          }),
        }))

      const oneUnverified = renderQa({ total: 1, passedCount: 0, flaggedCount: 0, unverifiedCount: 1, unverifiedReasons: ['invalid_verdict_json'] })
      expect(oneUnverified).toContain(localI18n.t('generationCommon.production.qa.allUnverified', { count: 1 }))
      expect(oneUnverified).toContain('data-production-qa-why-toggle="true"')
      expect(oneUnverified).toContain('aria-expanded="false"')
      expect(oneUnverified).not.toContain('data-production-qa-reasons')

      const threeUnverified = renderQa({ total: 3, passedCount: 0, flaggedCount: 0, unverifiedCount: 3, unverifiedReasons: ['vision_unavailable'] })
      expect(threeUnverified).toContain(localI18n.t('generationCommon.production.qa.allUnverified', { count: 3 }))

      const fiveOfTwelveEn = renderQa({ total: 12, passedCount: 7, flaggedCount: 0, unverifiedCount: 5, unverifiedReasons: ['invalid_verdict_json'] })
      expect(fiveOfTwelveEn).toContain(localI18n.t('generationCommon.production.qa.partialUnverified', { count: 5, total: 12 }))
      expect(fiveOfTwelveEn).toContain('data-production-qa-why-toggle="true"')

      await localI18n.changeLanguage('zh-CN')
      const fiveOfTwelveZh = renderQa({ total: 12, passedCount: 7, flaggedCount: 0, unverifiedCount: 5, unverifiedReasons: ['invalid_verdict_json'] })
      expect(fiveOfTwelveZh).toContain(localI18n.t('generationCommon.production.qa.partialUnverified', { count: 5, total: 12 }))

      await localI18n.changeLanguage('en')
      const onePassed = renderQa({ total: 1, passedCount: 1, flaggedCount: 0, unverifiedCount: 0 })
      expect(onePassed).toContain('1 shot passed')
      expect(onePassed).not.toContain('1 shots')

      const threePassed = renderQa({ total: 3, passedCount: 3, flaggedCount: 0, unverifiedCount: 0 })
      expect(threePassed).toContain('all 3 shots passed')
    } finally {
      if (prev) tSpy.mockImplementation(prev)
    }
  })
})
