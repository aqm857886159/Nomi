// 「Agent 接着说下一句时，付费卡只摆还没定的镜」量具的单测（零花费、不起 App）：回合表、转录读法、硬断言判据、打分、花钱对账。
// 两类判据分开钉：硬断言判宿主和钱，打分判模型——它们读同一份观察，却互不依赖（见最后一组「点名 [镜1,镜2,镜3]」）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  GENERATE, SHOT_SCOPE_MARKER, TURNS,
  callEvidence, countVendorImageCreates, expectedUnnamedScope, gaugeProblems, judgeCardAgreement, judgeGenerateCall, judgeSpend, namedAgainBy, namedShotIds,
  sameShots, scoreTurn, shotKey, spendGateProblems, summarizeTurns, transcriptFacts, vendorTaskCount,
} from './_agentShotScopeScore.mjs'
import { assertEvidenceHasNoKey } from './_agentShotScopeSteps.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')

const OP = 'op-main'
const OTHER_OP = 'op-new'
const primary = { operationId: OP, shotIds: ['shot-1', 'shot-2', 'shot-3'] }
const call = (id, name, args, { isError = null, resultText = null } = {}) => ({ id, name, args, isError, resultText })
const generate = (id, args, outcome) => call(id, GENERATE, { operationId: OP, ...args }, outcome)
const refusedBy = (text = `nothing left. To put shots on a card anyway, ${SHOT_SCOPE_MARKER}; give a shot another take only if asked.`) => ({ isError: true, resultText: text })
const draftThree = call('d1', 'draft_shots', { shots: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }] }, { isError: false, resultText: '{}' })
const cardOf = (shotIds, operationId = OP) => ({ operationId, shotIds })
const observe = (calls, extra = {}) => ({ calls, card: null, primary, prompts: {}, newShots: [], ...extra })
const score = (turn, calls, extra) => scoreTurn(turn, observe(calls, extra))

describe('回合表（量具表的 8 个回合，用户逐字说的话）', () => {
  it('T1–T8，每句和任务书一字不差', () => {
    expect(TURNS.map((turn) => [turn.id, turn.ask])).toEqual([
      ['T1', '画三张图：雨后水洼里漂着的红色纸船、窗台上晒太阳的橘猫、黄昏海边的灯塔，都是 1:1。起草好就出卡，我在卡上决定生成哪张。'],
      ['T2', '先别管第二张，生成第三张'], ['T3', '算了先不生成'], ['T4', '先生成第一张看看'], ['T5', '剩下的也生成吧'],
      ['T6', '生成吧'], ['T7', '第二张改成夜景再生成'], ['T8', '加一个结尾镜头然后生成它'],
    ])
  })

  it('产物标记就是产品源码里的那句拒绝正文；两份走查入口各自写的字面量和它一致（入口里的 buildMarkers 要能静态读出来，所以各抄一份）', () => {
    expect(read('electron/shared/agentCapabilities/generationShotScope.ts')).toContain(SHOT_SCOPE_MARKER)
    for (const entry of ['tests/ux/agent-shot-scope-real.paid.mjs', 'tests/ux/agent-shot-scope-real.rehearsal.walk.mjs']) {
      expect(read(entry), entry).toContain(`const SHOT_SCOPE_BUILD_MARKER = '${SHOT_SCOPE_MARKER}'`)
    }
  })
})

