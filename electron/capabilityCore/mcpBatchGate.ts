// 能力核 · 生成前批次确认闸（蓝图 W3 幕 4：把「这一句话要花多少」摊开，点头才跑）。
//
// 为什么必须有（A 路调研：这是「Claude-Code 驱动短剧」同赛道的公认标配）：
//  · 短剧一次跑几十镜、烧的是真额度，业界实测 ~25% 要重滚；
//  · 对话驱动时用户**看不见**「我这一句会花多少」——确认闸把不可见的花费变可见；
//  · 与逐镜确认的区别：**一次问清整批**，而不是每镜打断一次（后者正是用户骂过的「反复确认」）。
//
// 与既有付费闸的分工（P1 不造第二套）：本模块只做**披露与清单**（纯函数）；真正的授权仍走
// 既有主进程收据门 / 会话信任 / spendGrant 硬闸——闸门语义一字不改，这里只是把「要花什么」讲清楚。
//
// 诚实披露三件（D4）：镜数与每镜引用什么、预估额度**含审片与重试**、以及「这笔批准覆盖什么范围」。

/** 批次里的一镜（调用方从画布/分镜表组装，纯数据）。 */
export type BatchShotPlan = {
  /** 镜号（story-order，用户指改的地址：「重滚 #3」）。 */
  index: number
  title: string
  /** 该镜引用的锚名（人话，用户一眼看出「这镜跟谁一致」）。 */
  anchorNames: string[]
  /** image=出图、video=出片（价位差一个量级，要分开报）。 */
  intent: 'image' | 'video'
  model: string
}

export type BatchGateInput = {
  shots: BatchShotPlan[]
  /** 每镜最多几次定向重试（审片不过时）——计入预算披露，不能瞒。 */
  retryBudgetPerShot: number
  /** 判分是否开启（开启则每镜多一次 VLM 判分调用；它走文本路、不吃生成额度，但要说清楚）。 */
  verifyEnabled: boolean
}

export type BatchGateDisclosure = {
  /** 镜数拆分（图/视频分开——价位差一个量级）。 */
  imageCount: number
  videoCount: number
  /** 最坏情况的生成次数（含重试），用于「最多花到哪」的诚实上界。 */
  maxGenerations: number
  /** 逐镜清单行（人话，每行 = 一镜要花的钱花在哪）。 */
  lines: string[]
  /** 一屏摘要（给 elicitation message / 卡片正文）。 */
  message: string
}

/**
 * 组批次披露。**纯函数**——不读目录不算钱（真实单价随 vendor 浮动、我们不谎报金额，
 * 只如实报「几张图/几条视频/最坏跑几次」，让用户按自己的资费心里有数）。
 *
 * 为什么不报具体金额：跨 vendor 单价与计费口径不一（按次/按秒/按分辨率），凑一个看似精确的数字
 * 反而是误导（D4 宁可不给也不给假的）。报「量」是诚实且够用的——用户知道自己的档位。
 */
export function buildBatchDisclosure(input: BatchGateInput): BatchGateDisclosure {
  const shots = input.shots || []
  const imageCount = shots.filter((s) => s.intent === 'image').length
  const videoCount = shots.filter((s) => s.intent === 'video').length
  const retry = Math.max(0, Math.floor(input.retryBudgetPerShot || 0))
  const maxGenerations = shots.length * (1 + retry)
  const lines = shots.map((s) => {
    const refs = s.anchorNames.length ? `参考 ${s.anchorNames.join('、')}` : '无参考（纯文生）'
    return `#${s.index} ${s.title} · ${s.intent === 'video' ? '出片' : '出图'} · ${refs} · ${s.model}`
  })
  const budgetBits = [
    imageCount ? `${imageCount} 张图` : '',
    videoCount ? `${videoCount} 条视频` : '',
  ].filter(Boolean).join(' + ') || '0 项'
  const message = [
    `即将生成 ${budgetBits}，共 ${shots.length} 镜：`,
    ...lines,
    '',
    retry > 0
      ? `预算口径：每镜最多重试 ${retry} 次（审片不过时自动定向重滚）→ **最坏跑 ${maxGenerations} 次**。`
      : `预算口径：不自动重试 → 恰好跑 ${shots.length} 次。`,
    input.verifyEnabled
      ? '每镜附一次自动审片（走文本模型判分，不计生成额度）；判不出的镜别会如实标「无法判定」而非误判。'
      : '本批不跑自动审片。',
    '批准后这一整批直接跑完，中途不再逐镜打断你。',
  ].join('\n')
  return { imageCount, videoCount, maxGenerations, lines, message }
}
