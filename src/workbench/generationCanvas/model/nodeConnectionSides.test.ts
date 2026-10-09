// 拉环两侧存不存在 = 节点种类定义上的 `connects`（2026-10-08 用户拍板：拉环只出现在用得上的一侧）。
// 期望表逐行写死，不从实现反推：素材没有左环（文本 2026-10-09 起有左环：收文字和图），剪辑没有右环；其余按今天真有的能力。
// 新加一种节点 → 这里缺一行 → 红（逼着写清它收不收输入、有没有可引用产出）。
import { describe, expect, it } from 'vitest'
import { GENERATION_NODE_KINDS, getGenerationNodeConnectionSides } from './generationNodeKinds'

const DECIDED: Record<string, { left: boolean; right: boolean }> = {
  shot_table: { left: false, right: false },
  text: { left: true, right: true },
  character: { left: true, right: true },
  scene: { left: true, right: true },
  image: { left: true, right: true },
  keyframe: { left: true, right: true },
  video: { left: true, right: true },
  audio: { left: true, right: true },
  clip: { left: true, right: false },
  shot: { left: false, right: false },
  output: { left: false, right: false },
  panorama: { left: false, right: true },
  director: { left: true, right: true },
  whiteboard: { left: false, right: true },
  model3d: { left: true, right: false },
  asset: { left: false, right: true },
  'agent-artifact': { left: false, right: false },
}

describe('ring sides come from the node-kind definition', () => {
  it('covers every kind, and nothing else', () => {
    expect([...GENERATION_NODE_KINDS].sort()).toEqual(Object.keys(DECIDED).sort())
  })

  it.each(GENERATION_NODE_KINDS)('%s has the decided left / right rings', (kind) => {
    expect(getGenerationNodeConnectionSides(kind)).toEqual(DECIDED[kind])
  })

  it('pins the sides the user named (10-08; text gets a left ring on 10-09)', () => {
    expect(getGenerationNodeConnectionSides('asset').left).toBe(false)
    expect(getGenerationNodeConnectionSides('text').left).toBe(true)
    expect(getGenerationNodeConnectionSides('clip').right).toBe(false)
  })
})
