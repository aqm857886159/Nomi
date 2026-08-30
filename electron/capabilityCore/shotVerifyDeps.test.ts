import { afterEach, describe, expect, it } from 'vitest'

import { makeShotVerifyDeps, type ShotVerifyDepsContext } from './shotVerifyDeps'
import { setDesktopLocale } from '../desktopLocale'

// L3 真额度验收抓出的韧性缺陷（2026-08-19）：judge 单点依赖「目录第一个 text 模型」太脆——
// 用户真实目录里它是经 code.newcli.com 中转的 claude-fable-5，该端点对这种 chat 调用连续 500。
// 修：judge 候选序列（目录里 enabled+key ok 的 text 模型，保持既有排序），首调失败 → 顺移下一候选
// （至多试 3 个），成功者进程内缓存为本次会话判分模型；全部失败 → 抛错（上层 orchestrate 收成 skipped）。

const ctx: ShotVerifyDepsContext = {
  projectId: 'p1',
  grantId: 'g1',
  nodeId: 'shot-1',
  vendor: 'v-gen',
  modelKey: 'm-gen',
  generationKind: 'image_edit',
  nodeKind: 'image',
  basePrompt: '暴雨夜便利店',
  params: {},
  references: [],
}

const JUDGE_JSON = '{"scores":{"identity":5,"composition":5,"continuity":5},"reason":"好"}'

afterEach(() => {
  setDesktopLocale('zh-CN')
})

describe('makeShotVerifyDeps · judge 候选回退（单点→候选序列）', () => {
  it('第一个候选传输失败 → 顺移第二个成功；成功者进程内缓存（第二次判分不再试第一个）', async () => {
    const candidates = [
      { vendor: 'bad-vendor', modelKey: 'claude-fable-5' }, // 首选：连续 500
      { vendor: 'good-vendor', modelKey: 'gpt-5.5' }, // 次选：成功
    ]
    const attemptedVendors: string[] = []
    const runTaskFn = async (payload: { vendor: string; request: unknown }) => {
      // 只有 judge 调用打到这里（generationKind 不是 image_to_prompt）。记录尝试的 vendor。
      const req = payload.request as { kind?: string }
      if (req.kind === 'image_to_prompt') {
        attemptedVendors.push(payload.vendor)
        if (payload.vendor === 'bad-vendor') throw new Error('[vendor-http] 500 ×3')
        return { assets: [], raw: { choices: [{ message: { content: JUDGE_JSON } }] } }
      }
      return { assets: [{ url: 'nomi-local://regen.png', type: 'image' }] }
    }
    const deps = makeShotVerifyDeps(ctx, { runTaskFn, listJudgeCandidates: () => candidates })

    expect(deps.visionAvailable()).toBe(true) // 有候选 → 视觉可用

    const out1 = await deps.judge('prompt-1', 'data:image/png;base64,FRAME1')
    expect(out1).toContain('identity') // 拿到判决文本
    expect(attemptedVendors).toEqual(['bad-vendor', 'good-vendor']) // 首选失败后顺移次选

    // 第二次判分：缓存生效 → 直接用 good-vendor，不再试 bad-vendor
    attemptedVendors.length = 0
    const out2 = await deps.judge('prompt-2', 'data:image/png;base64,FRAME2')
    expect(out2).toContain('identity')
    expect(attemptedVendors).toEqual(['good-vendor']) // ★缓存生效：不再试已失败的首选
  })

  it('至多试 6 个候选：前 6 个都失败 → 抛错（不试第 7 个）；orchestrate 上层收成 skipped', async () => {
    // L3 实跑教训：坏中转/纯文本模型能挤满前 3，窗口放宽到 6（总耗时由 deadline 硬界兜底）。
    const candidates = Array.from({ length: 7 }, (_, i) => ({ vendor: `c${i + 1}`, modelKey: `m${i + 1}` }))
    const attempted: string[] = []
    const runTaskFn = async (payload: { vendor: string; request: unknown }) => {
      attempted.push(payload.vendor)
      throw new Error('[vendor-http] 500 ×3')
    }
    const deps = makeShotVerifyDeps(ctx, { runTaskFn, listJudgeCandidates: () => candidates })
    await expect(deps.judge('p', 'f')).rejects.toThrow()
    expect(attempted).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) // 至多 6 个，不碰第 7 个
  })

  it('vision 命名的候选排前：名字带 vision/vl 的模型优先被试（判分要看图）', async () => {
    // L3 实跑现场：能看图的 moonshot-vision-preview 排目录第 6，被纯文本模型挤出窗口 → 排序治根。
    const candidates = [
      { vendor: 'relay', modelKey: 'claude-text' },
      { vendor: 'ms', modelKey: 'Qwen3-8B' },
      { vendor: 'moonshot', modelKey: 'moonshot-v1-128k-vision-preview' },
    ]
    const attempted: string[] = []
    const runTaskFn = async (payload: { vendor: string; request: unknown }) => {
      attempted.push(payload.vendor)
      return { assets: [], raw: { choices: [{ message: { content: '{"scores":{"identity":5},"reason":"ok"}' } }] } }
    }
    const deps = makeShotVerifyDeps(ctx, { runTaskFn, listJudgeCandidates: () => candidates })
    await deps.judge('p', 'f')
    expect(attempted[0]).toBe('moonshot') // vision 命名者第一个被试
  })

  it('无任何候选 → visionAvailable=false（整体跳过判分，仅生成不报错）', () => {
    const deps = makeShotVerifyDeps(ctx, { runTaskFn: async () => ({ assets: [] }), listJudgeCandidates: () => [] })
    expect(deps.visionAvailable()).toBe(false)
  })

  it('首选即成功 → 只试首选（不无谓顺移）', async () => {
    const candidates = [
      { vendor: 'first', modelKey: 'm1' },
      { vendor: 'second', modelKey: 'm2' },
    ]
    const attempted: string[] = []
    const runTaskFn = async (payload: { vendor: string; request: unknown }) => {
      attempted.push(payload.vendor)
      return { assets: [], raw: { choices: [{ message: { content: JUDGE_JSON } }] } }
    }
    const deps = makeShotVerifyDeps(ctx, { runTaskFn, listJudgeCandidates: () => candidates })
    await deps.judge('p', 'f')
    expect(attempted).toEqual(['first']) // 首选成功就停
  })

  it('把 Electron 当前界面语言注入判官编排依赖', () => {
    setDesktopLocale('en')
    const deps = makeShotVerifyDeps(ctx, { runTaskFn: async () => ({ assets: [] }), listJudgeCandidates: () => [] })
    expect(deps.reasonLanguage).toBe('en')
  })
})

