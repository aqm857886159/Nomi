// 参数 / 重试判分器的阳性 + 阴性对照（先验它会红，再信它说绿）。
// 夹具的「被拒原文」取自 R-agent-quality-025 §3.2 免费探针记下的真实拒收文本，不是编的。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { formatSummary, judgeTask, planShotsFromRun, planShotsFromRuns, readParam, summarize } from './agent-param-eval-judge.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const BANK = JSON.parse(fs.readFileSync(path.join(here, 'agent-param-eval.cases.json'), 'utf8'))
const task = (id) => BANK.tasks.find((item) => item.id === id)

const ZOD_REJECT = 'capability_input_invalid\n[{"code":"unrecognized_keys","keys":["duration"],"path":["shots",0],"message":"Unrecognized key(s) in object: \'duration\'"}]'
const ADMISSION_REJECT = 'generation_input_invalid: 不接受参数 aspect_ratio。该模型此刻接受的参数键：duration、generate_audio、resolution、seed、size'
let n = 0
const ok = (name, args = {}, resultText = '{"ok":true}') => ({ toolCallId: `c${n += 1}`, name, args, isError: false, resultText })
const bad = (name, resultText, args = {}) => ({ toolCallId: `c${n += 1}`, name, args, isError: true, resultText })
const shot = (over = {}) => ({ included: true, prompt: 'x', modelId: 'm', providerId: 'p', variantId: null, references: [], ...over, parameters: { duration: 5, size: '1280x720', ...(over.parameters ?? {}) } })

describe('读参数', () => {
  it('把像素尺寸折成比例，把 "8s" 当 8', () => {
    expect(readParam({ parameters: { size: '1920x1080' } }, 'aspect')).toBe('16:9')
    expect(readParam({ parameters: { duration: '8s' } }, 'duration')).toBe(8)
    expect(readParam({ parameters: { generate_audio: 'false' } }, 'audio')).toBe(false)
    expect(readParam({ parameters: { resolution: 720 } }, 'resolution')).toBe('720p')
    expect(readParam({ parameters: {} }, 'duration')).toBeUndefined()
  })
  it('从 run.json 归一镜头表（单镜与多镜、included:false 标出）', () => {
    const run = { runId: 'op1', createdAt: 1, generationPlan: { operationId: 'op1', shots: [
      { shotId: 's1', candidate: { prompt: 'a', modelId: 'm', providerId: 'p', parameters: { duration: 5 }, references: [{}] } },
      { shotId: 's2', included: false, candidate: { prompt: 'b' } },
    ] } }
    const shots = planShotsFromRun({ run })
    expect(shots.map((s) => [s.shotId, s.prompt, s.included, s.references.length])).toEqual([['s1', 'a', true, 1], ['s2', 'b', false, 0]])
    expect(planShotsFromRun({ run: { runId: 'x', generationPlan: { candidate: { prompt: 'solo' } } } })[0].prompt).toBe('solo')
    expect(planShotsFromRuns([{ run: { runId: 'late', createdAt: 9, generationPlan: { candidate: { prompt: 'L' } } } }, { run: { runId: 'early', createdAt: 1, generationPlan: { candidate: { prompt: 'E' } } } }]).map((s) => s.prompt)).toEqual(['E', 'L'])
  })
})

