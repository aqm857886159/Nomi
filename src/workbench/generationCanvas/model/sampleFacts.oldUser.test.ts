/**
 * 老项目升级后不会被读成样片（设计卡 docs/plan/2026-11-26-sample-mode.md ★1c / ★9-5）。
 *
 * 夹具是 0.24.1 用自己真实的 store 写口落下的画布存盘（tests/fixtures/old-user-data/canvas/v0.24.1-mode-nodes/），不是手写形状：
 * 25 个节点，其中 12 个图片节点带结果、6 个视频节点、音频和 3D 各 1 个。经今天主线「真实打开项目」（restoreSnapshot，含加载收敛）后：
 *   · 没有一个节点读出样片事实，也就不会长出节点下方那一行、不会出现「出高清」；
 *   · 存回的片段不多出样片相关的字段（运行记录 / 进度里的样片号只在出高清时写）。
 * 做不到的一半：夹具里的视频节点都没有结果（0.24.1 那次没真出片），带视频结果的老节点由 sampleFacts.test.ts 的「没来历的视频结果」一条钉住。
 */
import { describe, expect, it } from 'vitest'
import { loadFixture, openProject } from '../../../../tests/fixtures/old-user-data/canvas/canvasModeOldUser.testkit'
import { sampleFactsOf, sampleRowOf, sampleRowOwnsProgress } from './sampleFacts'

describe('老项目画布（0.24.1 真实存盘）· 升级后没有样片', () => {
  const { canvas } = loadFixture()
  const opened = openProject(canvas)

  it('夹具真有带结果的节点（不是空跑）', () => {
    expect(opened.nodes.length).toBe(canvas.nodes.length)
    expect(opened.nodes.filter((node) => node.result).length).toBeGreaterThan(0)
    expect(opened.nodes.some((node) => node.kind === 'video')).toBe(true)
  })

  it('每个节点：读不出样片事实、没有下方那一行、等待面照旧归节点', () => {
    for (const node of opened.nodes) {
      expect(sampleRowOf(node), node.id).toBeNull()
      expect(sampleRowOwnsProgress(node), node.id).toBe(false)
      for (const result of [node.result, ...(node.history ?? [])]) expect(sampleFactsOf(node, result), node.id).toBeNull()
    }
  })

  it('存回的片段不多出样片号', () => {
    const saved = JSON.stringify(opened.saved)
    expect(saved).not.toContain('draftTaskId')
    expect(saved).not.toContain('draft_task_id')
  })
})
