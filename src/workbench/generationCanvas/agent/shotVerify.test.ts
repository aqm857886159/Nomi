import { describe, it, expect } from 'vitest'
import {
  SHOT_VERIFY_DIMENSIONS,
  SHOT_VERIFY_NOT_ASSESSABLE,
  SHOT_VERIFY_PASS_THRESHOLD,
  activeDimensions,
  buildShotVerifyPrompt,
  parseShotVerifyVerdict,
  deviationsFromVerdict,
  contentDeviationsToReconcile,
  normalizeShotScore,
  type ShotVerifyContext,
} from './shotVerify'

const baseCtx = (over: Partial<ShotVerifyContext> = {}): ShotVerifyContext => ({
  shotNodeId: 'shot-5',
  shotTitle: '主角特写',
  shotPrompt: '林小满走进咖啡馆，中景',
  anchorDescriptions: ['林小满：黑长直、圆脸、白衬衫'],
  ...over,
})

describe('activeDimensions', () => {
  it('首镜(无前一镜)不评 continuity', () => {
    const keys = activeDimensions(baseCtx()).map((d) => d.key)
    expect(keys).toEqual(['identity', 'composition'])
    expect(keys).not.toContain('continuity')
  })

  it('有前一镜时三轴全评', () => {
    const keys = activeDimensions(baseCtx({ previousShotPrompt: '空镜：咖啡馆门口，白天' })).map((d) => d.key)
    expect(keys).toEqual(['identity', 'composition', 'continuity'])
  })

  it('前一镜为空白串等同无前一镜', () => {
    const keys = activeDimensions(baseCtx({ previousShotPrompt: '   ' })).map((d) => d.key)
    expect(keys).not.toContain('continuity')
  })
})

describe('buildShotVerifyPrompt', () => {
  it('首镜 prompt 显式声明不要评 continuity、且不含 continuity 键', () => {
    const p = buildShotVerifyPrompt(baseCtx())
    expect(p).toContain('不要评 continuity')
    expect(p).toContain('"identity"')
    expect(p).toContain('"composition"')
    expect(p).not.toContain('"continuity"')
  })

  it('带锚描述与前一镜时，对照基准与连贯对照都进 prompt', () => {
    const p = buildShotVerifyPrompt(baseCtx({ previousShotPrompt: '空镜：门口，白天' }))
    expect(p).toContain('林小满：黑长直')
    expect(p).toContain('上一镜意图')
    expect(p).toContain('"continuity"')
  })

  it('无锚时给出兜底说明（按提示词主体判断）', () => {
    const p = buildShotVerifyPrompt(baseCtx({ anchorDescriptions: [] }))
    expect(p).toContain('未声明设定锚')
  })
})

describe('parseShotVerifyVerdict', () => {
  it('解析裸 JSON', () => {
    const v = parseShotVerifyVerdict('{"reason":"脸对不上","scores":{"identity":1,"composition":4,"continuity":3}}')
    expect(v.scores.identity).toBe(1)
    expect(v.scores.composition).toBe(4)
    expect(v.reason).toBe('脸对不上')
  })

  it('剥 ```json 围栏 + 前后说明文字', () => {
    const v = parseShotVerifyVerdict('好的，结论如下：\n```json\n{"reason":"ok","scores":{"identity":5,"composition":5}}\n```\n')
    expect(v.scores.identity).toBe(5)
    expect(v.scores.continuity).toBe(1) // 缺省维度兜底为最低档(由调用方按 active 过滤)
  })

  it('夹取 1-5 并四舍五入；超上界落 5、负数与非数值落 1', () => {
    const v = parseShotVerifyVerdict('{"scores":{"identity":9,"composition":-3,"continuity":"x"}}')
    expect(v.scores.identity).toBe(5)
    expect(v.scores.composition).toBe(1) // 负数仍按最保守的 1（判不出别放行）
    expect(v.scores.continuity).toBe(1)
  })

  it('0 是「无法判定」哨兵，原样保留——不再被夹成 1（L3 实测：把「看不到」当「不像」会误报+白重试）', () => {
    const v = parseShotVerifyVerdict('{"scores":{"identity":0,"composition":4,"continuity":5}}')
    expect(v.scores.identity).toBe(SHOT_VERIFY_NOT_ASSESSABLE)
    expect(v.scores.composition).toBe(4) // 其余轴照旧
  })

  it('容忍尾逗号畸形', () => {
    const v = parseShotVerifyVerdict('{"reason":"y","scores":{"identity":2,},}')
    expect(v.scores.identity).toBe(2)
  })

  it('彻底非 JSON → 冒泡 error（不静默当通过）', () => {
    expect(() => parseShotVerifyVerdict('模型挂了，没有结构化输出')).toThrow()
  })
})