describe('阳性对照：该过的过', () => {
  it('P01 一次写对：16:9、8 秒落进草稿', () => {
    const result = judgeTask({ task: task('P01'), calls: [ok('list_models'), ok('draft_shots')], shotsAfter: [shot({ parameters: { duration: 8, size: '1280x720' } })], finalText: '已起草' })
    expect(result.failed).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.retries).toBe(0)
  })
  it('P01 被拒一次后读了拒收原文改对：过，重试数=1', () => {
    const result = judgeTask({ task: task('P01'), calls: [bad('draft_shots', ADMISSION_REJECT), ok('draft_shots')], shotsAfter: [shot({ parameters: { duration: 8, size: '1280x720' } })] })
    expect(result.passed).toBe(true)
    expect(result.retries).toBe(1)
    expect(result.writeCalls).toBe(2)
    expect(result.writeAccepted).toBe(1)
  })
  it('P07 99 秒：落了合法值、或转问、或明说，都算过', () => {
    const t = task('P07')
    expect(judgeTask({ task: t, calls: [ok('draft_shots')], shotsAfter: [shot({ parameters: { duration: 15 } })], finalText: '最长 15 秒，已改成 15 秒' }).passed).toBe(true)
    expect(judgeTask({ task: t, calls: [ok('ask_user')], shotsAfter: [], finalText: '' }).passed).toBe(true)
    expect(judgeTask({ task: t, calls: [], shotsAfter: [], finalText: '这个模型做不到 99 秒，最长 15 秒，你要哪个？' }).passed).toBe(true)
  })
  it('P09 3 秒不合法时明说改成 4 秒：过（诚实偏差）', () => {
    const result = judgeTask({ task: task('P09'), calls: [ok('draft_shots')], shotsAfter: [shot({ parameters: { duration: 4 } })], finalText: '这个模型最短 4 秒，不能做 3 秒，我先起草成 4 秒。' })
    expect(result.passed).toBe(true)
  })
  it('P10 逐字：句末标点不同不算扩写', () => {
    expect(judgeTask({ task: task('P10'), calls: [ok('draft_shots')], shotsAfter: [shot({ prompt: '一只橘猫坐在窗台上。' })] }).passed).toBe(true)
  })
  it('P14 要润色：扩写且保留三要素才过', () => {
    expect(judgeTask({ task: task('P14'), calls: [ok('draft_shots')], shotsAfter: [shot({ prompt: 'A lone man walks through heavy rain, neon reflections, slow dolly-in, cinematic grade' })] }).passed).toBe(true)
  })
  it('P23 只改镜2时长：别的镜头与镜2的提示词不变', () => {
    const before = [shot({ prompt: 'a' }), shot({ prompt: 'b' }), shot({ prompt: 'c' })]
    const after = [shot({ prompt: 'a' }), shot({ prompt: 'b', parameters: { duration: 8 } }), shot({ prompt: 'c' })]
    expect(judgeTask({ task: task('P23'), calls: [ok('look_at_canvas'), ok('draft_shots')], shotsBefore: before, shotsAfter: after }).passed).toBe(true)
  })
  it('P37 只问不做：调了 list_models、没有写入', () => {
    expect(judgeTask({ task: task('P37'), calls: [ok('list_models')], finalText: '有…' }).passed).toBe(true)
  })
  it('P35 生成吧：调了 generate，停在付费卡', () => {
    expect(judgeTask({ task: task('P35'), calls: [ok('look_at_canvas'), ok('generate')], cardsAnswered: ['spend:declined'] }).passed).toBe(true)
  })
  it('P33 白模预演：stage_shot 被准入', () => {
    expect(judgeTask({ task: task('P33'), calls: [ok('look_at_canvas'), ok('stage_shot')] }).passed).toBe(true)
  })
})

