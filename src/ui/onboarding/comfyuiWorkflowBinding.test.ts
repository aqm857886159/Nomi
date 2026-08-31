// 工作流绑定共享逻辑。夹具沿用 comfyuiWorkflowGraphView.test.ts 的 LTX 形态
// （取自 scripts/comfyui-workflow-params-walkthrough.mjs 的真实走查图，不自己编节点名）。
import { describe, expect, it } from 'vitest'
import {
  assignRole,
  clearRole,
  currentRoleOf,
  fieldChoicesForNode,
  normalizeBinding,
  paramFromCandidate,
  paramKeyProblem,
  roleChoicesForNode,
  toggleField,
  type WorkflowAnalysis,
  type WorkflowBinding,
  type WorkflowCandidate,
} from './comfyuiWorkflowBinding'

const text = (nodeId: string, inputKey = 'text'): WorkflowCandidate =>
  ({ nodeId, inputKey, classType: 'CLIPTextEncode', value: 'a prompt' })
const image = (nodeId: string, inputKey = 'image'): WorkflowCandidate =>
  ({ nodeId, inputKey, classType: 'LoadImage', value: 'start.png', mediaKind: 'image' })
const video = (nodeId: string, inputKey = 'file'): WorkflowCandidate =>
  ({ nodeId, inputKey, classType: 'LoadVideo', value: 'clip.mp4', mediaKind: 'video' })
const widget = (nodeId: string, inputKey: string, value: number, title?: string): WorkflowCandidate =>
  ({ nodeId, inputKey, classType: 'INTConstant', value, ...(title ? { title } : {}) })

const ANALYSIS: WorkflowAnalysis = {
  textInputs: [text('110'), text('109')],
  imageInputs: [image('200'), video('210')],
  outputNodes: [{ nodeId: '300', classType: 'SaveVideo', kind: 'video' }],
  numericInputs: [],
  widgetInputs: [widget('292', 'value', 960, 'WIDTH'), widget('293', 'value', 544, 'HEIGHT'), text('110')],
  suggested: {},
}

describe('工作流绑定的角色指派', () => {
  it('指派角色会撤掉绑同一个输入的参数行——一个输入只能有一个身份', () => {
    // 这正是 2026-08-03/08-11 两次反馈的根因形状：参数占位覆盖角色占位 → 用户的提示词静默送不进去。
    const before: WorkflowBinding = {
      params: [{ nodeId: '110', inputKey: 'text', paramKey: 'p', label: 'P', type: 'text', default: 'x' }],
    }
    const after = assignRole(before, 'prompt', { nodeId: '110', inputKey: 'text' })
    expect(after.promptNodeId).toBe('110')
    expect(after.params).toEqual([])
  })

  it('别的节点的参数行不受牵连', () => {
    const keep = { nodeId: '292', inputKey: 'value', paramKey: 'w', label: '宽', type: 'number' as const, default: 960 }
    const after = assignRole({ params: [keep] }, 'prompt', { nodeId: '110', inputKey: 'text' })
    expect(after.params).toEqual([keep])
  })

  it('成品角色只认节点、并带上产物类型（不占输入）', () => {
    const after = assignRole({}, 'output', { nodeId: '300', outputKind: 'video' })
    expect(after).toMatchObject({ outputNodeId: '300', outputKind: 'video' })
    expect(after.params ?? []).toEqual([])
  })

  it('清空角色只清那一个，其余绑定原样留着', () => {
    const bound: WorkflowBinding = {
      promptNodeId: '110', promptInputKey: 'text',
      firstFrameNodeId: '200', firstFrameInputKey: 'image',
    }
    const after = clearRole(bound, 'firstFrame')
    expect(after.firstFrameNodeId).toBeUndefined()
    expect(after.firstFrameInputKey).toBeUndefined()
    expect(after.promptNodeId).toBe('110')
  })

  it('currentRoleOf 认得出节点当前担着谁', () => {
    const bound: WorkflowBinding = { promptNodeId: '110', outputNodeId: '300' }
    expect(currentRoleOf(bound, '110')).toBe('prompt')
    expect(currentRoleOf(bound, '300')).toBe('output')
    expect(currentRoleOf(bound, '292')).toBeNull()
  })
})

describe('节点能担哪些角色（由分析推导，不猜）', () => {
  it('文本节点给提示词；图片节点给首帧+尾帧；视频节点只给源视频', () => {
    const roles = (nodeId: string) => roleChoicesForNode(ANALYSIS, {}, nodeId).map((c) => c.role)
    expect(roles('110')).toEqual(['prompt'])
    expect(roles('200')).toEqual(['firstFrame', 'lastFrame'])
    // LoadVideo.file 收的是视频，当首帧发 = 把 mp4 当图传，必失败——所以这里绝不能出现 firstFrame。
    expect(roles('210')).toEqual(['sourceVideo'])
    expect(roles('300')).toEqual(['output'])
  })

  it('没有可绑输入的节点给空清单（UI 据此不摆出死选项）', () => {
    expect(roleChoicesForNode(ANALYSIS, {}, '999')).toEqual([])
  })

  it('同节点多个同类输入逐个列出，当前生效的那个标 active', () => {
    const multi: WorkflowAnalysis = { ...ANALYSIS, textInputs: [text('110', 'text_g'), text('110', 'text_l')] }
    const choices = roleChoicesForNode(multi, { promptNodeId: '110', promptInputKey: 'text_l' }, '110')
    expect(choices.map((c) => c.inputKey)).toEqual(['text_g', 'text_l'])
    expect(choices.map((c) => c.active)).toEqual([false, true])
  })
})

