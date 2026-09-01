import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { canvasToolDescriptors } from '../../../../electron/harness/tools/canvasDescriptors'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { evaluateGate } from './gate'

describe('retired renderer generation writer', () => {
  it('is neither advertised nor accepted by the renderer gate', () => {
    expect(canvasToolDescriptors).not.toHaveProperty('run_generation_batch')
    expect(evaluateGate({
      kind: 'tool-call',
      toolName: 'run_generation_batch',
      args: { nodeIds: ['node-1'] },
    }).outcome).toBe('deny')
  })

  it('cannot mint a spend grant or dispatch a local generation queue', async () => {
    await expect(applyCanvasToolCall('run_generation_batch', { nodeIds: ['node-1'] }))
      .rejects.toThrow('unknown tool run_generation_batch')
    const source = readFileSync(new URL('./applyCanvasToolCall.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('mintSpendGrant')
    expect(source).not.toContain('runPlanWithToasts')
    expect(source).not.toContain("toolName === 'run_generation_batch'")
  })
})
