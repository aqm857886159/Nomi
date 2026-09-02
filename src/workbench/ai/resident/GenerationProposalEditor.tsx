import React from 'react'
import { IconMessage, IconPhoto, IconVideo } from '@tabler/icons-react'
import InlineParameterBar from '../../generationCanvas/nodes/InlineParameterBar'
import { archetypeModeChoices } from '../../generationCanvas/nodes/controls/channelModeReach'
import {
  deriveGenerationModelCatalogStatus,
  findModelOptionByIdentifier,
  useGenerationModelOptionsState,
} from '../../generationCanvas/adapters/modelOptionsAdapter'
import { resolveArchetypeForOption, resolveRenderedControls } from '../../generationCanvas/nodes/nodeModelArchetype'
import {
  archetypeVariantChoices,
  currentArchetypeMode,
  currentArchetypeVariant,
} from '../../generationCanvas/nodes/controls/archetypeMeta'
import {
  defaultPatchForCatalogControl,
  parseControlInput,
  type DynamicCatalogControl,
} from '../../generationCanvas/nodes/controls/parameterControlModel'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'
import { ResidentBatchStack } from './ResidentBatchStack'
import {
  asGenerationProposalArgs,
  asSemanticGenerationProposalArgs,
  updateGenerationProposalNode,
  updateGenerationProposalParams,
  updateSemanticGenerationField,
  updateSemanticGenerationParameters,
  updateSemanticGenerationReferences,
  updateSemanticGenerationShot,
  type GenerationProposalArgs,
  type GenerationProposalNode,
  type SemanticGenerationProposalArgs,
} from './generationProposalEditing'

type Translate = (key: string, options?: Record<string, unknown>) => string
type ProposalKind = 'image' | 'video' | 'text'

function primitive(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

function proposalKind(value: unknown): ProposalKind {
  const kind = String(value || '').toLowerCase()
  return kind.includes('video') || kind.includes('motion') ? 'video' : kind.includes('text') ? 'text' : 'image'
}

function ProposalPrompt({ value, onChange, t }: { value: string; onChange: (value: string) => void; t: Translate }): JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-1.5 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-2 py-1.5" data-agent-proposal-prompt="true">
      <IconMessage size={14} className="mt-0.5 shrink-0 text-nomi-accent" aria-hidden="true" />
      <textarea
        className="min-h-10 max-h-16 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-caption leading-relaxed text-nomi-ink-80 outline-none placeholder:text-nomi-ink-40"
        rows={2}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-label={t('agentResident.proposalPrompt')}
        placeholder={t('agentResident.proposalPrompt')}
      />
    </div>
  )
}

type ProposalParameterBarProps = {
  kind: ProposalKind
  modelValue: string
  vendor?: string
  modeId?: string
  variantId?: string
  params: Record<string, string | number | boolean>
  onModelChange: (value: string, vendor?: string) => void
  onModeChange: (value: string) => void
  onVariantChange: (value: string) => void
  onCatalogControlChange: (control: DynamicCatalogControl, value: string) => void
  onParameterControlChange: (control: ModelParameterControl, value: string) => void
  t: Translate
}

/** Maps a Host-owned proposal draft to the same archive-driven controls as a canvas node. */
function ProposalParameterBar({
  kind,
  modelValue,
  vendor,
  modeId,
  variantId,
  params,
  onModelChange,
  onModeChange,
  onVariantChange,
  onCatalogControlChange,
  onParameterControlChange,
  t,
}: ProposalParameterBarProps): JSX.Element {
  const modelState = useGenerationModelOptionsState(kind)
  const selectedModel = findModelOptionByIdentifier(modelState.options, modelValue, vendor) || null
  const archetype = resolveArchetypeForOption(selectedModel)
  const meta = React.useMemo<Record<string, unknown>>(() => ({
    ...params,
    ...(modelValue ? { modelKey: modelValue } : {}),
    ...(vendor ? { modelVendor: vendor, vendor } : {}),
    ...(modeId ? { archetype: { id: selectedModel?.modelKey || modelValue, modeId, variantId } } : {}),
    ...(variantId ? { variantId } : {}),
  }), [modelValue, modeId, params, selectedModel?.modelKey, variantId, vendor])
  const controls = resolveRenderedControls(selectedModel, meta, kind === 'image', kind === 'video')
  const modes = archetype ? archetypeModeChoices(archetype) : []
  const variants = archetype ? archetypeVariantChoices(archetype) : []
  const activeMode = archetype ? currentArchetypeMode(archetype, meta).id : modeId || ''
  const activeVariant = archetype ? currentArchetypeVariant(archetype, meta)?.id || variantId || '' : variantId || ''
  const catalogStatus = deriveGenerationModelCatalogStatus(kind, modelState)

  return (
    <div data-agent-proposal-parameters="true" className="min-w-0">
      <InlineParameterBar
        layout="stacked"
        panelMode="inline"
        summaryWidth={150}
        modelOptions={modelState.options}
        modelCatalogStatus={catalogStatus}
        renderedControls={controls}
        selectedModelOption={selectedModel}
        archetype={archetype}
        meta={meta}
        onModelChange={onModelChange}
        onCatalogControlChange={onCatalogControlChange}
        onParameterControlChange={onParameterControlChange}
        modeChoices={modes.length > 1 ? modes.map((mode) => ({ id: mode.id, label: mode.vendorTerm })) : undefined}
        activeModeId={activeMode}
        modeLabel={t('generationCommon.parameters.generationMode')}
        onModeSelect={modes.length > 1 ? onModeChange : undefined}
        variantChoices={variants}
        activeVariantId={activeVariant}
        onVariantSelect={onVariantChange}
      />
    </div>
  )
}

