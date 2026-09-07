import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { modelToolSurfaceManifest } from '../../../../electron/harness/tools/modelToolSurfaceManifest'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { evaluateGate } from './gate'

describe('retired renderer generation writer', () => {
  it('is neither advertised nor accepted by the renderer gate', () => {
    // 2026-09-07: this used to read the retired `canvasDescriptors` tool table.
    // The live owner of the model-facing surface is the manifest, so assert there.
    const modelFacingToolNames: string[] = [
      ...modelToolSurfaceManifest.generation,
      ...modelToolSurfaceManifest.editing,
      ...modelToolSurfaceManifest.canvas,
      ...modelToolSurfaceManifest.document,
    ].map(({ name }) => name)
    expect(modelFacingToolNames).not.toContain('run_generation_batch')
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
