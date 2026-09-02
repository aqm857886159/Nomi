import { describe, expect, it } from 'vitest'
import { projectAgentSkillEvents } from './skillEventProjection'
import type { ProjectAgentItem } from '../../../electron/shared/projectAgentContracts'

const base = { itemId: 'tool-a', threadId: 'thread-a', turnId: 'turn-a', kind: 'tool' as const, toolCallId: 'call-a', invocationId: 'inv-a', capability: { id: 'skill.read', version: 1 }, status: 'done' as const, retryable: false, deviated: false, createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' }

describe('projectAgentSkillEvents', () => {
  it('projects successful and failed skill ledger items without inventing names', () => {
    const items: ProjectAgentItem[] = [
      { ...base, skillLoad: { name: 'brand.promo', packageVersion: 'nomi-skill-v1', contentHash: 'a'.repeat(64) } },
      { ...base, itemId: 'tool-b', toolCallId: 'call-b', invocationId: 'inv-b', status: 'failed' },
      { ...base, itemId: 'tool-c', toolCallId: 'call-c', invocationId: 'inv-c', capability: { id: 'canvas.read', version: 1 } },
    ]
    expect(projectAgentSkillEvents(items)).toEqual([
      { itemId: 'tool-a', name: 'brand.promo', status: 'done', loaded: true },
      { itemId: 'tool-b', status: 'failed', loaded: false },
    ])
  })
})
