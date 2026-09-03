// 验证失败 → 说人话的原因 + 该点哪个按钮。
//
// **归类不在这里判**：category 由 vendorHttp 在抛出点查表定好（401/403→auth、402→balance、
// 429→quota、400/422→input、5xx→server），经 verifier → service → meta 一路带过来。
// 这里只做「归类 → 文案 + 动作」的映射。绝不用关键词去猜 error 字符串——那是已经反复漏了
// 5 轮的反模式（见 2026-08-12 `fix(errors): 文本侧错误也在源头留住 category`）。
//
// 唯一例外是 404/405：它们不在 vendorHttp 的查表里（会落 unknown），但恰恰是最常见的一种
// ——地址少写/多写一段。用 httpStatus 数值判定，仍然是确定性的，不是猜措辞。

export type AdapterFailureAction = 'fixUrl' | 'fixKey' | 'retry' | 'selfConnect' | 'topUp'

export type AdapterFailureAdvice = {
  /** i18n key 后缀，落在 onboardingProviders.adapterVerification.why.* */
  reasonKey: string
  /** 主按钮。null = 只解释，不催用户做什么（如「对方服务器故障」，等就行）。 */
  action: AdapterFailureAction | null
}

export type AdapterFailureInput = {
  errorCategory?: string
  httpStatus?: number
  stage?: string
  /** 编译失败的结构化细分原因，主进程带过来（见 onboardingBridgeTypes.DesktopAdapterModeResult）。 */
  compileFailureReason?: string
}

export function adapterFailureAdvice(input: AdapterFailureInput): AdapterFailureAdvice {
  // 「这个 kind 在通用协议上没有标准端点」是编译失败里**性质不同**的一种：不是我们没读懂、
  // 也不是用户填错，而是这条路本来就不通（当前只有 3D）。这时候还说「我们没读懂文档」等于
  // 把用户往「换个地址再试」上引——他该走的是直接脚本 / ComfyUI 工作流那条真的走得通的路。
  // 判据是生产者带来的结构化原因，不是 error 文案里的关键词。
  if (input.compileFailureReason === 'no_generic_contract') {
    return { reasonKey: 'noGenericContract', action: 'selfConnect' }
  }
  // 编译失败 = 我们没读懂这家的文档，跟用户的配置无关 —— 直接给逃生口，别让他改地址瞎试。
  if (input.stage === 'compile' || input.stage === 'docs') {
    return { reasonKey: 'compile', action: 'selfConnect' }
  }
  // 地址类：404/405 不在 category 查表里，但它是最常见的一种，且用状态码判定是确定的。
  if (input.httpStatus === 404 || input.httpStatus === 405) {
    return { reasonKey: 'notFound', action: 'fixUrl' }
  }
  switch (input.errorCategory) {
    case 'auth':
      return { reasonKey: 'auth', action: 'fixKey' }
    case 'balance':
      return { reasonKey: 'balance', action: 'topUp' }
    case 'quota':
      // 限流是暂时的，重验就好；催他改配置反而误导。
      return { reasonKey: 'quota', action: 'retry' }
    case 'input':
      // 参数被拒 = 我们猜的请求形状不合这家口味 —— 用户改地址改密钥都没用，得自己接。
      return { reasonKey: 'input', action: 'selfConnect' }
    case 'server':
      return { reasonKey: 'server', action: 'retry' }
    case 'network':
      return { reasonKey: 'network', action: 'fixUrl' }
    case 'timeout':
      return { reasonKey: 'network', action: 'retry' }
    default:
      // 不认得就**别装懂**：说清「没看懂这个错」，把原文摆出来（UI 侧），给最通用的两条路。
      return { reasonKey: 'unknown', action: 'selfConnect' }
  }
}
