import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import StoryboardPlanStrategyPanel from '../creation/storyboard/StoryboardPlanStrategyPanel'
import type { StoryboardPlanStrategyPanelProps } from '../creation/storyboard/StoryboardPlanStrategyPanel'

vi.mock('react-i18next', async (importOriginal) => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }))
const source = (file: string): string => readFileSync(`src/workbench/${file}`, 'utf8')

describe('DC24 quiet defaults preserve actionable boundaries', () => {
  it('renders no all-clear banner for an actionable-issue-free storyboard', () => {
    const props = {
      plan: { shots: [] },
      state: { status: 'ready', view: { blockers: [], requiredMerges: [], mergeSuggestions: [], splits: [] } },
      onChange: vi.fn(),
    } as unknown as StoryboardPlanStrategyPanelProps
    expect(renderToStaticMarkup(React.createElement(StoryboardPlanStrategyPanel, props))).toBe('')
  })

  it('keeps track landing surfaces without repeating the main empty-state lesson', () => {
    for (const file of ['timeline/TimelineTrack.tsx', 'timeline/TimelineTextTrack.tsx']) {
      const code = source(file)
      expect(code).toContain('workbench-timeline-track__empty')
      expect(code).not.toMatch(/t\('timelineEditor\.(track\.emptyAudio|track\.emptyVisual|textTrack\.emptyHint)'\)/)
    }
    const secondary = source('timeline/TimelineSecondaryAddRow.tsx')
    expect(secondary).not.toContain("t('timelineEditor.secondary.dropAudio')")
    expect(secondary).toContain('timeline-secondary-audio-drop')
    expect(secondary).toContain('timelineEditor.secondary.addMusic')
  })

  it('makes a known no-reference mode quiet only when it has no mode-switch action', () => {
    const code = source('creation/storyboard/shotRow/ShotReferenceZone.tsx')
    expect(code).not.toContain("t('storyboardEditor.row.noRefAccepted',")
    expect(code).toContain("t('storyboardEditor.row.noRefAcceptedSwitchSame',")
    expect(code).toContain("t('storyboardEditor.row.noRefAcceptedSwitch',")
  })

  it('keeps selected gestures and shared permissions, removes repeated teaching', () => {
    const gestures = source('settings/CanvasGestureSection.tsx')
    expect(gestures).not.toContain("t('settings.general.canvasGestureHint')")
    expect(gestures).toContain('t(active.hintKey)')
    const permissions = source('settings/AutomationPermissionsSection.tsx')
    // 「连上后允许做什么」的那句解释跟着开关走，住在客户端卡里（一功能一个家），设置页不再另留一栏。
    expect(permissions).not.toContain('settings.automation.hosts')
    expect(permissions).toContain('onTrustChange={toggleHost}')
    expect(readFileSync('src/ui/onboarding/ConnectAssistantCard.tsx', 'utf8')).toContain("t('onboardingProviders.assistant.trust.hint')")
    for (const key of ['firstSpendHint', 'irreversibleHint', 'continueHint']) expect(permissions).toContain(`settings.automation.risk.${key}`)
    const uploads = source('settings/AiModelsSection.tsx')
    expect(uploads).not.toContain("t('settings.ai.upload.channel.hint')")
    for (const key of ['publicLease', 'configure']) expect(uploads).toContain(`settings.ai.upload.channel.${key}`)
    expect(uploads).toContain('settings.ai.upload.anonymousPromptHint')
    expect(uploads).toContain('data-settings-custom-relay')
  })
})
