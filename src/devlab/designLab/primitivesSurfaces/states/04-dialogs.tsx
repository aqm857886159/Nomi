// 真组件的最小窗口取景；不装桌面桥，不读取用户资料，也不发生成请求。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsDialog } from '../../../../workbench/settings/SettingsDialog'
import { SkillDetail } from '../../../../workbench/skillLibrary/SkillDetail'
import { BrowserPromptExtractionSettingsModal } from '../../../../ui/browser/prompt/BrowserPromptExtractionSettingsModal'
import { normalizeBrowserPromptExtractionTemplateSettings } from '../../../../ui/browser/prompt/browserPromptExtractionSettings'
import { LabLocaleGate } from '../../labLocaleGate'
import type { LabState } from '../../labScreen'

import { HandbookPanel } from '../../../../workbench/onboarding/HandbookPanel'
import { TimelineShortcutsDialog } from '../../../../workbench/timeline/TimelineShortcutsDialog'
import { UpdateDialogCard } from '../../../../ui/app-shell/UpdateDialog'
import { SelectionPromptSaveController } from '../../../../workbench/generationCanvas/components/SelectionPromptSaveController'
import type { GenerationCanvasNode } from '../../../../workbench/generationCanvas/model/generationCanvasTypes'


import { ConfirmDialogHost } from '../../../../design/confirmDialog'
import { confirmDialog } from '../../../../design/confirmDialogStore'
import { FeedbackShareHost } from '../../../../ui/community/FeedbackShareHost'
import { CustomCallEditor } from '../../../../ui/onboarding/CustomCallEditor'
import { CATALOG_LIVENESS_STATES } from '../../catalogLiveness/states/01-listing'
import { OnboardingWizard } from '../../../../ui/onboarding/OnboardingWizard'
import { ShellStage, labHostState } from '../../v4/agentPanelV4LabHost'
import { ActionSelectModal } from '../../../../workbench/generationCanvas/nodes/director/panels/dialogs/ActionSelectModal'
import { HelpDialog } from '../../../../workbench/generationCanvas/nodes/director/panels/dialogs/HelpDialog'
import { MobileConnectDialog } from '../../../../workbench/generationCanvas/nodes/director/panels/dialogs/MobileConnectDialog'
import { MobileCameraContext } from '../../../../workbench/generationCanvas/nodes/director/MobileCameraContext'
import { SettingsDialog as DirectorSettingsDialog } from '../../../../workbench/generationCanvas/nodes/director/panels/dialogs/SettingsDialog'
import { DEFAULT_DIRECTOR_PREFERENCES } from '../../../../workbench/generationCanvas/nodes/director/scene/viewSettings'
import { SpendConfirmDialog } from '../../../../workbench/generationCanvas/spend/SpendConfirmDialog'
import { useSpendConfirmStore } from '../../../../workbench/generationCanvas/spend/spendConfirm'
import { WorkflowLibraryContent } from '../../../../workbench/library/WorkflowLibraryContent'
import { PromptPreviewOverlay } from '../../../../workbench/promptLibrary/PromptPreviewOverlay'
import NodeMediaPreviewDialog from '../../../../workbench/generationCanvas/nodes/NodeMediaPreviewDialog'
import { AssetPreviewDialog } from '../../../../workbench/assets/AssetPreviewDialog'
import { ComfyuiWorkflowSettingsPage } from '../../../../ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage'
import { ScreenshotCropOverlay } from '../../../../workbench/generationCanvas/components/ScreenshotCropOverlay'
import NodeShotCutPanel from '../../../../workbench/generationCanvas/nodes/NodeShotCutPanel'
import { SplashIntro } from '../../../../workbench/onboarding/SplashIntro'
import { JourneyTourController } from '../../../../workbench/onboarding/JourneyTourController'
import { useJourneyTourStore } from '../../../../workbench/onboarding/journeyTourStore'
import { NomiBrowserDialogView } from '../../../../ui/browser/dialog/NomiBrowserDialogView'
import type { DesktopBridge } from '../../../../desktop/bridge'

