// B2b only: proposal composition, never imported by production.
// Host items → projectV4Flow mirrors useAgentPanelV4Data; rows/composer/brand are production components.
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronRight, IconHistory, IconLayoutSidebarRightCollapse } from '@tabler/icons-react'
import type { ProjectAgentStatus } from '../../../../electron/shared/projectAgentContracts'
const WorkbenchEditor = React.lazy(() => import('./b2bEditor'))
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { NomiBrand } from '../../../design'
import { AgentPanelV4Composer } from '../../../workbench/ai/v4/AgentPanelV4Composer'
import { AgentPanelV4Panel, V4FlowRow } from '../../../workbench/ai/v4/AgentPanelV4Panel'
import { V4ContextRing } from '../../../workbench/ai/v4/AgentPanelV4Context'
import { ActionIcon } from '../../../workbench/ai/v4/AgentPanelV4Icons'
import { V4ErrorBar } from '../../../workbench/ai/v4/AgentPanelV4Receipt'
import { projectV4Flow } from '../../../workbench/ai/v4/agentPanelV4Projection'
import { useV4Labels } from '../../../workbench/ai/v4/agentPanelV4Labels'
import { clampAssistantWidth, ASSISTANT_WIDTH_MIN, assistantWidthMaxFor } from '../../../workbench/assistantWidthBounds'
import { labHostState, labUserItem, labToolItem, labAssistantItem } from './agentPanelV4LabHost'
import { useV4Fixtures } from './agentPanelV4LabKit'

export type B2bPhase = ProjectAgentStatus
const STEPS = [
  ['document.read', '读取全文', 2],
  ['skill.read', '加载分镜技能', 5],
  ['document.read', '核对人物与场景', 9],
  ['canvas.write', '准备 8 个镜头', 14],
  ['canvas.write', '校验镜头参数', 18],
  ['canvas.write', '重新校验镜头参数', 22],
  ['canvas.write', '写入 8 镜', 31],
] as const
// Specimen-local normative token from nomi-tokens.css:69 / design system §2.6.
// Runtime currently omits Variable, so the BEFORE must retain the production token.
const BRAND_TOKENS = { '--nomi-font-display': '"Fraunces Variable", Fraunces, "Inter Variable", Inter, serif' } as React.CSSProperties
const SOURCE = '日落前的一分钟'
const REQUEST = '把《日落前的一分钟》拆成 8 镜，保留结尾的小鞋。'
const ANSWER = '已拆成 8 镜。结尾保留小鞋和蓝布的呼应，人物、景别与时长已写入分镜方案。'

function useEvidence(phase: B2bPhase, step: number) {
  const { t } = useTranslation()
  const fx = useV4Fixtures()
  const selected = phase === 'running' ? STEPS.slice(0, step + 1) : STEPS
  const tools = selected.map(([capability, , seconds], index) => ({
    ...labToolItem(`b2b-tool-${index}`, capability, phase === 'running' && index === step ? 'running' : index === 4 || (phase === 'failed' && index === 6) ? 'failed' : 'done'),
    createdAt: `2026-09-06T09:00:${String(seconds).padStart(2, '0')}.000Z`,
    updatedAt: `2026-09-06T09:00:${String(seconds + 1).padStart(2, '0')}.000Z`,
  }))
  const snapshot = labHostState({ turnStatus: phase === 'done' ? 'done' : phase === 'failed' ? 'failed' : 'running', items: [labUserItem('b2b-user', REQUEST), ...tools, ...(phase === 'done' ? [labAssistantItem('b2b-answer', ANSWER)] : [])] })
  const flow = projectV4Flow({ items: snapshot.items, turns: snapshot.turns, queue: [], pendingTools: [], toolArgs: new Map(), toolProjections: new Map(selected.map(([, label], i) => [`turn-lab:b2b-tool-${i}`, { label, effect: '', target: SOURCE, technicalDetails: '', input: '', output: i === 4 ? '参数校验未通过，已重试' : '' }])), taskFacts: new Map(), clipLabels: new Map(), skillNames: new Map(), t })
  return { flow, context: fx.context, tools, selected }
}

