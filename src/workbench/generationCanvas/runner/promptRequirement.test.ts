import { describe, expect, it } from 'vitest'
import { comfyWorkflowTakesPrompt, promptRequiredForNode } from './promptRequirement'
import { resolveTaskArchetype } from './catalogTaskResolve'
import { modeForInputs, type ModeInput } from '../../../../electron/shared/modelArchetypes/modeForInputs'
import { EDGE_MODE_SLOTS } from '../../../../electron/shared/canvas/edgeAdmission'

const comfyMeta = (binding: Record<string, unknown>) => ({ comfyWorkflowImport: { text: '{}', binding } })
const node = (meta?: Record<string, unknown>) => ({ id: 'n', kind: 'image' as const, ...(meta ? { meta } : {}) })

describe('promptRequiredForNode —— 需不需要打字由模型自己说，不再一刀切', () => {
  it('ComfyUI 处理类工作流（去背景/超分）不吃提示词 → 空提示词照样能提交', () => {
    expect(promptRequiredForNode(node({ modelVendor: 'comfyui-local' }), 'comfyui-local')).toBe(false)
  })

  it('第 2 台起的 ComfyUI 实例同样（key 前缀派生，不是硬写死第一台）', () => {
    expect(promptRequiredForNode(node({}), 'comfyui-local-workstation')).toBe(false)
  })

  it('不回归：普通中转/云端模型仍然必须有提示词', () => {
    expect(promptRequiredForNode(node({ modelVendor: 'apimart' }), 'apimart')).toBe(true)
  })

  it('不回归：无 meta 的裸节点保持严格（默认要提示词）', () => {
    expect(promptRequiredForNode(node(), 'volcengine')).toBe(true)
  })
})

// 2026-11-15：Seedance 2.0 / Wan 3.0（APIMart）放了素材的方式，官方写提示词可不填——以前被我们自己拦住发不出去。
// 「Required for text-to-video; optional for image-to-video or video-reference-to-video」（Seedance 2.0）
// 「Required unless media fields are provided (at least one of prompt or media)」（Wan 3.0）
describe('promptRequiredForNode —— 放了素材就不拦空提示词（按方式声明，供应商原话）', () => {
  const video = (modelKey: string) => ({ id: 'n', kind: 'video' as const, meta: { modelVendor: 'apimart', modelKey } })
  // 画布路解析参考时现算过的方式（同 buildCatalogTaskRequest 递进来的那份）。
  const placed = (modelKey: string, inputs: ModeInput[]) => ({
    archetypeMode: modeForInputs(resolveTaskArchetype({ modelVendor: 'apimart', modelKey })!, inputs, null),
  })
  const image: ModeInput = { slots: EDGE_MODE_SLOTS.reference, asset: 'image' }
  const firstFrame: ModeInput = { slots: EDGE_MODE_SLOTS.first_frame, asset: 'image' }
  for (const modelKey of ['doubao-seedance-2.0', 'wan3.0-video', 'wan3.0-video-prime']) {
    it(`${modelKey}：放一张图 / 一张首帧 → 不要求提示词；什么都没放（文生）→ 仍要求`, () => {
      expect(promptRequiredForNode(video(modelKey), 'apimart', placed(modelKey, [image]))).toBe(false)
      expect(promptRequiredForNode(video(modelKey), 'apimart', placed(modelKey, [firstFrame]))).toBe(false)
      expect(promptRequiredForNode(video(modelKey), 'apimart')).toBe(true)
    })
  }
  it('doubao-seedance-2.0：只放参考视频（全能参考）→ 不要求提示词', () => {
    const clip: ModeInput = { slots: EDGE_MODE_SLOTS.reference, asset: 'video' }
    expect(promptRequiredForNode(video('doubao-seedance-2.0'), 'apimart', placed('doubao-seedance-2.0', [clip]))).toBe(false)
  })
})

describe('comfyWorkflowTakesPrompt —— UI 据此诚实说明', () => {
  it('绑了提示词节点 → true（正常显示提示词框，不显示说明）', () => {
    expect(comfyWorkflowTakesPrompt(comfyMeta({ promptNodeId: '6', promptInputKey: 'text', outputKind: 'image' }))).toBe(true)
  })

  it('只绑了首帧、没绑提示词 → false（显示「不吃提示词」）', () => {
    expect(comfyWorkflowTakesPrompt(comfyMeta({ firstFrameNodeId: '1', firstFrameInputKey: 'image', outputKind: 'image' }))).toBe(false)
  })

  it('只有 nodeId 没有 inputKey（半截绑定）→ false，不当成能注入', () => {
    expect(comfyWorkflowTakesPrompt(comfyMeta({ promptNodeId: '6' }))).toBe(false)
  })

  it('非 ComfyUI 模型 → null（不适用，UI 什么都不显示）', () => {
    expect(comfyWorkflowTakesPrompt({ parameters: [] })).toBeNull()
    expect(comfyWorkflowTakesPrompt(null)).toBeNull()
    expect(comfyWorkflowTakesPrompt(undefined)).toBeNull()
  })
})