describe('小工具', () => {
  it('sameShots 不看顺序，重复和多少都算不同', () => {
    expect(sameShots(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(sameShots(['a'], ['a', 'b'])).toBe(false)
    expect(sameShots(['a', 'a'], ['a'])).toBe(false)
    expect(sameShots(undefined, [])).toBe(true)
  })

  it('namedShotIds：没写 / null = 没点名；数组和单个字符串 = 点名', () => {
    expect(namedShotIds({ operationId: OP })).toBeUndefined()
    expect(namedShotIds({ shotIds: null })).toBeUndefined()
    expect(namedShotIds({ shotIds: ['shot-2', 'shot-3'] })).toEqual(['shot-2', 'shot-3'])
    expect(namedShotIds({ shotIds: 'shot-1' })).toEqual(['shot-1'])
  })
})

describe('转录读法', () => {
  const session = (messages) => [{ entries: messages.map((message) => ({ type: 'message', message })) }]
  const assistantCall = (id, name, args) => ({ role: 'assistant', provider: 'apimart', model: 'deepseek-v4-pro', stopReason: 'toolUse', content: [{ type: 'toolCall', id, name, arguments: args }] })
  const result = (id, text, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: 'x', isError, content: [{ type: 'text', text }] })
  const finalText = (text) => ({ role: 'assistant', provider: 'apimart', model: 'deepseek-v4-pro', stopReason: 'stop', content: [{ type: 'text', text }] })

  it('调用的参数和结果按 id 对回；还在等人的调用没有结果；落地 = 最后一条助手消息停在文字上', () => {
    const waiting = transcriptFacts(session([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      assistantCall('c1', 'draft_shots', { shots: [] }), result('c1', '{"operationId":"op-1"}'),
      assistantCall('c2', GENERATE, { operationId: 'op-1' }),
    ]))
    expect(waiting.calls.map((entry) => [entry.id, entry.name, entry.isError, entry.resultText])).toEqual([['c1', 'draft_shots', false, '{"operationId":"op-1"}'], ['c2', GENERATE, null, null]])
    expect(waiting).toMatchObject({ finals: 0, settled: false, models: ['apimart/deepseek-v4-pro'] })
    const done = transcriptFacts(session([assistantCall('c1', GENERATE, {}), result('c1', 'refused', true), finalText('好的')]))
    expect(done.calls[0]).toMatchObject({ isError: true, resultText: 'refused' })
    expect(done).toMatchObject({ finals: 1, settled: true })
  })

  it('带工具调用的助手消息不算「落地」，哪怕 stopReason 不是 toolUse 也不算', () => {
    const odd = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '我来调' }, { type: 'toolCall', id: 'c1', name: GENERATE, arguments: {} }] }
    expect(transcriptFacts(session([odd]))).toMatchObject({ finals: 0, settled: false })
  })

  it('模型说过的话按先后收进 texts（空的不收）；证据里被退回的带宿主那句话，收下的带结果的开头', () => {
    const facts = transcriptFacts(session([
      { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: '  先看一眼  ' }, { type: 'toolCall', id: 'c1', name: GENERATE, arguments: {} }] }, result('c1', 'x'.repeat(500), true),
      { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'c2', name: 'draft_shots', arguments: {} }] }, result('c2', 'y'.repeat(500)),
      finalText('好了'),
    ]))
    expect(facts.texts).toEqual(['先看一眼', '好了'])
    expect(callEvidence(facts.calls[0])).toMatchObject({ id: 'c1', isError: true, refusalText: 'x'.repeat(500) })
    expect(callEvidence(facts.calls[0])).not.toHaveProperty('resultHead')
    expect(callEvidence(facts.calls[1])).toMatchObject({ id: 'c2', isError: false, resultHead: 'y'.repeat(240) })
    expect(callEvidence({ id: 'c3', name: GENERATE, args: {}, isError: null, resultText: null })).toEqual({ id: 'c3', name: GENERATE, args: {}, isError: null })
  })
})

