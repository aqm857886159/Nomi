// 介入槽的投影：三条 2026-09-06 产品裁决的机器防线。
//
// ② 「不再问 →」的作用域是**这一个能力**，不是整个项目——而且门槛与现役
//    `InterventionSlot.showAlways` 逐字一致（只有 `reversible_local`）。这条不是文案问题：
//    抬全局档会让所有同类能力一起放行，那是扩大授权面。
// ③ 提案内联编辑器删掉后，槽里只剩确认 / 不要 / 不再问 —— 投影层不再产出任何「可编辑」的东西。
// ④ `missing_param` 不进这个槽（它没有「不要」这个出口），走对话流的提问 + 建议 chip。
import { describe, expect, it } from 'vitest'
import {
  canStopAskingFor,
  interventionKindOf,
  missingParamSuggestion,
  projectV4Intervention,
  type V4InterventionLabels,
} from './agentPanelV4Intervention'

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${Object.values(options).join(',')})` : key

const labels: V4InterventionLabels = {
  irreversible: '不可逆',
  reversible: '可撤销',
  spendBadge: '付费',
  credentialTitle: '这个模型还没配密钥',
  credentialConfirm: '去配置',
  credentialAlternate: '换个模型',
  questionTitle: '需要你定一下',
  planTitle: '这些要做吗？',
  more: '还有 1 条',
  scopeOnce: '范围：仅这一次',
  scopeCapability: '只对这一个操作生效',
}

describe('② 「不再问 →」只在可撤销的改动上，且只覆盖这一个能力', () => {
  it('门槛与现役 always 档逐字一致', () => {
    expect(canStopAskingFor('reversible_local')).toBe(true)
    expect(canStopAskingFor('spend')).toBe(false)
    expect(canStopAskingFor('irreversible')).toBe(false)
    // 认不出的能力也不给：不知道它可不可撤销时，「以后都别问」是最不该默认的答案。
    expect(canStopAskingFor(undefined)).toBe(false)
  })

  it('范围那一行说清它覆盖什么，不让用户以为按一下就全项目放行', () => {
    const reversible = projectV4Intervention(
      { toolName: 'timeline.write', args: {}, effectClass: 'reversible_local', pendingCount: 1 },
      labels,
      t,
    )
    expect(reversible?.scope).toBe(labels.scopeCapability)
    const spend = projectV4Intervention(
      { toolName: 'generation.control', args: {}, effectClass: 'spend', pendingCount: 1 },
      labels,
      t,
    )
    expect(spend?.scope).toBe(labels.scopeOnce)
  })
})

describe('kind 判定', () => {
  it('三种 effectClass 对三种 kind，认不出的 fail-closed 到不可逆', () => {
    expect(interventionKindOf({}, 'spend', false)).toBe('spend')
    expect(interventionKindOf({}, 'reversible_local', false)).toBe('approval-reversible')
    expect(interventionKindOf({}, 'irreversible', false)).toBe('approval-irreversible')
    // 未登记别名 → `resolveCapabilityEffectClass` 给 undefined。当成可撤销的，
    // 等于替用户赌「反正能撤回来」。
    expect(interventionKindOf({}, undefined, false)).toBe('approval-irreversible')
  })

  it('缺凭证与反问各有自己的家，且优先于 effectClass', () => {
    expect(interventionKindOf({ missingCredential: 'kling' }, 'spend', false)).toBe('credential')
    expect(interventionKindOf({ question: '用什么画幅？' }, 'irreversible', false)).toBe('question')
  })

  it('④ 缺参数**不进**这个槽', () => {
    expect(interventionKindOf({ missingParam: 'duration' }, 'reversible_local', false)).toBeUndefined()
    expect(projectV4Intervention(
      { toolName: 'generation.control', args: { missingParam: 'duration' }, effectClass: 'reversible_local', pendingCount: 1 },
      labels,
      t,
    )).toBeUndefined()
  })
})

describe('④ 缺参数走对话流的提问 + 建议 chip', () => {
  it('工具给了 question 就用它的原话，给了 options 就变成建议 chip', () => {
    const suggestion = missingParamSuggestion(
      { missingParam: 'aspectRatio', question: '第 2 镜用什么画幅？', options: ['16:9', '9:16'] },
      t,
    )
    expect(suggestion).toEqual({ text: '第 2 镜用什么画幅？', options: ['16:9', '9:16'] })
  })

  it('没给 question 就把参数名包进一句人话，但**不编具体建议值**', () => {
    const suggestion = missingParamSuggestion({ missingParam: 'duration' }, t)
    expect(suggestion?.text).toBe('agentPanelV4.missingParamAsk(duration)')
    expect(suggestion?.options).toEqual([])
  })

  it('不是缺参数就返回 undefined', () => {
    expect(missingParamSuggestion({ question: '只是反问' }, t)).toBeUndefined()
    expect(missingParamSuggestion(null, t)).toBeUndefined()
  })
})

describe('③ 槽里没有可编辑的东西', () => {
  it('投影只产出只读的清单行与参数 chip——编辑去对象自己的家', () => {
    const slot = projectV4Intervention(
      {
        toolName: 'propose_edit_plan',
        args: { model: 'kling-o1' },
        effectClass: 'reversible_local',
        pendingCount: 1,
        planLines: [{ text: '镜头 2 尾部裁 0.4s', technical: '{"op":"trim"}' }],
      },
      labels,
      t,
    )
    expect(slot?.kind).toBe('plan')
    expect(slot?.plan).toEqual([{ label: '镜头 2 尾部裁 0.4s', detail: '{"op":"trim"}', checked: true }])
    expect(slot?.params).toEqual(['kling-o1'])
    // 视图模型里没有任何「可编辑」的字段——编辑器整件删了，这条防止它以后从别处回来。
    expect(Object.keys(slot ?? {})).not.toContain('editable')
    expect(Object.keys(slot ?? {})).not.toContain('children')
  })
})

describe('同时多条待决时明着说，不静默藏起来', () => {
  it('槽头补一句「还有 N 条」', () => {
    const slot = projectV4Intervention(
      { toolName: 'timeline.write', args: {}, effectClass: 'reversible_local', pendingCount: 3 },
      labels,
      t,
    )
    expect(slot?.summary).toContain('agentPanelV4.interventionMore(2)')
  })
})
