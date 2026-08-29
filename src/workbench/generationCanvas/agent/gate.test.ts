import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CANVAS_READ_CAPABILITY } from '../../../../electron/shared/agentCapabilities/canvasRead'
import { CANVAS_DELETE_CAPABILITY } from '../../../../electron/shared/agentCapabilities/canvasDelete'
import { CANVAS_WRITE_CAPABILITY } from '../../../../electron/shared/agentCapabilities/canvasWrite'
import { ASSET_READ_CAPABILITY } from '../../../../electron/shared/agentCapabilities/assetRead'
import {
  EXPORT_READ_CAPABILITY,
  EXPORT_WRITE_CAPABILITY,
} from '../../../../electron/shared/agentCapabilities/exportCapabilities'
import { capabilityOperationAliasesFor } from '../../../../electron/shared/agentCapabilities/registry'
import { evaluateGate } from './gate'

describe('evaluateGate — 统一求值流(§6.1)', () => {
  it('fails closed if a main-owned canvas read ever leaks into the renderer gate', () => {
    const decision = evaluateGate({ kind: 'tool-call', toolName: CANVAS_READ_CAPABILITY.aliases.pi, args: {} })
    expect(decision.outcome).toBe('deny')
    const source = readFileSync(new URL('./gate.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('CANVAS_READ_CAPABILITY')
  })

  it('① policy:propose_storyboard_plan 免费可改(不写画布/不花钱)→ allow', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'propose_storyboard_plan', args: {} })).toEqual({
      outcome: 'allow',
    })
  })

  it('② invariant:不认识的工具 deny,reason 是人话', () => {
    const decision = evaluateGate({ kind: 'tool-call', toolName: 'rm_rf_everything', args: {} })
    expect(decision.outcome).toBe('deny')
    if (decision.outcome === 'deny') expect(decision.reason).toContain('rm_rf_everything')
  })

  it('纯函数:同入参恒同出参', () => {
    const intent = { kind: 'tool-call' as const, toolName: 'propose_storyboard_plan', args: {} }
    expect(evaluateGate(intent)).toEqual(evaluateGate(intent))
  })

  it('has no renderer policy owner for any Registry-owned Phase 3/4 alias', () => {
    const aliases = [
      CANVAS_WRITE_CAPABILITY.aliases.pi,
      ...capabilityOperationAliasesFor(CANVAS_WRITE_CAPABILITY.id, 'pi'),
      CANVAS_DELETE_CAPABILITY.aliases.pi,
      ASSET_READ_CAPABILITY.aliases.pi,
      ...capabilityOperationAliasesFor(ASSET_READ_CAPABILITY.id, 'pi'),
      EXPORT_READ_CAPABILITY.aliases.pi,
      ...capabilityOperationAliasesFor(EXPORT_READ_CAPABILITY.id, 'pi'),
      EXPORT_WRITE_CAPABILITY.aliases.pi,
      ...capabilityOperationAliasesFor(EXPORT_WRITE_CAPABILITY.id, 'pi'),
    ]
    const source = readFileSync(new URL('./gate.ts', import.meta.url), 'utf8')
    for (const alias of aliases) {
      expect(evaluateGate({ kind: 'tool-call', toolName: alias, args: {} }).outcome).toBe('deny')
      expect(source).not.toContain(alias)
    }
  })

  it('retires the renderer-owned paid generation tool instead of advertising a dead handler', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'run_generation_batch', args: { nodeIds: ['n1'] } }).outcome)
      .toBe('deny')
    const source = readFileSync(new URL('./gate.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('run_generation_batch')
  })

  it('batch-run / spend intent 先一律 ask(S6b/S7 落地语义)', () => {
    expect(evaluateGate({ kind: 'batch-run', nodeIds: ['n1', 'n2'] })).toEqual({ outcome: 'ask' })
    expect(evaluateGate({ kind: 'spend', estimatedCost: 1.5 })).toEqual({ outcome: 'ask' })
  })
})
