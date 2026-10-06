// 报障现场 + 类边界。
//
// 报障现场（2026-09-11 用户真机截图）：Agent 面板顶部出现一行红色英文原文
// 「The agent is opening a conversation. Try again after it opens.」——那是 laneIpc 里的一句
// 内部不变量断言，经 `result.message` → `new Error(...)` → `friendlyError` 三次转手后成了产品文案。
//
// 类边界：这一族不是「这一句忘了翻译」，是「主进程的任意字符串能不能成为界面文字」。
// 所以断言写成**任意**未分类英文散句都进不了界面，而不是只断言那一句。
import { describe, expect, it, vi } from 'vitest'
import { LaneCommandFailure, laneFailureText, providerFailureText, providerFailureIsUnclassified, takeUnclassifiedProviderFailures, LANE_ERROR_TEXT_KEY } from './laneCommandFailure'
import { classifyGenerationError } from '../../observability/classifyError'
import { leaksInternals } from '../resident/residentToolText'
import { LANE_ERROR_CODES } from '../../../../electron/shared/agentLane/laneErrorCodes'
import { zhAgentLaneError, enAgentLaneError } from '../../../i18n/locales/agentLaneError'
import { zhAgentPanelV4, enAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'

const key = (k: string) => k

describe('lane failure → 界面文案', () => {
  it('报障现场：正在打开对话时的拒绝，出的是码的文案，不是主进程那句英文', () => {
    const shown = laneFailureText(
      new LaneCommandFailure('agent_lane_opening', 'The agent is opening a conversation. Try again after it opens.'),
      key,
    )
    expect(shown).toBe(LANE_ERROR_TEXT_KEY.agent_lane_opening)
    expect(shown).not.toContain('The agent is opening')
  })

  it('类边界：兜底码下任何未分类的英文散句都只进 console，不进界面', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const diagnostic of [
      'No agent conversation is open in this window.',
      'Refusing a symbolic trace directory',
      'Native PDF was not preserved by the provider payload adapter',
      'Unexpected Anthropic SDK endpoint',
      'A prompt command must stay under 131072 bytes',
    ]) {
      const shown = laneFailureText(new LaneCommandFailure('agent_lane_execute_failed', diagnostic), key)
      expect(shown).toBe('agentResident.sendFailed')
      expect(shown).not.toContain(diagnostic)
    }
    expect(spy).toHaveBeenCalledTimes(5)
    spy.mockRestore()
  })

  it('每个码都有话可说，两种语言都不缺', () => {
    for (const code of LANE_ERROR_CODES) {
      expect(zhAgentLaneError[code], code).toBeTruthy()
      expect(enAgentLaneError[code], code).toBeTruthy()
    }
    expect(Object.keys(zhAgentLaneError).sort()).toEqual([...LANE_ERROR_CODES].sort())
  })

  it('供应商必须让用户读到的原话照常露出（D4：缺口明着标，不是一刀切掉）', () => {
    // 中文人话（我们自己已本地化的那一族）仍旧照常印出来。
    const shown = laneFailureText(new LaneCommandFailure('agent_lane_execute_failed', '官方算力限制，请等待一段时间后再进行使用'), key)
    expect(shown).toContain('官方算力限制')
  })

  it('裸 Error 里如果就是一个已登记的码，同样按码取文案', () => {
    expect(laneFailureText(new Error('agent_lane_workspace_stale'), key))
      .toBe(LANE_ERROR_TEXT_KEY.agent_lane_workspace_stale)
  })

  // 这一层是用户看到字之前的最后一道，而它是在 catch 里被调用的：它自己抛，这次失败就连一句
  // 兜底话都没有——用户什么都看不到，比印出英文原文更糟。类型说这几格是 string，但那是我们这侧
  // 的声明：自定义 Error 子类过 IPC 会掉类型，preload 与渲染层版本不齐时就可能是 undefined。
  // 故断言「不管塞进来什么，都得吐出一句话」，而不是只断言好数据那条路。
  it.each([
    ['diagnostic 是 undefined', new LaneCommandFailure('agent_lane_execute_failed', undefined as unknown as string)],
    ['diagnostic 是对象', new LaneCommandFailure('agent_lane_execute_failed', { toString: null } as unknown as string)],
    ['laneCode 不在码表里', new LaneCommandFailure('not_a_registered_code' as never, 'boom')],
    ['message 是 undefined 的裸 Error', Object.assign(new Error(), { message: undefined as unknown as string })],
  ])('%s 也不许把这一层自己抛掉', (_label, thrown) => {
    let shown = ''
    expect(() => { shown = laneFailureText(thrown, key) }).not.toThrow()
    expect(shown).toBeTruthy()
    expect(shown).not.toContain('undefined')
  })
})

