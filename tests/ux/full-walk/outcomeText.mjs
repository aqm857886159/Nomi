// 「查结果」第 1 道：用户看得见的地方（Agent 面板、提示条、状态行、任务卡）不许露出
//   · 服务商原始 JSON 形状；
//   · 内部 id 形状；
//   · 价格 / 预算字样（现在全走中转，价格未知是常态，界面不该出现这些词）。
// 纯函数、无运行时依赖：监视器（现场判）、单测（红 / 零误报）、欠账表（到期红）都读它。
// 用户自己写的内容（[data-user-content] 与 Agent 面板里「用户那一条」[data-v4-block=user]）在取文字时就剔掉，不进这里。

const J = (...parts) => new RegExp(parts.join(''), 'i')

/** 原始 JSON 形状：带引号的键紧跟冒号，或 OpenAI 系错误类型名。一句人话里不会出现 `"code":`。 */
const RAW_JSON = [
  // 花括号 / 方括号后紧跟带引号的键：{"message": … / { "shots": …（服务商回包、工具入参原样摆出来的样子）
  J('[{\\[]\\s*"[\\w$-]+"\\s*:'),
  J('"(?:message|code|type|param)"\\s*:\\s*(?:"|\\d|null)'),
  /invalid_request_error|insufficient_quota|rate_limit_exceeded|authentication_error/,
]