describe('deviationsFromVerdict', () => {
  it('只报低于阈值且本次该评的轴', () => {
    const ctx = baseCtx({ previousShotPrompt: '空镜，白天' })
    const devs = deviationsFromVerdict(ctx, { scores: { identity: 1, composition: 5, continuity: 2 }, reason: '脸不对、夜里了' })
    const dims = devs.map((d) => d.dimension)
    expect(dims).toContain('identity')
    expect(dims).toContain('continuity')
    expect(dims).not.toContain('composition') // 5 ≥ 阈值
    expect(devs[0].shotNodeId).toBe('shot-5')
    expect(devs[0].shotTitle).toBe('主角特写')
  })

  it('首镜即便 continuity 给了低分也不报（不该评的轴被过滤）', () => {
    const devs = deviationsFromVerdict(baseCtx(), { scores: { identity: 4, composition: 4, continuity: 1 }, reason: '' })
    expect(devs).toEqual([])
  })

  it('全部达标 → 零偏差', () => {
    const devs = deviationsFromVerdict(baseCtx({ previousShotPrompt: 'x' }), {
      scores: { identity: 5, composition: 3, continuity: 4 },
      reason: 'all good',
    })
    expect(devs).toEqual([])
  })

  it('reason 为空时给出兜底人话', () => {
    const devs = deviationsFromVerdict(baseCtx(), { scores: { identity: 1, composition: 5, continuity: 5 }, reason: '' })
    expect(devs[0].reason).toContain('身份')
    expect(devs[0].reason).toContain('第 1 档')
  })
})

describe('contentDeviationsToReconcile', () => {
  it('映射成 kind:content 的对账偏差，带 shotNodeId、人话进 reason', () => {
    const ctx = baseCtx({ previousShotPrompt: 'x' })
    const content = deviationsFromVerdict(ctx, { scores: { identity: 1, composition: 5, continuity: 5 }, reason: '脸对不上' })
    const recon = contentDeviationsToReconcile(content)
    expect(recon).toHaveLength(1)
    expect(recon[0].kind).toBe('content')
    expect(recon[0].where).toBe('主角特写')
    expect(recon[0].field).toBe('身份')
    expect(recon[0].shotNodeId).toBe('shot-5')
    expect(recon[0].reason).toBe('脸对不上')
  })

  it('空输入 → 空数组', () => {
    expect(contentDeviationsToReconcile([])).toEqual([])
  })
})

describe('normalizeShotScore + 常量', () => {
  it('1→0 / 3→0.5 / 5→1', () => {
    expect(normalizeShotScore(1)).toBe(0)
    expect(normalizeShotScore(3)).toBe(0.5)
    expect(normalizeShotScore(5)).toBe(1)
  })

  it('阈值与三轴定义稳定', () => {
    expect(SHOT_VERIFY_PASS_THRESHOLD).toBe(3)
    expect(SHOT_VERIFY_DIMENSIONS.map((d) => d.key)).toEqual(['identity', 'composition', 'continuity'])
  })
})

// 判官 reason 的语言闸(R15):英文界面下,对账卡上那句理由不能是中文。
// rubric 本身保持中文——它是调过的提示词工程,翻译它等于换一套判官行为;只把「reason 用什么语言写」切掉。
describe('buildShotVerifyPrompt — reason 语言', () => {
  it('英文界面追加「reason 用英文写」的指令', () => {
    const p = buildShotVerifyPrompt(baseCtx({ reasonLanguage: 'en' }))
    expect(p).toContain('reason 必须用**英文**写')
  })

  it('中文界面不追加,且与不传该字段逐字节相同', () => {
    const omitted = buildShotVerifyPrompt(baseCtx())
    const explicit = buildShotVerifyPrompt(baseCtx({ reasonLanguage: 'zh-CN' }))
    expect(explicit).toBe(omitted)
    expect(explicit).not.toContain('必须用**英文**写')
  })

  it('只改 reason 那一句,rubric 与打分铁律原样保留', () => {
    const zh = buildShotVerifyPrompt(baseCtx())
    const en = buildShotVerifyPrompt(baseCtx({ reasonLanguage: 'en' }))
    for (const anchor of ['<Rubric 逐维度 1-5 档>', '打分铁律', '身份', '构图']) {
      expect(zh).toContain(anchor)
      expect(en).toContain(anchor)
    }
  })
})