function Process({ phase, step }: { phase: B2bPhase; step: number }): JSX.Element {
  const evidence = useEvidence(phase, step)
  const shimmer = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    if (phase !== 'running' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = shimmer.current?.animate([{ backgroundPosition: '200% 0' }, { backgroundPosition: '-200% 0' }], { duration: 1800, iterations: Infinity })
    return () => animation?.cancel()
  }, [phase])
  const tools = evidence.flow.filter(item => item.kind === 'tool')
  return <>
    <details className="group text-caption text-nomi-ink-60" data-b2b-process={phase}>
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 rounded-nomi-sm px-2 hover:bg-nomi-ink-05">
        <ActionIcon action={phase === 'running' && step < 2 ? step === 0 ? 'document' : 'skill' : 'canvas'} />
        <span ref={shimmer} className={phase === 'running' ? 'bg-gradient-to-r from-nomi-ink-40 via-nomi-ink to-nomi-ink-40 bg-clip-text text-transparent' : ''} style={{ backgroundSize: '200% 100%' }} data-b2b-active>
          {phase === 'running' ? STEPS[step][1] : `用了 ${tools.length} 个工具 · ${evidence.tools.slice(0, -1).filter(tool => tool.status === 'failed').length} 次重试 · ${STEPS[STEPS.length - 1][2]}s`}
        </span>
        {phase === 'running' ? <span className="ml-auto font-nomi-mono text-micro">{STEPS[step][2]}s</span> : null}
        <IconChevronRight size={12} stroke={1.5} className="ml-auto transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-2 flex flex-col gap-1 border-l border-nomi-line pl-2" data-b2b-details>
        {tools.map((item, i) => <V4FlowRow key={i} darkMode={false} item={item} />)}
      </div>
    </details>
    {phase === 'failed' ? <div className="rounded-nomi border border-nomi-danger-edge bg-nomi-paper p-3" data-b2b-failure>
      <div className="mb-2 text-body-sm font-medium">写入 8 镜</div>
      <V4ErrorBar reason="分镜未写入：参数校验仍未通过。" />
      <p className="mb-0 mt-2 text-caption text-nomi-ink-60">已有文稿未改动。请补充分镜时长后重试。</p>
    </div> : null}
  </>
}

export function B2bPanel({ phase = 'done', width = 390, height = 620, step = 6 }: { phase?: B2bPhase; width?: number; height?: number; step?: number }): JSX.Element {
  const labels = useV4Labels()
  const evidence = useEvidence(phase, step)
  const [draft, setDraft] = React.useState('')
  return <section className="flex flex-col overflow-clip rounded-nomi border border-nomi-line bg-nomi-paper" style={{ width, height, ...BRAND_TOKENS }} data-b2b-panel>
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-nomi-line-soft px-3 text-body-sm font-semibold">
      <NomiBrand markSize={18} wordSize={14} />
      <V4ContextRing usage={evidence.context} labels={labels.context} />
      <span className="flex-1" /><IconHistory size={15} stroke={1.5} className="text-nomi-ink-40" /><IconLayoutSidebarRightCollapse size={15} stroke={1.5} className="text-nomi-ink-40" />
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2.5">
      {evidence.flow.filter(item => item.kind === 'user').map((item, i) => <V4FlowRow key={i} item={item} darkMode={false} panelHeight={height} />)}
      <Process phase={phase} step={step} />
      {evidence.flow.filter(item => item.kind === 'assistant').map((item, i) => <V4FlowRow key={i} item={item} darkMode={false} panelHeight={height} />)}
    </div>
    <div className="shrink-0 px-2.5 pb-2.5 pt-2"><AgentPanelV4Composer panelHeight={height} mode={phase === 'running' ? 'running' : 'idle'} value={draft} onValueChange={setDraft} modelLabel="DeepSeek V3.2" /></div>
  </section>
}