describe('硬断言：不点名的 generate 摆什么', () => {
  const facts = (extra) => ({ planShotIds: ['shot-1', 'shot-2', 'shot-3'], includedShotIds: ['shot-1', 'shot-2', 'shot-3'], hasOffer: true, undecided: [], standing: [], sent: [], ...extra })

  it('规则复述：有出价 = 那一次出价上还没定的；从没出价 = 勾着、没送过的；顺序跟计划', () => {
    expect(expectedUnnamedScope(facts({ undecided: ['shot-3', 'shot-2'] }))).toEqual(['shot-2', 'shot-3'])
    expect(expectedUnnamedScope(facts({ undecided: [] }))).toEqual([])
    expect(expectedUnnamedScope(facts({ undecided: ['shot-2'], includedShotIds: ['shot-1', 'shot-3'] }))).toEqual([])
    expect(expectedUnnamedScope(facts({ hasOffer: false, standing: ['shot-1', 'shot-2', 'shot-3'], sent: ['shot-1'] }))).toEqual(['shot-2', 'shot-3'])
  })

  const unnamed = generate('g', {})
  const ids = (checks) => Object.fromEntries(checks.map((entry) => [entry.id, entry.ok]))

  it('一镜不剩：拒了、正文带产物标记 = 绿；摆了卡 = 红；拒了但没有标记 = 红', () => {
    expect(ids(judgeGenerateCall({ call: unnamed, expected: [], sent: ['shot-1'], outcome: { kind: 'refused', text: `... ${SHOT_SCOPE_MARKER}; ...` } })))
      .toEqual({ 'unnamed-nothing-left-is-refused-with-marker': true })
    const card = judgeGenerateCall({ call: unnamed, expected: [], sent: ['shot-1'], outcome: { kind: 'card', ledgerShotIds: ['shot-1', 'shot-2', 'shot-3'] } })
    expect(card).toEqual([expect.objectContaining({ id: 'unnamed-nothing-left-is-refused-with-marker', ok: false })])
    expect(card[0].detail).toContain('shot-1, shot-2, shot-3')
    const bare = judgeGenerateCall({ call: unnamed, expected: [], outcome: { kind: 'refused', text: 'generation_input_invalid' } })
    expect(bare[0].ok).toBe(false)
  })

  it('还有没定的镜：账、界面、投影三处都只有它们 = 绿；任何一处多摆了已经送出的镜 = 红，并点出是哪一镜', () => {
    const good = judgeGenerateCall({ call: unnamed, expected: ['shot-2', 'shot-3'], sent: ['shot-1'],
      outcome: { kind: 'card', ledgerShotIds: ['shot-2', 'shot-3'], pointerShotIds: ['shot-3', 'shot-2'], projectionShotIds: ['shot-2', 'shot-3'] } })
    expect(ids(good)).toEqual({ 'unnamed-only-undecided': true, 'unnamed-never-offers-a-sent-shot': true })
    const leaked = judgeGenerateCall({ call: unnamed, expected: ['shot-2', 'shot-3'], sent: ['shot-1'],
      outcome: { kind: 'card', ledgerShotIds: ['shot-1', 'shot-2', 'shot-3'], pointerShotIds: ['shot-1', 'shot-2', 'shot-3'] } })
    expect(ids(leaked)).toEqual({ 'unnamed-only-undecided': false, 'unnamed-never-offers-a-sent-shot': false })
    expect(leaked.find((entry) => entry.id === 'unnamed-never-offers-a-sent-shot').detail).toContain('shot-1')
    const uiOnly = judgeGenerateCall({ call: unnamed, expected: ['shot-2'], sent: [],
      outcome: { kind: 'card', ledgerShotIds: ['shot-2'], pointerShotIds: ['shot-2', 'shot-3'] } })
    expect(uiOnly[0]).toMatchObject({ id: 'unnamed-only-undecided', ok: false })
  })

  it('该摆却被拒了 = 红（宿主把该给的镜吞了）', () => {
    const result = judgeGenerateCall({ call: unnamed, expected: ['shot-2'], outcome: { kind: 'refused', text: 'boom' } })
    expect(result[0]).toMatchObject({ id: 'unnamed-only-undecided', ok: false })
  })

  it('摆回已送出的镜时，归因：它是被送出之后哪个更早的 generate 点名重新摆上卡的（只归因，不改判红）', () => {
    const leaked = judgeGenerateCall({ call: unnamed, expected: ['shot-1', 'shot-2', 'shot-3'], sent: ['shot-1'],
      outcome: { kind: 'card', ledgerShotIds: ['shot-1', 'shot-2', 'shot-3'] } })
    expect(leaked.find((entry) => entry.id === 'unnamed-never-offers-a-sent-shot')).toMatchObject({ ok: false, leaked: ['shot-1'] })
    const turns = [
      { turn: 'T5', calls: [{ id: 'a', name: GENERATE, args: { shotIds: ['shot-1', 'shot-2'] }, isError: null }, { id: 'b', name: GENERATE, args: {}, isError: true }] },
      // 别的工具即使写了 shotIds 也不算点名（工具名取一个不在动词表里的，走查模型面调用门岗只按动词名查键）。
      { turn: 'T6', calls: [{ id: 'c', name: GENERATE, args: {}, isError: null }, { id: 'd', name: 'some_other_tool', args: { shotIds: ['shot-1'] } }] },
    ]
    expect(namedAgainBy(turns, ['shot-1'])).toEqual(['T5/a'])
    expect(namedAgainBy(turns, ['shot-3'])).toEqual([])
    expect(namedAgainBy([], ['shot-1'])).toEqual([])
  })
})

