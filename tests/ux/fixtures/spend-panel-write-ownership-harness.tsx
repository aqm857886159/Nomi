import '../../../src/i18n'
import { NodeWriteAccessProvider } from '../../../src/workbench/generationCanvas/nodes/nodeWriteAccess'
// Controlled host integration: real React lifecycle and real panel/drop/draft writers.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useAgentPanelSpendConfirm } from '../../../src/workbench/ai/v4/useAgentPanelSpendConfirm'
import { useNodeAssetDrop } from '../../../src/workbench/generationCanvas/nodes/useNodeAssetDrop'
import { resolveNodeArraySlots } from '../../../src/workbench/generationCanvas/model/nodeAssetDrop'
import type { GenerationCanvasNode } from '../../../src/workbench/generationCanvas/model/generationCanvasTypes'
import type { PendingSpendConfirm, PendingSpendRead } from '../../../src/desktop/productionRunBridgeTypes'
import type { NodeWriteAccess } from '../../../src/workbench/generationCanvas/nodes/nodeWriteAccess'

const NodeGenerationComposer = React.lazy(async () => {
  const [{ default: Composer }, { MantineProvider }] = await Promise.all([import('../../../src/workbench/generationCanvas/nodes/NodeGenerationComposer'), import('@mantine/core')])
  await import('@mantine/core/styles.css')
  return { default: (props: React.ComponentProps<typeof Composer>) => <MantineProvider><Composer {...props} /></MantineProvider> }
})

const meta = { modelKey: 'seedance-2', archetype: { id: 'seedance-2', modeId: 'omni' } }
const slot = resolveNodeArraySlots(meta).find(slot => slot.accept === 'image') ?? resolveNodeArraySlots(meta)[0]
if (!slot) throw new Error('reference fixture requires a real model array slot')
const nodes: GenerationCanvasNode[] = ['a', 'b'].map(id => ({ id, kind: 'video', title: id, position: { x: 0, y: 0 }, prompt: id, meta: { ...meta, [slot.metaKey]: [] } }))
const pending: PendingSpendConfirm = { projectId: 'project', runId: 'run', operationId: 'operation', quoteId: 'quote', planVersion: 1, candidateRevision: 1, currency: 'CNY', knownSubtotal: 2, unknownShotCount: 0,
  shots: nodes.map((node, index) => ({ shotId: node.id, nodeId: node.id, index: index + 1, prompt: node.id, modelId: 'seedance-2', providerId: 'fixture', kind: 'video' as const, mode: 'text-to-video', modeId: 'omni', parameters: { [slot.metaKey]: [] }, price: { known: true, amount: 1 } })) }
