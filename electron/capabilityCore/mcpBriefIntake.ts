// 能力核 · 开场收敛（蓝图 W3 幕 0：一屏 ≤3 题把创作方向定住，之后全程不再问方向）。
//
// 为什么是「≤3 题、一屏问全、永远能一键放行」（C 路调研的跨产品共识）：
//  · 业界只有两派——「一轮问全 ≤3 题」（ChatGPT）或「不问、改用可编辑草案」（Gemini/LTX）；
//    **没有产品做逐条追问**，超过 3 题就是 interrogation，正是用户骂过的「反复确认」观感来源；
//  · 跳过必须永远安全 = 用系统默认继续（所有被调研产品的跳过路径都这样）；
//  · 但方向问太少 → 初稿方向错、十几个镜头全废。故「问一次、问对、之后闭嘴」。
//
// 三题从哪来（derive 不 hardcode 死）：题面与候选**随片型给**（brief 里的 kind），但**题数硬上限 3**。
// 本模块是纯函数：组题 / 解析回答 / 合成方向摘要，零 electron 依赖，可裸测。真正弹表单的副作用在
// mcpProtocol 的薄接线（同 mcpPlanTrust 的纯核+接线分工）。

/** 一道收敛题：enum 候选 + 人话候选名（MCP elicitation 的 enum/enumNames 直接吃这两个数组）。 */
export type IntakeQuestion = {
  key: string
  /** 题面（人话，一行）。 */
  label: string
  /** 机器值。 */
  options: string[]
  /** 人话候选名（与 options 同序）。 */
  optionLabels: string[]
  /** 用户不选时的系统默认（跳过永远安全 = 用它继续）。 */
  fallback: string
}

/** 收敛上限——**硬上限，不许加题**。跨源共识：>3 题即审讯感（C 路调研 §1.2）。 */
export const INTAKE_MAX_QUESTIONS = 3

/** 「按你判断」的机器值：用户选它 = 全部走 fallback，等价于跳过。 */
export const INTAKE_DEFER = '__defer__'

/**
 * 按片型组三题。**题数恒 ≤ INTAKE_MAX_QUESTIONS**（本函数自己截断，调用方不必再判）。
 *
 * 为什么这三个维度：基调/画幅/风格是「错了下游全废」的三件事（错向代价高、确认成本低——正是
 * 08-11 研究的设门公式）。时长、镜头数这类可事后改的，**不设门**（agent 自己定，用户不满意一句话改）。
 */
export function buildIntakeQuestions(input: { kind?: string } = {}): IntakeQuestion[] {
  const kind = String(input.kind || '').toLowerCase()
  const tone = kind.includes('promo') || kind.includes('宣传')
    ? { options: ['warm', 'crisp', 'premium'], optionLabels: ['温暖亲和', '干净利落', '高级质感'], fallback: 'crisp' }
    : { options: ['grounded', 'noir', 'playful'], optionLabels: ['写实冷峻', '悬疑黑色', '轻松幽默'], fallback: 'grounded' }
  return [
    { key: 'tone', label: '整体基调', ...tone },
    {
      key: 'aspect',
      label: '画幅',
      options: ['9:16', '16:9', '1:1'],
      optionLabels: ['竖屏 9:16（短视频）', '横屏 16:9（长视频）', '方形 1:1'],
      fallback: '9:16',
    },
    {
      key: 'look',
      label: '画面风格',
      options: ['photoreal', 'stylized'],
      optionLabels: ['真人写实', '风格化/插画'],
      fallback: 'photoreal',
    },
  ].slice(0, INTAKE_MAX_QUESTIONS)
}

/** elicitation requestedSchema（enum + enumNames，客户端渲染成候选按钮）。每题都可留空 → 走 fallback。 */
export function buildIntakeSchema(questions: IntakeQuestion[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const q of questions) {
    properties[q.key] = {
      type: 'string',
      title: q.label,
      // 「按你判断」永远在候选里 —— 跳过必须安全且**显式可点**，不逼用户猜怎么跳过。
      enum: [...q.options, INTAKE_DEFER],
      enumNames: [...q.optionLabels, '按你判断'],
      description: `不选=按你判断（用「${q.optionLabels[q.options.indexOf(q.fallback)] || q.fallback}」继续）`,
    }
  }
  // required 为空：**任何一题都能留空**（跳过永远安全，C §1.2 铁律）。
  return { type: 'object', properties }
}

/** 一屏问全的提示文案（人话，讲清「只问这一次」——这是打消「又要被反复问」焦虑的关键一句）。 */
export function buildIntakeMessage(questions: IntakeQuestion[]): string {
  return [
    '开拍前把方向定了，**只问这一次**：',
    ...questions.map((q) => `· ${q.label}：${q.optionLabels.join(' / ')}`),
    '（每题都可以留空或选「按你判断」，我按默认继续。）',
  ].join('\n')
}

export type IntakeDecision = {
  /** key → 最终取值（含 fallback 填充后的）。 */
  values: Record<string, string>
  /** 用户真正表过态的题数（选了具体候选，不含 defer/留空）——用于诚实回执。 */
  answered: number
  /** 有没有走默认（有则回执里说明按什么默认继续）。 */
  usedDefaults: string[]
}

/**
 * 解析用户回答：留空 / 选了「按你判断」/ 给了非法值 → 一律回落 fallback（**跳过永远安全**）。
 * 纯函数，容错到底——收敛这一步绝不能因为答得不规整就报错拦住用户。
 */
export function resolveIntake(questions: IntakeQuestion[], answers: Record<string, unknown> | null | undefined): IntakeDecision {
  const raw = answers && typeof answers === 'object' ? answers as Record<string, unknown> : {}
  const values: Record<string, string> = {}
  const usedDefaults: string[] = []
  let answered = 0
  for (const q of questions) {
    const got = typeof raw[q.key] === 'string' ? String(raw[q.key]).trim() : ''
    if (got && got !== INTAKE_DEFER && q.options.includes(got)) {
      values[q.key] = got
      answered += 1
    } else {
      values[q.key] = q.fallback
      usedDefaults.push(q.label)
    }
  }
  return { values, answered, usedDefaults }
}

/** 方向摘要（回执 + 后续 prompt 的方向前缀）。诚实标注哪几项走了默认（D4：缺口明着标）。 */
export function summarizeIntake(questions: IntakeQuestion[], decision: IntakeDecision): string {
  const parts = questions.map((q) => {
    const value = decision.values[q.key]
    const label = q.optionLabels[q.options.indexOf(value)] || value
    return `${q.label}=${label}`
  })
  const tail = decision.usedDefaults.length ? `（${decision.usedDefaults.join('、')} 按默认）` : ''
  return `方向已定：${parts.join(' · ')}${tail}`
}
