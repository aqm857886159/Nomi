import { describe, expect, it } from 'vitest'
import { extractStoryFromRequest, routeCreationIntent } from './creationIntentRouting'

describe('routeCreationIntent（删 chip 后自然语言是唯一入口，覆盖面=可用性）', () => {
  it('「只要镜头图」类说法 → storyboard', () => {
    for (const text of ['帮我拆镜头', '把这段拆成 6 个镜头', '做个分镜', '拆分一下这个故事', '生成镜头脚本']) {
      expect(routeCreationIntent(text)).toBe('storyboard')
    }
  })

  it('「要完整轨迹/视频」类说法 → storyboard（skill 端再判轨迹模式）', () => {
    for (const text of ['把这个故事做成视频', '生成视频', '做成一条片子', '我要成片']) {
      expect(routeCreationIntent(text)).toBe('storyboard')
    }
  })

  it('人话视频说法也要接住（6-20 审计：正则太脆漏命中是 P0 入口问题）', () => {
    for (const text of ['帮我做个视频', '把这个弄成短片', '变成片子吧', '剪成一段视频', '拍成短片', '出片']) {
      expect(routeCreationIntent(text)).toBe('storyboard')
    }
  })

  it('放宽口径：旧正则漏的「动词+画面/段落」人话也要接住（治脆，6-26）', () => {
    for (const text of [
      '把这个故事整成一段段画面',
      '铺成画面接画面',
      '切成几个镜头',
      '排成分镜',
      '把剧情整理成一幕幕',
      '帮我把它拆成画面',
    ]) {
      expect(routeCreationIntent(text)).toBe('storyboard')
    }
  })

  it('放宽口径 2：补「规划镜头」「变成/拆成场景」（2026-07-15 用户群反馈仍难触发）', () => {
    for (const text of ['帮我规划一下镜头', '规划镜头', '把故事变成一个个场景', '拆成几个场景', '分成场景']) {
      expect(routeCreationIntent(text)).toBe('storyboard')
    }
  })

  it('不误伤：含「视频/片/画面/场景」但非拆镜头意图 → null', () => {
    for (const text of [
      '这个视频模型怎么样',
      '看张照片',
      '下一步呢',
      '帮我配个视频字幕的文案',
      '今天天气怎么样',
      '看个视频',
      '给他打个视频通话',
      '这个画面描写得不错',
      '这个场景描写不错',
    ]) {
      expect(routeCreationIntent(text)).toBeNull()
    }
  })

  it('「立角色卡」类说法 → fixation', () => {
    for (const text of ['给主角立角色卡', '建一个角色卡', '帮人物卡定妆', '做角色设定', '建个角色']) {
      expect(routeCreationIntent(text)).toBe('fixation')
    }
  })

  it('普通创作请求 → null（走通用创作 AI，不误触发跨面板动作）', () => {
    for (const text of ['帮我把这段写得更生动', '续写下一段', '这句话怎么改', '总结一下', '']) {
      expect(routeCreationIntent(text)).toBeNull()
    }
  })
})

describe('extractStoryFromRequest（编辑器空时把对话里的故事捞出来，免用户重搬 D1）', () => {
  it('「拆成镜头：<故事>」式 → 取冒号后的正文', () => {
    const story = '清晨，戴金丝眼镜的咖啡馆老板林夏打开店门，常客陈默推门而入。'
    expect(extractStoryFromRequest(`把这个故事拆成镜头：${story}`)).toBe(story)
    expect(extractStoryFromRequest(`拆镜头: ${story}`)).toBe(story)
  })

  it('没冒号但带实质故事正文 → 整条交给规划师（LLM 自会忽略命令词）', () => {
    const msg = '清晨咖啡馆里林夏打开店门擦拭吧台，常客陈默推门而入，把它拆成镜头'
    expect(extractStoryFromRequest(msg)).toBe(msg)
  })

  it('裸命令抠不出故事 → 空串（维持「先写故事」提示，不拿命令词当故事）', () => {
    for (const text of ['帮我拆镜头', '拆镜头', '把这段拆成 6 个镜头', '做个分镜', '', '生成视频']) {
      expect(extractStoryFromRequest(text)).toBe('')
    }
  })
})
