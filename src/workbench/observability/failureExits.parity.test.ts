// 五个出口对拍：同一个失败（同一段原文、同一个码）在画布 / 分镜 / 任务中心 / 内置助手 / 外部助手那里
// 被判成什么类别、说什么、能做什么。输入 = 准备报告的全部例子（I1a–I9）+ 三条无理由差异（U1–U3）。
// 有意差异（401 在外部助手原样透传、阶段码优先、无任务取回改重新生成、pi 瞬时改网络、隐私码、语言）
// 也在表里，各自留一行，防止「统一」时被抹平。
//
// 跑法：默认对着同目录 failureExits.parity.golden.json 断言；
// `FAILURE_PARITY_OUT=<文件>` 时把当前结果写到该文件（修前 / 修后对拍、两种没做成的版本的 diff 都用它）。
import { writeFileSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyGenerationError } from './classifyError'
import { generationFailureActions } from './generationFailureActions'
import { storyboardFailureCopy } from '../creation/storyboard/exec/storyboardFailureCopy'
import { providerFailureText } from '../ai/lane/laneCommandFailure'
import { buildToolErrorOutcome } from '../../../electron/capabilityCore/mcpToolErrorResults'
import { tagNomiError } from '../../../electron/shared/nomiErrorCodes'
import { encodeStructuredErrorMessage } from '../../../electron/vendor/vendorHttp'
import i18n from '../../i18n'

type Case = {
  id: string
  /** 画布 / 分镜 / 任务中心 / 内置助手收到的原文（它们只收字符串）。 */
  message: string
  /** 外部助手收到的错误对象；不给 = new Error(message)。 */
  error?: () => unknown
  run?: { id?: string; taskId?: string; productionRunId?: string }
  /** pi 判过「瞬时」（只有内置助手这一路带这个事实）。 */
  transient?: true
}

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code })
const vendorEnvelope = (payload: Record<string, unknown>, tail: string) =>
  encodeStructuredErrorMessage({ vendorKey: 'relay', method: 'POST', url: 'https://relay.example.com/v1/images', ...payload }, tail)

export const CASES: readonly Case[] = [
  { id: 'I1a 401 Unauthorized（外部助手只认确证码：有意）', message: '401 Unauthorized' },
  { id: 'I1b asset-too-large 码', message: tagNomiError('asset-too-large', 'HTTP 413') },
  { id: 'I1c 取回失败（阶段码优先，有任务号）', message: tagNomiError('retrieval-download', 'fetch failed'), run: { id: 'r1', taskId: 't1' } },
  { id: 'I7 同一取回失败，无任务号', message: tagNomiError('retrieval-download', 'fetch failed'), run: { id: 'r1' } },
  {
    id: 'I2 供应商信封 model_not_found',
    message: vendorEnvelope({ httpStatus: 400, upstreamMsg: 'The model x does not exist', upstreamCode: 'model_not_found', category: 'input', retryable: false }, 'Provider request failed (HTTP 400)'),
  },
  { id: 'I3 Mundane malfunction', message: 'Mundane malfunction' },
  { id: 'I4 unknown + pi 瞬时', message: 'upstream hiccup 7731', transient: true },
  { id: 'I5 隐私码 node_not_found（cause 不外露）', message: 'private cause', error: () => withCode('private cause', 'node_not_found') },
  { id: 'I6 human_approval_required', message: 'A main-process receipt is required', error: () => withCode('A main-process receipt is required', 'human_approval_required') },
  { id: 'I8 余额不足中文', message: '您的账户余额不足，请充值。' },
  { id: 'I9 unknown_model_identity', message: 'unknown_model_identity' },
  { id: 'U1 码是别的词的一部分', message: 'not_node_not_found_extra' },
  { id: 'U2 两个码并存（模型码在前）', message: 'unknown_model_identity node_not_found' },
  { id: 'U3a 确证码在字段里、正文是别的话', message: 'still pending', error: () => withCode('still pending', 'asset_not_localized') },
  { id: 'U3b 同一个码塞回正文', message: 'asset_not_localized' },
  { id: 'X1 正文里嵌入的整词码', message: 'generate failed: renderer_or_provider_unknown' },
  { id: 'X2 本机网络话', message: 'ECONNRESET boom' },
  { id: 'X3 端口里的 401（旧案）', message: 'POST http://127.0.0.1:59401/v1/tasks failed: 418 something odd' },
  { id: 'X4 旧项目落盘的本机拒绝串', message: 'node_generation_in_flight: gen-v2-image-mvysub98-2ht3' },
]

async function exitsOf(testCase: Case, language: 'zh-CN' | 'en') {
  await i18n.changeLanguage(language)
  const canvas = classifyGenerationError(testCase.message)
  const task = generationFailureActions(testCase.message, testCase.run)
  const storyboard = storyboardFailureCopy(testCase.message, testCase.run)
  const lane = providerFailureText(testCase.message, (key, options) => String(i18n.t(key as never, options as never)), testCase.transient ? { transient: true } : undefined)
  const external = buildToolErrorOutcome('probe', testCase.error ? testCase.error() : new Error(testCase.message), language).outcome
  return {
    canvas: { kind: canvas.kind, primary: canvas.primary, secondary: canvas.secondary, vendorSide: canvas.vendorSide, reason: canvas.reason, hint: canvas.hint },
    taskCenter: { kind: task.kind, primary: task.primary, secondary: task.secondary, canRetry: task.canRetry, hint: task.hint },
    storyboard,
    builtinAssistant: lane,
    externalAssistant: {
      errorCode: external.errorCode,
      message: external.message,
      recoveryActions: external.recoveryActions,
      nextActions: external.nextActions ?? null,
    },
  }
}

export async function collectExitTable() {
  const table: Record<string, Awaited<ReturnType<typeof exitsOf>>> = {}
  for (const testCase of CASES) table[`${testCase.id} [zh-CN]`] = await exitsOf(testCase, 'zh-CN')
  for (const id of ['I9 unknown_model_identity', 'I3 Mundane malfunction', 'X1 正文里嵌入的整词码']) {
    const testCase = CASES.find((entry) => entry.id === id)!
    table[`${testCase.id} [en]`] = await exitsOf(testCase, 'en')
  }
  await i18n.changeLanguage('zh-CN')
  return table
}

const GOLDEN = new URL('./failureExits.parity.golden.json', import.meta.url)

describe('五个出口对拍', () => {
  it('同一组输入，五个出口的类别 / 公开码 / 原因 / 动作与对拍表一致', async () => {
    const table = await collectExitTable()
    const out = process.env.FAILURE_PARITY_OUT
    if (out) {
      writeFileSync(out, `${JSON.stringify(table, null, 2)}\n`)
      return
    }
    expect(table).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')))
  })
})
