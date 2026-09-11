import { describe, expect, it } from 'vitest'
import { COMFYUI_WORKFLOW_CORPUS } from './comfyuiWorkflowFixtures'
import {
  analyzeComfyWorkflow,
  buildImportedWorkflow,
  normalizeWorkflowBinding,
  parseComfyApiWorkflow,
} from './comfyuiWorkflowImport'

describe('ComfyUI generic workflow corpus', () => {
  // 2026-09-11 根因修复后，语料 'unsupported-output' 的 expected mediaKinds 从 [] 改成了 ['audio']：
  // 那条真实语料本就带一个 LoadAudio 节点（见 comfyuiWorkflowFixtures.ts），修复前它的音频输入
  // 完全识别不出来（用户报的根因「ComfyUI 音频输入用不了」），这条穷举测试因此曾经悄悄通过一个
  // 假阴性。别把 mediaKinds 改回 []，那就是把根因焊死回去——语料本身没变，变的是识别能力。
  it.each(COMFYUI_WORKFLOW_CORPUS.filter((fixture) => fixture.api))('$id obeys the shared input contract', (fixture) => {
    const graph = parseComfyApiWorkflow(JSON.stringify(fixture.api))
    const analysis = analyzeComfyWorkflow(graph)
    const normalized = normalizeWorkflowBinding(analysis.suggested, graph)
    expect(analysis.imageInputs.map((input) => input.mediaKind)).toEqual(fixture.mediaKinds)
    expect(Boolean(analysis.suggested.promptNodeId)).toBe(fixture.expectPrompt)
    if (fixture.outputKind) {
      const built = buildImportedWorkflow(graph, normalized)
      expect(built.parameters.filter((parameter) => parameter.type === 'image-url')).toHaveLength(fixture.mediaKinds.length)
      expect(built.parameters.filter((parameter) => parameter.type === 'image-url').map((parameter) => parameter.mediaKind)).toEqual(fixture.mediaKinds)
      expect(built.kind).toBe(fixture.outputKind)
      expect(analysis.suggested.outputKind).toBe(fixture.outputKind)
    }
    if (fixture.unsupportedOutputKinds) {
      expect(analysis.outputNodes.map((output) => output.kind)).toEqual(fixture.unsupportedOutputKinds)
      expect(analysis.suggested.outputNodeId).toBeUndefined()
      expect(() => buildImportedWorkflow(graph, normalized)).toThrow(/输出/)
    }
  })

  it('rejects a UI-saved graph instead of treating it as API format', () => {
    const fixture = COMFYUI_WORKFLOW_CORPUS.find((item) => item.id === 'ui-export')
    expect(() => parseComfyApiWorkflow(JSON.stringify(fixture?.ui))).toThrow(/界面保存|Export \(API\)/)
  })
})