let refresh: (() => void) | undefined
let releaseUpload: ((value: unknown) => void) | undefined
let uploads = 0
let completed = 0
let stale: NodeWriteAccess | undefined
// 上传那一刻卡上那张框的 id（卡自己的 id，不是画布占位节点的 id）：退役之后拿同一个 id 也读不到、写不进。
let staleId = ''
let model!: ReturnType<typeof useAgentPanelSpendConfirm>
const feedback: string[] = []
const calls: unknown[] = []
const toasts: { message: string; kind: string }[] = []
const fixture = { nodes, edges: [], pending, calls, toasts,
  refresh: () => refresh?.(),
  edit: () => model.node && model.writeAccess.updateNode(model.node.id, { prompt: 'edited' }),
  confirm: () => model.confirm(),
  confirmRemaining: () => model.confirmRemaining(),
  discard: () => model.discard(),
  detach: () => { nodes.splice(0); pending.shots.forEach(shot => { delete (shot as {nodeId?: string}).nodeId }); refresh?.() },
  narrow: () => { (pending.shots as unknown[]).splice(0, 1); refresh?.() },
  slotKey: slot.metaKey,
  upload: () => { uploads++; return new Promise(resolve => { releaseUpload = resolve }) },
  snapshot: () => ({ slotKind: model.slot?.kind, slotDetail: model.slot?.summary, pendingShots: model.pending?.shots.map(shot => shot.shotId), busy: model.busy, batchRunning: model.batchRunning, title: model.slot?.title, progress: model.slot?.progress?.hint, page: model.page, quote: model.pending?.quoteId, operation: model.pending?.operationId, candidateRevision: model.pending?.candidateRevision,
    meta: model.node?.meta, refs: model.node?.meta?.[slot.metaKey], prompt: model.node?.prompt, uploads, completed, feedback, staleNode: stale?.latestNode(staleId)?.id, staleWritable: stale?.canWrite?.() }),
  change: (field: string) => {
    if (field === 'page') model.setPage(1)
    else { Object.assign(pending, field === 'quote' ? { quoteId: 'quote-next' } : field === 'operation' ? { operationId: 'operation-next' } : { candidateRevision: 2 }); refresh?.() }
  },
  // 重新出价：宿主收回这一次出价（× / 待决时打字 / 重启）之后，同一份草稿再 `generate`
  // 走的就是这一条——**operationId 不变**，报价指纹换一份、计划进一版。
  rebid: () => { Object.assign(pending, { quoteId: 'quote-rebid', planVersion: pending.planVersion + 1, candidateRevision: pending.candidateRevision + 1 }); refresh?.() },
  back: () => model.setPage(0),
  // 宿主那一侧此刻怎么说：没有待决（卡关了）/ 读不到 / 又有了。
  hide: () => { Object.assign(fixture, { hidden: true }); refresh?.() },
  failRead: () => { Object.assign(fixture, { readFails: true }); refresh?.() },
  restore: () => { Object.assign(fixture, { hidden: false, readFails: false }); refresh?.() },
  finish: () => releaseUpload?.({ id: 'asset', data: { url: 'nomi-local://asset/reference.png' } }),
  unmount: () => root.unmount(),
  staleWrite: () => stale?.updateNode(staleId, { prompt: 'late mutation' }),
}
Object.assign(window, { spendOwnership: fixture })
function Drop({ node, access }: { node: GenerationCanvasNode; access: NodeWriteAccess }) {
  const drop = useNodeAssetDrop(node, message => feedback.push(message), access)
  return <button id="upload" onClick={() => {
    stale = access
    staleId = node.id
    void drop.dropHandlers.onDrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: { getData: () => '', files: [new File(['fixture'], 'reference.png', { type: 'image/png' })] } } as unknown as React.DragEvent<HTMLElement>).finally(() => { completed++ })
  }}>upload</button>
}
// 宿主那一份待决出价：生产里它随对话投影推过来（`LaneWorkspaceProjection.spend`），这里由夹具「推」——
// 每次 `refresh()` 就是主进程推来一份新的。钩子自己不拉、不轮询。
function hostRead(): PendingSpendRead {
  const f = fixture as typeof fixture & { hidden?: boolean; readFails?: boolean }
  if (f.readFails) return { surface: 'unreadable', reason: 'projection-failed' }
  return { surface: 'ready', rows: f.hidden ? [] : [structuredClone(pending)] }
}
function Host() {
  const [read, setRead] = React.useState<PendingSpendRead>(hostRead)
  React.useLayoutEffect(() => { refresh = () => setRead(hostRead()); return () => { refresh = undefined } }, [])
  model = useAgentPanelSpendConfirm(read)
  return model.node ? <><Drop node={model.node} access={model.writeAccess} />{location.search.includes('composer=1') && <React.Suspense fallback={<span>Loading shared composer</span>}><NodeWriteAccessProvider value={model.writeAccess}><NodeGenerationComposer node={model.node} host="panel" readOnly={location.search.includes('readonly=1')} visualSize={{ width: 420, height: 300 }} onFeedback={message => feedback.push(message)} /></NodeWriteAccessProvider></React.Suspense>}</> : null
}
const root = createRoot(document.getElementById('root')!)
root.render(<Host />)