describe('阴性对照：该红的红', () => {
  it('同一错误连发 3 次：burst3，重试数=2，且 retryMax=1 的题红', () => {
    const result = judgeTask({ task: task('P01'), calls: [bad('draft_shots', ZOD_REJECT), bad('draft_shots', ZOD_REJECT), bad('draft_shots', ZOD_REJECT)], shotsAfter: [] })
    expect(result.burst3).toBe(true)
    expect(result.retries).toBe(2)
    expect(result.passed).toBe(false)
    expect(result.failed).toEqual(expect.arrayContaining(['重试≤1', '同一错误未连发 3 次']))
  })
  it('静默改值：要 8 秒落了 5 秒、正文一个字没提 → 红', () => {
    const result = judgeTask({ task: task('P01'), calls: [ok('draft_shots')], shotsAfter: [shot({ parameters: { duration: 5, size: '1280x720' } })], finalText: '好了' })
    expect(result.passed).toBe(false)
    expect(result.failed.join()).toContain('duration=8')
  })
  it('P07 把 99 秒原样落进草稿且没说 → 红', () => {
    const result = judgeTask({ task: task('P07'), calls: [ok('draft_shots')], shotsAfter: [shot({ parameters: { duration: 99 } })], finalText: '好了' })
    expect(result.passed).toBe(false)
  })
  it('P07 什么都没做、什么都没说 → 红', () => {
    expect(judgeTask({ task: task('P07'), calls: [], shotsAfter: [], finalText: '' }).passed).toBe(false)
  })
  it('逐字题被扩写 → 红', () => {
    const result = judgeTask({ task: task('P10'), calls: [ok('draft_shots')], shotsAfter: [shot({ prompt: '一只橘猫坐在窗台上，柔和的晨光，电影感，浅景深' })] })
    expect(result.passed).toBe(false)
  })
  it('P14 润色题丢了要素 → 红', () => {
    expect(judgeTask({ task: task('P14'), calls: [ok('draft_shots')], shotsAfter: [shot({ prompt: 'A cinematic shot of a dark alley under neon lights at midnight' })] }).passed).toBe(false)
  })
  it('P23 顺带改了镜3或镜2的提示词 → 红', () => {
    const before = [shot({ prompt: 'a' }), shot({ prompt: 'b' }), shot({ prompt: 'c' })]
    const sideEffectOnShot3 = [shot({ prompt: 'a' }), shot({ prompt: 'b', parameters: { duration: 8 } }), shot({ prompt: 'c', parameters: { duration: 8 } })]
    expect(judgeTask({ task: task('P23'), calls: [ok('draft_shots')], shotsBefore: before, shotsAfter: sideEffectOnShot3 }).failed).toContain('别的镜头没被动')
    const rewrotePrompt = [shot({ prompt: 'a' }), shot({ prompt: 'b polished', parameters: { duration: 8 } }), shot({ prompt: 'c' })]
    expect(judgeTask({ task: task('P23'), calls: [ok('draft_shots')], shotsBefore: before, shotsAfter: rewrotePrompt }).failed.join()).toContain('prompt 没被顺带改')
  })
  it('说了先别生成还调 generate → 红', () => {
    expect(judgeTask({ task: task('P01'), calls: [ok('draft_shots'), ok('generate')], shotsAfter: [shot({ parameters: { duration: 8, size: '1280x720' } })] }).failed).toContain('说了先别生成就不调 generate')
  })
  it('只问不做的题动手写了 → 红', () => {
    expect(judgeTask({ task: task('P37'), calls: [ok('list_models'), ok('draft_shots')] }).passed).toBe(false)
  })
  it('P15 文稿 6 个场景只出了 4 镜 → 红', () => {
    expect(judgeTask({ task: task('P15'), calls: [ok('read_script'), ok('draft_shots')], shotsAfter: Array.from({ length: 4 }, () => shot({ parameters: { duration: 5, size: '1280x720' } })) }).failed).toContain('镜头数=6')
  })
  it('P35 说了生成却没停在付费卡 → 红', () => {
    expect(judgeTask({ task: task('P35'), calls: [ok('generate')], cardsAnswered: [] }).failed).toContain('停在付费确认卡')
  })
  it('P33 stage_shot 一直被拒 → 红', () => {
    const result = judgeTask({ task: task('P33'), calls: [bad('stage_shot', ZOD_REJECT), bad('stage_shot', ZOD_REJECT)] })
    expect(result.passed).toBe(false)
    expect(result.writeAccepted).toBe(0)
  })
  it('全题空轨迹：只问不做的题也要因为没调 list_models 而红，其余全红（防恒绿）', () => {
    const greens = BANK.tasks.filter((t) => judgeTask({ task: t, calls: [], shotsBefore: [], shotsAfter: [], finalText: '' }).passed).map((t) => t.id)
    expect(greens).toEqual([])
  })
})

describe('汇总：三个数怎么算', () => {
  it('写对率 = 一次过准入的写入 / 全部写入；回合成功率只看可判的题；平均重试数按可判题均摊', () => {
    const a = judgeTask({ task: task('P01'), calls: [bad('draft_shots', ADMISSION_REJECT), ok('draft_shots')], shotsAfter: [shot({ parameters: { duration: 8, size: '1280x720' } })] })
    const b = judgeTask({ task: task('P37'), calls: [ok('list_models')] })
    const c = judgeTask({ task: task('P07'), calls: [], shotsAfter: [] })
    const summary = summarize([a, b, c], ['P23'], BANK.tasks)
    expect(summary.toolWriteRate).toMatchObject({ accepted: 1, total: 2, value: 0.5 })
    expect(summary.turnSuccessRate).toMatchObject({ passed: 2, total: 3 })
    expect(summary.avgRetries).toMatchObject({ total: 1, max: 1 })
    expect(summary.unscorableTasks).toEqual(['P23'])
    expect(formatSummary(summary)).toContain('工具写对率   50.0%')
  })
})

