import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CANVAS_READ_CAPABILITY } from '../../../../electron/shared/agentCapabilities/canvasRead'
import { evaluateGate } from './gate'

describe('evaluateGate — 统一求值流(§6.1)', () => {
  it('fails closed if a main-owned canvas read ever leaks into the renderer gate', () => {
    const decision = evaluateGate({ kind: 'tool-call', toolName: CANVAS_READ_CAPABILITY.aliases.pi, args: {} })
    expect(decision.outcome).toBe('deny')
    const source = readFileSync(new URL('./gate.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('CANVAS_READ_CAPABILITY')
  })

  it('① policy:只读工具直通 allow', () => {
    for (const toolName of ['get_media', 'inspect_media', 'search_media', 'inspect_source_range', 'read_waveform', 'inspect_export_job', 'verify_render']) {
      expect(evaluateGate({ kind: 'tool-call', toolName, args: {} })).toEqual({ outcome: 'allow' })
    }
  })

  it('① policy:propose_storyboard_plan 免费可改(不写画布/不花钱)→ allow', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'propose_storyboard_plan', args: {} })).toEqual({
      outcome: 'allow',
    })
  })

  it('③ ask:写工具排队等点头', () => {
    for (const toolName of ['create_canvas_nodes', 'connect_canvas_edges', 'export_timeline', 'cancel_export_job']) {
      expect(evaluateGate({ kind: 'tool-call', toolName, args: {} })).toEqual({ outcome: 'ask' })
    }
  })

  it('破坏性工具同样 ask(确认门管同一条)', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'delete_canvas_nodes', args: { nodeIds: ['n1'] } })).toEqual({
      outcome: 'ask',
    })
  })

  it('② invariant:不认识的工具 deny,reason 是人话', () => {
    const decision = evaluateGate({ kind: 'tool-call', toolName: 'rm_rf_everything', args: {} })
    expect(decision.outcome).toBe('deny')
    if (decision.outcome === 'deny') expect(decision.reason).toContain('rm_rf_everything')
  })

  it('纯函数:同入参恒同出参', () => {
    const intent = { kind: 'tool-call' as const, toolName: 'delete_canvas_nodes', args: { nodeIds: ['n1'] } }
    expect(evaluateGate(intent)).toEqual(evaluateGate(intent))
  })

  it('has no renderer policy owner for the Registry-owned canvas.write alias', () => {
    expect(evaluateGate({ kind: 'tool-call', toolName: 'set_node_prompt', args: {} }).outcome).toBe('deny')
    expect(readFileSync(new URL('./gate.ts', import.meta.url), 'utf8')).not.toContain('set_node_prompt')
  })

  describe('S6-4 锁不变量(N11):AI 硬禁,出边放行', () => {
    const ctx = {
      lockedNodes: new Map([['real-1', '女主角定妆卡']]),
      // clientId 翻译:LLM 口中的 c1 = real-1。
      resolveNodeId: (id: string) => (id === 'c1' ? 'real-1' : id),
    }

    it('LLM 用 clientId 指代锁住节点 → 翻译后照样 deny', () => {
      const decision = evaluateGate(
        { kind: 'tool-call', toolName: 'delete_canvas_nodes', args: { nodeIds: ['c1'] } },
        ctx,
      )
      expect(decision.outcome).toBe('deny')
    })

    it('入边(target=锁节点)deny;出边(source=锁节点,被引用)allow→ask', () => {
      const inbound = evaluateGate(
        { kind: 'tool-call', toolName: 'connect_canvas_edges', args: { edges: [{ source: 'n9', target: 'real-1' }] } },
        ctx,
      )
      expect(inbound.outcome).toBe('deny')
      const outbound = evaluateGate(
        { kind: 'tool-call', toolName: 'connect_canvas_edges', args: { edges: [{ source: 'real-1', target: 'n9' }] } },
        ctx,
      )
      expect(outbound).toEqual({ outcome: 'ask' })
    })

    it('不碰锁节点的写操作不受影响', () => {
      expect(
        evaluateGate({ kind: 'tool-call', toolName: 'create_canvas_nodes', args: { nodes: [] } }, ctx),
      ).toEqual({ outcome: 'ask' })
    })
  })

  it('batch-run / spend intent 先一律 ask(S6b/S7 落地语义)', () => {
    expect(evaluateGate({ kind: 'batch-run', nodeIds: ['n1', 'n2'] })).toEqual({ outcome: 'ask' })
    expect(evaluateGate({ kind: 'spend', estimatedCost: 1.5 })).toEqual({ outcome: 'ask' })
  })
})
