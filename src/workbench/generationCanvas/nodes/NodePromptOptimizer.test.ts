import { describe, expect, it } from 'vitest'
import { buildOptimizePrompt } from './promptOptimizer'

// W4-2：提示词优化器此前是**纯自由文本改写**——不读任何铁律，模型看到「望向」照样强行出正脸，
// 把用户要的背影镜毁掉（盘点 D#5）。这里钉死「污染词铁律真的进了改写指令」，不是加了句口号。

describe('buildOptimizePrompt · 污染词铁律注入', () => {
  it('★视频镜：铁律进 prompt（视线类/抽象概念/事件名/角色名四条都在）', () => {
    const p = buildOptimizePrompt('原提示词', '想更有张力', true)
    expect(p).toContain('铁律')
    expect(p).toContain('望向') // 视线类——最容易毁掉背影镜的那条
    expect(p).toContain('意识') // 抽象概念
    expect(p).toContain('驾驶') // 事件名
    expect(p).toContain('角色名') // 运动描述禁专有名词
  })

  it('铁律不只说「禁用」，还给替代写法（只禁不给出路 = 模型无所适从）', () => {
    const p = buildOptimizePrompt('x', '', true)
    expect(p).toContain('身体朝向') // 视线类的替代
    expect(p).toContain('外貌特征') // 角色名的替代
  })

  it('图片镜不注入（污染词铁律是运镜/动作场景的规则，图片镜无谓加长指令）', () => {
    expect(buildOptimizePrompt('原提示词', '', false)).not.toContain('铁律')
  })

  it('原提示词与用户想法照旧带上（没把既有行为改坏）', () => {
    const p = buildOptimizePrompt('一只橘猫坐在窗台', '换成夜晚', true)
    expect(p).toContain('一只橘猫坐在窗台')
    expect(p).toContain('换成夜晚')
  })
})