function ProposalItemHeader({ kind, title, index, total, t }: { kind: ProposalKind; title: string; index?: number; total?: number; t: Translate }): JSX.Element {
  const MediaIcon = kind === 'video' ? IconVideo : kind === 'image' ? IconPhoto : IconMessage
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-micro font-semibold text-nomi-ink">
      <MediaIcon size={14} className="shrink-0 text-nomi-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{title || t('agentResident.untitledShot')}</span>
      {index !== undefined && total !== undefined ? <span className="shrink-0 text-nomi-ink-40 tabular-nums">{index + 1}/{total}</span> : null}
    </div>
  )
}

function ProposalNodeEditor({ args, index, node, onChange, t, total, showHeader = true }: { args: GenerationProposalArgs; index: number; node: GenerationProposalNode; onChange: (next: GenerationProposalArgs) => void; t: Translate; total?: number; showHeader?: boolean }): JSX.Element {
  const kind = proposalKind(node.kind)
  const modelValue = primitive(node.modelKey)
  const vendor = primitive(node.vendor || node.modelVendor || node.providerId)
  const params = node.params || {}
  const updateNode = (patch: Partial<GenerationProposalNode>): void => onChange(updateGenerationProposalNode(args, index, patch))
  const updateParameter = (control: ModelParameterControl, value: string): void => {
    onChange(updateGenerationProposalParams(args, index, { [control.key]: parseControlInput(control, value) }))
  }
  const updateCatalog = (control: DynamicCatalogControl, value: string): void => {
    onChange(updateGenerationProposalParams(args, index, defaultPatchForCatalogControl({ ...control, defaultValue: value }) as Record<string, string | number | boolean | null>))
  }
  const updateModel = (value: string, nextVendor?: string): void => {
    // A model switch starts a fresh effective-args draft; stale mode/params
    // must not silently travel to an incompatible model.
    updateNode({ modelKey: value, vendor: nextVendor, modelVendor: nextVendor, modeId: undefined, variantId: undefined, params: {} })
  }
  return (
    <div className="grid min-w-0 gap-1.5" data-agent-proposal-node={node.clientId || String(index)}>
      {showHeader ? <ProposalItemHeader kind={kind} title={primitive(node.title)} index={index} total={total} t={t} /> : null}
      <ProposalPrompt value={primitive(node.prompt)} onChange={(value) => updateNode({ prompt: value })} t={t} />
      <ProposalParameterBar
        kind={kind}
        modelValue={modelValue}
        vendor={vendor}
        modeId={primitive(node.modeId)}
        variantId={primitive(node.variantId)}
        params={params}
        onModelChange={updateModel}
        onModeChange={(value) => updateNode({ modeId: value })}
        onVariantChange={(value) => updateNode({ variantId: value })}
        onCatalogControlChange={updateCatalog}
        onParameterControlChange={updateParameter}
        t={t}
      />
    </div>
  )
}

function semanticSource(args: SemanticGenerationProposalArgs): Record<string, unknown> {
  if (args.patch && typeof args.patch === 'object' && !Array.isArray(args.patch)) return args.patch as Record<string, unknown>
  if (args.candidate && typeof args.candidate === 'object' && !Array.isArray(args.candidate)) return args.candidate as Record<string, unknown>
  return args
}

function primitiveParameters(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) as Record<string, string | number | boolean>
}