/** 内部 id 形状：供应商路由键、候选 / 操作 / 生成事务 id、分类标记。 */
const INTERNAL_ID = [
  /\b(?:apimart|kie)\/[a-z0-9][\w.-]*/i,
  /\bcand-op-[\w-]+/,
  /\bgen-v2-[\w-]+/,
  /\bop-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\[nomi-classified:/,
]

/** 价格 / 预算字样词表（zh / en 各一份）。词表本身是「检测用的」，不是界面文案；单测拿整本真实词典核对：除例外键外零命中。 */
export const PRICE_WORDING = Object.freeze({
  'zh-CN': ['价格未知', '价未知', '预算已用完', '预算用完', '提额', '提高预算', '额度已用完', '未计费'],
  en: ['price unknown', 'budget ran out', 'budget exhausted', 'raise budget', 'raise the budget', 'out of budget', 'not charged'],
})

/**
 * 「没花钱 / 不计费 / 免费」这一类**断言**（界面不谈钱：只说事实和下一步）。
 * 费用方向的披露同样不进入界面；只有空间、方向、视图或惯用语里的 free、转述上游原文，登记在下面的例外键里。
 * 单测会拿整本中英词典核对，命中必须是例外键。
 */
export const NO_COST_CLAIMS = Object.freeze({
  'zh-CN': /免费|不花钱|没花钱|没有花钱|不花额度|不(?:会)?消耗(?:生成|模型)?额度|无费用|没有费用|不产生费用|不收费|不另外收费|不扣费|没有扣费|没扣费|未扣费|不计费|未计费|不额外(?:花|收)|省额度|重复扣费|再扣一次钱|勿重复付费|勿再次付费|不重付|并计费|会计费|仍会计费/,
  en: /\bfree\b|no charge|not charged|nothing was charged|(?:costs?|cost) nothing|no cost|no extra charge|no (?:generation )?quota\b|no credits\b|save credits|charge[sd]? (?:you )?(?:twice|again)|\bstill bill|\band billing|\bnot billed|nothing was spent|paying again|pay again|\brepay/i,
})

/**
 * 例外键：词表命中但不是 Nomi 对花费的断言。**只有这一份**——
 *   · `check:i18n`（scripts/check-i18n-no-cost-claims.mjs）扫词典时按键豁免；
 *   · 走查监视器看不到键，只看到屏上文字，它用 `compileExemptions(词典)` 按同一批键从词典取值再豁免。
 * NOT_MONEY：转述上游原文（服务商报错 / 账号状态），每条写理由；NON_MONEY_KEYS：free 只表示空间、方向、视图或惯用语。
 */
/** 只有转述上游原文才可登记；每条必须说明它是服务商错误/账号状态，不是 Nomi 的花费判断。 */
export const NOT_MONEY = Object.freeze({
  'generationCommon.error.balance': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.quota': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.balance.reason': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.balance.hint': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.quota.reason': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.error.quota.hint': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.balance': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.quota': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.balance.reason': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.balance.hint': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.quota.reason': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'generationCommon.observability.error.quota.hint': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.adapterVerification.why.balance': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.adapterVerification.why.quota': '转述服务商返回，不是 Nomi 对某一步花费的断言',
  'assetLibrary.pasteLink.errQuota': '转述 TikHub 返回，不是 Nomi 对某一步花费的断言',
  'assetLibrary.pasteLink.errRateLimited': '转述 TikHub 返回，不是 Nomi 对某一步花费的断言',
  'antigravity.errors.quota': '转述 agy 账号状态，不是 Nomi 对某一步花费的断言',
  'antigravity.check.limited': '转述 agy 账号状态，不是 Nomi 对某一步花费的断言',
  'antigravity.notice.limited': '转述 agy 账号状态，不是 Nomi 对某一步花费的断言',
  'antigravity.accountUsage': '转述 agy 账号状态，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.knownVendors.agnes.credentialHint': '服务商账户前置条件与额度由 Agnes 账户决定，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.knownVendors.modelscope.tagline': '服务商账户前置条件与推理额度由 ModelScope/阿里云账户决定，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.knownVendors.modelscope.promoText': '服务商账户前置条件与推理额度由 ModelScope/阿里云账户决定，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.knownVendors.fal.credentialHint': '服务商账户前置条件与模型额度、区域和价格由 fal.ai 账户决定，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.knownVendors.runway.credentialHint': '服务商账户前置条件与 credits 由 Runway 账户决定，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.knownVendors.runninghub.promoText': '服务商账户前置条件与用量、计费由 RunningHub 账户决定，不是 Nomi 对某一步花费的断言',
  'onboardingProviders.knownVendors.replicate.promoText': '服务商账户前置条件与用量、计费由 Replicate 账户决定，不是 Nomi 对某一步花费的断言',
  'knownVendors.agnes.credentialHint': '服务商账户前置条件与额度由 Agnes 账户决定，不是 Nomi 对某一步花费的断言',
  'knownVendors.modelscope.tagline': '服务商账户前置条件与推理额度由 ModelScope/阿里云账户决定，不是 Nomi 对某一步花费的断言',
  'knownVendors.modelscope.promoText': '服务商账户前置条件与推理额度由 ModelScope/阿里云账户决定，不是 Nomi 对某一步花费的断言',
  'knownVendors.fal.credentialHint': '服务商账户前置条件与模型额度、区域和价格由 fal.ai 账户决定，不是 Nomi 对某一步花费的断言',
  'knownVendors.runway.credentialHint': '服务商账户前置条件与 credits 由 Runway 账户决定，不是 Nomi 对某一步花费的断言',
  'knownVendors.runninghub.promoText': '服务商账户前置条件与用量、计费由 RunningHub 账户决定，不是 Nomi 对某一步花费的断言',
  'knownVendors.replicate.promoText': '服务商账户前置条件与用量、计费由 Replicate 账户决定，不是 Nomi 对某一步花费的断言',
})
/** 非金钱同形词：这些 key 的 free 只描述空间、方向、视图或惯用语，不表达费用。 */
export const NON_MONEY_KEYS = Object.freeze([
  'director.aspect.free',
  'taskCenter.exportJob.diskFull',
  'assetLibrary.rejectedNoDiskSpace',
  'assetLibrary.pasteLink.message',
  'settings.ai.tikhub.description',
  'settings.general.diagnostics.contentNotice',
  'director.timeline.screenshotNameFree',
  'director.timeline.toast.noSpace',
  'director.timelineInspector.freeOrientation',
  'director.camera.captureNeedsFree',
  'generationCommon.production.canvasLanding.actionFailure.ledgerWriteFailed',
])

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 例外键在词典里的值 → 屏上文字里要先抹掉的片段（`{{占位}}` 变成任意文字，大小写敏感）。
 * 代价写明：单词值（如画幅 `Free`）抹掉的是屏上每一个大写的独立 `Free`；词典侧有 `check:i18n` 按键把关，监视器这一侧只能按字认。
 */
export function compileExemptions(dictionaries) {
  const keys = [...Object.keys(NOT_MONEY), ...NON_MONEY_KEYS]
  const patterns = []
  for (const dictionary of Object.values(dictionaries ?? {})) {
    for (const key of keys) {
      const value = key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dictionary)
      if (typeof value !== 'string' || !value.trim()) continue
      const body = value.replace(/\*\*/g, '').split(/\{\{\s*[\w]+\s*\}\}/).map(escapeRegExp).join('.+?')
      patterns.push(new RegExp(/^\w/.test(body) ? `\\b${body}` : body, 'g'))
    }
  }
  return patterns
}