describe('硬断言：点名的 generate「说的 = 摆的」', () => {
  const named = (shotIds) => generate('g', { shotIds })

  it('点名几镜卡上就是那几镜，账、界面、投影三处都对 = 绿；少摆 / 多摆 / 界面对不上 = 红', () => {
    expect(judgeGenerateCall({ call: named(['shot-2', 'shot-3']), outcome: { kind: 'card', ledgerShotIds: ['shot-2', 'shot-3'], pointerShotIds: ['shot-3', 'shot-2'], projectionShotIds: ['shot-2', 'shot-3'] } }))
      .toEqual([expect.objectContaining({ id: 'named-equals-shown', ok: true })])
    for (const wrong of [
      { ledgerShotIds: ['shot-2'] }, { ledgerShotIds: ['shot-1', 'shot-2', 'shot-3'] },
      { ledgerShotIds: ['shot-2', 'shot-3'], pointerShotIds: ['shot-2'] }, { ledgerShotIds: ['shot-2', 'shot-3'], projectionShotIds: ['shot-3'] },
    ]) {
      expect(judgeGenerateCall({ call: named(['shot-2', 'shot-3']), outcome: { kind: 'card', ...wrong } })[0]).toMatchObject({ id: 'named-equals-shown', ok: false })
    }
  })

  it('点名无效被宿主拒了不算「说的 ≠ 摆的」（那是模型写错，归打分）', () => {
    expect(judgeGenerateCall({ call: named(['shot-9']), outcome: { kind: 'refused', text: 'shot-9 is not one of the shots you can name here.' } })).toEqual([])
  })

  it('一张卡上三处读到的镜要一致', () => {
    expect(judgeCardAgreement({ ledgerShotIds: ['shot-2', 'shot-3'], pointerShotIds: ['shot-3', 'shot-2'], projectionShotIds: ['shot-2', 'shot-3'] }).ok).toBe(true)
    expect(judgeCardAgreement({ ledgerShotIds: ['shot-2', 'shot-3'], pointerShotIds: ['shot-2'], projectionShotIds: ['shot-2', 'shot-3'] })).toMatchObject({ ok: false })
    expect(judgeCardAgreement({ ledgerShotIds: ['shot-2'], pointerShotIds: ['shot-2'], projectionShotIds: ['shot-2', 'shot-3'] }).ok).toBe(false)
  })

  it('给了节点就再对一遍：界面指向的节点要等于画布上这几镜自己的节点（读画布 store，不经卡的投影）', () => {
    const shots = { ledgerShotIds: ['shot-2', 'shot-3'], pointerShotIds: ['shot-2', 'shot-3'], projectionShotIds: ['shot-2', 'shot-3'] }
    expect(judgeCardAgreement({ ...shots, pointerNodeIds: ['n3', 'n2'], storeNodeIds: ['n2', 'n3'] })).toMatchObject({ ok: true })
    const wrong = judgeCardAgreement({ ...shots, pointerNodeIds: ['n2', 'n9'], storeNodeIds: ['n2', 'n3'] })
    expect(wrong.ok).toBe(false)
    expect(wrong.detail).toContain('n9')
    expect(judgeCardAgreement({ ...shots, pointerNodeIds: ['n2', 'n3'], storeNodeIds: undefined }).ok).toBe(true)
  })
})

describe('打分：T1', () => {
  it('起草 3 镜再 generate（不点名或点名这三镜）= 写对；卡指着这三镜 = 成功', () => {
    for (const args of [{}, { shotIds: ['shot-1', 'shot-2', 'shot-3'] }]) {
      expect(score('T1', [draftThree, generate('g', args)], { card: cardOf(primary.shotIds) })).toMatchObject({ toolWriteCorrect: true, turnSuccess: true })
    }
  })

  it('起草的不是一份 3 镜、generate 在起草之前或被退回、点名只有两镜 = 写错；卡上只有两镜 = 不成功', () => {
    const two = call('d1', 'draft_shots', { shots: [{ prompt: 'a' }, { prompt: 'b' }] }, { isError: false })
    expect(score('T1', [two, generate('g', {})]).toolWriteCorrect).toBe(false)
    expect(score('T1', [generate('g', {}), draftThree]).toolWriteCorrect).toBe(false)
    expect(score('T1', [draftThree, generate('g', {}, refusedBy())]).toolWriteCorrect).toBe(false)
    expect(score('T1', [draftThree, generate('g', { shotIds: ['shot-1', 'shot-2'] })]).toolWriteCorrect).toBe(false)
    expect(score('T1', [draftThree, generate('g', {})], { card: cardOf(['shot-1', 'shot-2']) }).turnSuccess).toBe(false)
    expect(score('T1', [draftThree, generate('g', {})]).turnSuccess).toBe(false)
  })
})

