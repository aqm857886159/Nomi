// 介入槽的投影：三条 2026-09-06 产品裁决的机器防线。
//
// ② 「不再问 →」的作用域是**这一个能力**，不是整个项目——而且门槛与现役
//    `InterventionSlot.showAlways` 逐字一致（只有 `reversible_local`）。这条不是文案问题：
//    抬全局档会让所有同类能力一起放行，那是扩大授权面。
// ③ 提案内联编辑器删掉后，槽里只剩确认 / 不要 / 不再问 —— 投影层不再产出任何「可编辑」的东西。
// ④ `missing_param` 渲成槽里的**反问卡**（2026-09-12 改）。它以前「走对话流的提问 + 建议 chip」，
//    可那条分支从来没有接过线（`missingParamSuggestion` 全仓零调用方），真实后果是宿主 announce
//    「有一条在等你」而槽里一片空白。现在缺参数就是一句问题 + 几个现成答案 = 反问格本来的形状。
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

  it('④ 缺参数进这个槽，渲成反问卡——**永远不返回空**', () => {
    expect(interventionKindOf({ missingParam: 'duration' }, 'reversible_local', false)).toBe('question')
    const slot = projectV4Intervention(
      { toolName: 'generation.control', args: { missingParam: 'duration' }, effectClass: 'reversible_local', pendingCount: 1 },
      labels,
      t,
    )
    // 宿主 announce 了「有一条在等你」，这里就必须画出点什么。空白是这一族 bug 的样子。
    expect(slot.kind).toBe('question')
    expect(slot.summary).toContain('duration')
  })

  it('这个函数的返回值不可空：所有登记形状都解得出一个 kind', () => {
    // 「announce 了却什么都没画」在这条链上**编译期**就不可能（R28）。这条测试守的是运行期
    // 那一半：别再有哪一支悄悄回 `undefined as unknown as ...`。
    const shapes: readonly Record<string, unknown>[] = [
      {}, { question: '?' }, { missingParam: 'duration' }, { missingCredential: 'kling' },
    ]
    for (const args of shapes) {
      for (const effectClass of ['spend', 'reversible_local', 'irreversible', undefined] as const) {
        expect(interventionKindOf(args, effectClass, false)).toBeTruthy()
        expect(projectV4Intervention({ toolName: 'x', args, effectClass, pendingCount: 1 }, labels, t).kind).toBeTruthy()
      }
    }
  })
})

describe('④ 缺参数那句问题的措辞（现在由反问卡用同一个函数写出来）', () => {
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

describe('要写进去的那段话，摘一行给用户看', () => {
  it('文稿写把 content 摘进摘要——「1 条内容」不足以让人决定要不要', () => {
    const slot = projectV4Intervention(
      { toolName: 'nomi_document_edit', args: { operation: 'append', content: '她按下录制键，画面定格。' }, effectClass: 'reversible_local', pendingCount: 1 },
      labels,
      t,
    )
    expect(slot?.summary).toContain('她按下录制键，画面定格。')
  })

  it('长文保留完整源码，显示高度归宿主滚动', () => {
    const long = '一'.repeat(200)
    const slot = projectV4Intervention(
      { toolName: 'nomi_document_edit', args: { content: long }, effectClass: 'reversible_local', pendingCount: 1 },
      labels,
      t,
    )
    expect(slot?.summary).toContain(long)
    expect(slot?.summary).not.toContain('…')
  })

  it('没有内容字段就不摘——不编，也不留占位', () => {
    const slot = projectV4Intervention(
      { toolName: 'nomi_canvas_read', args: {}, effectClass: 'reversible_local', pendingCount: 1 },
      labels,
      t,
    )
    expect(slot?.summary ?? '').not.toContain('…')
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
    expect(slot?.scope).toBeUndefined()
    expect(slot?.plan).toEqual([{ label: '镜头 2 尾部裁 0.4s', technical: '{"op":"trim"}', checked: true }])
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
