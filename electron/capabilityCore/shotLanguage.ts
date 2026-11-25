// 能力核 · 镜头语言纯核（蓝图 W4：把「凭方法论自觉」变成「字段 + 可校验」）。
//
// 背景（盘点 D#3/D#5）：镜头语言（景别/机位/运镜）今天全塞在 shot.prompt 自由文本里，靠规划师读
// director-* 方法论自觉写好；提示词优化器更是纯自由文本改写，**不读任何铁律、无校验**。方法论写得再好，
// 没有校验就只是建议——B 路调研的定理是「schema 是入场券」，这份纯核就是把入场券做出来。
//
// 两件事，共用一份词表（P1 单一真相源：校验器与提示都读同一张表，不各写各的）：
//  ① variationType：镜头内变化幅度（large/medium/small）——**审片与生成策略的路由键**（ViMax 实证：
//     它决定该镜用什么生成策略、该按什么标准审。large 镜重点审转场/几何崩塌，small 镜重点审身份/表情）；
//  ② 污染词校验：模型看到某个词就脑补整套刻板印象、**即使被否定也不例外**（写「不戴护士帽」照样进医院）。
//     故运动描述里命中污染词 → 报出来 + 给替换建议，而不是让它静默毁掉一镜。
//
// 纯函数、零 import，可裸 node 单测。词表源自 skills/director-shot-translation/SKILL.md 的「污染词铁律」
// 与「抽象动作→视觉元素」两张表——**那份 SKILL 是人读的方法论，这里是机器执行的同一套规则**。

/** 镜头内变化幅度。ViMax `variation_type`：决定生成策略与审片侧重的路由键。 */
type VariationType = 'large' | 'medium' | 'small'

/** 各档的判定说明（给规划师 prompt 与人读，措辞对齐 ViMax 原文语义）。 */
export const VARIATION_TYPE_GUIDE: Record<VariationType, string> = {
  large: '构图与焦点剧变（远景平滑推到特写、航拍掠过城市），通常伴大幅运镜',
  medium: '新角色进入，或角色从背面转到正面（面向镜头）',
  small: '微变——表情变化、既有角色的走/坐/站、中等运镜（pan/tilt/track）',
}

/**
 * 审片侧重（W1 审片环的路由）：large 镜先看「有没有崩/接不接得上」，small 镜先看「还是不是同一个人」。
 * 返回该档最该盯的轴名（与 SHOT_VERIFY_DIMENSIONS 的 key 同名，供编排层排序/加权，不改判分本身）。
 */
export function verifyFocusForVariation(type: VariationType): Array<'identity' | 'composition' | 'continuity'> {
  switch (type) {
    case 'large':
      return ['continuity', 'composition', 'identity'] // 剧变镜：先问接不接得上、构图对不对
    case 'medium':
      return ['identity', 'composition', 'continuity'] // 有人进出场：先问是不是那个人
    case 'small':
    default:
      return ['identity', 'continuity', 'composition'] // 微变镜：身份最容易在细节上崩
  }
}

/** 一条污染词规则：命中什么、为什么坏、改成什么。 */
type PollutionRule = {
  /** 命中词（简体中文原词；匹配用「包含」，中文无词边界）。 */
  words: string[]
  /** 模型会脑补出的坑（给人看的理由——不解释为什么，用户只会觉得我们在挑刺）。 */
  trap: string
  /** 该改成什么（可直接抄进 prompt 的方向）。 */
  fix: string
}

/**
 * 污染词表。**与 skills/director-shot-translation/SKILL.md 的「污染词铁律」同源**——
 * 那份是人读的方法论，这份是机器执行的同一套规则；改一处必改另一处（这份是校验器的唯一依据）。
 */
