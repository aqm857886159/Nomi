import { describe, expect, it } from 'vitest'
import { summarizeAgentPlan } from './generationCanvas/components/agentPlanSummary'
import {
  buildStoryboardPlanningMessage,
  STORYBOARD_PLANNER_SKILL,
} from './generationCanvas/agent/storyboardLauncher'
import { orderNodesByEdges } from './generationCanvas/agent/sendStoryboardToTimeline'
import { buildStoryDocument, TRY_NOW_EXAMPLES } from './library/tryNowExamples'
import type { GenerationCanvasEdge } from './generationCanvas/model/generationCanvasTypes'

describe('Phase C storyboard happy path', () => {
  describe('summarizeAgentPlan', () => {
    it('returns null when there is no create_canvas_nodes call', () => {
      const plan = summarizeAgentPlan([
        { toolCallId: 't1', toolName: 'read_canvas_state', args: {} },
      ])
      expect(plan).toBeNull()
    })

    it('returns null when create_canvas_nodes has no nodes', () => {
      const plan = summarizeAgentPlan([
        { toolCallId: 't1', toolName: 'create_canvas_nodes', args: { nodes: [] } },
      ])
      expect(plan).toBeNull()
    })

    it('aggregates create_canvas_nodes + connect_canvas_edges into a single plan', () => {
      const plan = summarizeAgentPlan([
        {
          toolCallId: 'create-1',
          toolName: 'create_canvas_nodes',
          args: {
            summary: '6 镜片段',
            nodes: [
              { clientId: 'n1', kind: 'image', title: '开场', prompt: 'opening shot', position: { x: 160, y: 260 } },
              { clientId: 'n2', kind: 'image', title: '高潮', prompt: 'climax', position: { x: 500, y: 260 } },
            ],
          },
        },
        {
          toolCallId: 'connect-1',
          toolName: 'connect_canvas_edges',
          args: { edges: [{ sourceClientId: 'n1', targetClientId: 'n2' }] },
        },
      ])
      expect(plan).not.toBeNull()
      expect(plan!.summary).toBe('6 镜片段')
      expect(plan!.nodes).toHaveLength(2)
      expect(plan!.nodes[0].prompt).toBe('opening shot')
      expect(plan!.edges).toEqual([{ sourceClientId: 'n1', targetClientId: 'n2' }])
      expect(plan!.createCallId).toBe('create-1')
      expect(plan!.connectCallId).toBe('connect-1')
    })

    it('edges carried inside create_canvas_nodes fold into the same plan (atomic, no second approval)', () => {
      const plan = summarizeAgentPlan([
        {
          toolCallId: 'create-1',
          toolName: 'create_canvas_nodes',
          args: {
            summary: '原子计划',
            nodes: [
              { clientId: 'n1', kind: 'image', title: '开场', prompt: 'p1' },
              { clientId: 'n2', kind: 'image', title: '收尾', prompt: 'p2' },
            ],
            edges: [{ sourceClientId: 'n1', targetClientId: 'n2' }],
          },
        },
      ])
      expect(plan!.edges).toEqual([{ sourceClientId: 'n1', targetClientId: 'n2' }])
      expect(plan!.connectCallId).toBeNull()
    })

    it('create-carried edges merge & dedupe with a trailing connect call (legacy traces)', () => {
      const plan = summarizeAgentPlan([
        {
          toolCallId: 'create-1',
          toolName: 'create_canvas_nodes',
          args: {
            nodes: [
              { clientId: 'n1', kind: 'image', title: 'a', prompt: 'p1' },
              { clientId: 'n2', kind: 'image', title: 'b', prompt: 'p2' },
              { clientId: 'n3', kind: 'image', title: 'c', prompt: 'p3' },
            ],
            edges: [{ sourceClientId: 'n1', targetClientId: 'n2' }],
          },
        },
        {
          toolCallId: 'connect-1',
          toolName: 'connect_canvas_edges',
          args: {
            edges: [
              { sourceClientId: 'n1', targetClientId: 'n2' }, // 与 create 内重复 → 去重
              { sourceClientId: 'n2', targetClientId: 'n3' },
            ],
          },
        },
      ])
      expect(plan!.edges).toEqual([
        { sourceClientId: 'n1', targetClientId: 'n2' },
        { sourceClientId: 'n2', targetClientId: 'n3' },
      ])
      expect(plan!.connectCallId).toBe('connect-1')
    })

    it('synthesises a summary when the agent did not provide one', () => {
      const plan = summarizeAgentPlan([
        {
          toolCallId: 'c',
          toolName: 'create_canvas_nodes',
          args: { nodes: [{ clientId: 'n1', kind: 'image', title: 't', prompt: 'p' }] },
        },
      ])
      expect(plan!.summary).toContain('1 个镜头')
      expect(plan!.connectCallId).toBeNull()
    })

    it('fills missing clientIds and titles with defaults', () => {
      const plan = summarizeAgentPlan([
        {
          toolCallId: 'c',
          toolName: 'create_canvas_nodes',
          args: { nodes: [{ kind: 'image', prompt: 'p' }, { kind: 'image', prompt: 'q' }] },
        },
      ])
      expect(plan!.nodes[0].clientId).toBe('n1')
      expect(plan!.nodes[1].clientId).toBe('n2')
      expect(plan!.nodes[0].title).toMatch(/镜头 1/)
    })

    it('drops malformed edges so connect_count reflects only usable ones', () => {
      const plan = summarizeAgentPlan([
        {
          toolCallId: 'c',
          toolName: 'create_canvas_nodes',
          args: { nodes: [{ clientId: 'n1', kind: 'image', title: 'a', prompt: 'a' }] },
        },
        {
          toolCallId: 'e',
          toolName: 'connect_canvas_edges',
          args: { edges: [{ sourceClientId: 'n1' }, { sourceClientId: 'n1', targetClientId: 'n2' }] },
        },
      ])
      expect(plan!.edges).toEqual([{ sourceClientId: 'n1', targetClientId: 'n2' }])
    })
  })

  describe('buildStoryboardPlanningMessage', () => {
    it('wraps the story with delimiter markers and the planner instruction', () => {
      const message = buildStoryboardPlanningMessage('  Once upon a time...  ')
      expect(message).toContain('请把下面这段故事规划成可生成的轨迹')
      expect(message).toContain('--- 故事正文 ---')
      expect(message).toContain('--- 故事正文结束 ---')
      expect(message).toContain('Once upon a time...')
      // Whitespace around the story should be trimmed.
      expect(message).not.toContain('  Once')
    })

    it('exports the planner skill descriptor for the canvas assistant', () => {
      expect(STORYBOARD_PLANNER_SKILL).toEqual({
        key: 'workbench.storyboard.planner',
        name: '故事板规划师',
      })
    })
  })

  describe('orderNodesByEdges', () => {
    function edge(source: string, target: string): GenerationCanvasEdge {
      return { id: `${source}-${target}`, source, target }
    }

    it('returns the selection as-is when only one node is selected', () => {
      expect(orderNodesByEdges(['a'], [])).toEqual(['a'])
    })

    it('topologically orders a simple linear chain regardless of selection order', () => {
      const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')]
      expect(orderNodesByEdges(['c', 'a', 'd', 'b'], edges)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('falls back to the input order when the subgraph has multiple sources', () => {
      const edges = [edge('a', 'c'), edge('b', 'c')]
      expect(orderNodesByEdges(['a', 'b', 'c'], edges)).toEqual(['a', 'b', 'c'])
    })

    it('falls back to the input order when the chain has a branch', () => {
      const edges = [edge('a', 'b'), edge('a', 'c')]
      expect(orderNodesByEdges(['a', 'b', 'c'], edges)).toEqual(['a', 'b', 'c'])
    })

    it('ignores edges that point outside the selection', () => {
      const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'z')]
      expect(orderNodesByEdges(['a', 'b', 'c'], edges)).toEqual(['a', 'b', 'c'])
    })
  })

  describe('Try-Now example fixtures', () => {
    it('ships exactly the three example stories the hero advertises', () => {
      expect(TRY_NOW_EXAMPLES.map((example) => example.id)).toEqual([
        'manga',
        'product-demo',
        'travel-vlog',
      ])
    })

    it('every example carries a non-empty story body and a project name', () => {
      for (const example of TRY_NOW_EXAMPLES) {
        expect(example.projectName.length).toBeGreaterThan(0)
        expect(example.story.trim().length).toBeGreaterThan(80)
      }
    })

    it('buildStoryDocument splits paragraphs and emits a tiptap-shaped doc', () => {
      const doc = buildStoryDocument('第一段。\n\n第二段。', '示例项目')
      expect(doc.title).toBe('示例项目')
      const root = doc.contentJson as { type: string; content: Array<{ type: string; content?: Array<{ type: string; text: string }> }> }
      expect(root.type).toBe('doc')
      expect(root.content).toHaveLength(2)
      expect(root.content[0].type).toBe('paragraph')
      expect(root.content[0].content?.[0]).toEqual({ type: 'text', text: '第一段。' })
      expect(root.content[1].content?.[0]).toEqual({ type: 'text', text: '第二段。' })
    })

    it('buildStoryDocument emits an empty paragraph for an empty story', () => {
      const doc = buildStoryDocument('   ')
      const root = doc.contentJson as { content: Array<{ type: string }> }
      expect(root.content).toEqual([{ type: 'paragraph' }])
    })
  })
})
