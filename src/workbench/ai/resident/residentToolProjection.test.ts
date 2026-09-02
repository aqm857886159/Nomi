import { describe, expect, it } from 'vitest'
import {
  normalizeResidentToolProjection,
  readResidentToolProjections,
  redactResidentSensitiveText,
  residentToolProjectionKey,
  residentToolProjectionScope,
  writeResidentToolProjections,
  type ResidentToolProjection,
  type ResidentToolProjectionStorage,
} from './residentToolProjection'

function storageStub(initial: Record<string, string> = {}): ResidentToolProjectionStorage {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

describe('resident tool display projection', () => {
  it('redacts credential-shaped values before persistence', () => {
    const text = redactResidentSensitiveText('model=ok apiKey=sk-test_1234567890abcdef bearer abcdefghijklmnop')
    expect(text).toContain('apiKey=[redacted]')
    expect(text).toContain('Bearer [redacted]')
    expect(text).not.toContain('sk-test_1234567890abcdef')
  })

  it('round-trips only normalized display fields for a thread scope', () => {
    const storage = storageStub()
    const scope = residentToolProjectionScope('project-1:g1', 'thread-1')
    const callKey = residentToolProjectionKey(scope, 'turn-1', 'call-1').slice(scope.length + 1)
    const projection: ResidentToolProjection = normalizeResidentToolProjection({
      effect: '创建 2 个镜头卡',
      target: '当前画布',
      technicalDetails: 'model=agent-runtime-image · prompt=小猫头像',
    })
    writeResidentToolProjections(scope, new Map([[callKey, projection]]), storage)
    expect(readResidentToolProjections(scope, storage)).toEqual({ [callKey]: projection })
  })

  it('ignores malformed storage entries instead of creating a second history', () => {
    const storage = storageStub({ 'nomi.agent.resident.tool-projections.v1:project-1%3Ag1%3Athread-1': JSON.stringify({ bad: { effect: 'ok' }, valid: 'not-an-object' }) })
    const scope = residentToolProjectionScope('project-1:g1', 'thread-1')
    expect(readResidentToolProjections(scope, storage)).toEqual({})
  })
})