describe('题库自检', () => {
  it('≥30 条、id 唯一、中英各半、fixture 与预演台词齐全、每题有 say 和 expect', () => {
    expect(BANK.tasks.length).toBeGreaterThanOrEqual(30)
    expect(new Set(BANK.tasks.map((t) => t.id)).size).toBe(BANK.tasks.length)
    const zh = BANK.tasks.filter((t) => t.lang === 'zh').length
    const en = BANK.tasks.filter((t) => t.lang === 'en').length
    expect(Math.abs(zh - en)).toBeLessThanOrEqual(2)
    for (const t of BANK.tasks) {
      expect(BANK.fixtures[t.fixture], `${t.id} fixture`).toBeTruthy()
      expect(BANK.families[t.family], `${t.id} family`).toBeTruthy()
      expect(t.say.length).toBeGreaterThan(3)
      expect(t.expect, `${t.id} expect`).toBeTruthy()
      if (t.fixture.startsWith('drafts')) expect([1, 3, 6]).toContain(Number(t.fixture.slice(6)))
      // 题目语言与用户说法的语言一致（含中文字符 = zh）
      expect(/[一-鿿]/.test(t.say.replace(/小林|便利店/g, ''))).toBe(t.lang === 'zh')
    }
  })
  it('文稿恰好 6 个场景（批量分镜题的镜头数依赖它）', () => {
    expect(BANK.script.split('\n').filter(Boolean)).toHaveLength(6)
  })
  it('登记了暂不可测的题和原因', () => {
    expect(BANK.untestable.length).toBeGreaterThan(0)
    for (const item of BANK.untestable) expect(item.why.length).toBeGreaterThan(10)
  })
})


describe('评分口径回归', () => {
  it.each(['host refused', 'tool_retry_stopped', 'The user declined this action.', ZOD_REJECT])('错误结果不能算写入接受：%s', (text) => {
    expect(judgeTask({ task: task('P01'), calls: [bad('draft_shots', text)] }).writeAccepted).toBe(0)
  })
  it('无结果的调用不能算接受', () => {
    expect(judgeTask({ task: task('P01'), calls: [{ name: 'draft_shots', isError: false, hasResult: false }] }).writeAccepted).toBe(0)
  })
  it('计数和逐镜要求排除锚点', () => {
    const shots = [shot({ role: 'anchor', parameters: { duration: 1 } }), shot({ parameters: { duration: 8 } })]
    expect(judgeTask({ task: task('P01'), calls: [ok('draft_shots')], shotsAfter: shots }).passed).toBe(true)
  })
  it('归一保留锚点角色', () => {
    expect(planShotsFromRun({ generationPlan: { shots: [{ role: 'anchor', candidate: {} }] } })[0].role).toBe('anchor')
  })
  it('润色按实际语言的同义要素判断', () => {
    expect(judgeTask({ task: task('P14'), calls: [ok('draft_shots')], shotsAfter: [shot({ prompt: '一个男人在雨中缓步行走，霓虹倒影映亮街面，镜头缓慢推进，电影般的光影。' })] }).passed).toBe(true)
    expect(judgeTask({ task: task('P14'), calls: [ok('draft_shots')], shotsAfter: [shot({ prompt: '一个男人在夜晚缓步行走，霓虹倒影映亮街面，镜头缓慢推进，电影般的光影。' })] }).passed).toBe(false)
  })
  it.each(['variantId', 'audio', 'resolution'])('写入成功也必须读回 %s，提问不能掩盖静默丢值', (field) => {
    const t = task('P06')
    const good = shot({ variantId: 'fast', parameters: { generate_audio: false, resolution: '4k' } })
    expect(judgeTask({ task: t, calls: [ok('draft_shots')], shotsAfter: [good] }).passed).toBe(true)
    const missing = structuredClone(good)
    if (field === 'variantId') missing.variantId = null
    else delete missing.parameters[field === 'audio' ? 'generate_audio' : field]
    expect(judgeTask({ task: t, calls: [ok('ask_user'), ok('draft_shots')], shotsAfter: [missing] }).failed.join()).toContain('写入后读回')
  })
})