const selectionNode: GenerationCanvasNode = { id: 'dialog-census-node', kind: 'image', title: 'Dialog census', position: { x: 0, y: 0 }, result: { id: 'image', type: 'image', createdAt: 1, url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="640" height="360"%3E%3Crect width="640" height="360" fill="gray"/%3E%3C/svg%3E' } }
function SelectionSaveStage(): JSX.Element {
  // 真实选中文字 → 浮钮 → 保存卡；不写入资料，不调用保存 API。
  const ref = React.useRef<HTMLParagraphElement>(null)
  React.useEffect(() => {
    const range = document.createRange()
    if (ref.current) range.selectNodeContents(ref.current)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    const timer = window.setInterval(() => {
      const button = document.querySelector<HTMLButtonElement>('button[data-selection-prompt-ui]')
      if (button) { button.click(); window.clearInterval(timer) }
    }, 50)
    return () => window.clearInterval(timer)
  }, [])
  return <div data-workspace-input-active="true" data-shortcut-surface="canvas">
    <div className="generation-canvas-v2-node" data-node-id={selectionNode.id}><p ref={ref}>A long prompt selected from the canvas. A quiet forest at sunrise.</p></div>
    <SelectionPromptSaveController nodes={[selectionNode]} />
  </div>
}

const noop = (): void => undefined

// 这些夹具只开 UI，不确认 / 保存 / 生成；桥仅提供本地只读目录数据。
const emptyAgentSnapshot = labHostState({ items: [] })
function OpenSequence({ selectors, children }: { selectors: readonly string[]; children: React.ReactNode }): JSX.Element {
  React.useEffect(() => {
    let next = 0
    const timer = window.setInterval(() => {
      const button = document.querySelector<HTMLElement>(selectors[next])
      if (!button) return
      button.click()
      next += 1
      if (next === selectors.length) window.clearInterval(timer)
    }, 60)
    return () => window.clearInterval(timer)
  }, [selectors])
  return <>{children}</>
}
const agentOpen = ['[data-v4-control="permission"]', '[data-v4-control="system-prompt"]']
function HostStage({ kind }: { kind: string }): JSX.Element {
  const { t } = useTranslation()
  React.useEffect(() => {
    if (kind === 'confirm') void confirmDialog({ title: t('common.delete'), message: t('common.cancel'), confirmLabel: t('common.delete') })
    if (kind === 'feedback') window.dispatchEvent(new CustomEvent('nomi-open-feedback-share', { detail: {} }))
    if (kind === 'spend') void useSpendConfirmStore.getState().requestConfirm({ title: t('generationCommon.savePrompt.title'), message: t('updateReminder.dialog.localData'), source: 'agent', kind: 'generation' })
  }, [kind, t])
  if (kind === 'confirm') return <ConfirmDialogHost />
  if (kind === 'feedback') return <FeedbackShareHost />
  return <SpendConfirmDialog />
}
function WorkflowEditStage(): JSX.Element {
  const { t } = useTranslation()
  React.useState(() => localStorage.setItem('nomi:workflow-library:v1', JSON.stringify([{ id: 'census', name: 'Census', description: 'Workflow', tags: [], createdAt: 1, updatedAt: 1, template: { id: 'census', name: 'Census', nodes: [], edges: [] } }])))
  return <OpenSequence selectors={[`button[aria-label="${t('libraries.workflow.edit')}"]`]}><WorkflowLibraryContent projectId="census" /></OpenSequence>
}
function CanvasWorkspace({ kind }: { kind: 'media' | 'crop' | 'shotcut' }): JSX.Element {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => setReady(true), [])
  return <div className="workbench-generation__canvas fixed inset-0" data-workspace-input-active="true" data-shortcut-surface="canvas">
    {ready && (kind === 'media' ? <NodeMediaPreviewDialog mediaType="image" url={selectionNode.result!.url!} title="Census" onClose={noop} onStep={noop} />
      : kind === 'shotcut' ? <NodeShotCutPanel onFeedback={noop} node={{ ...selectionNode, kind: 'video' }} onClose={noop} />
      : <ScreenshotCropOverlay capture={{ url: selectionNode.result!.url!, width: 640, height: 360 }} project={{ signal: new AbortController().signal, assertCurrent: noop, binding: { projectId: 'census', immutableProjectUuid: '00000000-0000-4000-8000-000000000001', projectGeneration: 1 } }} basePosition={{ x: 0, y: 0 }} onClose={noop} />)}
  </div>
}
function ComfyWorkspace(): JSX.Element {
  React.useState(() => {
    const binding = { promptNodeId: '6', promptInputKey: 'text', outputNodeId: '9', outputKind: 'image', images: [], params: [] }
    const graph = { '6': { class_type: 'CLIPTextEncode', inputs: { text: 'A quiet forest' } }, '9': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'census' } } }
    const previous = window.nomiDesktop
    window.nomiDesktop = { ...previous, modelCatalog: { ...previous?.modelCatalog,
      listVendors: () => [{ key: 'comfyui-local', name: 'ComfyUI', enabled: true }],
      listModels: () => [{ vendorKey: 'comfyui-local', modelKey: 'census', labelZh: 'Census', enabled: true, kind: 'image', meta: { comfyWorkflowImport: { text: JSON.stringify(graph), binding } } }],
      listMappings: () => [], probeComfyui: async () => ({ ok: true }),
      analyzeComfyWorkflow: () => ({ ok: true, analysis: { textInputs: [{ nodeId: '6', classType: 'CLIPTextEncode', inputKey: 'text', value: 'A quiet forest' }], imageInputs: [], numericInputs: [], outputNodes: [{ nodeId: '9', classType: 'SaveImage', kind: 'image' }], suggested: binding } }),
    } } as unknown as DesktopBridge
  })
  return <ComfyuiWorkflowSettingsPage vendorKey="comfyui-local" initialModelKey="census" onClose={noop} onChanged={noop} />
}
function JourneyWorkspace(): JSX.Element {
  React.useState(() => useJourneyTourStore.setState({ active: true, phase: 'finale' }))
  return <JourneyTourController onStartReal={noop} />
}
function BrowserWorkspace(): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  const tab = { id: 'census', viewId: null, title: 'Nomi', url: 'about:blank', canGoBack: false, canGoForward: false, loading: false }
  return <NomiBrowserDialogView tabs={[tab]} activeTab={tab} activeTabId={tab.id} addressValue="about:blank" dialogTopOffset={0}
    bookmarks={[]} captureFlyouts={[]} dockPanelWidth={320} webContentBounds={null} localBrowserAssetPopoverSplit={false}
    webContainerRef={ref} browserViewHostRef={ref} bookmarkContextMenuRef={ref} tabContextMenuRef={ref} materialSitesRef={ref} promptModePickerRef={ref}
    onClose={noop} createTab={noop} closeTab={noop} closeAllTabs={noop} setActiveTabId={noop} setAddressValue={noop} setTabContextMenu={noop} setBookmarkContextMenu={noop}
    handleAddressFocus={noop} handleAddressBlur={noop} handleAddressChange={noop} navigateActiveTab={noop} saveBookmark={noop} setMaterialSitesOpen={noop}
    toggleBrowserResourceCapture={noop} openBrowserScreenshotPromptModePicker={noop} setEditingBookmark={noop} commitBookmarkRename={noop}
  />
}

