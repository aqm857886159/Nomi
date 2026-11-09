// 真组件的最小窗口取景；不装桌面桥，不读取用户资料，也不发生成请求。
import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsDialog } from '../../../../workbench/settings/SettingsDialog'
import { SkillDetail } from '../../../../workbench/skillLibrary/SkillDetail'
import { BrowserPromptExtractionSettingsModal } from '../../../../ui/browser/prompt/BrowserPromptExtractionSettingsModal'
import { normalizeBrowserPromptExtractionTemplateSettings } from '../../../../ui/browser/prompt/browserPromptExtractionSettings'
import { LabLocaleGate } from '../../labLocaleGate'
import type { LabState } from '../../labScreen'

const noop = (): void => undefined
function DialogStage({ kind }: { kind: 'settings' | 'skill' | 'extraction' }): JSX.Element {
  const { t } = useTranslation()
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
function LocalizedDialog({ kind }: { kind: 'settings' | 'skill' | 'extraction' }): JSX.Element {
  const locale = new URLSearchParams(window.location.search).get('locale') === 'en' ? 'en' : 'zh-CN'
  return <LabLocaleGate locale={locale}><DialogStage kind={kind} /></LabLocaleGate>
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
]
