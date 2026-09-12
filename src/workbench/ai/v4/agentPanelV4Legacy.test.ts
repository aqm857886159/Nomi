import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { expect, test } from 'vitest'
import { AgentPanelV4Panel } from './AgentPanelV4Panel'
import { zhAgentPanelV4, enAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'

// 介入槽的写口在生产里是必填（R28）。测试里显式给一份空壳，表示「这一格不验行为」。
const NO_HANDLERS = { onPlanToggle: () => undefined, onCollapsePlan: () => undefined }

for (const [locale, dictionary] of [['zh-CN', zhAgentPanelV4], ['en', enAgentPanelV4]] as const) {
  test(`legacy banner follows actual migration facts and is absent on new conversations: ${locale}`, async () => {
    const i18n = createInstance()
    await i18n.init({ lng: locale, resources: { [locale]: { translation: { agentPanelV4: dictionary } } } })
    const render = (legacy?: { arrayOrder: boolean; summaries: boolean; archivedItems: boolean; missingToolArguments: boolean }) =>
      renderToStaticMarkup(React.createElement(I18nextProvider, { i18n }, React.createElement(AgentPanelV4Panel, { slotHandlers: NO_HANDLERS, flow: [], context: {}, legacy })))
    expect(render()).not.toContain('data-v4-legacy')
    const simple = render({ arrayOrder: false, summaries: false, archivedItems: false, missingToolArguments: false })
    expect(simple).toContain(dictionary.legacyNotice)
    expect(simple).not.toContain(dictionary.legacyMissingArguments)
    const full = render({ arrayOrder: true, summaries: true, archivedItems: true, missingToolArguments: true })
    expect(full.match(/data-v4-legacy=/g)).toHaveLength(1)
    for (const text of [dictionary.legacyArrayOrder, dictionary.legacySummaries, dictionary.legacyArchived, dictionary.legacyMissingArguments]) expect(full).toContain(text)
  })
}
