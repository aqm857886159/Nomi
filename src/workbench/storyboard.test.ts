import { describe, expect, it } from 'vitest'
import {
  buildStoryboardPlanningMessage,
  STORYBOARD_PLANNER_SKILL,
} from './generationCanvas/agent/storyboardLauncher'
import type { StoryboardPlan } from './generationCanvas/agent/storyboardPlan'
import { buildStoryDocument, TRY_NOW_EXAMPLES } from './library/tryNowExamples'

describe('Phase C storyboard happy path', () => {
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
      const currentPlan: StoryboardPlan = {
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