describe('打分：T2 / T4（点名单独一镜）', () => {
  it('T2 点名 [镜3]、卡只指着镜3 = 写对且成功', () => {
    expect(score('T2', [generate('g', { shotIds: ['shot-3'] })], { card: cardOf(['shot-3']) })).toMatchObject({ toolWriteCorrect: true, turnSuccess: true, why: [] })
  })

  it('T2 点错镜、不点名、点了两镜、调了两次、指的是别的草稿、被退回 = 写错；卡上不是镜3 = 不成功', () => {
    for (const calls of [
      [generate('g', { shotIds: ['shot-2'] })], [generate('g', {})], [generate('g', { shotIds: ['shot-2', 'shot-3'] })],
      [generate('a', { shotIds: ['shot-3'] }), generate('b', { shotIds: ['shot-3'] })],
      [call('g', GENERATE, { operationId: OTHER_OP, shotIds: ['shot-3'] })], [generate('g', { shotIds: ['shot-3'] }, refusedBy('x'))],
    ]) expect(score('T2', calls).toolWriteCorrect, JSON.stringify(calls.map((entry) => entry.args))).toBe(false)
    expect(score('T2', [generate('g', { shotIds: ['shot-3'] })], { card: cardOf(['shot-2', 'shot-3']) }).turnSuccess).toBe(false)
    expect(score('T2', [generate('g', { shotIds: ['shot-3'] })], { card: cardOf(['shot-3'], OTHER_OP) }).turnSuccess).toBe(false)
  })

  it('T4 点名 [镜1]、卡只指着镜1 = 写对且成功；卡上不止镜1 = 不成功', () => {
    expect(score('T4', [generate('g', { shotIds: ['shot-1'] })], { card: cardOf(['shot-1']) })).toMatchObject({ toolWriteCorrect: true, turnSuccess: true })
    expect(score('T4', [generate('g', { shotIds: ['shot-1'] })], { card: cardOf(['shot-1', 'shot-3']) }).turnSuccess).toBe(false)
    expect(score('T4', [generate('g', {})]).toolWriteCorrect).toBe(false)
  })
})

describe('打分：T3', () => {
  it('不调 generate、没有新卡 = 写对且成功；调了 generate 或出了新卡 = 不行', () => {
    expect(score('T3', [])).toMatchObject({ toolWriteCorrect: true, turnSuccess: true })
    expect(score('T3', [generate('g', {})]).toolWriteCorrect).toBe(false)
    expect(score('T3', [], { card: cardOf(['shot-1']) }).turnSuccess).toBe(false)
  })
})

describe('打分：T5（两条路都算对，要记是哪条）', () => {
  const wanted = ['shot-2', 'shot-3']
  it('直接点名 [镜2, 镜3]', () => {
    expect(score('T5', [generate('g', { shotIds: wanted })], { card: cardOf(wanted) })).toMatchObject({ toolWriteCorrect: true, turnSuccess: true, route: 'direct-named' })
  })

  it('先不点名、被拒、再点名 [镜2, 镜3]', () => {
    expect(score('T5', [generate('a', {}, refusedBy()), generate('b', { shotIds: wanted })], { card: cardOf(wanted) }))
      .toMatchObject({ toolWriteCorrect: true, turnSuccess: true, route: 'refused-then-named' })
  })

  it('在拒绝里打转（不点名被拒两次）、被拒之后点名点错、直接点名点错 [镜1,镜2,镜3] / [镜2] = 写错', () => {
    for (const calls of [
      [generate('a', {}, refusedBy()), generate('b', {}, refusedBy()), generate('c', { shotIds: wanted })],
      [generate('a', {}, refusedBy()), generate('b', { shotIds: ['shot-2'] })],
      [generate('g', { shotIds: ['shot-1', 'shot-2', 'shot-3'] })],
      [generate('g', { shotIds: ['shot-2'] })], [generate('g', {})], [],
      [generate('a', { shotIds: wanted }, refusedBy('x'))],
    ]) expect(score('T5', calls).toolWriteCorrect, JSON.stringify(calls.map((entry) => [entry.args.shotIds, entry.isError]))).toBe(false)
    expect(score('T5', [generate('g', { shotIds: wanted })], { card: cardOf(['shot-1', 'shot-2', 'shot-3']) }).turnSuccess).toBe(false)
    expect(score('T5', [generate('g', { shotIds: wanted })]).turnSuccess).toBe(false)
  })
})

describe('打分：T6', () => {
  const wanted = ['shot-2', 'shot-3']
  it('不点名或点名 [镜2, 镜3]、卡指着镜2和镜3、不含镜1 = 写对且成功', () => {
    for (const args of [{}, { shotIds: wanted }]) {
      expect(score('T6', [generate('g', args)], { card: cardOf(wanted) })).toMatchObject({ toolWriteCorrect: true, turnSuccess: true })
    }
  })

  it('卡上含镜1 = 不成功；点了别的镜、调了两次、被退回 = 写错', () => {
    expect(score('T6', [generate('g', {})], { card: cardOf(['shot-1', 'shot-2', 'shot-3']) }).turnSuccess).toBe(false)
    expect(score('T6', [generate('g', { shotIds: ['shot-1', 'shot-2', 'shot-3'] })]).toolWriteCorrect).toBe(false)
    expect(score('T6', [generate('a', {}), generate('b', {})]).toolWriteCorrect).toBe(false)
    expect(score('T6', [generate('a', {}, refusedBy())]).toolWriteCorrect).toBe(false)
  })
})

