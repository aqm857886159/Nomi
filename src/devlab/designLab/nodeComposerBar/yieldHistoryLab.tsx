// 迁移量具：同一份最终数据重挂生产宿主，不重放到达路径。
import React from 'react'
import { useTranslation } from 'react-i18next'
import NodeGenerationComposer from '../../../workbench/generationCanvas/nodes/NodeGenerationComposer'
import StoryboardAnchorZone from '../../../workbench/creation/storyboard/anchorZone/StoryboardAnchorZone'
import { LayoutRows } from '../storyboardReuse/storyboardLayoutLabKit'
import { labAnchorRuntime, labShot, NOOP } from '../storyboard/storyboardFixtures'
import { layoutPlan } from '../storyboardReuse/storyboardLayoutFixtures'
import { LabCanvasViewport } from '../labCanvasViewport'
import { PROFILE_KINDS } from '../../../../electron/shared/contracts/modelAccessCapabilities'
import { modelKindForTaskKind } from '../../../../electron/shared/capabilityModeManifest'
import { MODEL_ARCHETYPES } from '../../../../electron/shared/modelArchetypes/builtInCatalog'
import { seedModelCatalogForTests } from '../../../config/modelCatalogCache'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import type { ModelOption } from '../../../config/models'

type State = { host: 'canvas' | 'list' | 'shot' | 'anchor'; width: number; model: string; mode: string; duration: number; resolution: string; busy: boolean }
const catalog = (kind: 'video' | 'image'): ModelOption[] => MODEL_ARCHETYPES.filter(a => a.kind === kind).map(a => ({ value: a.id, modelKey: a.id, vendor: 'apimart', label: a.label, kind, meta: { archetypeId: a.id } }))
const models = { video: catalog('video'), image: catalog('image') }
const initial: State = { host: 'canvas', width: 485, model: 'seedance-2.5-apimart', mode: 't2v', duration: 5, resolution: '720p', busy: false }
declare global { interface Window { __yieldHistory?: { set: (patch: Partial<State>) => void; remount: () => void; current: () => State } } }

export function YieldHistoryStage(): React.JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = React.useState(initial)
  const [epoch, setEpoch] = React.useState(0)
  const root = React.useRef<HTMLDivElement>(null)
  const { host, width, model, mode, duration, resolution, busy } = state
  React.useLayoutEffect(() => {
    seedModelCatalogForTests({ ok: true, counts: { vendors: 1, enabledVendors: 1, models: models.video.length + models.image.length, enabledModels: models.video.length + models.image.length, mappings: 0, enabledMappings: 0, enabledApiKeys: 1 }, byKind: [], issues: [] }, [
      ...PROFILE_KINDS.filter(mode => modelKindForTaskKind(mode) === 'video').map(requiredMode => ({ kind: 'video' as const, requiredMode, options: models.video })),
      ...PROFILE_KINDS.filter(mode => modelKindForTaskKind(mode) === 'image').map(requiredMode => ({ kind: 'image' as const, requiredMode, options: models.image })),
    ])
    useGenerationCanvasStore.setState({ nodes: [{ id: 'history-node', kind: 'video', categoryId: 'shots', title: 'History', prompt: 'A quiet harbour', position: { x: 0, y: 0 }, size: { width: 340, height: 130 }, status: busy ? 'running' : 'idle', meta: { modelKey: model, modelVendor: 'apimart', archetype: { id: model, modeId: mode, modeChosenBy: 'human' }, size: '16:9', duration, resolution, ...(mode === 'first' ? { firstFrameUrl: `${window.location.origin}/tests/ux/fixtures/b3-refs/海边清晨.svg` } : {}) } } as GenerationCanvasNode], edges: [] })
  }, [model, mode, duration, resolution, busy])
  const node = useGenerationCanvasStore(s => s.nodes.find(n => n.id === 'history-node'))
  React.useLayoutEffect(() => {
    // 宿主给定尺寸：同一宽度下改内容不改变底栏行宽。
    for (const el of root.current?.querySelectorAll<HTMLElement>('[data-node-composer-footer]') ?? []) el.parentElement!.style.width = `${width}px`
    for (const el of root.current?.querySelectorAll<HTMLElement>('[data-composer-host], .generation-canvas-v2-node__composer-card') ?? []) el.style.width = `${width + 26}px`
  })
  React.useEffect(() => {
    window.__yieldHistory = { set: patch => setState(s => ({ ...s, ...patch })), remount: () => setEpoch(n => n + 1), current: () => state }
    return () => { delete window.__yieldHistory }
  }, [state])
  const params = { size: '16:9', duration, resolution }
  const shot = labShot({ index: 1, shotKind: 'video', modelKey: model, modelVendor: 'apimart', modeId: mode, durationSec: duration, params, prompt: 'A quiet harbour', anchorIds: [], referenceBindings: {} })
  const anchor = { id: 'history-anchor', kind: 'character' as const, name: 'Lin', description: 'A traveller', carrier: 'visual' as const, modelKey: model, modelVendor: 'apimart', params }
  return <div ref={root} data-yield-history={host} className="relative ml-64 mt-32" style={{ width: 1100, height: 800 }}>
    <div key={`${host}:${epoch}`}>
      {host === 'canvas' || host === 'list' ? <LabCanvasViewport>{node ? <NodeGenerationComposer node={node} visualSize={{ width: 340, height: 130 }} host={host === 'canvas' ? 'canvas' : 'inline'} onFeedback={NOOP} /> : null}</LabCanvasViewport>
        : host === 'shot' ? <LayoutRows plan={layoutPlan('16:9', [shot])} width={width + 350} models={models} execs={{ 1: { status: busy ? 'generating' : 'ready' } }} />
          : <div style={{ width: width + 350 }}><StoryboardAnchorZone cards={[labAnchorRuntime(anchor)]} aspect="16:9" expanded imageModelOptions={models.image} pendingActions={busy ? new Set(['anchor:history-anchor']) : undefined} onUpdateAnchor={NOOP} onChangeKind={NOOP} onRemoveAnchor={NOOP} onGenerateAnchor={NOOP} onRegenerateAnchor={NOOP} onToggleFrozenAnchor={NOOP} /></div>}
    </div>
    <span className="sr-only">{t('generationCommon.parameters.generationParameters')}</span>
  </div>
}