function SemanticShotEditor({ args, index, shot, onChange, t, total }: { args: SemanticGenerationProposalArgs; index: number; shot: Record<string, unknown>; onChange: (next: SemanticGenerationProposalArgs) => void; t: Translate; total: number }): JSX.Element {
  const nested = shot.candidate && typeof shot.candidate === 'object' && !Array.isArray(shot.candidate) ? shot.candidate as Record<string, unknown> : shot
  const kind = proposalKind(nested.taskKind || nested.kind || shot.role)
  const params = primitiveParameters(nested.parameters)
  const update = (patch: Record<string, unknown>): void => onChange(updateSemanticGenerationShot(args, index, patch))
  const modelValue = primitive(nested.modelId || nested.modelKey || nested.model)
  const vendor = primitive(nested.providerId || nested.vendor)
  const modeId = primitive(nested.modeId || nested.mode)
  const variantId = primitive(nested.variantId)
  const updateModel = (value: string, nextVendor?: string): void => update({ modelId: value, providerId: nextVendor, modeId: undefined, mode: undefined, variantId: undefined, parameters: {} })
  const updateParameter = (control: ModelParameterControl, value: string): void => {
    update({ parameters: { ...params, [control.key]: parseControlInput(control, value) } })
  }
  const updateCatalog = (control: DynamicCatalogControl, value: string): void => {
    update({ parameters: { ...params, ...defaultPatchForCatalogControl({ ...control, defaultValue: value }) } })
  }
  return (
    <div className="grid min-w-0 gap-1.5" data-agent-proposal-shot={primitive(shot.shotId) || String(index)}>
      <ProposalItemHeader kind={kind} title={primitive(shot.shotId)} index={index} total={total} t={t} />
      <ProposalPrompt value={primitive(nested.prompt || nested.scriptText)} onChange={(value) => update(Object.prototype.hasOwnProperty.call(nested, 'scriptText') && !Object.prototype.hasOwnProperty.call(nested, 'prompt') ? { scriptText: value } : { prompt: value })} t={t} />
      <ProposalParameterBar
        kind={kind}
        modelValue={modelValue}
        vendor={vendor}
        modeId={modeId}
        variantId={variantId}
        params={params}
        onModelChange={updateModel}
        onModeChange={(value) => update({ modeId: value, mode: value })}
        onVariantChange={(value) => update({ variantId: value })}
        onCatalogControlChange={updateCatalog}
        onParameterControlChange={updateParameter}
        t={t}
      />
    </div>
  )
}

function ReferencesDisclosure({ args, t, onChange }: { args: SemanticGenerationProposalArgs; t: Translate; onChange: (next: SemanticGenerationProposalArgs) => void }): JSX.Element | null {
  const source = semanticSource(args)
  const references = Array.isArray(source.references) ? source.references : []
  if (!references.length) return null
  return (
    <details className="rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 px-2" data-agent-proposal-references="true">
      <summary className="min-h-7 cursor-pointer list-none py-1 text-micro text-nomi-ink-60">{t('agentResident.referencesLabel')} · {references.length}</summary>
      <div className="grid gap-1 border-t border-nomi-line-soft py-1">
        {references.map((reference, index) => (
          <div key={index} className="flex min-w-0 items-center gap-1 text-micro text-nomi-ink-70">
            <span className="min-w-0 flex-1 truncate">{reference && typeof reference === 'object' && 'assetId' in reference ? primitive((reference as { assetId?: unknown }).assetId) : t('agentResident.referencesLabel')}</span>
            <button type="button" className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-10" aria-label={t('agentResident.removeReference')} onClick={() => onChange(updateSemanticGenerationReferences(args, references.filter((_, candidateIndex) => candidateIndex !== index)))}>×</button>
          </div>
        ))}
      </div>
    </details>
  )
}