export const POLLUTION_RULES: readonly PollutionRule[] = [
  {
    words: ['意识', '记忆', '命运', '灵魂', '思绪'],
    trap: '抽象概念 → 模型画大脑发光、神经元放电',
    fix: '换成具体物理表现（瞳孔收缩 / 手指无意识抽搐 / 屏幕波形变化）',
  },
  {
    words: ['望向', '注视', '凝视', '看向', '回眸'],
    trap: '视线类抽象动作 → 模型强行出正脸（眼睛必须可见），把你要的背影/侧身毁掉',
    fix: '拆成「身体朝向 + 视线所及物体的具体描述」（如：背对镜头站立，画面右侧出现那扇亮着的窗）',
  },
  {
    words: ['打游戏', '驾驶', '战斗', '瞄准', '办公', '做饭'],
    trap: '事件名 → 好莱坞刻板造型',
    fix: '拆成具体动作/姿态 + 操作的物体（如：双手握住方向盘，拇指敲击盘缘）',
  },
  {
    words: ['深空', '太空'],
    trap: '→ 彩色星云壁纸风',
    fix: '漆黑背景，冷白针点恒星，无星云无彩色天体，纯粹黑暗',
  },
  {
    // 2026-08-20 L3-F1 实测：锚提示词只写了「便利店工装制服」，模型在工牌上自己画出了 7-Eleven
    // 的真实商标，并沿着参考图一路带进后面每一镜（3 处）。不是崩坏，但要交付的成片带着别人的商标。
    words: ['便利店', '快餐店', '球鞋', '运动鞋', '快递', '咖啡店'],
    trap: '真实商业场所/商品 → 模型自动补上真实品牌商标（实测：「便利店工装」出了 7-Eleven 工牌），成片带着别人的商标',
    fix: '补一句「无任何品牌标识、无文字商标、logo 处留白或用虚构标识」；要真实感就描述形制（如：藏青色短袖工装，胸前挂无字工牌）',
  },
]

type PollutionHit = { word: string; trap: string; fix: string }

/** 查一段运动/动作描述里的污染词。纯函数——只报告不改写（改写权归模型与用户，我们只负责「别让它静默毁片」）。 */
export function findPollutionWords(text: string): PollutionHit[] {
  const s = String(text || '')
  const hits: PollutionHit[] = []
  for (const rule of POLLUTION_RULES) {
    for (const word of rule.words) {
      if (s.includes(word)) hits.push({ word, trap: rule.trap, fix: rule.fix })
    }
  }
  return hits
}

/**
 * 运动描述里**不该出现角色名**（ViMax 实证 + director-shot-translation 同理）：T2V/I2V 认不出专有名词，
 * 「小周抬头」对模型等于「某个不认识的词 抬头」——应改用外貌特征指代（「短发圆脸的女性抬头」）。
 *
 * 纯函数：调用方把该镜引用的锚名传进来（我们不猜谁是角色名，只查「你自己声明的锚名有没有漏进运动描述」）。
 */
export function findCharacterNamesInMotion(motionText: string, characterNames: string[]): string[] {
  const s = String(motionText || '')
  return characterNames
    .map((n) => String(n || '').trim())
    .filter((n) => n.length > 0 && s.includes(n))
}

type ShotLanguageIssue = { kind: 'pollution' | 'character-name-in-motion'; detail: string; fix: string }

/**
 * 一镜的镜头语言体检（供规划师产出后自检 / 优化器改写后回归 / 交付前提示）。
 * **只报告不阻断**——与审片环同一哲学：这是增益不是关卡，用户想那么写就那么写，但得知道代价。
 */
export function checkShotLanguage(input: {
  motionText: string
  characterNames?: string[]
}): ShotLanguageIssue[] {
  const issues: ShotLanguageIssue[] = []
  for (const hit of findPollutionWords(input.motionText)) {
    issues.push({ kind: 'pollution', detail: `「${hit.word}」：${hit.trap}`, fix: hit.fix })
  }
  for (const name of findCharacterNamesInMotion(input.motionText, input.characterNames || [])) {
    issues.push({
      kind: 'character-name-in-motion',
      detail: `运动描述里出现角色名「${name}」——视频模型认不出专有名词`,
      fix: `改用外貌特征指代（如「短发圆脸的女性」），角色身份靠参考图锚定而不是靠名字`,
    })
  }
  return issues
}
