// 人话翻译层(harness 总方案 §7.2:narrate 穷举注册表)。
// 纪律:进度/错误展示组件**只准经 narrate 取文案**,字面量文案 = review 必拒;
// Record 穷举 → 新增 phase 不补人话直接 typecheck 红(结构性防"底层在动、界面失语")。
// S2 先覆盖生成进度域;错误 hint(classifyGenerationError 七段)按总方案在 S4 迁入。
// 设计系统铁律呼应:No fake progress——没有真实百分比就不给 percent,用"已等 N 秒"说真话。

export type GenerationProgressPhase =
  | 'queued' //      已入队,还没开始
  | 'resolving' //   正在确认模型与参数(catalog 解析)
  | 'requesting' //  正在把任务发给模型(vendor HTTP 出门)
  | 'waiting' //     模型已接单,排队中(拿到 taskId,首个非终态)
  | 'generating' //  模型生成中(轮询进行时)
  | 'still-generating' // 超过常规时长仍在生成(软超时后,后台继续等结果)
  | 'retrying' //    网络波动重试中
  | 'finalizing' //  正在保存结果(本地化/归一)

export type ProgressNarrationContext = {
  elapsedMs?: number
  attempt?: number
  maxAttempts?: number
}

const NARRATE_PROGRESS: Record<GenerationProgressPhase, (ctx: ProgressNarrationContext) => string> = {
  queued: () => '准备生成',
  resolving: () => '正在确认模型与参数',
  requesting: () => '正在把任务发给模型',
  waiting: () => '模型已接单,排队中',
  generating: (ctx) =>
    typeof ctx.elapsedMs === 'number' && ctx.elapsedMs >= 5000
      ? `正在生成,已等 ${Math.round(ctx.elapsedMs / 1000)} 秒`
      : '正在生成',
  // 软超时后:视频较慢仍在跑,后台继续等。说真话(已等 N 分钟),不假装快完成。
  'still-generating': (ctx) =>
    typeof ctx.elapsedMs === 'number'
      ? `仍在生成 · 已超常规时长(已等 ${Math.round(ctx.elapsedMs / 60000)} 分钟)`
      : '仍在生成 · 已超常规时长',
  retrying: (ctx) =>
    ctx.attempt && ctx.maxAttempts ? `网络波动,正在重试(${ctx.attempt}/${ctx.maxAttempts})` : '网络波动,正在重试',
  finalizing: () => '正在保存结果',
}

export function narrateProgress(phase: GenerationProgressPhase, ctx: ProgressNarrationContext = {}): string {
  return NARRATE_PROGRESS[phase](ctx)
}

// ---------------------------------------------------------------------------
// 生成错误词表(S4-2:classifyGenerationError 的唯一文案来源)。
// structured 路径(VendorRequestError.category 查表)与 legacy 正则路径都只产 kind,
// 文案在这一张表里——reason/hint 永不散落第二处(P1)。
// ---------------------------------------------------------------------------

export type GenerationErrorKind =
  | 'auth'
  | 'balance'
  | 'quota'
  | 'poll-timeout'
  | 'network'
  | 'model-config'
  | 'model-not-open'
  | 'account-gate'
  | 'content-policy'
  | 'server'
  | 'input'
  | 'output-truncated'
  | 'unknown'

const NARRATE_ERROR: Record<GenerationErrorKind, { reason: string; hint: string }> = {
  auth: { reason: 'API Key 无效', hint: '请在「模型接入」页检查这个模型的 API Key。' },
  balance: { reason: '余额不足', hint: '服务商账户余额不足，请到服务商充值后重试，或在「模型接入」换一个模型。' },
  quota: { reason: '配额或限流', hint: '服务商配额已用尽或触发限流，请稍后重试，或在「模型接入」换一个模型。' },
  'poll-timeout': { reason: '生成超时', hint: '视频生成较慢，等待超过上限。任务可能仍在进行，请稍后重新生成，或换更快的模型（如 Seedance Fast）。' },
  network: { reason: '网络超时', hint: '网络问题，请检查网络后重试。' },
  'model-config': { reason: '模型未配置', hint: '这个模型没配好，请去「模型接入」页设置。' },
  // 模型已接好但服务商账户没开通该模型(火山方舟最常见,Seedream/Seedance 各自要单独开通)。
  // 这不是 Key/额度问题——上游 404/403 各家不一,但都是「去控制台开通」一个动作能解。
  'model-not-open': {
    reason: '模型未开通',
    hint: '这个模型你的服务商账户还没开通。请到服务商控制台开通它（火山方舟：在 Ark 控制台「开通管理」激活对应模型），或在「模型接入」换一个已开通的模型。',
  },
  // 账号档位闸：模型已接好、参数也对，但服务商按账号档位拒了——即梦需高级会员、RunningHub 标准模型需
  // 企业级共享 Key、即梦部分模型首次需网页端授权。区别于 model-not-open（去控制台开通一个动作）：这类
  // 动作各异（开会员 / 换企业 Key / 网页授权），具体以「服务商原话」为准，故 hint 指向原话 + 给换模型出口。
  'account-gate': {
    reason: '账号权限不足',
    hint: '这个模型需要更高的账号档位才能用——按下方「服务商原话」开通对应会员 / 换企业级 API Key / 先在服务商网页端完成授权；也可在「模型接入」换一个能用的模型。',
  },
  'content-policy': { reason: '提示词被拦截', hint: '提示词触发了安全策略，请修改后重试。' },
  server: { reason: '服务商故障', hint: '服务商服务异常，请稍后重试，或换一个模型。' },
  input: { reason: '参数不被接受', hint: '服务商拒绝了请求参数，请检查比例/尺寸等设置，或换一个模型。' },
  // 输出截断是**确定性**的（这轮要返回的内容超过模型单轮输出上限）——绝不能落 unknown 的
  // 「稍等重试」误导（原样重试必再撞，2026-07-15 拆镜头 Mimo→Deepseek 连撞两次就是这么来的）。
  'output-truncated': {
    reason: '输出超长被截断',
    hint: '这一轮要返回的内容超过了模型的单轮输出上限，原样重试只会再次截断。请缩短这轮任务（如剧本分段拆镜头、减少镜头数），或换单轮输出上限更大的模型。',
  },
  unknown: { reason: '生成失败', hint: '可能是服务商临时故障或额度问题，建议稍等重试，或换一个模型。' },
}

export function narrateGenerationError(kind: GenerationErrorKind): { reason: string; hint: string } {
  return NARRATE_ERROR[kind]
}
