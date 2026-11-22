import { describe, expect, it } from 'vitest'

import { projectSpendCard, spendCardStoppedMessage, spendCardSummary, type SpendCardShotFacts, type SpendCardView } from './agentPanelSpendCard'
import type { PendingSpendConfirm, PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import i18n from '../../../i18n'
import { enAgentPanelV4, zhAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'

// 付费卡（D2 第③步，SpendCardQ1 板）每一句话都要能追到产地：几段、哪一镜没发出去、为什么、下一步、印不印钱。
// 这一组钉的是「说错了会怎样」——把去掉的也算进 N、结果未知说成没花钱、算不出价印 0、失败时给一条不存在的出路。

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${Object.entries(options).map(([k, v]) => `${k}=${String(v)}`).join(',')})` : key

const DRAFTED = { providerId: 'apimart', modelId: 'seedance-2-fast' } as const

function shot(index: number, overrides: Partial<PendingSpendShot> = {}): PendingSpendShot {
  return { shotId: `s${index}`, nodeId: `n${index}`, index, kind: 'video', draftedModel: DRAFTED, offer: 'undecided', ...overrides }
}

function facts(index: number, overrides: Partial<SpendCardShotFacts> = {}): SpendCardShotFacts {
  return {
    present: true,
    shotRef: `镜 0${index}`,
    model: 'Seedance 2.0 Fast',
    aspect: '16:9',
    durationSec: 4,
    resolution: '480p',
    selected: DRAFTED,
    price: { known: true, amount: 0.7 },
    ...overrides,
  }
}

function pending(shots: readonly PendingSpendShot[], overrides: Partial<PendingSpendConfirm> = {}): PendingSpendConfirm {
  return { projectId: 'p1', runId: 'r1', operationId: 'op-1', planVersion: 1, quoteId: 'q1', currency: 'CNY', shots, ...overrides }
}

const IDLE: SpendCardView = { busy: false, stopping: false,  }

function project(shots: readonly PendingSpendShot[], shotFacts: readonly SpendCardShotFacts[], view: Partial<SpendCardView> = {}, overrides: Partial<PendingSpendConfirm> = {}) {
  return projectSpendCard(pending(shots, overrides), shotFacts, { ...IDLE, ...view }, t, { locale: 'zh-CN' })!
}

describe('付费卡投影 · 等人决定', () => {
  it('单段：一张指向元素 + 「生成」；数量只在主按钮，不渲染页脚，不挂「不生成 ×」', () => {
    const card = project([shot(1)], [facts(1)])
    expect(card.single).toBe(true)
    expect(card.slot.title).toBe('agentPanelV4.spendParamsTitleSingle(count=1)')
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendCard.generate')
    expect(card.slot.price).toBeUndefined()
    expect(card.summary).toBeUndefined()
    expect(card.pointers).toEqual([{ shotId: 's1', nodeId: 'n1', shotRef: '镜 01', removed: false, exclusion: null }])
    expect(card.primary).toEqual({ kind: 'generate', shotIds: ['s1'] })
  })

  it('「Nomi 选的」并入只读摘要；节点里换过模型就不再这么说', () => {
    expect(project([shot(1), shot(2)], [facts(1), facts(2)]).summary).toContain('agentPanelV4.spendCard.summaryPickedModel')
    const changed = project([shot(1), shot(2)], [facts(1), facts(2, { selected: { providerId: 'apimart', modelId: 'seedance-2-pro' } })])
    expect(changed.summary).not.toContain('agentPanelV4.spendParamsModelPicked')
    const noModel = project([shot(1), shot(2)], [facts(1), facts(2, { selected: null })])
    expect(noModel.summary).not.toContain('agentPanelV4.spendParamsModelPicked')
  })

  it('三段同价：「全部生成（3）」+ 不渲染页脚、不印合计金额、不出逐镜折叠；摘要是整齐的那一行', () => {
    const card = project([shot(1), shot(2), shot(3)], [facts(1), facts(2), facts(3, { durationSec: 5 })])
    expect(card.single).toBe(false)
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendCard.generateAll(count=3)')
    expect(card.slot.price).toBeUndefined()
    expect(JSON.stringify(card)).not.toContain('¥')
    expect(card.summary).toBe('agentPanelV4.spendCard.summaryPickedModel(model=Seedance 2.0 Fast,picked=agentPanelV4.spendParamsModelPicked) · 16:9 · 480p · agentPanelV4.spendCard.summarySeconds(value=13s)')
    expect(card.pointers[0]!.hoverSummary).toContain('4s')
    expect(card.pointers[1]!.hoverSummary).toContain('4s')
    expect(card.pointers[2]!.hoverSummary).toContain('5s')
    expect(card.pointers[2]!.hoverSummary).not.toContain('summarySeconds')
    const uniform = project([shot(1), shot(2), shot(3)], [facts(1), facts(2), facts(3)])
    expect(uniform.pointers.every((pointer) => pointer.hoverSummary === undefined)).toBe(true)
    expect(card.pointers.map((pointer) => pointer.exclusion)).toEqual(['exclude', 'exclude', 'exclude'])
    expect(card.primary).toEqual({ kind: 'generate', shotIds: ['s1', 's2', 's3'] })
  })

  it('各镜价格不同：折叠明细逐镜印价（名字与指向元素同一个），不渲染页脚（D5）', () => {
    const card = project([shot(1), shot(2)], [facts(1), facts(2, { aspect: '9:16', durationSec: 5, price: { known: true, amount: 0.88 } })])
    expect(card.slot.price?.perItemLabel).toBe('agentPanelV4.spendParamsPerItem')
    expect(card.slot.price?.perItem).toEqual([
      { label: '镜 01 · Seedance 2.0 Fast · 16:9 · 4s', amount: '¥0.70' },
      { label: '镜 02 · Seedance 2.0 Fast · 9:16 · 5s', amount: '¥0.88' },
    ])
    expect(card.summary).toBe('agentPanelV4.spendCard.summaryMixed(prefix=agentPanelV4.spendCard.summaryPickedModel(model=Seedance 2.0 Fast,picked=agentPanelV4.spendParamsModelPicked) · 480p,groups=agentPanelV4.spendCard.summaryGroup(value=16:9,count=1) · agentPanelV4.spendCard.summaryGroup(value=9:16,count=1))')
    expect(card.pointers[0]!.hoverSummary).toContain('16:9')
    expect(card.pointers[1]!.hoverSummary).toContain('9:16')
  })

  it('有一镜算不出价：页脚与逐镜折叠整行不印，绝不写 0（3.5）', () => {
    const card = project([shot(1), shot(2)], [facts(1), facts(2, { price: { known: false } })])
    expect(card.slot.price).toBeUndefined()
    expect(JSON.stringify(card)).not.toMatch(/¥0(?!\.\d*[1-9])/)
  })

  it('图片：标题和「生成剩下」都说「张」；有一段视频就说视频', () => {
    const images = project([shot(1, { kind: 'image' }), shot(2, { kind: 'image' })], [facts(1, { durationSec: null }), facts(2, { durationSec: null })])
    expect(images.slot.title).toBe('agentPanelV4.spendParamsTitleImage(count=2)')
    const mixed = project([shot(1, { kind: 'image' }), shot(2)], [facts(1), facts(2)])
    expect(mixed.slot.title).toBe('agentPanelV4.spendParamsTitle(count=2)')
  })
})

describe('付费卡投影 · 不生成 / 恢复 / 删除 / 节点上点过 ↑', () => {
  it('「不生成 ×」去掉一镜：N 减一、主按钮不交它、那一格改挂「恢复」（3.4）', () => {
    const card = project([shot(1), shot(2, { offer: 'removed' }), shot(3)], [facts(1), facts(2), facts(3)])
    expect(card.slot.title).toBe('agentPanelV4.spendParamsTitle(count=2)')
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendCard.generateAll(count=2)')
    expect(card.pointers.map((pointer) => pointer.exclusion)).toEqual(['exclude', 'restore', 'exclude'])
    expect(card.primary).toEqual({ kind: 'generate', shotIds: ['s1', 's3'] })
  })

  it('全部去掉：主按钮置灰只说「生成」，卡留着（每一格都能恢复），标题说没有要生成的了', () => {
    const card = project([shot(1, { offer: 'removed' }), shot(2, { offer: 'removed' })], [facts(1), facts(2)])
    expect(card.slot.title).toBe('agentPanelV4.spendCard.titleNothing')
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendCard.generate')
    expect(card.slot.actionsDisabled).toBe(true)
    expect(card.pointers.map((pointer) => pointer.exclusion)).toEqual(['restore', 'restore'])
    expect(card.primary).toEqual({ kind: 'generate', shotIds: [] })
  })

  it('节点被删：指向元素「已删除」、不能恢复，N 跟着变（3.12）；宿主还没记上删除时也不交它', () => {
    const card = project(
      [shot(1), shot(2, { offer: 'removed' }), shot(3)],
      [facts(1), facts(2, { present: false }), facts(3, { present: false })],
    )
    expect(card.pointers.map((pointer) => [pointer.removed, pointer.exclusion])).toEqual([[false, 'exclude'], [true, null], [false, null]])
    expect(card.primary).toEqual({ kind: 'generate', shotIds: ['s1'] })
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendCard.generateAll(count=1)')
  })

  it('还没落到画布上的那一镜：指向元素是不可点的占位（nodeId 空），卡不算它、不交它', () => {
    const card = project([shot(1, { nodeId: undefined }), shot(2)], [facts(1, { present: false }), facts(2)])
    expect(card.pointers[0]).toMatchObject({ nodeId: '', removed: false, exclusion: null })
    expect(card.primary).toEqual({ kind: 'generate', shotIds: ['s2'] })
    const allLanding = project([shot(1, { nodeId: undefined }), shot(2, { nodeId: undefined })], [facts(1, { present: false }), facts(2, { present: false })])
    expect(allLanding.slot.confirmLabel).toBe('agentPanelV4.spendCard.generate')
    expect(allLanding.slot.actionsDisabled).toBe(true)
  })

  it('节点上点过 ↑（画布接走了）：卡说「生成剩下 N 段」，按钮只数剩下的（3.3）', () => {
    const card = project([shot(1, { offer: 'taken_by_canvas' }), shot(2), shot(3)], [facts(1), facts(2), facts(3)])
    expect(card.slot.title).toBe('agentPanelV4.spendParamsTitleRemainingVideo(count=2)')
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendConfirmRemainingVideo(count=2)')
    expect(card.pointers[0]!.exclusion).toBeNull()
    expect(card.primary).toEqual({ kind: 'generate', shotIds: ['s2', 's3'] })
  })

  it('动作在路上：主按钮置灰（第二下不进）', () => {
    expect(project([shot(1)], [facts(1)], { busy: true }).slot.actionsDisabled).toBe(true)
  })
})

describe('付费卡投影 · 正在发出', () => {
  it('有镜在交：标题说到第几段，动作行只说怎么停；不挂「不生成 ×」、没有主按钮（3.6）', () => {
    const card = project([shot(1, { offer: 'sent' }), shot(2, { offer: 'handing_over' }), shot(3, { offer: 'handing_over' })], [facts(1), facts(2), facts(3)])
    expect(card.slot.title).toBe('agentPanelV4.spendBatchProgressVideo(current=2,total=3)')
    expect(card.slot.progress).toEqual({ hint: 'agentPanelV4.spendBatchStopHint' })
    expect(card.slot.confirmLabel).toBeUndefined()
    expect(card.primary).toEqual({ kind: 'none' })
    expect(card.pointers.every((pointer) => pointer.exclusion === null)).toBe(true)
  })

  it('点了「取消」、宿主还没停稳：说正在停，已经发出的照常生成', () => {
    const card = project([shot(1, { offer: 'handing_over' }), shot(2, { offer: 'handing_over' })], [facts(1), facts(2)], { stopping: true })
    expect(card.slot.title).toBe('agentPanelV4.spendBatchStopping')
    expect(card.slot.progress).toEqual({ hint: 'agentPanelV4.spendBatchStoppingHint' })
  })

  it('停下之后那一句只说事实：发了几段、没发几段；一段没剩就照实说已经发出去；一段都没交出去就说没发出去', () => {
    const shots = [shot(1), shot(2), shot(3)]
    expect(spendCardStoppedMessage(shots, { sent: 1, notSent: 2 }, t)).toBe('agentPanelV4.spendBatchStoppedVideo(sent=1,count=2,total=3)')
    expect(spendCardStoppedMessage(shots, { sent: 3, notSent: 0 }, t)).toBe('agentPanelV4.spendBatchAllSentVideo(sent=3,count=3)')
    expect(spendCardStoppedMessage([shot(1, { kind: 'image' })], { sent: 0, notSent: 1 }, t)).toBe('agentPanelV4.spendBatchNoneSentImage(count=1)')
    expect(spendCardStoppedMessage(shots, { sent: 0, notSent: 3 }, t)).toBe('agentPanelV4.spendBatchNoneSentVideo(count=3)')
  })
})

describe('付费卡投影 · 失败留在卡里', () => {
  it('没发出去：「先不发了 · 再试一次」，再试只重发没发出去的那几镜；别的几段此刻怎样写在原因下面（3.7）', () => {
    const card = project(
      [shot(1, { offer: 'sent' }), shot(2, { offer: 'not_sent', failure: { kind: 'not_sent', code: 'provider_not_reached' } }), shot(3)],
      [facts(1), facts(2), facts(3)],
    )
    expect(card.slot.title).toBe('agentPanelV4.spendCard.failedTitle.notSent(shot=镜 02)')
    expect(card.slot.failed).toBe(true)
    expect(card.slot.dismissLabel).toBe('agentPanelV4.spendCard.decline')
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendCard.retry')
    expect(card.notices).toEqual([{ tone: 'danger', text: 'agentPanelV4.spendCard.failure.provider_not_reached' }])
    expect(card.pointers[2]!.hostStatus).toBe('agentPanelV4.spendCard.pointerNotSentYet')
    expect(card.pointers[1]!.hostFailure).toBe('agentPanelV4.spendCard.pointerFailed')
    expect(card.primary).toEqual({ kind: 'retry', shotIds: ['s2'] })
  })

  it('参数被拒：「先不发了 · 去改镜 N」，点了定位到那个节点（不给「再试一次」：同样的参数再发一次还是被拒）', () => {
    const card = project(
      [shot(1, { offer: 'sent' }), shot(2, { offer: 'not_sent', failure: { kind: 'parameter_rejected', code: 'provider_rejected' } })],
      [facts(1), facts(2)],
    )
    expect(card.slot.title).toBe('agentPanelV4.spendCard.failedTitle.rejected(shot=镜 02)')
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendCard.goEdit(shot=镜 02)')
    expect(card.slot.confirmIcon).toBe('locate')
    expect(card.notices[0]!.text).toBe('agentPanelV4.spendCard.failure.provider_rejected')
    expect(card.primary).toEqual({ kind: 'locate', nodeId: 'n2', label: '镜 02' })
  })

  it('结果未知：不说没花钱，下一步是去节点上核对（不是再发一次）', () => {
    const card = project([shot(1, { offer: 'unknown' }), shot(2)], [facts(1), facts(2)])
    expect(card.slot.title).toBe('agentPanelV4.spendCard.failedTitle.unclear(shot=镜 01)')
    expect(card.notices[0]!.text).toBe('agentPanelV4.spendCard.failure.unclear')
    expect(JSON.stringify(card)).not.toContain('notSentFallback')
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendCard.goCheck(shot=镜 01)')
    expect(card.primary).toEqual({ kind: 'locate', nodeId: 'n1', label: '镜 01' })
    expect(card.pointers[0]!.hostFailure).toBe('agentPanelV4.spendCard.pointerUnclear')
  })

  it('没登记的码按种类说：没发出去 = 这次没花钱、可以再试；参数被拒 = 去节点里改', () => {
    const notSent = project([shot(1, { offer: 'not_sent', failure: { kind: 'not_sent', code: 'some_new_code' } })], [facts(1)])
    expect(notSent.notices[0]!.text).toBe('agentPanelV4.spendCard.failure.notSentFallback')
    const rejected = project([shot(1, { offer: 'not_sent', failure: { kind: 'parameter_rejected', code: 'some_new_code' } })], [facts(1)])
    expect(rejected.notices[0]!.text).toBe('agentPanelV4.spendCard.failure.rejectedFallback')
  })

  it('没发出去的节点已经不在画布上：不再当成要处理的那一镜', () => {
    const card = project([shot(1, { offer: 'not_sent', failure: { kind: 'not_sent', code: 'canvas_node_missing' } }), shot(2)], [facts(1, { present: false }), facts(2)])
    expect(card.slot.failed).toBeUndefined()
    expect(card.primary).toEqual({ kind: 'generate', shotIds: ['s2'] })
  })
})

describe('付费卡投影 · 本机预检（按下之前就判得出发不出去）', () => {
  const blocked = (code: string, kind: 'not_sent' | 'parameter_rejected' = 'parameter_rejected') => ({ blocked: { kind, code } })

  it('有别的段能发：那一镜一行红字说明、不进 N，指向元素写「发不出去」', () => {
    const card = project([shot(1), shot(2), shot(3)], [facts(1), facts(2, blocked('prompt_required')), facts(3)])
    expect(card.slot.failed).toBeUndefined()
    expect(card.slot.confirmLabel).toBe('agentPanelV4.spendCard.generateAll(count=2)')
    expect(card.notices).toEqual([{ tone: 'danger', text: 'agentPanelV4.spendCard.blockedNotice(shot=镜 02,reason=agentPanelV4.spendCard.failure.prompt_required)' }])
    expect(card.pointers[1]).toMatchObject({ hostFailure: 'agentPanelV4.spendCard.pointerCannotSend', exclusion: 'exclude' })
    expect(card.primary).toEqual({ kind: 'generate', shotIds: ['s1', 's3'] })
  })

  it('一段能发的都没有：失败样子留在卡里，参数那一类「去改」，节点在忙那一类「去看」', () => {
    const rejected = project([shot(1)], [facts(1, blocked('model_not_selected'))])
    expect(rejected.slot.title).toBe('agentPanelV4.spendCard.failedTitle.blocked(shot=镜 01)')
    expect(rejected.slot.confirmLabel).toBe('agentPanelV4.spendCard.goEdit(shot=镜 01)')
    expect(rejected.primary).toEqual({ kind: 'locate', nodeId: 'n1', label: '镜 01' })
    const busy = project([shot(1)], [facts(1, blocked('node_generation_in_flight', 'not_sent'))])
    expect(busy.slot.confirmLabel).toBe('agentPanelV4.spendCard.goCheck(shot=镜 01)')
  })
})

describe('付费卡投影 · 托管披露、刹车、空卡', () => {

  it('直接生成档的刹车退回这张卡：三种样子都多一行说明，别的不变', () => {
    for (const [reason, key] of [['retry-limit', 'brakeRetry'], ['out-of-plan', 'brakeOutOfPlan'], ['stopped', 'brakeStopped']] as const) {
      const card = project([shot(1)], [facts(1)], {}, { brake: { reason } })
      expect(card.slot.summary).toBe(`agentPanelV4.${key}.title`)
      expect(card.slot.title).toBe('agentPanelV4.spendParamsTitleSingle(count=1)')
    }
    const failed = project([shot(1, { offer: 'unknown' })], [facts(1)], {}, { brake: { reason: 'retry-limit' } })
    expect(failed.slot.summary).toBe('agentPanelV4.brakeRetry.title')
  })

  it('一镜都没有：不出卡', () => {
    expect(projectSpendCard(pending([]), [], IDLE, t, { locale: 'zh-CN' })).toBeUndefined()
  })
})

describe('一行只读摘要', () => {
  it('读不出就不印；只列不同的那几样', () => {
    expect(spendCardSummary([], t)).toBeUndefined()
    expect(spendCardSummary([facts(1, { model: '', aspect: null, resolution: null, durationSec: null })], t)).toBeUndefined()
    const mixedModel = spendCardSummary([facts(1), facts(2, { model: 'Kling 2.5' })], t)
    expect(mixedModel).toBe('agentPanelV4.spendCard.summaryMixed(prefix=16:9 · 480p,groups=agentPanelV4.spendCard.summaryGroup(value=Seedance 2.0 Fast,count=1) · agentPanelV4.spendCard.summaryGroup(value=Kling 2.5,count=1))')
  })

  // 走查抓到的：两镜比例自动、一镜在节点里改成 16:9，整齐那一行只印第一镜的值——第一镜正好是 16:9 时，卡对三镜都说 16:9。
  // 读不出的那一格放在哪一镜、哪一样上都一样：它和读得出的不同，整齐那一行永远不替它说一个值。
  const READS: ReadonlyArray<readonly ['aspect' | 'resolution' | 'model', string, null | '']> = [
    ['aspect', '16:9', null],
    ['resolution', '1K', null],
    ['model', 'GPT Image 2', ''],
  ]
  it.each(READS.flatMap(([key, value, empty]) => [0, 1, 2].map((readable) => [key, value, readable, empty] as const)))(
    '%s=%s，三镜里只有第 %i 镜（0 基）读得出：不被说成三镜都是它',
    (key, value, readable, empty) => {
      const shots = [1, 2, 3].map((index) => facts(index, { aspect: '16:9', resolution: '1K', model: 'GPT Image 2', [key]: index - 1 === readable ? value : empty } as Partial<SpendCardShotFacts>))
      const line = spendCardSummary(shots, t)!
      expect(line).toContain('agentPanelV4.spendCard.summaryMixed(prefix=')
      expect(line).toContain(`summaryGroup(value=${value},count=1)`)
      expect(line, '读不出的那几镜不印成一组空值').not.toMatch(/value=,/)
    },
  )

  it('三镜都读不出那一样：整齐，那一样不印（不是「逐镜不同」）', () => {
    expect(spendCardSummary([1, 2, 3].map((index) => facts(index, { aspect: null })), t)).toBe('Seedance 2.0 Fast · 480p · agentPanelV4.spendCard.summarySeconds(value=12s)')
  })
})

// SpendCardQ1 板 card.title：卡标题一句问话、不带数量（数量只在主按钮）。英文曾有一条「Generate these {{count}} images?」带着张数，
// 样张是「Generate these images?」——中英每一条标题键、以及标题的每一种说法（多段 / 单段 / 剩下的 / 一段都不剩）都在这里数着。
describe('付费卡标题 · 一句问话、不带数量（SpendCardQ1/card.title）', () => {
  const dictionaries = { 'zh-CN': zhAgentPanelV4, en: enAgentPanelV4 } as const
  /** 等人决定那一档的全部标题键（词典里 `spendParamsTitle*` 与「没有要生成的了」）；进度标题（正在发出 k/N）不是问话，不在此列。 */
  const titleEntries = (locale: keyof typeof dictionaries): Array<[string, string]> => {
    const dictionary = dictionaries[locale]
    return [
      ...Object.entries(dictionary).filter(([key, value]) => key.startsWith('spendParamsTitle') && typeof value === 'string') as Array<[string, string]>,
      ['spendCard.titleNothing', dictionary.spendCard.titleNothing],
    ]
  }

  it.each(['zh-CN', 'en'] as const)('%s：每一条标题键都没有数量占位、没有数字（词典逐键数着）', (locale) => {
    const entries = titleEntries(locale)
    // 防空转：标题键至少是 多段 / 单段 / 剩下的 × 图片 / 视频，加「没有要生成的了」。
    expect(entries.length).toBeGreaterThanOrEqual(9)
    for (const [key, text] of entries) {
      expect(text, `${locale} ${key}`).not.toMatch(/\{\{/)
      expect(text, `${locale} ${key}`).not.toMatch(/\d/)
    }
  })

  const shots = (count: number, kind: 'image' | 'video', overrides: Partial<PendingSpendShot> = {}) =>
    Array.from({ length: count }, (_, index) => shot(index + 1, { kind, ...overrides }))
  const factsFor = (count: number, kind: 'image' | 'video') => Array.from({ length: count }, (_, index) => facts(index + 1, kind === 'image' ? { durationSec: null } : {}))

  /** 真 i18n 的 t（i18next 的重载签名比投影要的宽，窄成它要的那一种）。 */
  const realT = (locale: 'zh-CN' | 'en') => i18n.getFixedT(locale) as unknown as (key: string, options?: Record<string, unknown>) => string
  /** 用真 i18n 把投影出来的标题念出来：覆盖「挑哪一句」+ 词典 + 复数，三层一起。 */
  const spoken = (locale: 'zh-CN' | 'en', pendingShots: readonly PendingSpendShot[], shotFacts: readonly SpendCardShotFacts[]): string =>
    projectSpendCard(pending(pendingShots), shotFacts, IDLE, realT(locale), { locale })!.slot.title

  it.each(['zh-CN', 'en'] as const)('%s：多段 / 单段 / 剩下的 / 一段都不剩，图片和视频，念出来的标题都不带数字', (locale) => {
    for (const kind of ['image', 'video'] as const) {
      for (const count of [2, 3, 8]) {
        const many = spoken(locale, shots(count, kind), factsFor(count, kind))
        expect(many, `${locale} ${kind} 多段 ${count}`).not.toMatch(/\d/)
      }
      const single = spoken(locale, shots(1, kind), factsFor(1, kind))
      expect(single, `${locale} ${kind} 单段`).not.toMatch(/\d/)
      const remaining = spoken(locale, [shot(1, { kind, offer: 'taken_by_canvas' }), shot(2, { kind }), shot(3, { kind })], factsFor(3, kind))
      expect(remaining, `${locale} ${kind} 剩下的`).not.toMatch(/\d/)
    }
    const nothing = spoken(locale, [shot(1, { offer: 'removed' }), shot(2, { offer: 'removed' })], [facts(1), facts(2)])
    expect(nothing, `${locale} 一段都不剩`).not.toMatch(/\d/)
  })

  it('英文多段图片：标题就是词典那一句、不带张数；张数只在主按钮（曾是标题里带着 2 的那一句）', () => {
    const card = projectSpendCard(pending(shots(2, 'image')), factsFor(2, 'image'), IDLE, realT('en'), { locale: 'en' })!
    expect(card.slot.title).toBe(enAgentPanelV4.spendParamsTitleImage_other)
    expect(card.slot.title).not.toMatch(/\d/)
    expect(card.slot.confirmLabel).toBe(enAgentPanelV4.spendCard.generateAllImage.replace('{{count}}', '2'))
  })
})