describe('画布可调字段', () => {
  it('候选跟着当前绑定走：绑成提示词的输入立刻退出候选，改绑后立刻回来', () => {
    const keys = (binding: WorkflowBinding) =>
      fieldChoicesForNode(ANALYSIS, binding, '110').map((f) => f.candidate.inputKey)
    expect(keys({})).toEqual(['text'])
    expect(keys({ promptNodeId: '110', promptInputKey: 'text' })).toEqual([])
    // 改绑到别的节点 → #110 的 text 必须回到候选（钉死在 analysis.suggested 上就是原来那个 bug）。
    expect(keys({ promptNodeId: '109', promptInputKey: 'text' })).toEqual(['text'])
  })

  it('已暴露的字段标出来；再点一次撤掉', () => {
    const exposed = toggleField({}, widget('292', 'value', 960, 'WIDTH'))
    expect(exposed.params).toHaveLength(1)
    expect(fieldChoicesForNode(ANALYSIS, exposed, '292')[0].exposed).toBe(true)
    const removed = toggleField(exposed, widget('292', 'value', 960, 'WIDTH'))
    expect(removed.params).toEqual([])
  })

  it('paramKey 重名自动加后缀，label 用作者的节点标题', () => {
    const first = paramFromCandidate(widget('292', 'value', 960, 'WIDTH'))
    expect(first.label).toBe('WIDTH')
    expect(first.paramKey).toBe('comfy_width')
    const second = paramFromCandidate(widget('293', 'value', 544, 'WIDTH'), [first])
    expect(second.paramKey).toBe('comfy_width_2')
  })

  it('没有标题时退回 inputKey #nodeId，且 key 里的非法字符被替掉', () => {
    const param = paramFromCandidate(widget('292', 'cfg-scale', 7))
    expect(param.label).toBe('cfg-scale #292')
    expect(param.paramKey).toMatch(/^[A-Za-z0-9_]+$/)
  })

  // 主进程 taskTemplateParams 把一批保留名排在 extras **之后**
  // （`{ ...extras, width: request.width, ... }`），同名参数会被 undefined 覆盖 →
  // 模板渲染成空 → 那个 input 键整个消失，ComfyUI 收到的图里值凭空不见，界面上还一切正常。
  // 走查实锤过（_meta.title="WIDTH" 的 INTConstant 提交后 inputs 变成 {}）。前缀是结构性保证。
  it.each(['width', 'height', 'seed', 'steps', 'size', 'duration', 'n', 'cfgScale', 'negative_prompt'])(
    '派生 key 绝不撞上主进程保留参数名 %s（撞了会被静默清空）',
    (reserved) => {
      const param = paramFromCandidate(widget('292', 'value', 1, reserved))
      expect(param.paramKey).not.toBe(reserved.toLowerCase())
      expect(param.paramKey.startsWith('comfy_')).toBe(true)
    },
  )

  it('已经带 comfy_ 前缀的标题不再重复加一层', () => {
    expect(paramFromCandidate(widget('292', 'value', 1, 'comfy_width')).paramKey).toBe('comfy_width')
  })

  it('参数 key 的空/非法/重名各自报出来', () => {
    const base = { nodeId: '1', inputKey: 'v', label: 'L', type: 'number' as const, default: 1 }
    expect(paramKeyProblem([{ ...base, paramKey: 'ok' }])).toBeNull()
    expect(paramKeyProblem([{ ...base, paramKey: '' }])).toBe('invalid')
    expect(paramKeyProblem([{ ...base, paramKey: 'a b' }])).toBe('invalid')
    expect(paramKeyProblem([{ ...base, paramKey: 'x' }, { ...base, paramKey: 'x' }])).toBe('duplicate')
  })
})

describe('老快照兼容', () => {
  it('只有 numeric 的旧绑定补齐成统一的 params（之后全链只面对一种形态）', () => {
    const normalized = normalizeBinding({
      numeric: [{ nodeId: '292', inputKey: 'value', paramKey: 'w', label: '宽', default: 960 }],
    })
    expect(normalized.params).toEqual([
      { nodeId: '292', inputKey: 'value', paramKey: 'w', label: '宽', default: 960, type: 'number' },
    ])
  })

  it('已有 params 时不被 numeric 覆盖', () => {
    const params = [{ nodeId: '1', inputKey: 'v', paramKey: 'k', label: 'L', type: 'text' as const, default: 'x' }]
    expect(normalizeBinding({ params, numeric: [] }).params).toEqual(params)
  })
})
