// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LONG_TITLE, expectWrappingTitle } from './modalTitleAssertions'
import { ConfirmDialogHost } from '../confirmDialog'
import { confirmDialog } from '../confirmDialogStore'
import { OVERLAY_STATES } from '../../devlab/designLab/primitivesSurfaces/states/02-overlays'
import { UpdateDialogCard } from '../../ui/app-shell/UpdateDialog'
import { BrowserPromptExtractionSettingsModal } from '../../ui/browser/prompt/BrowserPromptExtractionSettingsModal'
import { createDefaultBrowserPromptExtractionTemplateSettings } from '../../ui/browser/prompt/browserPromptExtractionSettings'
import { FeedbackShareHost } from '../../ui/community/FeedbackShareHost'
import { CustomCallEditor } from '../../ui/onboarding/CustomCallEditor'
import { ModelSettingsDetailDialog } from '../../ui/onboarding/ModelSettingsDetailDialog'
import { OnboardingWizard } from '../../ui/onboarding/OnboardingWizard'
import ProjectAgentResidentShell from '../../workbench/ai/ProjectAgentResidentShell'
import { SelectionPromptSaveController } from '../../workbench/generationCanvas/components/SelectionPromptSaveController'
import { createGenerationNode } from '../../workbench/generationCanvas/model/graphOps'
import { ActionSelectModal } from '../../workbench/generationCanvas/nodes/director/panels/dialogs/ActionSelectModal'
import { HelpDialog } from '../../workbench/generationCanvas/nodes/director/panels/dialogs/HelpDialog'
import { MobileConnectDialog } from '../../workbench/generationCanvas/nodes/director/panels/dialogs/MobileConnectDialog'
import { MobileCameraContext } from '../../workbench/generationCanvas/nodes/director/MobileCameraContext'
import { SettingsDialog as DirectorSettings } from '../../workbench/generationCanvas/nodes/director/panels/dialogs/SettingsDialog'
import { DEFAULT_DIRECTOR_PREFERENCES } from '../../workbench/generationCanvas/nodes/director/scene/viewSettings'
import { SpendConfirmDialog } from '../../workbench/generationCanvas/spend/SpendConfirmDialog'
import { useSpendConfirmStore } from '../../workbench/generationCanvas/spend/spendConfirm'
import { WorkflowLibraryContent } from '../../workbench/library/WorkflowLibraryContent'
import { saveWorkflowToLibrary } from '../../workbench/library/workflowLibrary'
import { HandbookPanel } from '../../workbench/onboarding/HandbookPanel'
import { SettingsDialog } from '../../workbench/settings/SettingsDialog'
import { SkillDetail } from '../../workbench/skillLibrary/SkillDetail'
import { galleryEntries } from '../../workbench/skillLibrary/skillGallery'
import { TimelineShortcutsDialog } from '../../workbench/timeline/TimelineShortcutsDialog'
import { NomiColorSchemeContext } from '../../theme/colorScheme'
import i18n from '../../i18n'

vi.hoisted(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

// 固定文案（包括实验室的中文字面量）也用同一条压力样本。保留真实调用方给的
// classNames、styles、header 和开关，让实际 Mantine 标题、包裹组件与祖先全部落进 DOM。
vi.mock('../overlays', async importOriginal => {
  const { DesignModal } = await importOriginal<typeof import('../overlays')>()
  return { DesignModal: (props: React.ComponentProps<typeof DesignModal>) =>
    <DesignModal {...props} title={LONG_TITLE} /> }
})

const noop = () => undefined
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  root = createRoot(document.body.appendChild(document.createElement('div')))
})
afterEach(async () => {
  await act(() => root.unmount())
  document.body.replaceChildren()
  localStorage.clear()
})

async function mount(element: React.ReactNode) {
  await act(() => root.render(<MantineProvider env="test">
    <NomiColorSchemeContext.Provider value={{ colorScheme: 'light', isDark: false, setColorScheme: noop,
      toggleColorScheme: noop, acquireForcedDark: () => noop }}>
      {element}
    </NomiColorSchemeContext.Provider>
  </MantineProvider>))
}

async function click(selector: string) {
  const button = document.querySelector<HTMLElement>(selector)
  if (!button) throw new Error(`找不到 ${selector}`)
  await act(() => button.click())
}

const [skill] = galleryEntries([{ name: 'storyboard', label: LONG_TITLE, directoryName: 'storyboard',
  description: null, author: null, stageLabels: [], isPlaybook: false, neededProviders: [],
  manifestError: null, origin: 'user', packageVersion: '1', contentHash: 'fixture' }], 'en')
const mobile = { available: false, dialogOpen: true, setDialogOpen: noop, status: null, starting: false,
  speeds: { moveMetersPerSecond: 1, elevationMetersPerSecond: 1 }, setSpeeds: noop, start: async () => false, stop: async () => {} }

