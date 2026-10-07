import { describe, expect, it } from 'vitest'
import { droppedMentionUrls, encodeMention, insertAutoMentions, mentionUrlsInOrder } from './promptMentions'

/**
 * 自动引用的唯一 owner `insertAutoMentions`（分镜与画布共用）。
 * 2026-10-05 用户原话：「不是提示词末尾，比如『小张@ 在 xx 地方做了什么事』，一旦小张图出来了，
 * 你就加一个 @ 到小张后面，用我们的 @ 的那个功能不就行了。」
 */
const LINWEI = 'nomi-local://asset/linwei.png'
const ALLEY = 'nomi-local://asset/alley.png'

describe('insertAutoMentions：插在名字紧后面', () => {
  it('中文：紧跟在名字后面插一枚现有格式的 @ 标记，不插末尾、不加任何字', () => {
    const result = insertAutoMentions('林薇冲进后巷，镜头跟拍', [{ key: 'a-linwei', name: '林薇', url: LINWEI }])
    expect(result.prompt).toBe(`林薇${encodeMention(LINWEI)}冲进后巷，镜头跟拍`)
    expect(result.inserted.map((item) => item.key)).toEqual(['a-linwei'])
    expect(result.applied).toEqual(['a-linwei'])
  })

  it('英文：整词匹配（Mia 不会命中 Miami），插在单词后面', () => {
    const candidates = [{ key: 'a-mia', name: 'Mia', url: LINWEI }]
    expect(insertAutoMentions('A street in Miami at night', candidates).inserted).toEqual([])
    expect(insertAutoMentions('Mia runs into the alley', candidates).prompt).toBe(`Mia${encodeMention(LINWEI)} runs into the alley`)
  })

  it('同名出现多次只补一次，补在第一次', () => {
    const prompt = '林薇回头，林薇停下'
    const result = insertAutoMentions(prompt, [{ key: 'a-linwei', name: '林薇', url: LINWEI }])
    expect(result.prompt).toBe(`林薇${encodeMention(LINWEI)}回头，林薇停下`)
    expect(mentionUrlsInOrder(result.prompt)).toEqual([LINWEI])
  })

  it('名字没出现在提示词里：不往末尾塞，账本也不记（以后写进名字还能补）', () => {
    const result = insertAutoMentions('她回头，追兵的车灯扫过', [{ key: 'a-linwei', name: '林薇', url: LINWEI }])
    expect(result.prompt).toBe('她回头，追兵的车灯扫过')
    expect(result.applied).toEqual([])
  })

  it('名字互相包含：短名字不命中长名字里的那一段（「林」不插进「林薇」中间）', () => {
    const result = insertAutoMentions('林薇冲进后巷', [
      { key: 'a-lin', name: '林', url: ALLEY },
      { key: 'a-linwei', name: '林薇', url: LINWEI },
    ])
    expect(result.prompt).toBe(`林薇${encodeMention(LINWEI)}冲进后巷`)
    expect(result.inserted.map((item) => item.key)).toEqual(['a-linwei'])
  })

  it('两张图各插在自己名字后面', () => {
    const result = insertAutoMentions('林薇冲进后巷', [
      { key: 'a-alley', name: '后巷', url: ALLEY },
      { key: 'a-linwei', name: '林薇', url: LINWEI },
    ])
    expect(result.prompt).toBe(`林薇${encodeMention(LINWEI)}冲进后巷${encodeMention(ALLEY)}`)
  })
})

/**
 * 名字互为前缀 × 出图状态（2026-10-06 独立验收 V-1042）：「小张」出图、「小张三」还没出图时，
 * 只看本轮候选会把「小张三走进巷子」改成「小张@三走进巷子」。最长匹配要对**所有已知名字**做。
 */
describe('insertAutoMentions：前缀名字 × 出图状态（清单）', () => {
  const PAIRS = [
    { short: '小张', long: '小张三', prompt: '小张三走进巷子' },
    { short: 'Lin', long: 'Lin Wei', prompt: 'Lin Wei walks into the alley' },
    { short: 'Lin', long: 'Linwei', prompt: 'Linwei walks into the alley' },
  ]
  const SHORT_URL = 'nomi-local://asset/short.png'
  const LONG_URL = 'nomi-local://asset/long.png'
  for (const pair of PAIRS) {
    for (const [shortReady, longReady] of [[true, false], [false, true], [true, true], [false, false]] as const) {
      it(`${pair.short} ${shortReady ? '已' : '未'}出图 × ${pair.long} ${longReady ? '已' : '未'}出图`, () => {
        const candidates = [
          ...(shortReady ? [{ key: 'short', name: pair.short, url: SHORT_URL }] : []),
          ...(longReady ? [{ key: 'long', name: pair.long, url: LONG_URL }] : []),
        ]
        const result = insertAutoMentions(pair.prompt, candidates, [], [pair.short, pair.long])
        const rest = pair.prompt.slice(pair.long.length)
        expect(result.prompt).toBe(longReady ? `${pair.long}${encodeMention(LONG_URL)}${rest}` : pair.prompt)
        expect(mentionUrlsInOrder(result.prompt)).not.toContain(SHORT_URL)
      })
    }
  }
})

describe('insertAutoMentions：用户删掉的 @ 不再补回来', () => {
  it('账本里有这个身份（之前补过）→ 不再插，哪怕名字还在、@ 已被删', () => {
    const result = insertAutoMentions('林薇冲进后巷', [{ key: 'a-linwei', name: '林薇', url: LINWEI }], ['a-linwei'])
    expect(result.prompt).toBe('林薇冲进后巷')
    expect(result.inserted).toEqual([])
  })

  it('用户自己已经 @ 过这张图 → 不重复插，但记进账本', () => {
    const prompt = `她看着${encodeMention(LINWEI)}，林薇不说话`
    const result = insertAutoMentions(prompt, [{ key: 'a-linwei', name: '林薇', url: LINWEI }])
    expect(result.prompt).toBe(prompt)
    expect(result.applied).toEqual(['a-linwei'])
  })

  it('只搜文字段：已有 @ 标记里的 url 不会被当成名字命中', () => {
    const prompt = `${encodeMention('nomi-local://asset/林薇-old.png')} 在雨里`
    expect(insertAutoMentions(prompt, [{ key: 'a-linwei', name: '林薇', url: LINWEI }]).inserted).toEqual([])
  })
})

describe('droppedMentionUrls：删 @ 同步删参考的判据', () => {
  it('上一版有、这一版没有的 url；还剩一枚就不算删', () => {
    const before = `${encodeMention(LINWEI)} 和 ${encodeMention(ALLEY)} 与 ${encodeMention(ALLEY)}`
    expect(droppedMentionUrls(before, `${encodeMention(ALLEY)}`)).toEqual([LINWEI])
    expect(droppedMentionUrls(before, `${encodeMention(LINWEI)} ${encodeMention(ALLEY)}`)).toEqual([])
  })
})
