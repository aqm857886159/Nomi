import { describe, expect, it } from 'vitest'
import {
  proposalForTool,
  readableToolDetailRows,
  readableToolPreview,
  readableToolSummary,
  residentToolProjectionForCall,
} from './residentToolDisplay'
import { partitionResidentProposalFields } from './residentProposalDisplay'

const translate = (key: string, options?: Record<string, unknown>): string => {
  if (!options) return key
  return `${key}(${Object.entries(options).map(([name, value]) => `${name}=${String(value)}`).join(',')})`
}

describe('resident tool display projection', () => {
  it('keeps the first layer compact while retaining generation intent', () => {
    const args = { prompt: 'a small cat avatar', modelId: 'provider/image-fast', parameters: { aspectRatio: '1:1', quality: 'standard' } }
    expect(readableToolPreview(translate, 'nomi_start_generation', args)).toBe('agentResident.toolGenerationSummary')
    expect(readableToolSummary(translate, 'nomi_start_generation', args)).toContain('a small cat avatar')
    expect(readableToolSummary(translate, 'nomi_start_generation', args)).toContain('provider/image-fast')
  })

  it('partitions proposal content into a compact bar and on-demand evidence', () => {
    const proposal = proposalForTool(translate, 'nomi_start_generation', {
      prompt: 'a small cat avatar',
      modelId: 'provider/image-fast',
      parameters: { aspectRatio: '1:1', quality: 'standard' },
    })
    expect(proposal).toBeDefined()
    const groups = partitionResidentProposalFields(proposal?.fields ?? [])
    expect(groups.compact.map((field) => field.kind)).toEqual(['model', 'parameters', 'target'])
    expect(groups.prompt.map((field) => field.kind)).toEqual(['prompt'])
    expect(groups.estimate?.kind).toBe('estimate')
    // The disclosure retains the original order and every field, including
    // prompt/estimate/boundary, so editing and audit evidence remain reachable.
    expect(groups.details).toEqual(proposal?.fields)
  })

  it('surfaces patch prompt, model and parameters in the disclosed proposal fields', () => {
    const proposal = proposalForTool(translate, 'nomi_operation_create', {
      patch: {
        prompt: 'replace the third shot with a close-up',
        modelId: 'provider/video-cheap',
        parameters: { duration: 6, aspectRatio: '16:9' },
      },
    })
    expect(proposal?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'agentResident.proposalPrompt', value: 'replace the third shot with a close-up', kind: 'prompt' }),
      expect.objectContaining({ label: 'agentResident.proposalModel', value: 'agentResident.toolVideoModel', kind: 'model' }),
      expect.objectContaining({ label: 'agentResident.proposalParameters', value: expect.stringContaining('agentResident.toolParameterDuration: 6'), kind: 'parameters' }),
    ]))
    const detailRows = readableToolDetailRows(translate, 'nomi_operation_create', {
      patch: { prompt: 'replace the third shot', modelId: 'provider/video-cheap', parameters: { duration: 6 } },
    })
    // ResidentApprovalDetail 每行都带 kind 判别符（同上 proposal.fields 断言、partitionResidentProposalFields
    // 都依赖它）——故用 objectContaining 匹配语义字段，不锁死其余行（target/estimate 等）与 kind 之外的形状。
    expect(detailRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'agentResident.toolPromptLabel', value: 'replace the third shot', kind: 'prompt' }),
      expect.objectContaining({ label: 'agentResident.toolModelLabel', value: 'provider/video-cheap', kind: 'model' }),
      expect.objectContaining({ label: 'agentResident.toolParametersLabel', value: 'agentResident.toolParameterDuration: 6', kind: 'parameters' }),
    ]))
  })

  it('projects safe display strings for persisted completed tool receipts', () => {
    const projection = residentToolProjectionForCall(translate, 'nomi_start_generation', {
      prompt: 'cat avatar',
      modelId: 'provider/image-fast',
      apiKey: 'sk-secret-value',
    }, 'done')
    expect(projection.effect).toBe('agentResident.toolGenerationSummary')
    expect(projection.target).toBe('agentResident.targetCanvas')
    expect(projection.technicalDetails).not.toContain('sk-secret-value')
  })
})

// 确认卡的存在意义是让人**看懂再点**。patch_shots 若落到兜底文案，用户面对的是一张
// 不说改了什么的卡——那等于没有卡。2026-09-03 实测：不加专用分支时它显示「查看细节」。
describe('patch_shots 确认卡说清改了什么', () => {
  it('批量：说清「全部镜头 · 追加提示词」', () => {
    const preview = readableToolPreview(translate, 'patch_shots', {
      select: { kind: 'all' }, patch: { promptAppend: '雨天' },
    })
    expect(preview).toContain('patchShotsAll')
    expect(preview).toContain('patchShotsField.promptAppend')
    expect(preview).not.toContain('toolInspectDetails')
  })

  it('指定镜：卡上带出具体镜号，用户看得见它要动哪几镜', () => {
    const preview = readableToolPreview(translate, 'patch_shots', {
      select: { kind: 'indexes', indexes: [2, 5] }, patch: { durationSec: 8 },
    })
    expect(preview).toContain('indexes=2、5')
    expect(preview).toContain('patchShotsField.durationSec')
  })

  it('作用对象不按数组长度瞎猜（select 不是 nodeIds/shots）', () => {
    const projection = residentToolProjectionForCall(translate, 'patch_shots', {
      select: { kind: 'all' }, patch: { prompt: 'x' },
    }, 'proposed')
    expect(projection.target).toContain('targetStoryboardAll')
  })
})