describe('打分：T7', () => {
  const revise = call('r', 'draft_shots', { operationId: OP, shots: [{ shotId: 'shot-2', prompt: '橘猫，夜景' }] }, { isError: false })
  const night = { [shotKey(OP, 'shot-2')]: '窗台上的橘猫，夜景，月光' }

  it('先改镜2的提示词、再点名 [镜2]；卡只指着镜2、节点提示词里有「夜」= 写对且成功（英文 night 也算）', () => {
    expect(score('T7', [revise, generate('g', { shotIds: ['shot-2'] })], { card: cardOf(['shot-2']), prompts: night })).toMatchObject({ toolWriteCorrect: true, turnSuccess: true })
    expect(score('T7', [revise, generate('g', { shotIds: ['shot-2'] })], { card: cardOf(['shot-2']), prompts: { [shotKey(OP, 'shot-2')]: 'a cat at Night' } }).turnSuccess).toBe(true)
  })

  it('没改提示词、改的是别的镜、generate 在改之前、没点名 = 写错；节点提示词里没有夜 = 不成功', () => {
    expect(score('T7', [generate('g', { shotIds: ['shot-2'] })], { card: cardOf(['shot-2']), prompts: night }).toolWriteCorrect).toBe(false)
    const wrongShot = call('r', 'draft_shots', { operationId: OP, shots: [{ shotId: 'shot-3', prompt: '夜' }] }, { isError: false })
    expect(score('T7', [wrongShot, generate('g', { shotIds: ['shot-2'] })]).toolWriteCorrect).toBe(false)
    expect(score('T7', [generate('g', { shotIds: ['shot-2'] }), revise]).toolWriteCorrect).toBe(false)
    expect(score('T7', [revise, generate('g', {})]).toolWriteCorrect).toBe(false)
    expect(score('T7', [revise, generate('g', { shotIds: ['shot-2'] })], { card: cardOf(['shot-2']), prompts: { [shotKey(OP, 'shot-2')]: '窗台上的橘猫' } })).toMatchObject({ toolWriteCorrect: true, turnSuccess: false })
    expect(score('T7', [revise, generate('g', { shotIds: ['shot-2'] })], { card: cardOf(['shot-2', 'shot-3']), prompts: night }).turnSuccess).toBe(false)
  })
})

describe('打分：T8（新的一镜通常是另一份草稿里的 shot-1）', () => {
  const draftNew = call('n', 'draft_shots', { shots: [{ title: '结尾', prompt: '灯塔熄灯' }] }, { isError: false })
  const appendRefused = call('a', 'draft_shots', { operationId: OP, shots: [{ title: '结尾', prompt: '灯塔熄灯' }] }, { isError: true, resultText: 'start a new draft without operationId' })
  const newShots = [{ operationId: OTHER_OP, shotId: 'shot-1' }]
  const generateNew = (args) => call('g', GENERATE, { operationId: OTHER_OP, ...args })

  it('补一镜被拒后另起新草稿、点名新镜；卡只指着新那一镜 = 写对且成功（被拒的补镜不扣分）', () => {
    expect(score('T8', [appendRefused, draftNew, generateNew({ shotIds: ['shot-1'] })], { card: cardOf(['shot-1'], OTHER_OP), newShots })).toMatchObject({ toolWriteCorrect: true, turnSuccess: true })
    expect(score('T8', [draftNew, generateNew({ shotIds: ['shot-1'] })], { card: cardOf(['shot-1'], OTHER_OP), newShots }).toolWriteCorrect).toBe(true)
  })

  it('新草稿上不点名也行（它只有这一镜）；在老草稿上不点名 / 点了老草稿的镜 = 写错', () => {
    expect(score('T8', [draftNew, generateNew({})], { card: cardOf(['shot-1'], OTHER_OP), newShots }).toolWriteCorrect).toBe(true)
    expect(score('T8', [draftNew, generate('g', {})], { card: cardOf(['shot-2']), newShots }).toolWriteCorrect).toBe(false)
    expect(score('T8', [draftNew, generate('g', { shotIds: ['shot-3'] })], { card: cardOf(['shot-3']), newShots }).toolWriteCorrect).toBe(false)
  })

  it('补镜成功（老草稿里多一镜）时点名它也对；卡上除了新镜还有别的镜 = 不成功；没有新镜 = 写错', () => {
    const appended = call('p', 'draft_shots', { operationId: OP, shots: [{ title: '结尾', prompt: '灯塔熄灯' }] }, { isError: false })
    const added = [{ operationId: OP, shotId: 'shot-4' }]
    expect(score('T8', [appended, generate('g', { shotIds: ['shot-4'] })], { card: cardOf(['shot-4']), newShots: added })).toMatchObject({ toolWriteCorrect: true, turnSuccess: true })
    expect(score('T8', [appended, generate('g', { shotIds: ['shot-4'] })], { card: cardOf(['shot-2', 'shot-4']), newShots: added }).turnSuccess).toBe(false)
    expect(score('T8', [generate('g', {})], { card: cardOf(['shot-2']), newShots: [] })).toMatchObject({ toolWriteCorrect: false, turnSuccess: false })
  })
})

