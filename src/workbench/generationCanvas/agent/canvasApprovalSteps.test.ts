import { beforeEach, describe, expect, it, vi } from 'vitest'
const deps = vi.hoisted(() => ({ catalog: vi.fn(), read: vi.fn(() => ({ nodes: [], edges: [], groups: [] })) }))
vi.mock('./availableModels', () => ({ listAvailableModelsForAgent: deps.catalog }))
vi.mock('./generationCanvasTools', () => ({ readGenerationCanvasSnapshot: deps.read }))
import { claimCanvasApprovalBatch, resolveCanvasApprovalSteps } from './canvasApprovalSteps'

beforeEach(() => vi.clearAllMocks())

const turn = { id: 7, isCurrent: () => true, canWrite: () => true, isCancelled: () => false }
const call = (toolCallId: string) => ({
  turnId: turn.id,
  toolCallId,
  toolName: 'set_node_prompt',
  args: { nodeId: 'node', prompt: 'original' },
  isPending: () => true,
  confirm: vi.fn(async () => {}),
})

describe('approval preflight ownership', () => {
  it('does not read the newly active canvas after the old approval loses its turn', async () => {
    let release!: () => void
    let writable = true
    deps.catalog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([])
        }),
    )
    const pending = resolveCanvasApprovalSteps(
      [
        {
          toolCallId: 'create',
          toolName: 'create_canvas_nodes',
          effectiveArgs: {
            nodes: [{ clientId: 'n', kind: 'image', modelKey: 'model-A' }],
          },
          transport: vi.fn(async () => {}),
        },
      ],
      () => writable,
    )
    writable = false
    release()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(deps.read).not.toHaveBeenCalled()
  })

  it.each(['missing', 'expired', 'other-turn'] as const)(
    '%s member rejects the whole batch without consuming another card',
    (kind) => {
      const valid = call('valid')
      const invalid = {
        ...call('invalid'),
        ...(kind === 'other-turn' ? { turnId: 6 } : {}),
        isPending: () => kind !== 'expired',
      }
      const pending = new Map([['valid', valid], ...(kind === 'missing' ? [] : [['invalid', invalid] as const])])
      expect(claimCanvasApprovalBatch([{ toolCallId: 'valid' }, { toolCallId: 'invalid' }], pending, turn)).toBeNull()
      expect(pending.get('valid')).toBe(valid)
      expect(valid.confirm).not.toHaveBeenCalled()
    },
  )

  it('duplicate IDs cannot consume or execute the same approval twice', () => {
    const valid = call('valid')
    const pending = new Map([['valid', valid]])
    expect(claimCanvasApprovalBatch([{ toolCallId: 'valid' }, { toolCallId: 'valid' }], pending, turn)).toBeNull()
    expect(pending.get('valid')).toBe(valid)
  })

  it('claims exact objects once, keeps overrides, and leaves subsequently enqueued cards alone', () => {
    let active = true
    const original = { ...call('same-id'), isPending: () => active }
    const other = call('other')
    const pending = new Map([
      ['same-id', original],
      ['other', other],
    ])
    const approval = claimCanvasApprovalBatch(
      [{ toolCallId: 'same-id', overrides: { prompt: 'approved edit' } }],
      pending,
      turn,
    )
    expect(approval?.rawSteps[0]).toMatchObject({
      effectiveArgs: { nodeId: 'node', prompt: 'approved edit' },
      overridesDelta: { prompt: 'approved edit' },
      transport: original.confirm,
    })
    expect(approval?.items[0].call).toBe(original)
    expect(approval?.owner.canWrite()).toBe(true)
    expect(claimCanvasApprovalBatch([{ toolCallId: 'same-id' }], pending, turn)).toBeNull()
    const replacement = call('same-id')
    pending.set('same-id', replacement)
    active = false
    expect(approval?.owner.canWrite()).toBe(false)
    expect(pending.get('same-id')).toBe(replacement)
    expect(pending.get('other')).toBe(other)
  })
})
