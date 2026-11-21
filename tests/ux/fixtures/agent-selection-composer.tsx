import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/i18n'
import { useWorkbenchStore } from '../../../src/workbench/workbenchStore'
import { createDefaultTimeline } from '../../../src/workbench/timeline/timelineMath'
import { AgentPanelV4Composer } from '../../../src/workbench/ai/v4/AgentPanelV4Composer'
import { useResidentComposerContext } from '../../../src/workbench/ai/resident/ResidentComposerContext'
import { useAgentPanelV4Actions } from '../../../src/workbench/ai/v4/useAgentPanelV4Actions'
import type { AgentPanelV4Data } from '../../../src/workbench/ai/v4/useAgentPanelV4Data'
import type { V4ComposerReference } from '../../../src/workbench/ai/v4/agentPanelV4Types'
import { laneClient, EMPTY_LANE_WORKSPACE } from '../../../src/workbench/ai/lane/laneClient'
import type { LaneWorkspaceProjection } from '../../../electron/shared/agentLane/laneContracts'
import type { LaneDesktopCommand } from '../../../electron/shared/agentLane/laneDesktopContracts'
import { restoreProjectAgentInputs } from '../../../src/workbench/ai/projectAgentDraftRecovery'
import type { NomiEditorOwner } from '../../../src/workbench/common/useNomiRichTextEditor'

// 浏览器夹具只替掉桌面目录 IO 与 lane 传输；组件、store、恢复、send 及命令组装均为生产代码。
Object.assign(window, { nomiDesktop: { modelCatalog: { listModels: async () => [], listVendors: async () => [] } } })
const originalFetch = globalThis.fetch
const guardedFetch: typeof fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('selection_fixture_network_blocked')
  return originalFetch(input, init)
}
globalThis.fetch = guardedFetch
let blocked = false
try { await fetch('https://selection-canary.invalid') } catch { blocked = true }
if (!blocked) throw new Error('network canary failed')
const commands: LaneDesktopCommand[] = []
let publish!: (projection: LaneWorkspaceProjection) => void
let projection: LaneWorkspaceProjection = { ...EMPTY_LANE_WORKSPACE, workspaceId: 'fixture-workspace', lanes: [{ laneName: 'main', sessionId: 'session-a', createdAt: 1, updatedAt: 1 }], active: { ...EMPTY_LANE_WORKSPACE.active, lane: 'main' } }
laneClient.connect({ onProjection: listener => { publish = listener; return () => undefined }, send: async command => {
  commands.push(command)
  if (command.kind === 'workspace-open') return { ok: true, workspaceId: 'fixture-workspace' }
  return { ok: true }
} })
await laneClient.open({ projectId: 'fixture-project', immutableProjectUuid: 'fixture-uuid' } as never)
publish(projection)
let references: readonly V4ComposerReference[] = []
let saved: readonly V4ComposerReference[] = []
const root = createRoot(document.getElementById('root')!)
const label = (key: string) => key
const removeFile = (id: string) => useWorkbenchStore.getState().setProjectAgentAttachments(items => items.filter(item => item.id !== id))
// 输入框的 owner：和生产 ProjectAgentResidentShell 读写同一份 store 草稿。
const draftOwner: NomiEditorOwner<string> = {
  subscribe: useWorkbenchStore.subscribe,
  getSnapshot: () => useWorkbenchStore.getState().projectAgentDraft,
  write: next => useWorkbenchStore.getState().setProjectAgentDraft(next),
}
function Harness() {
  references = useResidentComposerContext('preview', [], label, removeFile)
  const snapshot = React.useSyncExternalStore(laneClient.subscribe, laneClient.workspace, laneClient.workspace)
  const actions = useAgentPanelV4Actions('preview', { snapshot } as AgentPanelV4Data)
  const draft = useWorkbenchStore(state => state.projectAgentDraft)
  return <div data-selection-ready="true" data-selection-owner={laneClient.context() ? 'connected' : 'disconnected'}><AgentPanelV4Composer chips={references} draft={draftOwner}
    onSubmit={() => { void actions.send(draft) }} />
    <output data-send-error="true">{actions.error}</output></div>
}
function seed(kind: 'videos' | 'same-name' | 'caption', oldDraft = false) {
  commands.length = 0
  const timeline = createDefaultTimeline()
  timeline.tracks.find(track => track.id === 'videoTrack')!.clips = ['a', 'b'].map((id, index) => ({
    id, type: 'video', sourceNodeId: `node-${id}`, label: kind === 'same-name' ? 'Same name' : `Original ${id}`,
    startFrame: index * 90, endFrame: index * 90 + 60, frameCount: 60, offsetStartFrame: 0, offsetEndFrame: 0,
  }))
  timeline.textClips = [{ id: 'caption', text: 'Original caption', style: 'caption', startFrame: 0, endFrame: 60 }]
  useWorkbenchStore.setState({ timeline, selectedTimelineClipIds: kind === 'caption' ? [] : ['b', 'a'], selectedTextClipId: kind === 'caption' ? 'caption' : '',
    projectAgentDraft: '', projectAgentDraftIntent: null, projectAgentAdmissionId: null, projectAgentAttachments: [], creationActiveSkill: null, selectedLibraryPrompt: null })
  if (oldDraft) restoreProjectAgentInputs('fixture-uuid', { laneName: 'main', sessionId: 'session-a' }, [{ text: 'Shorten this', intent: {
    target: { kind: 'timeline', clipIds: ['old-a'] }, contextSnapshot: { version: 1, handles: [{ id: 'timeline-clip:old-a', kind: 'timelineClip', targetId: 'old-a', revision: '1', intentRole: 'target', locator: { type: 'timeRange', startMs: 9000, endMs: 10000 }, display: { title: 'Old A' } }] },
  } }], true)
}
Object.assign(window, { __selectionFixture: {
  seed, commands, canary: blocked,
  seedReference: (kind: 'file' | 'skill' | 'prompt') => {
    seed('caption'); useWorkbenchStore.getState().selectTimelineTextClip('')
    if (kind === 'file') useWorkbenchStore.getState().setProjectAgentAttachments(['file-a', 'file-b'].map(id => ({ id, fileName: 'Same file', contentType: 'text/plain', sizeBytes: 1, kind: 'file', status: 'uploading' })))
    if (kind === 'skill') useWorkbenchStore.getState().setCreationActiveSkill({ key: 'skill-a' })
    if (kind === 'prompt') useWorkbenchStore.getState().setSelectedLibraryPrompt({ id: 'prompt-a', title: 'Prompt A', prompt: 'Original prompt' } as never)
  },
  state: () => ({ media: useWorkbenchStore.getState().selectedTimelineClipIds, text: useWorkbenchStore.getState().selectedTextClipId, timeline: useWorkbenchStore.getState().timeline }),
  save: () => { saved = references }, removeSaved: (index: number) => saved[index].onRemove(),
  disconnect: () => laneClient.connect(undefined), unmount: () => root.unmount(),
  switchSession: () => { projection = { ...projection, lanes: [{ laneName: 'main', sessionId: 'session-b', createdAt: 1, updatedAt: 1 }], active: projection.active }; publish(projection) },
  switchProject: async () => { await laneClient.open({ projectId: 'new-project', immutableProjectUuid: 'new-uuid' } as never); publish(projection) },
} })
seed('videos')
root.render(<Harness />)