describe('打分和硬断言互不依赖：T5 点名 [镜1, 镜2, 镜3]', () => {
  it('卡上确实摆了这三镜（说的 = 摆的，硬断言绿），而打分记「工具写错」「回合不成功」', () => {
    const naming = generate('g', { shotIds: ['shot-1', 'shot-2', 'shot-3'] })
    const hard = judgeGenerateCall({ call: naming, outcome: { kind: 'card', ledgerShotIds: ['shot-1', 'shot-2', 'shot-3'], pointerShotIds: ['shot-1', 'shot-2', 'shot-3'], projectionShotIds: ['shot-1', 'shot-2', 'shot-3'] } })
    expect(hard).toEqual([expect.objectContaining({ id: 'named-equals-shown', ok: true })])
    const scored = score('T5', [naming], { card: cardOf(['shot-1', 'shot-2', 'shot-3']) })
    expect(scored).toMatchObject({ toolWriteCorrect: false, turnSuccess: false, route: 'other' })
    expect(scored.why.join(' ')).toContain('shot-1')
  })
})

describe('汇总与量具问题', () => {
  it('summarizeTurns：x/8、y/8，T5 走的路，量具错的回合数', () => {
    const records = TURNS.map((turn, index) => ({ turn: turn.id, harnessError: index === 7 ? 'boom' : null, score: { toolWriteCorrect: index < 6, turnSuccess: index < 5, route: turn.id === 'T5' ? 'refused-then-named' : null } }))
    expect(summarizeTurns(records)).toEqual({ turns: 8, toolWriteCorrect: '6/8', turnSuccess: '5/8', t5Route: 'refused-then-named', harnessErrors: 1 })
    expect(summarizeTurns([{ turn: 'T1', score: undefined }]).toolWriteCorrect).toBe('0/1')
  })

  it('gaugeProblems：量具出错 / 超时 / 面板报错 / 答话的不是被授权的模型都算，模型答错不算', () => {
    expect(gaugeProblems([{ turn: 'T1', harnessError: null, settle: 'card' }], { models: ['apimart/deepseek-v4-pro'], expectedModelKey: 'deepseek-v4-pro' })).toEqual([])
    const problems = gaugeProblems([
      { turn: 'T2', harnessError: 'boom', settle: 'card' }, { turn: 'T3', settle: 'timeout' }, { turn: 'T4', settle: 'error' }, { turn: 'T5', settle: 'intervention' },
    ], { models: ['apimart/deepseek-v4-pro', 'apimart/other'], expectedModelKey: 'deepseek-v4-pro' })
    expect(problems).toHaveLength(5)
    expect(problems.join('\n')).toMatch(/T2 量具出错[\s\S]*T3 超时[\s\S]*T4[\s\S]*T5[\s\S]*apimart\/other/)
  })
})

