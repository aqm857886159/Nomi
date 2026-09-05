import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronDown, IconLayoutDashboard } from '@tabler/icons-react'
import { WorkbenchButton } from '../../design'
import { cn } from '../../utils/cn'
import type { EditingPanelPreset } from './panelLayout'
import { useWorkbenchStore } from '../workbenchStore'

export default function EditingLayoutMenu(): JSX.Element {
  const { t } = useTranslation()
  const layout = useWorkbenchStore((state) => state.editingPanelLayout)
  const toggle = useWorkbenchStore((state) => state.toggleEditingPanel)
  const setPreset = useWorkbenchStore((state) => state.setEditingPanelPreset)
  const reset = useWorkbenchStore((state) => state.resetEditingPanelLayout)
  const [open, setOpen] = React.useState(false)
  const labels: Record<keyof typeof layout.visibility, string> = { source: t('timelinePreview.previewLayout.panels.source'), inspector: t('timelinePreview.previewLayout.panels.inspector'), assistant: t('timelinePreview.previewLayout.panels.assistant') }
  const presets: Array<Exclude<EditingPanelPreset, 'custom'>> = ['default', 'focus', 'result', 'portrait']
  return <div className="relative z-20">
    <WorkbenchButton className="inline-flex h-7 items-center gap-1 border border-[var(--workbench-border)] bg-[var(--workbench-surface)] px-2 text-micro" aria-expanded={open} onClick={() => setOpen(!open)}><IconLayoutDashboard size={14} />{t('timelinePreview.previewLayout.title')}<IconChevronDown size={12} /></WorkbenchButton>
    {open ? <div className="absolute right-0 top-full mt-1 w-56 rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] p-2 shadow-[var(--workbench-shadow-pop)]">
      <div className="mb-1 text-micro font-semibold text-[var(--workbench-muted)]">{t('timelinePreview.previewLayout.panelsTitle')}</div>
      {(Object.keys(layout.visibility) as Array<keyof typeof layout.visibility>).map((panel) => <label key={panel} className="flex cursor-pointer items-center justify-between rounded-nomi-sm px-2 py-1 text-caption hover:bg-[var(--workbench-hover)]"><span>{labels[panel]}</span><input type="checkbox" checked={layout.visibility[panel]} onChange={() => toggle(panel)} /></label>)}
      <div className="my-2 border-t border-[var(--workbench-border)]" />
      <div className="mb-1 text-micro font-semibold text-[var(--workbench-muted)]">{t('timelinePreview.previewLayout.presetsTitle')}</div>
      {presets.map((preset) => <button key={preset} type="button" className={cn('block w-full rounded-nomi-sm px-2 py-1 text-left text-caption hover:bg-[var(--workbench-hover)]', layout.preset === preset && 'bg-[var(--workbench-accent-soft)]')} onClick={() => setPreset(preset)}>{t(({ default: 'timelinePreview.previewLayout.presets.default', focus: 'timelinePreview.previewLayout.presets.focus', result: 'timelinePreview.previewLayout.presets.result', portrait: 'timelinePreview.previewLayout.presets.portrait' } as const)[preset])}</button>)}
      <button type="button" className="mt-1 block w-full rounded-nomi-sm px-2 py-1 text-left text-caption text-[var(--workbench-accent)] hover:bg-[var(--workbench-hover)]" onClick={reset}>{t('timelinePreview.previewLayout.reset')}</button>
    </div> : null}
  </div>
}