const cases = [
  ['UpdateDialog', <UpdateDialogCard view="available" version="1" canAutoInstall releaseUrl={null}
    digest={{ title: '发行说明', groups: [], hiddenGroups: 0 }} />, 'block m-0 text-title font-semibold text-nomi-ink'],
  ['CustomCallEditor', <CustomCallEditor target={{ vendorKey: 'custom', modelKey: 'model', label: '模型', script: '' }}
    onClose={noop} onSaved={noop} />, 'text-body font-semibold text-nomi-ink'],
  ['HandbookPanel', <HandbookPanel opened onClose={noop} />, 'text-title font-bold text-nomi-ink'],
  ['SkillDetail', <SkillDetail entry={skill} onClose={noop} onAddToChat={noop} onExport={noop} />,
    'm-0 font-nomi-display text-h1 font-medium leading-8 text-nomi-ink'],
  ['BrowserPromptExtractionSettingsModal', <BrowserPromptExtractionSettingsModal projectAvailable
    settings={createDefaultBrowserPromptExtractionTemplateSettings()} onClose={noop} onSave={noop} />],
  ['ModelSettingsDetailDialog', <ModelSettingsDetailDialog label={LONG_TITLE} escapeAction="close" onClose={noop}>{null}</ModelSettingsDetailDialog>],
  ['OnboardingWizard', <OnboardingWizard opened onClose={noop} />],
  ['ActionSelectModal', <ActionSelectModal open onPick={noop} onClose={noop} />],
  ['HelpDialog', <HelpDialog open onClose={noop} />],
  ['MobileConnectDialog', <MobileCameraContext.Provider value={mobile}><MobileConnectDialog /></MobileCameraContext.Provider>],
  ['DirectorSettingsDialog', <DirectorSettings open preferences={DEFAULT_DIRECTOR_PREFERENCES}
    onChange={noop} onClose={noop} onOpenHelp={noop} />],
  ['SettingsDialog', <SettingsDialog onClose={noop} />],
  ['TimelineShortcutsDialog', <TimelineShortcutsDialog onClose={noop} />],
  ['ps-07-modal', OVERLAY_STATES.find(state => state.id === 'ps-07-modal')!.render()],
] as const

it.each(cases)('%s 的超长标题', async (_, element, typography) => {
  await mount(element)
  expectWrappingTitle(typography)
})

it('ConfirmDialogHost 的超长标题', async () => {
  await mount(<ConfirmDialogHost />)
  await act(() => { void confirmDialog({ title: LONG_TITLE }) })
  expectWrappingTitle()
})

it('FeedbackShareHost 的超长标题', async () => {
  await mount(<FeedbackShareHost />)
  await act(() => { window.dispatchEvent(new Event('nomi-open-feedback-share')) })
  expectWrappingTitle()
})

it('SpendConfirmDialog 的超长标题', async () => {
  void useSpendConfirmStore.getState().requestConfirm({ title: LONG_TITLE, message: '再次生成', source: 'agent', kind: 'generation' })
  try {
    await mount(<SpendConfirmDialog />)
    expectWrappingTitle('block text-title font-medium leading-normal text-nomi-ink')
  } finally {
    await act(() => useSpendConfirmStore.getState().resolvePending(false))
  }
})

it('WorkflowEditDialog 的超长标题', async () => {
  const node = createGenerationNode({ id: 'text', kind: 'text' })
  saveWorkflowToLibrary({ template: { id: 'flow', name: '工作流', schemaVersion: 1, createdAt: 1, updatedAt: 1,
    nodes: [{ sourceId: node.id, node, relativePosition: node.position }], edges: [], groups: [] } })
  await mount(<WorkflowLibraryContent projectId="project" />)
  await click(`[aria-label="${i18n.t('libraries.workflow.edit')}"]`)
  expectWrappingTitle()
})

it('SelectionPromptSaveController 的超长标题', async () => {
  const node = createGenerationNode({ id: 'text', kind: 'text' })
  await mount(<div data-workspace-input-active="true" data-shortcut-surface="canvas">
    <span className="generation-canvas-v2-node" data-node-id={node.id}>分镜描述</span>
    <SelectionPromptSaveController nodes={[node]} />
  </div>)
  const range = document.createRange()
  range.selectNodeContents(document.querySelector('[data-node-id]')!)
  // jsdom 没有布局引擎；只给工具栏定位提供非零选区。
  range.getBoundingClientRect = () => new DOMRect(20, 30, 60, 16)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  expect(window.getSelection()?.toString()).toBe('分镜描述')
  await act(async () => {
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await click('button[data-selection-prompt-ui]')
  expectWrappingTitle('text-body font-semibold text-nomi-ink')
})

it('ProjectAgentResidentShell 的系统提示词超长标题', async () => {
  await mount(<ProjectAgentResidentShell surface="creation" />)
  await click('[data-v4-control="permission"]')
  await click('[data-v4-control="system-prompt"]')
  expectWrappingTitle()
})
