import { afterEach, describe, it, expect, vi } from 'vitest'
import i18n, { DEFAULT_LOCALE } from '../../../i18n'
import { verifyGeneratedShots, type ShotVerifyInput, type ShotVerifyDeps } from './shotVerifyRunner'

const imageShot = (over: Partial<ShotVerifyInput> = {}): ShotVerifyInput => ({
  shotNodeId: 'shot-1',
  shotTitle: '镜头 1',
  shotPrompt: '林小满走进咖啡馆',
  anchorDescriptions: ['林小满：黑长直、圆脸'],
  frameSourceUrl: 'nomi-local://frame-1.png',
  isVideo: false,
  ...over,
})

const okDeps = (over: Partial<ShotVerifyDeps> = {}): ShotVerifyDeps => ({
  extractFrame: vi.fn(async (u: string) => `nomi-local://extracted-from-${u}`),
  judge: vi.fn(async () => '{"reason":"脸对不上","scores":{"identity":1,"composition":5,"continuity":5}}'),
  visionAvailable: () => true,
  ...over,
})

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LOCALE)
})

describe('verifyGeneratedShots（三态诚实审片）', () => {
  it('视觉模型不可用 → 每镜诚实标 unverified(vision_unavailable)，不冒充通过', async () => {
    const judge = vi.fn()
    const report = await verifyGeneratedShots([imageShot()], okDeps({ visionAvailable: () => false, judge }))
    expect(judge).not.toHaveBeenCalled()
    expect(report.deviations).toEqual([])
    expect(report.unverified).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜头 1', reason: 'vision_unavailable' },
    ])
    expect(report.shotOutcomes).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜头 1', status: 'unverified', reason: 'vision_unavailable' },
    ])
  })

  it('图片镜直接用 frameSourceUrl，不调 extractFrame，低分标 flagged', async () => {
    const extractFrame = vi.fn()
    const report = await verifyGeneratedShots([imageShot()], okDeps({ extractFrame }))
    expect(extractFrame).not.toHaveBeenCalled()
    expect(report.deviations).toHaveLength(1)
    expect(report.deviations[0].kind).toBe('content')
    expect(report.deviations[0].field).toBe('身份')
    expect(report.deviations[0].shotNodeId).toBe('shot-1')
    expect(report.unverified).toEqual([])
    expect(report.shotOutcomes).toHaveLength(1)
    expect(report.shotOutcomes[0].status).toBe('flagged')
  })

  it('视频镜先抽帧再喂模型', async () => {
    const deps = okDeps()
    await verifyGeneratedShots([imageShot({ isVideo: true, frameSourceUrl: 'nomi-local://vid.mp4' })], deps)
    expect(deps.extractFrame).toHaveBeenCalledWith('nomi-local://vid.mp4')
    expect((deps.judge as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('nomi-local://extracted-from-nomi-local://vid.mp4')
  })

  it('取帧失败 → 标 unverified(frame_extract_failed)，不抛、不冒充通过', async () => {
    const deps = okDeps({ extractFrame: vi.fn(async () => { throw new Error('ffmpeg 崩') }) })
    const report = await verifyGeneratedShots([imageShot({ isVideo: true, frameSourceUrl: 'x' })], deps)
    expect(report.deviations).toEqual([])
    expect(report.unverified).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜头 1', reason: 'frame_extract_failed' },
    ])
    expect(report.shotOutcomes[0]).toMatchObject({ shotNodeId: 'shot-1', status: 'unverified', reason: 'frame_extract_failed' })
  })

  it('看图请求抛错 → 标 unverified(judge_failed)，不冒充通过', async () => {
    const deps = okDeps({ judge: vi.fn(async () => { throw new Error('network timeout') }) })
    const report = await verifyGeneratedShots([imageShot()], deps)
    expect(report.deviations).toEqual([])
    expect(report.unverified).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜头 1', reason: 'judge_failed' },
    ])
    expect(report.shotOutcomes[0]).toMatchObject({ shotNodeId: 'shot-1', status: 'unverified', reason: 'judge_failed' })
  })

  it('模型返回非 JSON → 标 unverified(invalid_verdict_json)，不冒充通过', async () => {
    const deps = okDeps({ judge: vi.fn(async () => '模型挂了，非 JSON') })
    const report = await verifyGeneratedShots([imageShot()], deps)
    expect(report.deviations).toEqual([])
    expect(report.unverified).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜头 1', reason: 'invalid_verdict_json' },
    ])
    expect(report.shotOutcomes[0]).toMatchObject({ shotNodeId: 'shot-1', status: 'unverified', reason: 'invalid_verdict_json' })
  })

  it('反例 D：真审过且全轴达标 → status=passed，无偏差也无 unverified', async () => {
    const deps = okDeps({ judge: vi.fn(async () => '{"scores":{"identity":5,"composition":4,"continuity":5},"reason":"ok"}') })
    const report = await verifyGeneratedShots([imageShot()], deps)
    expect(report.deviations).toEqual([])
    expect(report.unverified).toEqual([])
    expect(report.shotOutcomes).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜头 1', status: 'passed' },
    ])
  })

  it('多镜混合：一镜 flagged、一镜 passed、一镜 unverified 各记其态', async () => {
    const judge = vi.fn()
      .mockResolvedValueOnce('{"scores":{"identity":1,"composition":5,"continuity":5},"reason":"脸不对"}')
      .mockResolvedValueOnce('{"scores":{"identity":5,"composition":5,"continuity":5},"reason":"ok"}')
      .mockRejectedValueOnce(new Error('503'))
    const shots = [
      imageShot({ shotNodeId: 'shot-1', shotTitle: '镜头 1' }),
      imageShot({ shotNodeId: 'shot-2', shotTitle: '镜头 2', previousShotPrompt: '上一镜' }),
      imageShot({ shotNodeId: 'shot-3', shotTitle: '镜头 3', previousShotPrompt: '上一镜' }),
    ]
    const report = await verifyGeneratedShots(shots, okDeps({ judge }))
    expect(report.deviations).toHaveLength(1)
    expect(report.deviations[0].shotNodeId).toBe('shot-1')
    expect(report.unverified).toEqual([
      { shotNodeId: 'shot-3', shotTitle: '镜头 3', reason: 'judge_failed' },
    ])
    expect(report.shotOutcomes.map((o) => [o.shotNodeId, o.status])).toEqual([
      ['shot-1', 'flagged'],
      ['shot-2', 'passed'],
      ['shot-3', 'unverified'],
    ])
  })

  it('空帧地址 → 标 unverified(missing_frame_source)', async () => {
    const report = await verifyGeneratedShots([imageShot({ frameSourceUrl: '' })], okDeps())
    expect(report.deviations).toEqual([])
    expect(report.unverified).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜头 1', reason: 'missing_frame_source' },
    ])
  })

  it('英文界面把当前 locale 注入判官 prompt', async () => {
    await i18n.changeLanguage('en')
    const judge = vi.fn<ShotVerifyDeps['judge']>(async () => (
      '{"reason":"wrong subject","scores":{"identity":1,"composition":5}}'
    ))
    await verifyGeneratedShots([imageShot()], okDeps({ judge }))
    expect(judge.mock.calls[0]?.[0]).toContain('reason 必须用**英文**写')
  })
})
