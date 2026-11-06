// 没有可以再查的任务时（同步供应商：结果只在创建请求的那一次回答里，节点上没有任务号），错误卡上不许出现任何
// 暗示能取回的说明或动作（2026-10-28，设计卡 docs/plan/2026-10-28-sync-landing-not-unknown.md A10）。
//
// 类守门：遍历全部失败类别——将来新加一类，只要它的默认说明 / 动作指向「重新取回」，又没在 narrate 的无任务表里给一版，这里就红。
import { afterAll, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { classifyGenerationError } from './classifyError'
import {
  GENERATION_ERROR_KINDS,
  narrateGenerationError,
  narrateGenerationErrorActions,
  narrateGenerationErrorWithoutTask,
  type GenerationErrorAction,
} from './narrate'
import { generatedMediaValidationError } from '../../../electron/assets/generatedMediaDecode'
import { retrievalStageError } from '../../../electron/tasks/retrievalStageError'
import { describeOutboundRefusal } from '../../../electron/networkOutboundMessage'

afterAll(async () => { await i18n.changeLanguage('zh-CN') })

/** 要有一笔任务才有意义的动作（查看任务 / 去重新取回 / 去任务中心核对 / 核对后重新生成）：没有任务号时一颗都不许出现——
 *  按下去要么按不动，要么把人领去一个什么都做不了的地方。 */
const TASK_BOUND_ACTIONS: readonly GenerationErrorAction[] = ['view-task', 'open-recoverable', 'reconcile', 'release-regenerate']

function retrieveAgainLabels(): string[] {
  return [i18n.t('generationCommon.production.runAction.retry-retrieval'), i18n.t('generationCommon.observability.action.openRecoverable.main')]
}

/** 节点上没有任务号时这一类最终给的说明与动作（与 NodeErrorReport 同一条选法）。 */
function withoutTask(kind: (typeof GENERATION_ERROR_KINDS)[number]) {
  const override = narrateGenerationErrorWithoutTask(kind)
  if (override) return override
  return { hint: narrateGenerationError(kind).hint, ...narrateGenerationErrorActions(kind) }
}

describe('A10：渲染层读落地门抛出的真错误', () => {
  for (const lang of ['zh-CN', 'en'] as const) {
    it(`${lang} · 字节读不出 → output-unreadable：不点名服务商、主动作重试，说明不提重新取回`, async () => {
      await i18n.changeLanguage(lang)
      const report = classifyGenerationError(generatedMediaValidationError('decode_failed').message)
      expect(report.kind).toBe('output-unreadable')
      expect(report.vendorSide).toBe(false)
      expect(report.primary).toBe('retry')
      expect(narrateGenerationErrorWithoutTask('output-unreadable'), '默认就不暗示能取回').toBeNull()
      for (const label of retrieveAgainLabels()) expect(report.hint).not.toContain(label)
    })

    it(`${lang} · 结果下载 403 → retrieval-incomplete；没有任务号时主动作是重试，说明不提重新取回`, async () => {
      await i18n.changeLanguage(lang)
      const report = classifyGenerationError(retrievalStageError('retrieval-download', new Error('Fetch failed: HTTP 403')).message)
      expect(report.kind).toBe('retrieval-incomplete')
      expect(report.vendorSide).toBe(false)
      const shown = withoutTask(report.kind)
      expect(shown.primary).toBe('retry')
      for (const label of retrieveAgainLabels()) expect(shown.hint).not.toContain(label)
    })

    it(`${lang} · 取片被出网策略拦 → outbound-blocked；没有任务号时先去网络那一行、次动作重试，说明不提重新取回`, async () => {
      await i18n.changeLanguage(lang)
      const message = describeOutboundRefusal({ reason: 'private-address', hostname: 'cdn.provider.test', observedAddress: '198.18.0.7', syntheticResolver: false, stage: 'retrieval' })
      const report = classifyGenerationError(message)
      expect(report.kind).toBe('outbound-blocked')
      const shown = withoutTask(report.kind)
      expect([shown.primary, shown.secondary]).toEqual(['open-model-access', 'retry'])
      for (const label of retrieveAgainLabels()) expect(shown.hint).not.toContain(label)
    })
  }
})

describe('类守门：没有任务号时，任何一类都不暗示能取回', () => {
  for (const lang of ['zh-CN', 'en'] as const) {
    it(`${lang} · 全部失败类别`, async () => {
      await i18n.changeLanguage(lang)
      const offenders = GENERATION_ERROR_KINDS
        // 结果不明和本机占用拒绝即使没有服务商任务号也要去本机任务中心；其余类无号不暗示可取回。
        // 结果未知那一类说的就是「可能有一笔」：去任务中心核对是它的本分，不归这条管。
        .filter((kind) => kind !== 'submission-unknown' && kind !== 'local-refusal')
        .filter((kind) => {
          const shown = withoutTask(kind)
          return TASK_BOUND_ACTIONS.includes(shown.primary)
            || (shown.secondary !== null && TASK_BOUND_ACTIONS.includes(shown.secondary))
            || retrieveAgainLabels().some((label) => shown.hint.includes(label))
        })
      expect(offenders).toEqual([])
    })
  }

  it('探针活着：有任务号时（默认）这几类确实指向重新取回——无任务表管的正是它们', async () => {
    await i18n.changeLanguage('zh-CN')
    for (const kind of ['retrieval-incomplete', 'output-retrieval-failed', 'outbound-blocked'] as const) {
      const { hint } = narrateGenerationError(kind)
      expect(retrieveAgainLabels().some((label) => hint.includes(label)), kind).toBe(true)
      expect(narrateGenerationErrorWithoutTask(kind), kind).not.toBeNull()
    }
  })
})