export function B2bProcessSpecimen({ phase }: { phase: B2bPhase }): JSX.Element {
  const [step, setStep] = React.useState(0)
  return <div className="bg-nomi-bg p-4" data-design-lab-stage="b2b">
    {phase === 'running' ? <div className="mb-3 flex gap-2 text-caption">{[0, 1, 6].map(i => <button key={i} className="rounded-nomi-sm border border-nomi-line px-2 py-1" onClick={() => setStep(i)} data-b2b-step={i}>{STEPS[i][1]}</button>)}</div> : null}
    <B2bPanel phase={phase} step={step} />
  </div>
}

export function B2bResizeSpecimen({ initial }: { initial: number }): JSX.Element {
  const [width, setWidth] = React.useState(() => clampAssistantWidth(Number(localStorage.getItem('nomi-lab-b2b-width') ?? initial), window.innerWidth))
  React.useMemo(() => {
    useWorkbenchStore.setState({ activeDocumentId: 'b2b-document', workbenchDocuments: [{ id: 'b2b-document', version: 1, title: SOURCE, updatedAt: 0, contentJson: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: SOURCE }] },
      ...['下午五点，小禾背着相机走到河边旧街，想在日落前完成自己的第一条短片。', '风吹动修鞋摊前的蓝布。她蹲下，看见师傅用磨白的手掌托平一只小鞋。'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    ] } }] })
    return null
  }, [])
  const drag = React.useRef<{ x: number; width: number } | null>(null)
  const change = (value: number) => { const next = clampAssistantWidth(value, window.innerWidth); setWidth(next); localStorage.setItem('nomi-lab-b2b-width', String(next)) }
  return <div className="bg-nomi-bg p-4" style={{ width: 1440 }} data-design-lab-stage="b2b">
    <div className="mb-3 flex items-center gap-4 text-caption text-nomi-ink-60"><span>样张 · 拖动分隔线调整面板</span><span data-b2b-width>{width}px</span></div>
    <div className="flex items-stretch">
      <div className="min-w-0 flex-1" style={{ height: 620 }}><React.Suspense fallback={null}><WorkbenchEditor /></React.Suspense></div>
      <div role="separator" tabIndex={0} aria-label="调整 Agent 面板宽度" aria-orientation="vertical" aria-valuemin={ASSISTANT_WIDTH_MIN} aria-valuemax={assistantWidthMaxFor(window.innerWidth)} aria-valuenow={width}
        className="group flex w-4 shrink-0 cursor-col-resize touch-none items-center justify-center focus:outline-nomi-accent"
        onPointerDown={event => { drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerMove={event => { if (drag.current) change(drag.current.width + drag.current.x - event.clientX) }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); change(width + (event.key === 'ArrowLeft' ? 20 : -20)) } }}>
        <span className="h-8 w-1 rounded-full bg-nomi-ink-20 group-hover:bg-nomi-accent" />
      </div>
      <B2bPanel width={width} />
    </div>
  </div>
}

export function B2bFrames(): JSX.Element {
  return <div className="flex gap-4 bg-nomi-bg p-4" data-design-lab-stage="b2b">
    {['创作', '分镜', '生成', '预览'].map(surface => <div key={surface}><p className="mb-3 mt-0 text-caption text-nomi-ink-60">{surface}</p><B2bPanel width={340} /></div>)}
  </div>
}

export function B2bBrandAudit(): JSX.Element {
  const evidence = useEvidence('done', 6)
  return <div className="flex gap-6 bg-nomi-bg p-4" data-design-lab-stage="b2b">
    <div><p className="text-caption">现状 · 顶栏调用 NomiBrand 默认值</p><div className="mb-6 rounded-nomi border border-nomi-line bg-nomi-paper p-4"><NomiBrand /></div><p className="text-caption">现状 · Agent 面板头</p><AgentPanelV4Panel flow={[]} context={evidence.context} width={340} height={300} /></div>
    <div style={BRAND_TOKENS}><p className="text-caption">规范 · 同一品牌组件 / 无新设计</p><div className="mb-6 rounded-nomi border border-nomi-line bg-nomi-paper p-4"><NomiBrand /></div><p className="text-caption">样张 · 面板头复用品牌组件</p><B2bPanel width={340} height={300} /></div>
  </div>
}