/**
 * 在一段用户可见文字里找违例。返回 [{kind, match}]；kind ∈ raw-json | internal-id | price-wording。
 * `exemptions` 来自 `compileExemptions`：只影响价格字样那一类，原始 JSON / 内部 id 照判。
 */
export function findLeaks(text, { exemptions = [] } = {}) {
  const value = String(text ?? '')
  const leaks = []
  for (const pattern of RAW_JSON) {
    const match = pattern.exec(value)
    if (match) { leaks.push({ kind: 'raw-json', match: match[0] }); break }
  }
  for (const pattern of INTERNAL_ID) {
    const match = pattern.exec(value)
    if (match) { leaks.push({ kind: 'internal-id', match: match[0] }); break }
  }
  const priceText = exemptions.reduce((rest, pattern) => rest.replace(pattern, ' '), value)
  const lower = priceText.toLowerCase()
  for (const word of [...PRICE_WORDING['zh-CN'], ...PRICE_WORDING.en]) {
    if (lower.includes(word.toLowerCase())) { leaks.push({ kind: 'price-wording', match: word }); break }
  }
  if (!leaks.some((leak) => leak.kind === 'price-wording')) {
    for (const pattern of Object.values(NO_COST_CLAIMS)) {
      const match = pattern.exec(priceText)
      if (match) { leaks.push({ kind: 'price-wording', match: match[0] }); break }
    }
  }
  return leaks
}

/**
 * 页内取文字（在 page.evaluate 里跑，所以是一个自包含函数）：
 * 返回 [{source, text}]——Agent 面板、提示条、状态行、任务卡里**可见**且**不是用户内容**的文字。
 */
export function collectVisibleTextInPage() {
  const visible = (el) => el.getClientRects().length > 0
  const clean = (el) => {
    const clone = el.cloneNode(true)
    clone.querySelectorAll('[data-user-content], [data-v4-block="user"]').forEach((node) => node.remove())
    return String(clone.innerText ?? clone.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  const picks = [
    ['agent-panel', '[data-agent-resident]'],
    ['toast', '.mantine-Notification-root'],
    ['status', '[role="status"], [role="alert"]'],
    ['task-card', '[data-production-task-card]'],
  ]
  const out = []
  for (const [source, selector] of picks) {
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el) || el.closest('[data-user-content]')) continue
      const text = clean(el)
      if (text) out.push({ source, text })
    }
  }
  return out
}

/** 欠账表：main 上已有的违例，带到期日、绑到会修它的 PR。过期后同一条违例重新算红。 */
export function activeDebt(debts, { rule, kind, text, today }) {
  return (debts ?? []).find((debt) => debt.rule === rule && debt.kind === kind
    && String(today) <= String(debt.until)
    && (!debt.textIncludes || String(text ?? '').includes(debt.textIncludes))) ?? null
}
