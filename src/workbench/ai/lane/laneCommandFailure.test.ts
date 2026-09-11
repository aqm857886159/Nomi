// 报障现场 + 类边界。
//
// 报障现场（2026-09-11 用户真机截图）：Agent 面板顶部出现一行红色英文原文
// 「The agent is opening a conversation. Try again after it opens.」——那是 laneIpc 里的一句
// 内部不变量断言，经 `result.message` → `new Error(...)` → `friendlyError` 三次转手后成了产品文案。
//
// 类边界：这一族不是「这一句忘了翻译」，是「主进程的任意字符串能不能成为界面文字」。
// 所以断言写成**任意**未分类英文散句都进不了界面，而不是只断言那一句。
import { describe, expect, it, vi } from 'vitest'
import { LaneCommandFailure, laneFailureText } from './laneCommandFailure'
import { LANE_ERROR_CODES, laneErrorI18nKey } from '../../../../electron/shared/agentLane/laneErrorCodes'
import { zhAgentLaneError, enAgentLaneError } from '../../../i18n/locales/agentLaneError'

const key = (k: string) => k

describe('lane failure → 界面文案', () => {
  it('报障现场：正在打开对话时的拒绝，出的是码的文案，不是主进程那句英文', () => {
    const shown = laneFailureText(
      new LaneCommandFailure('agent_lane_opening', 'The agent is opening a conversation. Try again after it opens.'),
      key,
    )
    expect(shown).toBe(laneErrorI18nKey('agent_lane_opening'))
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
      .toBe(laneErrorI18nKey('agent_lane_workspace_stale'))
  })
})
