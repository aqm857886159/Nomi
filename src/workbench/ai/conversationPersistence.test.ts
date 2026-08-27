import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchAiMessage } from './workbenchAiTypes'

const deps = vi.hoisted(() => ({
  project: 'A', read: vi.fn(), write: vi.fn(), seed: vi.fn(), clear: vi.fn(),
  creation: [] as WorkbenchAiMessage[], generation: [] as WorkbenchAiMessage[],
}))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => ({ conversations: { read: deps.read, write: deps.write } }) }))
vi.mock('../../api/desktopClient', () => ({ seedWorkbenchAgentSession: deps.seed, clearWorkbenchAgentSession: deps.clear }))
vi.mock('../windowUrlParam', () => ({ readWindowUrlParam: () => deps.project }))
vi.mock('./workbenchAgentRunner', () => ({ workbenchSessionKey: (area: string) => `nomi:workbench:${deps.project}:${area}` }))
vi.mock('../workbenchStore', () => ({ useWorkbenchStore: {
  getState: () => ({ creationAiMessages: deps.creation, setCreationAiMessages: (messages: WorkbenchAiMessage[]) => { deps.creation = messages } }),
  subscribe: () => () => {},
} }))
vi.mock('../generationCanvas/store/generationCanvasStore', () => ({ useGenerationCanvasStore: {
  getState: () => ({ generationAiMessages: deps.generation, setGenerationAiMessages: (messages: WorkbenchAiMessage[]) => { deps.generation = messages } }),
  subscribe: () => () => {},
} }))
vi.mock('../generationCanvas/agent/proposalUndo', () => ({
  getCommittedProposal: () => null, parseCommittedProposalRecord: () => null,
  setCommittedProposal: vi.fn(), clearCommittedProposal: vi.fn(), subscribeCommittedProposal: () => () => {},
}))
import { getActiveConversationId, initConversationPersistence, listConversations, loadProjectConversations, startNewConversation, switchConversation } from './conversationPersistence'
import { useCreationTurnStore } from '../creation/creationTurnController'
import { useCanvasTurnStore } from '../generationCanvas/agent/canvasTurnController'

const area = (project: string, suffix: string) => ({ activeId: `${project}-${suffix}`, threads: [{
  id: `${project}-${suffix}`, title: project, createdAt: 1, updatedAt: 1,
  messages: [{ id: `${project}-${suffix}-message`, role: 'user' as const, content: `${project} ${suffix}` }],
}] })
const disk = (project: string) => ({ ok: true, conversations: { creation: area(project, 'creation'), generation: area(project, 'generation') } })
let dispose: () => void
beforeEach(() => {
  vi.clearAllMocks()
  deps.creation = []
  deps.generation = []
  deps.seed.mockResolvedValue(undefined)
  deps.write.mockResolvedValue({ ok: true })
  dispose = initConversationPersistence(() => deps.project)
})
afterEach(() => { dispose(); useCreationTurnStore.getState().abandon(); useCanvasTurnStore.getState().abandon() })

describe('conversation projection owns explicit project and thread', () => {
  it('starts the captured project read before the host publishes its new active project ref', async () => {
    deps.project = 'host-old'
    deps.read.mockResolvedValue(disk('host-next'))
    const loading = loadProjectConversations('host-next')
    deps.project = 'host-next'
    await loading
    expect(deps.read).toHaveBeenCalledWith('host-next')
    expect(deps.creation[0]?.content).toBe('host-next creation')
    expect(deps.seed).toHaveBeenCalledWith({ kind: 'persistent', binding: {
      sessionKey: 'nomi:workbench:host-next:creation', threadId: 'host-next-creation',
    } }, [{ role: 'user', content: 'host-next creation' }])
  })

  it('late A read cannot overwrite B or seed A bubbles into B', async () => {
    let resolveA!: (value: ReturnType<typeof disk>) => void
    deps.read.mockImplementation((project: string) => project === 'race-A'
      ? new Promise((resolve) => { resolveA = resolve }) : Promise.resolve(disk(project)))
    deps.project = 'race-A'
    const first = loadProjectConversations(deps.project)
    deps.project = 'race-B'
    await loadProjectConversations(deps.project)
    resolveA(disk('race-A'))
    await first
    expect(deps.creation.map((message) => message.content)).toEqual(['race-B creation'])
    expect(deps.generation.map((message) => message.content)).toEqual(['race-B generation'])
    expect(deps.seed.mock.calls).toEqual([
      [{ kind: 'persistent', binding: { sessionKey: 'nomi:workbench:race-B:creation', threadId: 'race-B-creation' } }, [{ role: 'user', content: 'race-B creation' }]],
      [{ kind: 'persistent', binding: { sessionKey: 'nomi:workbench:race-B:generation', threadId: 'race-B-generation' } }, [{ role: 'user', content: 'race-B generation' }]],
    ])
  })

  it('new conversation stops the old turn and ensures an empty new binding without clearing the archive', async () => {
    deps.project = 'new-thread-project'
    deps.read.mockResolvedValue(disk(deps.project))
    await loadProjectConversations(deps.project)
    deps.seed.mockClear()
    const oldId = getActiveConversationId('creation')
    const turn = useCreationTurnStore.getState().begin()
    const cancel = vi.fn()
    useCreationTurnStore.getState().attachCancel(turn.id, cancel)
    startNewConversation('creation')
    const nextId = getActiveConversationId('creation')
    expect(nextId).not.toBe(oldId)
    expect(turn.isCurrent()).toBe(false)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(deps.clear).not.toHaveBeenCalled()
    expect(listConversations('creation').find((item) => item.id === oldId)?.messages[0].content).toBe('new-thread-project creation')
    expect(deps.seed).toHaveBeenCalledWith({ kind: 'persistent', binding: { sessionKey: 'nomi:workbench:new-thread-project:creation', threadId: nextId } }, [])
    switchConversation('creation', oldId as string)
    expect(deps.seed).toHaveBeenLastCalledWith({ kind: 'persistent', binding: { sessionKey: 'nomi:workbench:new-thread-project:creation', threadId: oldId } }, [{ role: 'user', content: 'new-thread-project creation' }])
  })

  it('switching generation threads invalidates canvas callbacks, but not the creation turn', async () => {
    deps.project = 'area-project'
    deps.read.mockResolvedValue(disk(deps.project))
    await loadProjectConversations(deps.project)
    const oldId = getActiveConversationId('generation') as string
    startNewConversation('generation')
    const canvas = useCanvasTurnStore.getState().begin()
    const creation = useCreationTurnStore.getState().begin()
    switchConversation('generation', oldId)
    expect(canvas.isCurrent()).toBe(false)
    expect(creation.isCurrent()).toBe(true)
  })
})
