import { describe, expect, it } from 'vitest'
import { AGENT_FORM_DEFAULTS, BALL_SIZE, COMPOSER_FOCUS_MAX_FRAMES, EDGE_GAP, FLOAT_MIN, clampBall, clampRect, defaultBallPoint, defaultFloatRect, focusAgentComposerSoon } from './agentFormStore'

describe('Agent 三形态的几何（10-08 外壳重设计）', () => {
  it('默认：画布 / 列表是小球，创作、分镜、预览停靠', () => {
    expect(AGENT_FORM_DEFAULTS).toEqual({ creation: 'dock', storyboard: 'dock', generation: 'ball', preview: 'dock' })
  })

  it('默认浮窗贴右下、约半屏高，整块在内容区里', () => {
    const area = { width: 1210, height: 760 }
    const rect = defaultFloatRect(area)
    expect(rect.x + rect.width).toBe(area.width - EDGE_GAP)
    expect(rect.y + rect.height).toBe(area.height - EDGE_GAP)
    expect(rect.height).toBeGreaterThanOrEqual(Math.round(area.height * 0.5))
  })

  it('窗口缩小后浮窗被夹回可见区（旧位置在屏外也回得来）', () => {
    const rect = clampRect({ x: 1400, y: 900, width: 400, height: 420 }, { width: 900, height: 600 })
    expect(rect.x + rect.width).toBeLessThanOrEqual(900)
    expect(rect.y + rect.height).toBeLessThanOrEqual(600)
    expect(rect.x).toBeGreaterThanOrEqual(0)
  })

  it('内容区比浮窗最小尺寸还小时，浮窗收到内容区那么大，不出界', () => {
    const rect = clampRect({ x: 0, y: 0, width: 400, height: 420 }, { width: 280, height: 300 })
    expect(rect.width).toBe(280)
    expect(rect.height).toBe(300)
    expect(FLOAT_MIN.width).toBeGreaterThan(280)
  })

  it('小球默认右下，越界被夹回', () => {
    const area = { width: 1210, height: 760 }
    expect(defaultBallPoint(area)).toEqual({ x: area.width - BALL_SIZE - EDGE_GAP, y: area.height - BALL_SIZE - EDGE_GAP })
    expect(clampBall({ x: -50, y: 2000 }, area)).toEqual({ x: 0, y: area.height - BALL_SIZE })
  })
})

describe('打开面板后把焦点放进输入框（focusAgentComposerSoon）', () => {
  /** 手摇帧：每调一次 step() 跑一帧。 */
  const frames = () => {
    const queue: Array<() => void> = []
    return { nextFrame: (tick: () => void) => { queue.push(tick) }, step: () => queue.shift()?.(), pending: () => queue.length }
  }

  it('面板晚几帧才挂上：挂上那一帧聚焦，不出声', () => {
    const clock = frames()
    const focused: string[] = []
    const warnings: unknown[] = []
    let mounted = false
    focusAgentComposerSoon('#host [data-input]', {
      find: () => (mounted ? ({ focus: () => focused.push('input') } as unknown as HTMLElement) : null),
      nextFrame: clock.nextFrame,
      warn: (fields) => warnings.push(fields),
    })
    clock.step()
    clock.step()
    mounted = true
    clock.step()
    expect(focused).toEqual(['input'])
    expect(clock.pending()).toBe(0)
    expect(warnings).toEqual([])
  })

  it('等满还找不到：出一声，带选择器名，不再请求帧（10-12 换输入框后悄悄失效近一个月的那一类）', () => {
    const clock = frames()
    const warnings: Array<{ selector: string; frames: number }> = []
    focusAgentComposerSoon('#host [data-input]', { find: () => null, nextFrame: clock.nextFrame, warn: (fields) => warnings.push(fields) })
    let ran = 0
    while (clock.pending() && ran < 100) { clock.step(); ran += 1 }
    expect(ran).toBe(COMPOSER_FOCUS_MAX_FRAMES + 1)
    expect(warnings).toEqual([{ selector: '#host [data-input]', frames: COMPOSER_FOCUS_MAX_FRAMES }])
  })
})