describe('服务商报文 → 面板红字（原始 JSON / 分类标记不进界面）', () => {
  it('reported case: 整段 JSON 报错 + 分类标记，出的是人话，不含 JSON 与标记', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = '{"error":{"code":"model_not_found","message":"The model apimart/gpt-image-1 does not exist","type":"invalid_request_error"}} [nomi-classified: server error]'
    const shown = providerFailureText(raw, key)
    expect(shown).toBe('agentResident.providerUnknownError')
    expect(leaksInternals(shown)).toBe(false)
    // 日志不在纯文案函数里记（见 takeUnclassifiedProviderFailures）；这条原文必须被判成「认不出」，effect 才会记它。
    expect(providerFailureIsUnclassified(raw)).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('class: 带汉字的原始 JSON 也不算人话', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const raw of ['{"code":1,"msg":"系统异常，请稍后"}', '[{"错误":"x","code":7}]', `op-4f2a9c1e-7b3d-4e8a-9c21-0d5e6f7a8b9c 失败了`]) {
      expect(providerFailureText(raw, key), raw).toBe('agentResident.providerUnknownError')
      expect(laneFailureText(new LaneCommandFailure('agent_lane_execute_failed', raw), key), raw).toBe('agentResident.sendFailed')
    }
    spy.mockRestore()
  })

  it('认得出的分类仍给人话，且分类标记被剥掉', () => {
    const shown = providerFailureText('账户余额不足，请充值 [nomi-classified: insufficient_quota]', (k) => k)
    expect(shown).not.toContain('nomi-classified')
    expect(shown).not.toContain('agentResident.providerUnknownError')
  })

  it('两种语言都有「没见过的错误」那句', async () => {
    const { zhAgentResident, enAgentResident } = await import('../../../i18n/locales/agentResident') as Record<string, Record<string, string>>
    expect(zhAgentResident?.providerUnknownError ?? '').toBeTruthy()
    expect(enAgentResident?.providerUnknownError ?? '').toBeTruthy()
  })
})

describe('服务商报文：断线 / 超时归网络类，不再说「认不出」', () => {
  it.each(['Connection error.', 'Request timed out.', 'other side closed', 'terminated'])('%s → 网络类（嗅探兜底词）', (raw) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(providerFailureText(raw, key)).not.toBe('agentResident.providerUnknownError')
    expect(providerFailureIsUnclassified(raw)).toBe(false)
    spy.mockRestore()
  })

  it('pi 判了瞬时、关键词表又不认的原话 → 照样归网络类（主判据在 pi）', () => {
    const raw = 'upstream hiccup 7731'
    expect(providerFailureText(raw, key)).toBe('agentResident.providerUnknownError')
    expect(providerFailureText(raw, key, { transient: true })).not.toBe('agentResident.providerUnknownError')
  })

  it('投影重算 10 次，纯文案函数一次日志都不记（日志只在 effect 里按条目记）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < 10; i++) providerFailureText('totally unknown gibberish xyz', key)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('同一份投影重算 10 次，同一条错误只产出 1 条要记的日志；已化解的不记', () => {
    const seen = new Set<string>()
    const items = [
      { kind: 'error', identity: 'e1:0', raw: 'totally unknown gibberish xyz' },
      { kind: 'error', identity: 'e2:0', raw: 'also gibberish qqq', recovered: true as const },
      { kind: 'error', identity: 'e3:0', raw: 'Connection error.' },
    ]
    const logged: string[] = []
    for (let i = 0; i < 10; i++) logged.push(...takeUnclassifiedProviderFailures(items, seen))
    expect(logged).toEqual(['totally unknown gibberish xyz'])
  })

  it('原因 + 服务商原话的拼法走 i18n：en 半角冒号加空格，zh 全角冒号', () => {
    const translate = (table: Record<string, string>): ((k: string, o?: Record<string, unknown>) => string) => (k, o) =>
      (table[k.replace('agentPanelV4.', '')] ?? k).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(o?.[name] ?? ''))
    const en = providerFailureText('Connection error.', translate(enAgentPanelV4 as unknown as Record<string, string>))
    expect(en).toMatch(/: Connection error\.$/)
    expect(en).not.toContain('：')
    const zh = providerFailureText('Connection error.', translate(zhAgentPanelV4 as unknown as Record<string, string>))
    expect(zh).toMatch(/：Connection error\.$/)
  })

  it('共享嗅探表的「terminated」只认整串：账号被终止 / 策略终止 / 用户终止不会被说成连不上服务商', () => {
    for (const raw of ['Content generation terminated due to policy violation', 'Your account has been terminated', 'Process terminated by user']) {
      expect(classifyGenerationError(raw).kind, raw).not.toBe('network')
    }
    expect(classifyGenerationError('terminated').kind).toBe('network')
  })
})
