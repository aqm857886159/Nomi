// 「查结果」第 1 道的判据：先证明会红（每一类违例各一条真实形状），再证明不误报（整本中英词典 + 常见正常句子）。
import { describe, expect, it } from 'vitest'

import { activeDebt, findLeaks, NO_COST_CLAIMS, PRICE_WORDING } from './outcomeText.mjs'
import { loadDictionaries } from './invariants.mjs'

const kinds = (text) => findLeaks(text).map((leak) => leak.kind)

describe('会红：每一类违例', () => {
  it('服务商原始 JSON', () => {
    expect(kinds('生成失败：{"message":"bad request","code":400}')).toContain('raw-json')
    expect(kinds('Error: "code": 1113')).toContain('raw-json')
    expect(kinds('provider said invalid_request_error')).toContain('raw-json')
  })
  it('内部 id', () => {
    expect(kinds('模型 apimart/gpt-image-2 不可用')).toContain('internal-id')
    expect(kinds('候选 cand-op-12ab 已过期')).toContain('internal-id')
    expect(kinds('事务 gen-v2-9f3 失败')).toContain('internal-id')
    expect(kinds('op-123e4567-e89b-12d3-a456-426614174000')).toContain('internal-id')
    expect(kinds('[nomi-classified:rate-limit] 请稍后')).toContain('internal-id')
  })
  it('价格 / 预算字样（中英）', () => {
    expect(kinds('价格未知 · 以供应商账单为准')).toContain('price-wording')
    expect(kinds('预算已用完，提额续拍')).toContain('price-wording')
    expect(kinds('Price unknown · billed by provider')).toContain('price-wording')
    expect(kinds('Budget ran out. Raise budget to continue')).toContain('price-wording')
    // 失败标题后面的「未计费 / Not charged」角标已删（现在都走中转站，扣没扣钱我们不知道）；词表防它回来。
    expect(kinds('请求被拦下 · 未计费')).toContain('price-wording')
    expect(kinds('Request blocked · Not charged')).toContain('price-wording')
  })
})

describe('词表对着真实词典核对（词典里「价格未知」类文案改了词表要跟着改）', () => {
  const dictionaries = loadDictionaries()
  const flat = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'string' ? [[`${prefix}${key}`, value]] : value && typeof value === 'object' ? flat(value, `${prefix}${key}.`) : []))
  const find = (locale, suffix) => flat(dictionaries[locale]).filter(([key]) => key.endsWith(suffix)).map(([, value]) => value)

  it('这几条真实文案都被词表抓得到', () => {
    for (const locale of ['zh-CN', 'en']) {
      for (const suffix of ['estCostUnknown', 'shotPriceUnknown']) {
        const values = find(locale, suffix)
        expect(values.length, `${locale} 词典里找不到 ${suffix}`).toBeGreaterThan(0)
        for (const value of values) expect(kinds(value), `${locale}.${suffix} = ${value}`).toContain('price-wording')
      }
    }
  })

  it('付费卡那几句（合计「价格未知」、停下「预算已用完 · 提额续拍」）已从词典删掉，不许回来（#947）', () => {
    for (const locale of ['zh-CN', 'en']) {
      for (const suffix of ['spendTotalUnknown', 'stoppedBudget', 'raiseBudget']) {
        expect(find(locale, suffix), `${locale} 词典里又出现了 ${suffix}`).toEqual([])
      }
    }
  })
})

describe('不误报', () => {
  const ok = [
    '已生成 3 张图，放进了画布', 'Generated 3 images and placed them on the canvas',
    '生成失败，请稍后再试', 'Generation failed. Try again in a minute.',
    '这个模型暂时不可用，可以换一个试试', '操作 5 分钟前完成', 'The operation completed',
    '我想做一个关于预算 PPT 的视频', // 用户内容讲到「预算」不在词表（用户内容本来也在取文字时剔掉）
    '请用 JSON 格式整理', 'status code 是一个常见说法', 'type: 动画',
    '本地 local 模型', '打开 local/bin 目录',
  ]
  it('正常句子零命中', () => { for (const text of ok) expect(findLeaks(text), text).toEqual([]) })

  it('整本词典里除了价格预算类文案，原始 JSON 与内部 id 形状零命中（中英各一遍）', () => {
    const dictionaries = loadDictionaries()
    const flat = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'string' ? [[`${prefix}${key}`, value]] : value && typeof value === 'object' ? flat(value, `${prefix}${key}.`) : []))
    // 豁免只有两类，各有理由：设计实验室的样例入参（只在 devlab 里渲染，用户界面不出现）；让用户粘贴 ComfyUI 工作流 JSON 的输入框占位符（placeholder 不是界面文字，也不在取文字的区域里）。
    const exempt = (key) => /(^|.)fixture[A-Z]/.test(key) || key.endsWith('comfyWorkflow.jsonPlaceholder')
    for (const locale of ['zh-CN', 'en']) {
      const hits = flat(dictionaries[locale]).filter(([key]) => !exempt(key)).flatMap(([key, value]) => findLeaks(value).filter((leak) => leak.kind !== 'price-wording').map((leak) => `${key}: ${leak.match}`))
      expect(hits, `${locale} 词典里出现了 JSON / id 形状`).toEqual([])
    }
  })

  it('词表本身不含单字泛词（防止把正常的「budget / 预算」都抓成违例）', () => {
    for (const word of [...PRICE_WORDING['zh-CN'], ...PRICE_WORDING.en]) expect(word.length).toBeGreaterThanOrEqual(2)
  })
})

