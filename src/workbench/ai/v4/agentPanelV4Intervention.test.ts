// 介入槽的投影：三条 2026-09-06 产品裁决的机器防线。
//
// ② 「不再问 →」的作用域是**这一个能力**，不是整个项目——而且门槛与现役
//    `InterventionSlot.showAlways` 逐字一致（只有 `reversible_local`）。这条不是文案问题：
//    抬全局档会让所有同类能力一起放行，那是扩大授权面。
// ③ 提案内联编辑器删掉后，槽里只剩确认 / 不要 / 不再问 —— 投影层不再产出任何「可编辑」的东西。
// ④ `missing_param` 渲成槽里的**反问卡**（2026-09-12 改）。它以前「走对话流的提问 + 建议 chip」，
//    可那条分支从来没有接过线，真实后果是宿主 announce「有一条在等你」而槽里一片空白。
//    现在缺参数就是一句问题 + 几个现成答案 = 反问格本来的形状，解析与它共用
//    `agentPanelV4Question.parseQuestionSheet`（2026-09-21 起是这条交互唯一的解析口）。
import { describe, expect, it } from 'vitest'
import {
  askReasonText,
  canStopAskingFor,
  interventionKindOf,
  planConfirmDecision,
  questionText,
  projectV4Intervention,
  type V4InterventionLabels,
} from './agentPanelV4Intervention'
import {
  answerToolResult,
  parseQuestionSheet,
  questionAnswerFromInput,
  questionAnswerFromOption,
  questionAnswerFromOptions,
  questionOptionCountIssue,
  type V4QuestionAsk,
} from './agentPanelV4Question'

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${Object.values(options).join(',')})` : key

const labels: V4InterventionLabels = {
  irreversible: '不可逆',
  reversible: '可撤销',
  spendBadge: '付费',
  credentialTitle: '这个模型还没配密钥',
  credentialConfirm: '去配置',
  credentialAlternate: '换个模型',
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
    // 付费档仍然印「范围：仅这一次」——它说的是这次批准的范围，没说错。
    // 这次只把**反问卡**排除掉（见下一条），不顺手动确认卡那几档。
    const spend = projectV4Intervention(
      { toolName: 'generation.control', args: {}, effectClass: 'spend', pendingCount: 1 },
      labels,
      t,
    )
    expect(spend?.scope).toBe(labels.scopeOnce)
  })

  it('反问卡不许拿到那行作用域——它根本没有「不再问 →」那颗钮', () => {
    // 2026-09-21 用户当场点名的四样之一：卡底印着「『不再问』只对这一个操作生效」，
    // 而这张卡上压根没有那颗按钮。判据钉死在投影层，改回去当场红。
    const ask = projectV4Intervention(
      { toolName: 'ask_user', args: { questions: [{ question: '用什么画幅？' }] }, effectClass: 'reversible_local', pendingCount: 1 },
      labels,
      t,
    )
    expect(ask.kind).toBe('question')
    expect(ask.scope).toBeUndefined()
  })

  it('反问卡的标题**就是**那句问题，没有第二行卡头，也不在正文里印第二遍', () => {
    const ask = projectV4Intervention(
      { toolName: 'ask_user', args: { questions: [{ question: '这段想要几秒？' }] }, effectClass: undefined, pendingCount: 1 },
      labels,
      t,
    )
    expect(ask.title).toBe('这段想要几秒？')
    expect(ask.summary ?? '').not.toContain('这段想要几秒？')
  })
})

describe('kind 判定', () => {
  it('三种 effectClass 对三种 kind，认不出的 fail-closed 到不可逆', () => {
    expect(interventionKindOf({}, 'spend', false)).toBe('spend')
    expect(interventionKindOf({}, 'reversible_local', false)).toBe('approval-reversible')
    expect(interventionKindOf({}, 'irreversible', false)).toBe('approval-irreversible')
    // 未登记别名 → `capabilityEffectClassOf` 给 undefined。当成可撤销的，
    // 等于替用户赌「反正能撤回来」。
    expect(interventionKindOf({}, undefined, false)).toBe('approval-irreversible')
  })

  it('缺凭证与反问各有自己的家，且优先于 effectClass', () => {
    expect(interventionKindOf({ missingCredential: 'kling' }, 'spend', false)).toBe('credential')
    expect(interventionKindOf({ questions: [{ question: '用什么画幅？' }] }, 'irreversible', false)).toBe('question')
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
    // 问句现在是**标题**（反问卡没有卡头，问题本身就是那行标题）。
    expect(slot.title).toContain('duration')
  })

  it('这个函数的返回值不可空：所有登记形状都解得出一个 kind', () => {
    // 「announce 了却什么都没画」在这条链上**编译期**就不可能（R28）。这条测试守的是运行期
    // 那一半：别再有哪一支悄悄回 `undefined as unknown as ...`。
    const shapes: readonly Record<string, unknown>[] = [
      {}, { questions: [{ question: '?' }] }, { missingParam: 'duration' }, { missingCredential: 'kling' },
    ]
    for (const args of shapes) {
      for (const effectClass of ['spend', 'reversible_local', 'irreversible', undefined] as const) {
        expect(interventionKindOf(args, effectClass, false)).toBeTruthy()
        expect(projectV4Intervention({ toolName: 'x', args, effectClass, pendingCount: 1 }, labels, t).kind).toBeTruthy()
      }
    }
  })
})

describe('④ 缺参数 / 反问共用同一份解析与同一句问句', () => {
  it('工具给了 question 就用它的原话，选项照模型写的形状带出来（标签 + 说明 + 推荐）', () => {
    const ask = parseQuestionSheet({
      missingParam: 'aspectRatio',
      questions: [{
        question: '第 2 镜用什么画幅？',
        options: [
          { id: 'wide', label: '16:9 横版', description: '适合横屏平台', recommended: true },
          '9:16 竖版',
        ],
      }],
    })?.questions[0]
    expect(ask && questionText(ask, t)).toBe('第 2 镜用什么画幅？')
    expect(ask?.options).toEqual([
      { id: 'wide', label: '16:9 横版', description: '适合横屏平台', recommended: true },
      { id: 'option-2', label: '9:16 竖版' },
    ])
  })

  it('没给 question 就把参数名包进一句人话，但**不编具体建议值**', () => {
    const ask = parseQuestionSheet({ missingParam: 'duration' })?.questions[0]
    expect(ask && questionText(ask, t)).toBe('agentPanelV4.missingParamAsk(duration)')
    expect(ask?.options).toEqual([])
  })

  it('既不是缺参数也不是提问就返回 undefined——它不该占反问格', () => {
    expect(parseQuestionSheet({ operation: 'append', content: 'x' })).toBeUndefined()
    expect(parseQuestionSheet(null)).toBeUndefined()
  })

  it('反问卡的选项**只**来自反问：别的档带了 options 也不渲染成可点的 chip', () => {
    const slot = projectV4Intervention(
      { toolName: 'nomi_generate', args: { options: ['a', 'b'] }, effectClass: 'spend', pendingCount: 1 },
      labels,
      t,
    )
    expect(slot.kind).toBe('spend')
    expect(slot.options).toBeUndefined()
  })

  it('反问卡**永远**带卡内那一行自由输入，哪怕一个选项都没有', () => {
    const slot = projectV4Intervention(
      { toolName: 'ask', args: { questions: [{ question: '要几秒？' }] }, effectClass: undefined, pendingCount: 1 },
      labels,
      t,
    )
    // 那一行的占位不再经投影层下发：它是 Approval Card 这件东西**自带**的一行
    //（`V4AskCard` 的 `labels.ask.customPlaceholder`），不是某一档才有的可选字段。
    // 投影层这里只要证「一个选项都没有也照样是一张反问卡」。
    expect(slot.kind).toBe('question')
    expect(slot.options ?? []).toHaveLength(0)
    expect(slot.title).toBe('要几秒？')
  })

  it('审批 / 付费 / 计划三档不是反问——它们的出口是确认 / 不要', () => {
    const slot = projectV4Intervention(
      { toolName: 'nomi_generate', args: {}, effectClass: 'spend', pendingCount: 1 },
      labels,
      t,
    )
    expect(slot.kind).toBe('spend')
  })

  it('熔断那句话由渲染层按码出，不收生产者拼好的成句字符串（R15）', () => {
    const sheet = parseQuestionSheet({ questions: [{ question: '这 2 个镜头当什么用？' }], askReason: { code: 'retry_exhausted', attempts: 3 } })
    expect(sheet && askReasonText(sheet, t)).toBe('agentPanelV4.questionRetryExhausted(3)')
    const slot = projectV4Intervention(
      { toolName: 'ask', args: { questions: [{ question: 'x' }], askReason: { code: 'retry_exhausted', attempts: 3 } }, effectClass: undefined, pendingCount: 1 },
      labels,
      t,
    )
    expect(slot.summary).toContain('agentPanelV4.questionRetryExhausted(3)')
  })
})

describe('选项数量的判词（拍板：2–4 个）', () => {
  const askWith = (count: number): V4QuestionAsk =>
    ({ question: 'q', options: Array.from({ length: count }, (_, index) => ({ id: `o${index}`, label: `o${index}` })) })
  it('一个都没有 = 只有自由输入的一张卡，合法', () => {
    expect(questionOptionCountIssue({ question: 'q', options: [] })).toBeUndefined()
  })
  it('2–4 个在区间内；1 个太少、5 个太多——但数据一条都不丢', () => {
    expect(questionOptionCountIssue(askWith(1))).toBe('too-few')
    expect(questionOptionCountIssue(askWith(2))).toBeUndefined()
    expect(questionOptionCountIssue(askWith(4))).toBeUndefined()
    expect(questionOptionCountIssue(askWith(5))).toBe('too-many')
    expect(parseQuestionSheet({ questions: [{ question: 'q', options: ['a', 'b', 'c', 'd', 'e'] }] })?.questions[0]?.options).toHaveLength(5)
  })
})

describe('答案的形状：chip 与卡内那一行走同一个出口', () => {
  it('点 chip = 提交，答案带 id 也带那几个字（模型只认字）', () => {
    expect(questionAnswerFromOption({ id: 'wide', label: '16:9 横版' }))
      .toEqual({ questionIndex: 0, optionIds: ['wide'], text: '16:9 横版' })
    // 多选那一支：几颗一起提交，`text` 是它们连起来——模型只认字，一串 id 对它等于没答。
    expect(questionAnswerFromOptions([{ id: 'a', label: '暖调' }, { id: 'b', label: '慢镜' }], 1))
      .toEqual({ questionIndex: 1, optionIds: ['a', 'b'], text: '暖调、慢镜' })
    expect(questionAnswerFromOptions([]), '一颗都没选时不成立').toBeUndefined()
  })
  it('卡内为空时回车不提交——这条规则是一个函数，因为它有第二个后果（回车也不外泄）', () => {
    expect(questionAnswerFromInput('   ')).toBeUndefined()
    expect(questionAnswerFromInput('  竖版吧  ')).toEqual({ questionIndex: 0, text: '竖版吧' })
  })
  it('回给模型的是那句话本身，不是我们这边的 id', () => {
    expect(answerToolResult(['用什么画幅？'], { answers: [{ questionIndex: 0, optionIds: ['wide'], text: '16:9 横版' }] })).toBe('16:9 横版')
    // 一张卡几题时**带题号与问句**按题一行：几条光秃秃的 text 连起来，模型对不上哪句答的是哪题。
    expect(answerToolResult(['给谁看？', '多长？'], {
      answers: [{ questionIndex: 0, text: '给同事看' }, { questionIndex: 1, text: '30 秒' }],
    })).toBe('Question 1 (给谁看？): 给同事看\nQuestion 2 (多长？): 30 秒')
  })

  it('被跳过的那题明说是跳过——「答了 1、3 跳过 2」不许读成「答了 1、2」', () => {
    const text = answerToolResult(['给谁看？', '多长？', '横的竖的？'], {
      answers: [{ questionIndex: 0, text: '给同事看' }, { questionIndex: 2, text: '竖的' }],
      skippedQuestionIndexes: [1],
    })
    const lines = text.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('Question 2 (多长？)')
    expect(lines[1]).toContain('skipped')
    expect(lines[2]).toBe('Question 3 (横的竖的？): 竖的')
  })

  it('多题投影：整张卡的题都摊进 `questions`，熔断那一句只在第一题下面说一遍', () => {
    const card = projectV4Intervention({
      toolName: 'ask_user', effectClass: undefined, pendingCount: 1,
      args: { questions: [{ question: '给谁看？', note: '决定语气' }, { question: '多长？', multiSelect: true }], askReason: { code: 'retry_exhausted', attempts: 3 } },
    }, labels, t)
    expect(card.questions?.map((question) => question.question)).toEqual(['给谁看？', '多长？'])
    expect(card.questions?.[0]?.note).toContain('决定语气')
    expect(card.questions?.[1]?.note).toBeUndefined()
    expect(card.questions?.[1]?.multiSelect).toBe(true)
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

describe('时间轴计划卡只给「仅这一次」，不管清单行投影出来没有', () => {
  // 卡是不是计划卡由**这次调用的动词**决定（它的声明写着用户先看审阅卡），不由清单行
  // 投影成没成功决定。以前判据是 `planLines.length > 0`：动词名一漂（2026-09-14 改名）、
  // 或 operations 一时投影不出来，同一份计划就退回成通用「可撤销」卡，多出「不再问 →」——
  // 用户一点，这一会话之后的时间轴计划全都不再先给他看。
  const editTimeline = {
    toolName: 'edit_timeline',
    args: { baseRevision: 'revision-1', summary: '片头加一条字幕', operations: [] },
    effectClass: 'reversible_local' as const,
    pendingCount: 1,
  }

  it('清单行还没投影出来：仍是计划卡，没有范围行（= 没有「不再问」）', () => {
    const slot = projectV4Intervention(editTimeline, labels, t)
    expect(slot.kind).toBe('plan')
    expect(slot.scope).toBeUndefined()
  })

  it('清单行投影出来了：同一张计划卡，行就是那几句人话', () => {
    const slot = projectV4Intervention({ ...editTimeline, planLines: [{ text: '字幕 · 汤先到，人后到', technical: '{"kind":"text"}' }] }, labels, t)
    expect(slot.kind).toBe('plan')
    expect(slot.scope).toBeUndefined()
    expect(slot.plan).toEqual([{ label: '字幕 · 汤先到，人后到', technical: '{"kind":"text"}', checked: true }])
  })

  it('同一个契约上不带计划的 undo 不是计划卡', () => {
    expect(projectV4Intervention({ ...editTimeline, toolName: 'undo', args: { undoToken: 'u1' } }, labels, t).kind)
      .toBe('approval-reversible')
  })
})

describe('③ 槽里没有可编辑的东西', () => {
  it('投影只产出只读的清单行与参数 chip——编辑去对象自己的家', () => {
    const slot = projectV4Intervention(
      {
        toolName: 'edit_timeline',
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

  it('取消勾选的行在投影里就是没勾的——「不勾就是不做」得先勾得动', () => {
    const slot = projectV4Intervention(
      {
        toolName: 'edit_timeline',
        args: {},
        effectClass: 'reversible_local',
        pendingCount: 1,
        planLines: [{ text: '镜头 1' }, { text: '镜头 2' }, { text: '镜头 3' }],
        uncheckedPlanRows: new Set(['镜头 2']),
      },
      labels,
      t,
    )
    expect(slot?.plan?.map((row) => [row.label, row.checked])).toEqual([
      ['镜头 1', true], ['镜头 2', false], ['镜头 3', true],
    ])
  })
})

describe('计划卡的「确认」按勾选集派生，不是无条件放行', () => {
  it('一条都没取消 = 批准', () => {
    expect(planConfirmDecision(new Set(), ['镜头 1', '镜头 2'])).toEqual({ action: 'approve' })
  })

  it('取消了几条 = 带「只做这几条」的 deny；协议没有第三个答案，全批就是骗钱', () => {
    expect(planConfirmDecision(new Set(['镜头 2']), ['镜头 1', '镜头 3']))
      .toEqual({ action: 'deny', keptRows: ['镜头 1', '镜头 3'] })
  })

  it('一条都不留 = 不带话的 deny（整张不要）', () => {
    expect(planConfirmDecision(new Set(['镜头 1']), [])).toEqual({ action: 'deny', keptRows: [] })
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
