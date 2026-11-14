import { describe, expect, it } from 'vitest'
import { comfyWorkflowTakesPrompt, promptRequiredForNode } from './promptRequirement'

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