describe('花钱：对账与花钱前核对', () => {
  const hold = (vendor, receipt = vendor) => ({ seconds: vendor.length, vendor, receipt })

  it('卡上批了几镜 = 收据几笔 = 供应商几个任务 = 任务号几个 = 1，之后一直不涨 = 全绿', () => {
    const checks = judgeSpend({ approved: 1, receiptMedia: 1, vendorTasks: 1, providerTaskIds: ['t-1'], hold: hold([1, 1, 1]) })
    expect(checks.map((entry) => entry.ok)).toEqual([true, true, true, true, true])
  })

  it('任何一边对不上、或等的那段里涨过，对应那条红', () => {
    const red = (overrides) => judgeSpend({ approved: 1, receiptMedia: 1, vendorTasks: 1, providerTaskIds: ['t-1'], hold: hold([1, 1]), ...overrides }).filter((entry) => !entry.ok).map((entry) => entry.id)
    expect(red({ approved: 2 })).toEqual(['spend-card-approved'])
    expect(red({ receiptMedia: 0 })).toEqual(['spend-receipt'])
    expect(red({ vendorTasks: 2 })).toEqual(['spend-vendor-tasks'])
    expect(red({ providerTaskIds: [] })).toEqual(['spend-provider-task-ids'])
    expect(red({ hold: hold([1, 2, 2]) })).toEqual(['spend-hold-stays-flat'])
    expect(red({ hold: hold([]) })).toEqual(['spend-hold-stays-flat'])
  })

  it('网络闸账本里数发往 APIMart 的图片创建请求；记录器没生效（一条放行请求都没有）要说出来', () => {
    const entry = (path, method = 'POST', host = 'api.apimart.ai') => ({ kind: 'allowed-request', host, method, url: `https://${host}${path}` })
    expect(countVendorImageCreates([entry('/v1/chat/completions'), entry('/v1/images/generations'), entry('/v1/images/generations', 'GET'), entry('/v1/images/generations', 'POST', 'evil.example')], { host: 'api.apimart.ai' }))
      .toEqual({ creates: 1, recorderAlive: true })
    expect(countVendorImageCreates([], { host: 'api.apimart.ai' })).toEqual({ creates: 0, recorderAlive: false })
    expect(countVendorImageCreates([{ kind: 'blocked', host: 'api.apimart.ai' }], { host: 'api.apimart.ai' }).recorderAlive).toBe(false)
  })

  it('供应商几个任务 = 记到的创建请求数和供应商给的任务号数取大的：记录器漏记时任务号兜底，多发的创建请求即便被拒也算', () => {
    expect(vendorTaskCount({ wireCreates: 1, providerTaskIds: ['t-1'] })).toBe(1)
    expect(vendorTaskCount({ wireCreates: 0, providerTaskIds: ['t-1'] })).toBe(1)
    expect(vendorTaskCount({ wireCreates: 2, providerTaskIds: ['t-1'] })).toBe(2)
    expect(vendorTaskCount({ wireCreates: 1, providerTaskIds: ['t-1', 't-2'] })).toBe(2)
    expect(vendorTaskCount({ wireCreates: 0, providerTaskIds: [] })).toBe(0)
  })

  it('点那一下之前核对：只许一镜、不许多张出图、只授权 1K', () => {
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], candidateParams: { aspect_ratio: '1:1' }, meta: { resolution: '1K' } })).toEqual([])
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], candidateParams: { resolution: '1k' }, meta: {} })).toEqual([])
    expect(spendGateProblems({ effectiveShotIds: ['shot-1', 'shot-2'] })[0]).toContain('只许一镜')
    expect(spendGateProblems({ effectiveShotIds: [] })[0]).toContain('只许一镜')
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], candidateParams: { n: 4 } })[0]).toContain('n=4')
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], meta: { num_images: 2 } })[0]).toContain('num_images')
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], meta: { resolution: '4K' } })[0]).toContain('只授权 1K')
  })

  it('点那一下之前核对模型：草稿候选和节点上的模型都得是被授权的那个；不给授权就不核', () => {
    const authorized = { vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' }
    const candidate = { providerId: 'apimart', modelId: 'gemini-3.1-flash-image-preview' }
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], candidate, meta: { modelVendor: 'apimart', modelKey: authorized.modelKey }, authorized })).toEqual([])
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], candidate: { providerId: 'apimart', modelId: 'gpt-image-2' }, authorized })[0])
      .toContain('草稿里那一镜的模型是 apimart/gpt-image-2，只授权 apimart/gemini-3.1-flash-image-preview')
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], candidate, meta: { modelVendor: 'apimart', modelKey: 'gpt-image-2' }, authorized })[0]).toContain('节点上那一镜的模型是 apimart/gpt-image-2')
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], candidate: {}, authorized })[0]).toContain('undefined/undefined')
    expect(spendGateProblems({ effectiveShotIds: ['shot-1'], candidate: { providerId: 'x', modelId: 'y' } })).toEqual([])
  })
})

describe('证据落盘前查 key', () => {
  it('key 原串、形如 key 的串都拒；干净的证据放行', () => {
    // key 形状的串在运行时拼出来：源码里不留 sk-… / Bearer … 字面量（提交前的明文凭证扫描只认字面量）。
    const skShaped = ['sk', 'abcdefghijklmnopqrstuvwx'].join('-')
    const bearerShaped = ['Bearer', 'abcdefghijklmnopqrstuvwxyz012345'].join(' ')
    expect(() => assertEvidenceHasNoKey('{"args":{"prompt":"雨后水洼里的红纸船"}}')).not.toThrow()
    expect(() => assertEvidenceHasNoKey('{"x":"rehearsal-fake-key-0123456789abcdef"}', ['rehearsal-fake-key-0123456789abcdef'])).toThrow(/key 原串/)
    expect(() => assertEvidenceHasNoKey(`{"x":"${skShaped}"}`)).toThrow(/形如 key/)
    expect(() => assertEvidenceHasNoKey(`{"x":"${bearerShaped}"}`)).toThrow(/形如 key/)
  })
})
