import React from 'react'
import { useGenerationModelOptionsState, findModelOptionByIdentifier } from '../../generationCanvas/adapters/modelOptionsAdapter'
import { resolveArchetypeForOption, resolveRenderedControls } from '../../generationCanvas/nodes/nodeModelArchetype'
import {
  catalogControlInitialValue,
  controlInitialValue,
  defaultPatchForCatalogControl,
  isParameterControl,
  parseControlInput,
  type DynamicModelControl,
} from '../../generationCanvas/nodes/controls/parameterControlModel'
import { archetypeModeChoices, currentArchetypeMode } from '../../generationCanvas/nodes/controls/archetypeMeta'
import {
  asGenerationProposalArgs,
  updateGenerationProposalNode,
  updateGenerationProposalParams,
  type GenerationProposalArgs,
  type GenerationProposalNode,
} from './generationProposalEditing'

type Translate = (key: string, options?: Record<string, unknown>) => string

function fieldClass(): string {
  return 'min-w-0 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1 text-micro text-nomi-ink outline-none focus:border-nomi-accent focus:ring-1 focus:ring-nomi-accent/20'
}

function valueAsString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function controlOptionValue(option: unknown): string {
  if (typeof option === 'string' || typeof option === 'number' || typeof option === 'boolean') return String(option)
  if (option && typeof option === 'object' && 'value' in option) return valueAsString((option as { value?: unknown }).value)
  return ''
}

function controlOptionLabel(option: unknown): string {
  if (option && typeof option === 'object' && 'label' in option) return String((option as { label?: unknown }).label ?? controlOptionValue(option))
  return controlOptionValue(option)
}

function ProposalControl({
  control,
  meta,
  onChange,
}: {
  control: DynamicModelControl
  meta: Record<string, unknown>
  onChange: (control: DynamicModelControl, value: string) => void
}): JSX.Element {
  const value = isParameterControl(control) ? controlInitialValue(control, meta) : catalogControlInitialValue(control, meta)
  if (isParameterControl(control) && control.type === 'boolean') {
    return <label data-agent-parameter-control={control.key} className="flex min-h-7 items-center justify-between gap-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1 text-micro text-nomi-ink-80"><span className="truncate">{control.label}</span><input type="checkbox" aria-label={control.label} checked={value === 'true'} onChange={(event) => onChange(control, event.currentTarget.checked ? 'true' : 'false')} /></label>
  }
  if (control.options.length > 0) {
    return <select data-agent-parameter-control={control.key} className={fieldClass()} aria-label={control.label} value={value} onChange={(event) => onChange(control, event.currentTarget.value)}>{control.options.map((option) => <option key={controlOptionValue(option)} value={controlOptionValue(option)}>{controlOptionLabel(option)}</option>)}</select>
  }
  const type = isParameterControl(control) && control.type === 'number' ? 'number' : 'text'
  return <input data-agent-parameter-control={control.key} className={fieldClass()} aria-label={control.label} type={type} value={value} min={isParameterControl(control) ? control.min : undefined} max={isParameterControl(control) ? control.max : undefined} step={isParameterControl(control) ? control.step : undefined} placeholder={isParameterControl(control) ? control.placeholder : undefined} onChange={(event) => onChange(control, event.currentTarget.value)} />
}

