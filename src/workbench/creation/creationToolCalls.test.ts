import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const deps = vi.hoisted(() => ({ save: vi.fn(), providers: vi.fn() }))
vi.mock('../api/skillApi', () => ({
  importWorkbenchSkill: deps.save, getAvailableSkillProviders: deps.providers,
  skillCapabilityFor: () => ({ missing: [], satisfied: true }),
}))
import { createCreationToolHandler } from './creationToolCalls'
import { useCreationTurnStore } from './creationTurnController'

beforeEach(() => { vi.clearAllMocks(); deps.save.mockReturnValue({ ok: true, skillName: 'my-skill', dirName: 'my-skill' }); deps.providers.mockResolvedValue([]) })
afterEach(() => useCreationTurnStore.getState().abandon())

function setup() {
  const turn = useCreationTurnStore.getState().begin()
  const enqueue = vi.fn()
  return { turn, enqueue, handler: createCreationToolHandler({ turn, enqueue, allowsWrite: true, skillSaveFailed: () => 'failed' }) }
}

describe('Creation document tool turn boundary', () => {
  it.each(['read_full_text', 'append_to_end', 'author_skill'])('Stop rejects %s even while cancelled result may still display', async (toolName) => {
    const { handler, turn, enqueue } = setup()
    useCreationTurnStore.getState().requestUserCancel()
    const confirm = vi.fn(async () => {})
    await handler({
      turnId: String(turn.id),
      executionToken: 'execution-test',
      toolCallId: 'tool', toolName, args: { content: 'old' }, isPending: () => true, confirm,
    })
    expect(turn.isCurrent()).toBe(true)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ ok: false, denied: true }))
    expect(enqueue).not.toHaveBeenCalled()
    expect(deps.save).not.toHaveBeenCalled()
  })

  it('author_skill stays automatic but late provider discovery cannot approve an abandoned turn', async () => {
    let release!: () => void
    deps.providers.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]) }))
    const { handler, enqueue, turn } = setup()
    const confirm = vi.fn(async () => {})
    const pending = handler({
      turnId: String(turn.id),
      executionToken: 'execution-test',
      toolCallId: 'skill', toolName: 'author_skill', args: {}, isPending: () => true, confirm,
    })
    await Promise.resolve()
    expect(deps.save).toHaveBeenCalledTimes(1)
    expect(enqueue).not.toHaveBeenCalled()
    useCreationTurnStore.getState().abandon()
    release()
    await pending
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ ok: false, denied: true }))
  })
})
