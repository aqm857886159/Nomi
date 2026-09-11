// Temporary lab entry mounted by c04-capture.mjs; never included in the production bundle.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/fraunces/wght.css'
import '@mantine/notifications/styles.css'
import '../../../src/styles/index.css'
import { NomiAppProviders } from '../../../src/NomiAppProviders'
import { NomiColorSchemeProvider } from '../../../src/theme/NomiColorSchemeProvider'
import { persistColorScheme, primeNomiColorScheme } from '../../../src/theme/colorScheme'
import i18n from '../../../src/i18n'
import StoryboardPlanStrategyPanel from '../../../src/workbench/creation/storyboard/StoryboardPlanStrategyPanel'
import { SpendConfirmDialog } from '../../../src/workbench/generationCanvas/spend/SpendConfirmDialog'
import { useSpendConfirmStore } from '../../../src/workbench/generationCanvas/spend/spendConfirm'
import { TableStage } from '../../../src/devlab/designLab/storyboard/storyboardLabKit'
import type { C04Fixture } from './c04-fixture'

const fixture = (window as unknown as { __c04Fixture: C04Fixture }).__c04Fixture
persistColorScheme('light')
primeNomiColorScheme()
void i18n.changeLanguage('zh-CN')
function Specimen() {
  const spend = new URLSearchParams(location.search).get('specimen') === 'c06'
  React.useEffect(() => {
    if (!spend) return
    // Exact request shape from capabilityApplyHandler.ts (batch gate): contract projection + actions.
    void useSpendConfirmStore.getState().requestConfirm({
      kind: 'contract', title: i18n.t('runtime.capability.generationGateBatchTitle'),
      message: i18n.t('generationCommon.production.batch.body', { project: fixture.plan.title }),
      confirmLabel: i18n.t('generationCommon.production.batch.confirm', { count: fixture.plan.shots.length }),
      source: 'agent', contract: fixture.contract, onTrialFirst: () => {}, onBackToEdit: () => {},
    })
    return () => useSpendConfirmStore.getState().resolvePending(false)
  }, [spend])
  return spend ? <SpendConfirmDialog /> : (
    <TableStage clip={false}>
      {/* Exact props from StoryboardPlanEditor.tsx:487; view comes from the real resolver/classifier. */}
      <StoryboardPlanStrategyPanel plan={fixture.plan} state={{ status: 'ready', view: fixture.view, warnings: new Map() }} onChange={() => {}} />
    </TableStage>
  )
}
createRoot(document.getElementById('design-lab-root')!).render(
  <NomiColorSchemeProvider><NomiAppProviders><Specimen /></NomiAppProviders></NomiColorSchemeProvider>,
)