describe('toJudgeImageUrl（判分图形态转换：本地资产 → data:）', () => {
  it('nomi-local:// → 读盘转 data:image/...;base64（外部 vendor 才取得到；L3 现场 moonshot 400 的根因）', async () => {
    const os = await import('node:os')
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-img-'))
    const file = path.join(dir, 'frame.jpg')
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    const sent: string[] = []
    const runTaskFn = async (payload: { vendor: string; request: unknown }) => {
      const req = payload.request as { extras?: { referenceImages?: string[] } }
      sent.push(...(req.extras?.referenceImages || []))
      return { assets: [], raw: { choices: [{ message: { content: '{"scores":{"identity":5},"reason":"ok"}' } }] } }
    }
    const deps = makeShotVerifyDeps(ctx, {
      runTaskFn,
      listJudgeCandidates: () => [{ vendor: 'v', modelKey: 'm-vision' }],
      resolveLocalAsset: () => ({ filePath: file }),
    })
    await deps.judge('p', 'nomi-local://asset/proj/assets/frame.jpg')
    expect(sent[0].startsWith('data:image/jpeg;base64,')).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('http(s)/data: 原样透传（不无谓转码）', async () => {
    const sent: string[] = []
    const runTaskFn = async (payload: { vendor: string; request: unknown }) => {
      const req = payload.request as { extras?: { referenceImages?: string[] } }
      sent.push(...(req.extras?.referenceImages || []))
      return { assets: [], raw: { choices: [{ message: { content: '{"scores":{"identity":5},"reason":"ok"}' } }] } }
    }
    const deps = makeShotVerifyDeps(ctx, { runTaskFn, listJudgeCandidates: () => [{ vendor: 'v', modelKey: 'm' }] })
    await deps.judge('p', 'https://example.com/f.png')
    expect(sent[0]).toBe('https://example.com/f.png')
  })
})
