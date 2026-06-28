import { describe, it, expect, vi } from 'vitest'
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

describe('verifyGeneratedShots', () => {
  it('视觉模型不可用 → 整体跳过(返回空,降级仅结构校验)', async () => {
    const judge = vi.fn()
    const out = await verifyGeneratedShots([imageShot()], okDeps({ visionAvailable: () => false, judge }))
    expect(out).toEqual([])
    expect(judge).not.toHaveBeenCalled()
  })

  it('图片镜直接用 frameSourceUrl，不调 extractFrame', async () => {
    const extractFrame = vi.fn()
    const out = await verifyGeneratedShots([imageShot()], okDeps({ extractFrame }))
    expect(extractFrame).not.toHaveBeenCalled()
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('content')
    expect(out[0].field).toBe('身份')
    expect(out[0].shotNodeId).toBe('shot-1')
  })

  it('视频镜先抽帧再喂模型', async () => {
    const deps = okDeps()
    await verifyGeneratedShots([imageShot({ isVideo: true, frameSourceUrl: 'nomi-local://vid.mp4' })], deps)
    expect(deps.extractFrame).toHaveBeenCalledWith('nomi-local://vid.mp4')
    expect((deps.judge as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('nomi-local://extracted-from-nomi-local://vid.mp4')
  })

  it('取帧失败 → 跳过该镜，不抛、不误报', async () => {
    const deps = okDeps({ extractFrame: vi.fn(async () => { throw new Error('ffmpeg 崩') }) })
    const out = await verifyGeneratedShots([imageShot({ isVideo: true, frameSourceUrl: 'x' })], deps)
    expect(out).toEqual([])
  })

  it('判决/解析失败 → 跳过该镜，不把生成完成拖红', async () => {
    const deps = okDeps({ judge: vi.fn(async () => '模型挂了，非 JSON') })
    const out = await verifyGeneratedShots([imageShot()], deps)
    expect(out).toEqual([])
  })

  it('多镜：一镜偏差一镜达标，只报偏差的', async () => {
    const judge = vi.fn()
      .mockResolvedValueOnce('{"scores":{"identity":1,"composition":5,"continuity":5},"reason":"脸不对"}')
      .mockResolvedValueOnce('{"scores":{"identity":5,"composition":5,"continuity":5},"reason":"ok"}')
    const shots = [imageShot({ shotNodeId: 'shot-1' }), imageShot({ shotNodeId: 'shot-2', previousShotPrompt: '上一镜' })]
    const out = await verifyGeneratedShots(shots, okDeps({ judge }))
    expect(out).toHaveLength(1)
    expect(out[0].shotNodeId).toBe('shot-1')
  })

  it('空帧地址 → 跳过', async () => {
    const out = await verifyGeneratedShots([imageShot({ frameSourceUrl: '' })], okDeps())
    expect(out).toEqual([])
  })
})
