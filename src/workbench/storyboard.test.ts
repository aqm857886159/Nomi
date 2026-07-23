import { describe, expect, it } from 'vitest'
import { summarizeAgentPlan, planNodeLayer, isRelayEdge } from './generationCanvas/components/agentPlanSummary'
import {
  buildStoryboardPlanningMessage,
  STORYBOARD_PLANNER_SKILL,
} from './generationCanvas/agent/storyboardLauncher'
import { buildStoryDocument, TRY_NOW_EXAMPLES } from './library/tryNowExamples'

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

    it('exposes createEdges with mode + keeps relay edges separable (T3 分组数据)', () => {
      const plan = summarizeAgentPlan([
        {
          toolCallId: 'c',
          toolName: 'create_canvas_nodes',
          args: {
            nodes: [
              { clientId: 'ref-c1', kind: 'character', title: '角色：男主', prompt: 'p' },
              { clientId: 'kf1', kind: 'image', title: '镜头 1', prompt: 'p' },
              { clientId: 'v1', kind: 'video', title: '镜头 1 视频', prompt: 'p' },
              { clientId: 'v2', kind: 'video', title: '镜头 2 视频', prompt: 'p' },
            ],
            edges: [
              { sourceClientId: 'ref-c1', targetClientId: 'kf1', mode: 'character_ref' },
              { sourceClientId: 'kf1', targetClientId: 'v1', mode: 'first_frame' },
              { sourceClientId: 'v1', targetClientId: 'v2', mode: 'first_frame' },
            ],
          },
        },
      ])
      // createEdges 保留 mode，供计划卡分组/接力识别
      expect(plan!.createEdges).toHaveLength(3)
      expect(plan!.createEdges[0].mode).toBe('character_ref')
    })
  })

  describe('planNodeLayer / isRelayEdge（T3 纯函数）', () => {
    it('层由 kind 推导：character/scene→reference, image→keyframe, video→video', () => {
      expect(planNodeLayer({ kind: 'character' })).toBe('reference')
      expect(planNodeLayer({ kind: 'scene' })).toBe('reference')
      expect(planNodeLayer({ kind: 'image' })).toBe('keyframe')
      expect(planNodeLayer({ kind: 'video' })).toBe('video')
      expect(planNodeLayer({ kind: 'text' })).toBeNull()
    })

    it('尾帧接力边 = video 源 + video 目标 + first_frame；其余非接力', () => {
      const kinds = new Map([['v1', 'video'], ['v2', 'video'], ['kf1', 'image']])
      expect(isRelayEdge({ sourceClientId: 'v1', targetClientId: 'v2', mode: 'first_frame' }, kinds)).toBe(true)
      // 关键帧→视频的 first_frame 不是接力（源是 image）
      expect(isRelayEdge({ sourceClientId: 'kf1', targetClientId: 'v1', mode: 'first_frame' }, kinds)).toBe(false)
      // video→video 但非 first_frame 也不是接力
      expect(isRelayEdge({ sourceClientId: 'v1', targetClientId: 'v2', mode: 'reference' }, kinds)).toBe(false)
    })
  })

  describe('buildStoryboardPlanningMessage', () => {
    it('wraps the story with delimiter markers and the planner instruction', () => {
      const message = buildStoryboardPlanningMessage({ storyText: '  Once upon a time...  ' })
      expect(message).toContain('propose_storyboard_plan')
      expect(message).toContain('分镜方案')
      expect(message).toContain('--- 故事正文 ---')
      expect(message).toContain('--- 故事正文结束 ---')
      expect(message).toContain('Once upon a time...')
      // Whitespace around the story should be trimmed.
      expect(message).not.toContain('  Once')
    })

    it('修改模式：带当前方案 + 修改要求时，产出基于现方案的修改指令（P0-9 Slice 3）', () => {
      const currentPlan = {
        title: '测试方案 · 2 镜',
        anchors: [{ id: 'anchor-1', kind: 'character', name: '小明', carrier: 'visual', description: '少年' }],
        shots: [
          { index: 1, durationSec: 5, anchorIds: ['anchor-1'], prompt: '推镜，小明走进教室' },
          { index: 2, durationSec: 5, anchorIds: ['anchor-1'], prompt: '特写，小明坐下' },
        ],
      }
      const message = buildStoryboardPlanningMessage({ currentPlan, revisionRequest: '把所有镜头时长改成 8 秒' })
      expect(message).toContain('propose_storyboard_plan')
      expect(message).toContain('--- 当前方案(JSON) ---')
      expect(message).toContain('小明')
      expect(message).toContain('把所有镜头时长改成 8 秒')
      // 修改模式不该带「故事正文」骨架。
      expect(message).not.toContain('--- 故事正文 ---')
    })

    it('图片+视频模式：要求单条逻辑 shot 内嵌 keyframe，不另拆 image shot', () => {
      const message = buildStoryboardPlanningMessage({ storyText: '父子在书房视频通话。', shotMode: 'image-video' })
      expect(message).toContain('图片+视频分镜')
      expect(message).toContain('keyframe')
      expect(message).toContain('enabled: true')
      expect(message).toContain('不要把首帧图另拆成一条 image shot')
      expect(message).toContain('绝对不要引用 image-1')
    })

    it('exports the planner skill descriptor for the canvas assistant', () => {
      expect(STORYBOARD_PLANNER_SKILL).toEqual({
        key: 'workbench.storyboard.planner',
        name: '故事板规划师',
      })
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