function SemanticProposalEditor({ args, onChange, t }: { args: SemanticGenerationProposalArgs; onChange: (next: Record<string, unknown>) => void; t: Translate }): JSX.Element {
  const [activeShotIndex, setActiveShotIndex] = React.useState(0)
  const source = semanticSource(args)
  const shots = Array.isArray(args.shots) ? args.shots.filter((shot): shot is Record<string, unknown> => Boolean(shot && typeof shot === 'object' && !Array.isArray(shot))) : []
  const kind = proposalKind(source.taskKind || source.mode)
  const rootParams = primitiveParameters(source.parameters)
  const rootPromptKey = Object.prototype.hasOwnProperty.call(source, 'scriptText') && !Object.prototype.hasOwnProperty.call(source, 'prompt') ? 'scriptText' : 'prompt'
  const updateRoot = (value: string): void => onChange(updateSemanticGenerationField(args, rootPromptKey, value))
  const updateRootParameter = (control: ModelParameterControl, value: string): void => {
    onChange(updateSemanticGenerationParameters(args, { [control.key]: parseControlInput(control, value) }))
  }
  const updateRootCatalog = (control: DynamicCatalogControl, value: string): void => {
    onChange(updateSemanticGenerationParameters(args, defaultPatchForCatalogControl({ ...control, defaultValue: value })))
  }
  const updateRootModel = (value: string, vendor?: string): void => {
    let next = updateSemanticGenerationField(args, 'modelId', value)
    next = updateSemanticGenerationField(next, 'providerId', vendor)
    next = updateSemanticGenerationField(next, 'modeId', undefined)
    next = updateSemanticGenerationField(next, 'mode', undefined)
    next = updateSemanticGenerationField(next, 'variantId', undefined)
    next = updateSemanticGenerationParameters(next, {})
    onChange(next)
  }
  return (
    <section className="grid min-w-0 gap-1.5" data-agent-semantic-proposal-editor="true">
      {shots.length === 0 ? (
        <>
          <ProposalPrompt value={primitive(source.prompt || source.scriptText)} onChange={updateRoot} t={t} />
          <ProposalParameterBar
            kind={kind}
            modelValue={primitive(source.modelId || source.modelKey || source.model)}
            vendor={primitive(source.providerId || source.vendor)}
            modeId={primitive(source.modeId || source.mode)}
            variantId={primitive(source.variantId)}
            params={rootParams}
            onModelChange={updateRootModel}
            onModeChange={(value) => onChange(updateSemanticGenerationField(updateSemanticGenerationField(args, 'modeId', value), 'mode', value))}
            onVariantChange={(value) => onChange(updateSemanticGenerationField(args, 'variantId', value))}
            onCatalogControlChange={updateRootCatalog}
            onParameterControlChange={updateRootParameter}
            t={t}
          />
        </>
      ) : (
        <ResidentBatchStack
          items={shots}
          activeIndex={activeShotIndex}
          onSelect={setActiveShotIndex}
          getKey={(shot, index) => primitive(shot.shotId) || String(index)}
          getLabel={(shot, index) => primitive(shot.shotId) || `${t('agentResident.untitledShot')} ${index + 1}`}
          stackLabel={t('agentResident.batchStack')}
          previousLabel={t('agentResident.batchPrevious')}
          nextLabel={t('agentResident.batchNext')}
          renderActive={(shot, index) => <SemanticShotEditor args={args} index={index} shot={shot} onChange={onChange} t={t} total={shots.length} />}
        />
      )}
      <ReferencesDisclosure args={args} t={t} onChange={onChange} />
    </section>
  )
}

export function GenerationProposalEditor({ args: rawArgs, onChange, t }: { args: unknown; onChange: (next: Record<string, unknown>) => void; t: Translate }): JSX.Element | null {
  const parsed = asGenerationProposalArgs(rawArgs)
  const semantic = asSemanticGenerationProposalArgs(rawArgs)
  const [activeNodeIndex, setActiveNodeIndex] = React.useState(0)
  if (!parsed && semantic) return <SemanticProposalEditor args={semantic} t={t} onChange={onChange} />
  if (!parsed || !parsed.nodes.length) return null
  const update = (next: GenerationProposalArgs): void => onChange(next)
  return (
    <section className="grid min-w-0 gap-1.5" data-agent-proposal-editor="true">
      {parsed.nodes.length > 1 ? (
        <ResidentBatchStack
          items={parsed.nodes}
          activeIndex={activeNodeIndex}
          onSelect={setActiveNodeIndex}
          getKey={(node, index) => primitive(node.clientId) || String(index)}
          getLabel={(node, index) => primitive(node.title) || `${t('agentResident.untitledShot')} ${index + 1}`}
          stackLabel={t('agentResident.batchStack')}
          previousLabel={t('agentResident.batchPrevious')}
          nextLabel={t('agentResident.batchNext')}
          renderActive={(node, index) => <ProposalNodeEditor args={parsed} index={index} node={node} onChange={update} t={t} total={parsed.nodes.length} />}
        />
      ) : (
        <ProposalNodeEditor args={parsed} index={0} node={parsed.nodes[0]!} onChange={update} t={t} showHeader={false} />
      )}
    </section>
  )
}
