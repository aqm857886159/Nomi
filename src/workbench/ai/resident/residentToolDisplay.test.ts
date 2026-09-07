import { describe, expect, it } from 'vitest'
import {
  humanizeToolFailure,
  proposalForTool,
  readableToolDetailRows,
  isReadOnlyToolName,
  readableToolName,
  readableToolPreview,
  readableToolSummary,
  residentToolProjectionForCall,
} from './residentToolDisplay'
import { partitionResidentProposalFields } from './residentProposalDisplay'
import { CAPABILITY_ALIAS_ENTRIES, CAPABILITY_CONTRACTS } from '../../../../electron/shared/agentCapabilities/registry'

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

  it('names every registered capability and every surface alias of it, derived from the registry', () => {
    // Class-level, not a spot check. Both lists come from the registry, so a new capability — or a
    // rename of any pi/MCP alias — fails here instead of silently rendering as the generic "工具" in
    // the tool chips and, since the approval card titles itself with this string, on the card a human
    // is asked to approve. Neither list is ever hand-copied.
    const unnamedContracts = CAPABILITY_CONTRACTS
      .map((contract) => contract.id)
      .filter((id) => readableToolName(translate, id) === 'agentResident.toolGeneric')
    expect(unnamedContracts).toEqual([])

    const unnamedAliases = CAPABILITY_ALIAS_ENTRIES
      .filter((entry) => readableToolName(translate, entry.alias) === 'agentResident.toolGeneric')
      .map((entry) => `${entry.surface}:${entry.alias}`)
    expect(unnamedAliases).toEqual([])

    expect(CAPABILITY_CONTRACTS.length).toBeGreaterThan(10)
    expect(CAPABILITY_ALIAS_ENTRIES.length).toBeGreaterThan(CAPABILITY_CONTRACTS.length)
  })

  it('trusts the registry over the words in an alias', () => {
    // `propose_edit_plan` belongs to timeline.read; word-matching sees "edit" and calls it a write.
    expect(isReadOnlyToolName('propose_edit_plan')).toBe(true)
    expect(isReadOnlyToolName('apply_edit_plan')).toBe(false)
    expect(readableToolName(translate, 'insert_at_cursor')).toBe('agentResident.toolDocumentWrite')
    expect(readableToolName(translate, 'read_production_artifact')).toBe('agentResident.toolProductionRead')
  })

  it('reads the operation out of the arguments, not just the collapsed tool name', () => {
    // The canvas surface advertises `nomi_canvas_maintenance` / `nomi_canvas_edit`; the semantics are
    // in `args.operation`. Keying on the name alone made an irreversible delete render as the generic
    // "inspect details" label, so the approval card said nothing about what was being deleted.
    const del = { operation: 'delete_canvas_nodes', nodeIds: ['node-a', 'node-b'] }
    expect(readableToolName(translate, 'nomi_canvas_maintenance', del)).toBe('agentResident.toolCanvasDelete')
    expect(readableToolSummary(translate, 'nomi_canvas_maintenance', del)).toBe('agentResident.toolCanvasDeleteSummary')
    expect(readableToolPreview(translate, 'nomi_canvas_maintenance', del)).toBe('agentResident.toolTargetCount(count=2)')

    const create = { operation: 'create_canvas_nodes', nodes: [{ title: '镜头 1' }] }
    expect(readableToolName(translate, 'nomi_canvas_edit', create)).toBe('agentResident.toolCanvasWrite')
    expect(readableToolPreview(translate, 'nomi_canvas_edit', create)).toContain('agentResident.toolShotCount(count=1)')

    // The pi-side aliases still carry the operation in the name; both halves keep working.
    expect(readableToolName(translate, 'delete_canvas_nodes')).toBe('agentResident.toolCanvasDelete')
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

describe('失败正文 → 人话：只有这一条门', () => {
  // 校验失败在这套系统里有两种写法，消费它的地方有三处（收据行内、收据展开体、失败条）。
  // 两种写法各翻各的，就会像 2026-09-06 那样：同一次失败在一处是「nodes：期望 array」、
  // 在另一处是一整段英文。
  const PI_PROSE = [
    'Validation failed for tool "nomi_canvas_edit":',
    '  - nodes: Expected array',
    '',
    'Received arguments:',
    '{',
    '  "nodes": "[{\\"clientId\\":\\"s1\\""',
    '}',
  ].join('\n')

  it('zod issue JSON：哪个字段、要什么、给了什么', () => {
    const issues = JSON.stringify([{ code: 'invalid_type', expected: 'array', received: 'string', path: ['nodes'] }])
    expect(humanizeToolFailure(translate, issues)).toBe('agentResident.issueType(field=nodes,expected=array,received=string)')
  })

  it('pi 的英文散文体回执：抬头丢掉、入参回显丢掉，只留说得出事的那句', () => {
    const humanized = humanizeToolFailure(translate, PI_PROSE)
    expect(humanized).toBe('agentResident.issueExpected(field=nodes,expected=array)')
    expect(humanized).not.toContain('Received arguments')
  })

  it('缺必填字段有自己的说法', () => {
    const text = 'Validation failed for tool "nomi_canvas_edit":\n  - nodes: Expected required property'
    expect(humanizeToolFailure(translate, text)).toBe('agentResident.issueRequired(field=nodes)')
  })

  it('认出了这条回执就再也不放英文出去：一句都翻不动时给通用的那句', () => {
    const text = 'Validation failed for tool "nomi_canvas_edit":\n  - Unknown validation error'
    expect(humanizeToolFailure(translate, text)).toBe('agentResident.issueInvalidArgs')
  })

  it('不是校验回执就不硬翻——供应商已经写好的中文原样交回调用方', () => {
    expect(humanizeToolFailure(translate, '余额不足，请先充值。')).toBeUndefined()
    expect(humanizeToolFailure(translate, '')).toBeUndefined()
  })

  it('展开区的「输出」留原文：行内说人话，详情给英文', () => {
    const projection = residentToolProjectionForCall(translate, 'nomi_canvas_edit', { operation: 'create_canvas_nodes' }, 'failed', { error: PI_PROSE })
    expect(projection.output).toBe(PI_PROSE)
  })
})