function DialogStage({ kind }: { kind: string }): JSX.Element {
  const { t } = useTranslation()

  if (['confirm', 'feedback', 'spend'].includes(kind)) return <HostStage kind={kind} />
  if (kind === 'custom') return <CustomCallEditor target={{ vendorKey: 'census', modelKey: 'census', label: 'Census', script: '' }} onClose={noop} onSaved={noop} />
  if (kind === 'model') return CATALOG_LIVENESS_STATES[0].render()
  if (kind === 'onboarding') return <OnboardingWizard opened onClose={noop} initialPreset="newapi" />
  if (kind === 'agent') return <OpenSequence selectors={agentOpen}><ShellStage snapshot={emptyAgentSnapshot} /></OpenSequence>
  if (kind === 'action') return <ActionSelectModal open onClose={noop} onPick={noop} />
  if (kind === 'help') return <HelpDialog open onClose={noop} />
  if (kind === 'mobile') return <MobileCameraContext.Provider value={{ available: true, dialogOpen: true, setDialogOpen: noop, status: null, starting: false, speeds: { moveMetersPerSecond: 1, elevationMetersPerSecond: 1 }, setSpeeds: noop, start: async () => false, stop: async () => undefined }}><MobileConnectDialog /></MobileCameraContext.Provider>
  if (kind === 'director-settings') return <DirectorSettingsDialog open preferences={DEFAULT_DIRECTOR_PREFERENCES} onChange={noop} onClose={noop} onOpenHelp={noop} />
  if (kind === 'workflow') return <WorkflowEditStage />
  if (kind === 'prompt') return <><span data-dialog-census-workspace="[data-prompt-preview] button, [data-prompt-preview] a" /><PromptPreviewOverlay prompt={{ id: 'census', title: 'Census', prompt: 'A quiet forest.\n'.repeat(40), mediaUrl: selectionNode.result!.url!, mediaType: 'image', promptType: 'image', tags: [], source: '', sourceId: '', sourceUrl: '', origin: 'user' }} originRect={new DOMRect(100, 100, 200, 150)} onClose={noop} onAddToCanvas={noop} onEdit={noop} onDelete={noop} /></>
  if (kind === 'media' || kind === 'crop' || kind === 'shotcut') return <><span data-dialog-census-workspace="[role=dialog] button, [role=dialog] input" /><CanvasWorkspace kind={kind} /></>
  if (kind === 'asset') return <><span data-dialog-census-workspace="[role=dialog] button" /><AssetPreviewDialog asset={{ id: 'census', kind: 'image', name: 'Census', renderUrl: selectionNode.result!.url!, source: 'canvas', origin: { source: 'canvas', nodeId: 'census' } }} onClose={noop} /></>
  if (kind === 'comfy') return <><span data-dialog-census-workspace="[data-comfyui-workflow-page] header button, [data-workflow-save]" /><ComfyWorkspace /></>
  if (kind === 'splash') return <><span data-dialog-census-workspace="[data-splash-skip]" /><SplashIntro onDone={noop} /></>
  if (kind === 'journey') return <><span data-dialog-census-workspace="[data-journey-tour=finale] button" /><JourneyWorkspace /></>
  if (kind === 'browser') return <><span data-dialog-census-workspace=".nomi-browser-dialog-root button, .nomi-browser-dialog-root input" /><BrowserWorkspace /></>
  if (kind === 'handbook') return <HandbookPanel opened onClose={noop} />
  if (kind === 'shortcuts') return <TimelineShortcutsDialog onClose={noop} />
  if (kind === 'selection') return <SelectionSaveStage />
  if (kind === 'update') return <UpdateDialogCard view="available" version="0.25.0" digest={{ title: t('updateReminder.dialog.localData'), groups: Array.from({ length: 4 }, (_, i) => ({ heading: `${i + 1}`, items: Array.from({ length: 3 }, () => t('updateReminder.dialog.localData')) })), hiddenGroups: 0 }} releaseUrl={null} canAutoInstall onClose={noop} />
  if (kind === 'settings') return <SettingsDialog initialTab="general" onClose={noop} />
  if (kind === 'extraction') return <BrowserPromptExtractionSettingsModal settings={normalizeBrowserPromptExtractionTemplateSettings({})} projectAvailable onSave={noop} onClose={noop} />
  return <SkillDetail entry={{
    id: 'skill:dialog-census', title: t('libraries.skill.addToChat'), description: t('libraries.skill.exportPackage'),
    body: Array.from({ length: 40 }, (_, index) => `## ${index + 1}\n\n${t('libraries.skill.addToChat')}`).join('\n\n'), illustration: false,
    skill: { name: 'dialog-census', directoryName: 'dialog-census', label: 'dialog-census', description: null,
      author: null, stageLabels: [], isPlaybook: false, neededProviders: [], manifestError: null,
      origin: 'user', packageVersion: '1', contentHash: 'fixture' },
  }} onClose={noop} onAddToChat={noop} onExport={noop} onDelete={noop} />
}
const EXTRA_CONTROLS: Readonly<Record<string, string>> = {
  model: '[data-model-settings-dialog] button',
  onboarding: '[role="dialog"] .mantine-Button-root',
  agent: '[data-system-prompt-editor] button, .mantine-Modal-close',
  action: '[role="dialog"] [data-design-modal-scroll] > div:last-child button',
  mobile: '[data-testid="director-mobile-dialog"] > div:last-child button',
  'director-settings': '[data-testid="director-settings-dialog"] > div:last-child button',
}
function LocalizedDialog({ kind }: { kind: string }): JSX.Element {
  const locale = new URLSearchParams(window.location.search).get('locale') === 'en' ? 'en' : 'zh-CN'
  return <LabLocaleGate locale={locale}>
    <span data-dialog-census-expects={kind === 'prompt' ? '[data-prompt-preview]' : kind === 'splash' ? '[data-splash-skip]' : '[role="dialog"]'} />
    {EXTRA_CONTROLS[kind] ? <span data-dialog-census-actions={EXTRA_CONTROLS[kind]} /> : null}
    <DialogStage kind={kind} />
  </LabLocaleGate>
}