describe('欠账表', () => {
  const debts = [{ rule: 'ui-leaked-internals', kind: 'price-wording', until: '2026-10-15', boundTo: '#947' }]
  it('未到期算已登记，到期后重新算红', () => {
    expect(activeDebt(debts, { rule: 'ui-leaked-internals', kind: 'price-wording', today: '2026-10-02' })).not.toBeNull()
    expect(activeDebt(debts, { rule: 'ui-leaked-internals', kind: 'price-wording', today: '2026-10-16' })).toBeNull()
  })
  it('登记的是价格字样，不能顺带放过原始 JSON', () => {
    expect(activeDebt(debts, { rule: 'ui-leaked-internals', kind: 'raw-json', today: '2026-10-02' })).toBeNull()
  })
})

describe('真实走查里抓到的形状（main 上 Agent 工具卡原样摆出的入参）', () => {
  it('工具入参 JSON 与操作 id 都判违例', () => {
    const text = 'Prepare generation Running Input{ "shots": [ { "prompt": "a cat", "candidate": { "providerId": "apimart" } } ] } op-510dcbd0-0236-4af8-b61c-711ce74a5925'
    expect(kinds(text)).toEqual(expect.arrayContaining(['raw-json', 'internal-id']))
  })
})

// 「没花钱 / 不计费 / 免费」这类断言（2026-10-02：界面不谈钱，只说事实和下一步）。
describe('不谈钱：没花钱 / 免费 / 不计费 这类断言', () => {
  it('会红：中英各种说法', () => {
    for (const text of ['确认后做一次免费自检', '不会发起生成请求，也不会消耗额度', '这次没有扣费，可以重试', '这一步没成，也没有花钱', '取消不产生费用',
      '已取消（未提交，无费用）', '只查结果，不重新生成，不花钱', '用本地模型省额度', '再次提交可能重复扣费', '勿重复付费', '会跑完并计费',
      'Confirming runs one free self-check', 'Nothing was charged — try again', 'It costs nothing', 'No generation quota is used. No credits are spent',
      'free to cancel', 'Retrying could charge twice', 're-fetching costs nothing extra', 'The step adds no cost']) {
      expect(kinds(text), text).toContain('price-wording')
    }
  })

  it('不误报：第三方自己的说法、不是钱的 free、正常句子（零误报）', () => {
    for (const text of [
      '境外服务商和免费图床可能连不上', 'Overseas providers and free image hosts may be unreachable', // 第三方服务
      '绑定阿里云账号后每天有免费推理额度', 'Daily free quota with an Alibaba Cloud account', '免费试用已于 2026-05-01 结束', 'The free trial ended on May 1',
      '上传不等于模型额度免费', // 第三方（Runway）的额度说明
      'Free up space and export again', 'The project disk has only 2 GB free left', 'Free roam · panorama', 'Free orientation', 'The watermark-free video lands in your library', 'AI draft · Edit freely',
      '这一步没成，Nomi 没有开始生成。', 'The task was never submitted; you can retry.', '已取消（未提交）', '只查结果，不重新生成', '重新生成这一镜',
    ]) expect(findLeaks(text).filter((leak) => leak.kind === 'price-wording'), text).toEqual([])
  })

  // 整本词典的扫描、白名单与「白名单没烂掉」已前移到 scripts/check-i18n-no-cost-claims.mjs（check:i18n 链里，本地 gates / pre-push 会跑）。
})
