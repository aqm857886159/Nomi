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

/** 价格 / 预算字样词表（zh / en 各一份）。词表本身是「检测用的」，不是界面文案；单测会对着真实词典核对它没漏。 */
export const PRICE_WORDING = Object.freeze({
  'zh-CN': ['价格未知', '价未知', '预算已用完', '预算用完', '提额', '提高预算', '额度已用完', '未计费'],
  en: ['price unknown', 'budget ran out', 'budget exhausted', 'raise budget', 'raise the budget', 'out of budget', 'not charged'],
})

/**
 * 「没花钱 / 不计费 / 免费」这一类**断言**（界面不谈钱：只说事实和下一步）。
 * 费用方向的披露同样不进入界面；只有空间、方向、视图或惯用语里的 free 由门岗按 key 排除。
 * 单测会拿整本中英词典核对，命中必须是明确的非金钱 key 或有理由的上游原文。
 */
export const NO_COST_CLAIMS = Object.freeze({
  'zh-CN': /免费|不花钱|没花钱|没有花钱|不花额度|不(?:会)?消耗(?:生成|模型)?额度|无费用|没有费用|不产生费用|不收费|不另外收费|不扣费|没有扣费|没扣费|未扣费|不计费|未计费|不额外(?:花|收)|省额度|重复扣费|再扣一次钱|勿重复付费|勿再次付费|不重付|并计费|会计费|仍会计费/,
  en: /\bfree\b|no charge|not charged|nothing was charged|(?:costs?|cost) nothing|no cost|no extra charge|no (?:generation )?quota\b|no credits\b|save credits|charge[sd]? (?:you )?(?:twice|again)|\bstill bill|\band billing|\bnot billed|nothing was spent|paying again|pay again|\brepay/i,
})

/** 在一段用户可见文字里找违例。返回 [{kind, match}]；kind ∈ raw-json | internal-id | price-wording。 */
export function findLeaks(text) {
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
  const lower = value.toLowerCase()
  for (const word of [...PRICE_WORDING['zh-CN'], ...PRICE_WORDING.en]) {
    if (lower.includes(word.toLowerCase())) { leaks.push({ kind: 'price-wording', match: word }); break }
  }
  if (!leaks.some((leak) => leak.kind === 'price-wording')) {
    for (const pattern of Object.values(NO_COST_CLAIMS)) {
      const match = pattern.exec(value)
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
