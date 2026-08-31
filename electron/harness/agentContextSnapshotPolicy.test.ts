import { describe, expect, it } from 'vitest'
import type { AgentChatRequest } from './agentChatContracts'
import { captureAgentChatRequest } from './agentChatPolicy'

describe('Host ContextSnapshot capture', () => {
  it('detaches and freezes the resident selection before runtime preparation', () => {
    const request = {
      prompt: '改这个镜头',
      capability: 'canvas-agent',
      history: { kind: 'ephemeral' },
      projectId: 'project-a',
      contextSnapshot: {
        version: 1,
        handles: [{
          id: 'timeline-clip:clip-1',
          kind: 'video',
          targetId: 'clip-1',
          revision: 'timeline-1',
          locator: { type: 'timeRange', startMs: 0, endMs: 1000 },
          display: { title: '开场片段' },
          intentRole: 'target',
        }],
      },
    } satisfies AgentChatRequest

    const captured = captureAgentChatRequest(request)
    expect(captured.contextSnapshot).toEqual(request.contextSnapshot)
    expect(captured.contextSnapshot).not.toBe(request.contextSnapshot)
    expect(captured.contextSnapshot?.handles).not.toBe(request.contextSnapshot.handles)
    expect(Object.isFrozen(captured.contextSnapshot)).toBe(true)
    expect(Object.isFrozen(captured.contextSnapshot?.handles)).toBe(true)
    expect(Object.isFrozen(captured.contextSnapshot?.handles[0])).toBe(true)
    expect(Object.isFrozen(captured.contextSnapshot?.handles[0]?.locator)).toBe(true)
  })
})