function ProposalNodeEditor({
  args,
  index,
  node,
  onChange,
  t,
}: {
  args: GenerationProposalArgs
  index: number
  node: GenerationProposalNode
  onChange: (next: GenerationProposalArgs) => void
  t: Translate
}): JSX.Element {
  const nodeKind = node.kind === 'video' ? 'video' : node.kind === 'text' ? 'text' : 'image'
  const modelState = useGenerationModelOptionsState(nodeKind)
  const modelKey = typeof node.modelKey === 'string' ? node.modelKey : ''
  const selectedModel = findModelOptionByIdentifier(modelState.options, modelKey)
  const meta = React.useMemo(() => ({ ...(node.params || {}), ...(modelKey ? { modelKey } : {}), ...(node.modeId ? { archetype: { id: selectedModel?.modelKey || modelKey, modeId: node.modeId } } : {}) }), [modelKey, node.modeId, node.params, selectedModel?.modelKey])
  const isImage = nodeKind === 'image'
  const isVideo = nodeKind === 'video'
  const archetype = resolveArchetypeForOption(selectedModel)
  const controls = resolveRenderedControls(selectedModel, meta, isImage, isVideo)
  const modes = archetype ? archetypeModeChoices(archetype) : []
  const params = node.params || {}
  const knownParamKeys = new Set(controls.map((control) => control.key))

  const updateNode = (patch: Partial<GenerationProposalNode>): void => onChange(updateGenerationProposalNode(args, index, patch))
  const updateParam = (control: DynamicModelControl, value: string): void => {
    if (isParameterControl(control)) {
      updateParamValue(control.key, parseControlInput(control, value))
      return
    }
    const patch = defaultPatchForCatalogControl({ ...control, defaultValue: value })
    onChange(updateGenerationProposalParams(args, index, patch as Record<string, string | number | boolean | null>))
  }
  const updateParamValue = (key: string, value: string | number | boolean | null): void => onChange(updateGenerationProposalParams(args, index, { [key]: value }))

  return <div className="grid gap-2 border-t border-nomi-line-soft pt-2" data-agent-proposal-node={node.clientId || String(index)}>
    <div className="flex items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-micro font-semibold text-nomi-ink">{node.title || t('agentResident.untitledShot')}</span><span className="rounded-pill bg-nomi-accent-soft px-1.5 py-0.5 text-micro text-nomi-accent">{nodeKind === 'video' ? t('agentResident.video') : nodeKind === 'text' ? t('agentResident.proposalText') : t('agentResident.image')}</span></div>
    <label className="grid gap-1 text-micro text-nomi-ink-60"><span>{t('agentResident.proposalPrompt')}</span><textarea className={`${fieldClass()} min-h-12 resize-y`} value={typeof node.prompt === 'string' ? node.prompt : ''} onChange={(event) => updateNode({ prompt: event.currentTarget.value })} aria-label={t('agentResident.proposalPrompt')} /></label>
    <div className="grid grid-cols-2 gap-1.5">
      <label className="grid min-w-0 gap-1 text-micro text-nomi-ink-60"><span>{t('agentResident.proposalModel')}</span>{modelState.options.length ? <select className={fieldClass()} aria-label={t('agentResident.proposalModel')} value={modelKey} onChange={(event) => { const value = event.currentTarget.value; const { modeId: _modeId, params: _params, ...withoutModelSpecific } = node; updateNode({ ...withoutModelSpecific, modelKey: value }) }}>{modelState.options.map((option) => <option key={`${option.vendor || ''}:${option.value}`} value={option.value}>{option.label}</option>)}</select> : <input className={fieldClass()} aria-label={t('agentResident.proposalModel')} value={modelKey} onChange={(event) => updateNode({ modelKey: event.currentTarget.value })} />}</label>
      <label className="grid min-w-0 gap-1 text-micro text-nomi-ink-60"><span>{t('agentResident.proposalMode')}</span>{modes.length ? <select className={fieldClass()} aria-label={t('agentResident.proposalMode')} value={node.modeId || (archetype ? currentArchetypeMode(archetype, meta).id : '')} onChange={(event) => updateNode({ modeId: event.currentTarget.value })}>{modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.vendorTerm}</option>)}</select> : <input className={fieldClass()} aria-label={t('agentResident.proposalMode')} value={node.modeId || ''} onChange={(event) => updateNode({ modeId: event.currentTarget.value })} placeholder={t('agentResident.proposalModeHint')} />}</label>
    </div>
    {controls.length ? <div className="grid gap-1.5"><div className="text-micro font-medium text-nomi-ink-60">{t('agentResident.proposalParameters')}</div>{controls.map((control) => <ProposalControl key={control.key} control={control} meta={meta} onChange={updateParam} />)}</div> : null}
    {Object.entries(params).filter(([key]) => !knownParamKeys.has(key)).map(([key, value]) => <label key={key} className="grid gap-1 text-micro text-nomi-ink-60"><span>{key}</span><input className={fieldClass()} aria-label={key} value={valueAsString(value)} onChange={(event) => updateParamValue(key, event.currentTarget.value)} /></label>)}
  </div>
}

export function GenerationProposalEditor({ args: rawArgs, onChange, t }: { args: unknown; onChange: (next: Record<string, unknown>) => void; t: Translate }): JSX.Element | null {
  const parsed = asGenerationProposalArgs(rawArgs)
  const [open, setOpen] = React.useState(false)
  if (!parsed) return null
  const editableNodes = parsed.nodes
  if (!editableNodes.length) return null
  const update = (next: GenerationProposalArgs): void => onChange(next)
  return <section className="grid gap-1.5" data-agent-proposal-editor="true"><button type="button" className="inline-flex min-h-7 w-fit items-center gap-1 rounded-nomi-sm px-1 text-micro font-medium text-nomi-ink-60 hover:bg-nomi-ink-05" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span aria-hidden="true">{open ? '▾' : '▸'}</span>{t('agentResident.editParameters')}<span className="text-nomi-ink-40">{t('agentResident.proposalNodeCount', { count: editableNodes.length })}</span></button>{open ? <div className="grid gap-2">{parsed.nodes.map((node, index) => <ProposalNodeEditor key={node.clientId || String(index)} args={parsed} index={index} node={node} onChange={update} t={t} />)}</div> : null}</section>
}