export const DIALOG_STATES: readonly LabState[] = [
  {
    id: 'ps-20-settings-dialog',
    name: '设置 · 最小窗口外壳',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 阶段②',
    mirrors: ['src/workbench/settings/SettingsDialog.tsx:67'],
    coverage: 'shell',
    capture: 'viewport',
    render: () => <LocalizedDialog kind="settings" />,
  },
  {
    id: 'ps-21-skill-dialog',
    name: '技能详情 · 长正文和决定栏',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 阶段②',
    mirrors: ['src/workbench/skillLibrary/SkillDetail.tsx:15'],
    coverage: 'shell',
    capture: 'viewport',
    render: () => <LocalizedDialog kind="skill" />,
  },
  {
    id: 'ps-22-extraction-dialog',
    name: '提取设置 · 保存决定栏',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 阶段②',
    mirrors: ['src/ui/browser/prompt/BrowserPromptExtractionSettingsModal.tsx:55'],
    coverage: 'shell',
    capture: 'viewport',
    render: () => <LocalizedDialog kind="extraction" />,
  },
  {
    id: 'ps-23-handbook-dialog',
    name: 'handbook · 最小窗口',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/onboarding/HandbookPanel.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="handbook" />,
  },
  {
    id: 'ps-24-shortcuts-dialog',
    name: 'shortcuts · 最小窗口',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/timeline/TimelineShortcutsDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="shortcuts" />,
  },
  {
    id: 'ps-25-update-dialog',
    name: 'update · 最小窗口',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/ui/app-shell/UpdateDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="update" />,
  },
  {
    id: 'ps-26-selection-dialog',
    name: 'selection · 最小窗口',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="selection" />,
  },
  {
    id: 'ps-27-confirm-dialog',
    name: 'confirm · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/design/confirmDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="confirm" />,
  },
  {
    id: 'ps-28-feedback-dialog',
    name: 'feedback · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/ui/community/FeedbackShareHost.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="feedback" />,
  },
  {
    id: 'ps-29-custom-dialog',
    name: 'custom · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/ui/onboarding/CustomCallEditor.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="custom" />,
  },
  {
    id: 'ps-30-model-dialog',
    name: 'model · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/ui/onboarding/ModelSettingsDetailDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="model" />,
  },
  {
    id: 'ps-31-onboarding-dialog',
    name: 'onboarding · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/ui/onboarding/OnboardingWizard.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="onboarding" />,
  },
  {
    id: 'ps-32-agent-dialog',
    name: 'agent · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/ai/ProjectAgentResidentShell.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="agent" />,
  },
  {
    id: 'ps-33-action-dialog',
    name: 'action · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/generationCanvas/nodes/director/panels/dialogs/ActionSelectModal.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="action" />,
  },
  {
    id: 'ps-34-help-dialog',
    name: 'help · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/generationCanvas/nodes/director/panels/dialogs/HelpDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="help" />,
  },
  {
    id: 'ps-35-mobile-dialog',
    name: 'mobile · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/generationCanvas/nodes/director/panels/dialogs/MobileConnectDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="mobile" />,
  },
  {
    id: 'ps-36-director-settings-dialog',
    name: 'director-settings · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/generationCanvas/nodes/director/panels/dialogs/SettingsDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="director-settings" />,
  },
  {
    id: 'ps-37-spend-dialog',
    name: 'spend · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="spend" />,
  },
  {
    id: 'ps-38-workflow-dialog',
    name: 'workflow · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/library/WorkflowLibraryContent.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="workflow" />,
  },
  {
    id: 'ps-39-prompt-dialog',
    name: 'prompt · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/promptLibrary/PromptPreviewOverlay.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="prompt" />,
  },
  {
    id: 'ps-40-media-dialog',
    name: 'media · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/generationCanvas/nodes/NodeMediaPreviewDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="media" />,
  },
  {
    id: 'ps-41-asset-dialog',
    name: 'asset · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/assets/AssetPreviewDialog.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="asset" />,
  },
  {
    id: 'ps-42-comfy-dialog',
    name: 'comfy · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="comfy" />,
  },
  {
    id: 'ps-43-crop-dialog',
    name: 'crop · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/generationCanvas/components/ScreenshotCropOverlay.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="crop" />,
  },
  {
    id: 'ps-44-shotcut-dialog',
    name: 'shotcut · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="shotcut" />,
  },
  {
    id: 'ps-45-splash-dialog',
    name: 'splash · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/onboarding/SplashIntro.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="splash" />,
  },
  {
    id: 'ps-46-journey-dialog',
    name: 'journey · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/workbench/onboarding/JourneyTourController.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="journey" />,
  },
  {
    id: 'ps-47-browser-dialog',
    name: 'browser · 最小窗口普查',
    source: 'docs/plan/2026-11-09-min-window-dialog-clip.md · 协调续派',
    mirrors: ['src/ui/browser/dialog/NomiBrowserDialogView.tsx:1'], coverage: 'shell', capture: 'viewport',
    render: () => <LocalizedDialog kind="browser" />,
  },
]
