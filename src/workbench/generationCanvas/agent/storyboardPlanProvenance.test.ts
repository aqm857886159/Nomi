import { describe, expect, it } from 'vitest'

import {
  storyboardPlanToCreateNodesArgs,
  type StoryboardPlan,
} from './storyboardPlan'

const PLAN: StoryboardPlan = {
  title: '有来源的分镜',
  sourceScriptArtifactId: 'artifact-script-v3',
  sourceScriptVersion: 3,
  sourceScriptHash: 'script-hash-v3',
  anchors: [],
  shots: [{
    index: 1,
    shotId: 'shot-stable-1',
    shotKind: 'video',
    durationSec: 6,
    anchorIds: [],
    prompt: '镜头缓慢推近',
    ffDesc: '首帧：雨夜窗边，中近景',
    motionDesc: '缓慢推近到主角侧脸',
    subtitle: '你终于来了。',
    dialogue: '你终于来了。',
    lfDesc: '尾帧：主角抬头看向窗外',
    variationType: 'small',
    camIdx: 2,
    continuity: '沿用上一镜的雨夜窗边与冷蓝光',
    transition: { type: 'dissolve', durationFrames: 6 },
  }],
}

describe('StoryboardPlan provenance', () => {
  it('preserves source script version and hash in storyboard artifact', () => {
    const args = storyboardPlanToCreateNodesArgs(PLAN)

    expect(args.sourceScriptArtifactId).toBe('artifact-script-v3')
    expect(args.sourceScriptVersion).toBe(3)
    expect(args.sourceScriptHash).toBe('script-hash-v3')
  })

  it('carries ffDesc, lfDesc, variationType, camIdx and continuity into node metadata', () => {
    const shot = storyboardPlanToCreateNodesArgs(PLAN).nodes.find((node) => node.clientId === 'shot-stable-1')

    expect(shot?.metadata).toMatchObject({
      shotId: 'shot-stable-1',
      sourceScriptArtifactId: 'artifact-script-v3',
      sourceScriptVersion: 3,
      sourceScriptHash: 'script-hash-v3',
      ffDesc: '首帧：雨夜窗边，中近景',
      motionDesc: '缓慢推近到主角侧脸',
      subtitle: '你终于来了。',
      dialogue: '你终于来了。',
      lfDesc: '尾帧：主角抬头看向窗外',
      variationType: 'small',
      camIdx: 2,
      continuity: '沿用上一镜的雨夜窗边与冷蓝光',
      transition: { type: 'dissolve', durationFrames: 6 },
    })
  })

  it('derives a stable shot id for legacy plans that do not have one', () => {
    const plan: StoryboardPlan = {
      ...PLAN,
      shots: [{ ...PLAN.shots[0], shotId: undefined }],
    }

    const shot = storyboardPlanToCreateNodesArgs(plan).nodes.find((node) => node.clientId === 'shot-1')
    expect(shot?.metadata).toMatchObject({ shotId: 'shot-1' })
  })

  it('stamps a stable materialization operation on every node for crash-safe retries', () => {
    const plan: StoryboardPlan = {
      ...PLAN,
      anchors: [{ id: 'hero', kind: 'character', carrier: 'visual', name: '主角', description: '雨夜里的主角' }],
      shots: [{ ...PLAN.shots[0], anchorIds: ['hero'] }],
    }
    const args = storyboardPlanToCreateNodesArgs(plan, { materializationOperationId: 'materialize:run-1:v1' })

    expect(args.nodes.map((node) => node.metadata)).toEqual(expect.arrayContaining([
      // 锚节点自 B 起恒带 anchorId（分镜表绑定键），materialization 戳原样保留。
      expect.objectContaining({ materializationOperationId: 'materialize:run-1:v1', materializationClientId: 'hero', anchorId: 'hero' }),
      expect.objectContaining({ materializationOperationId: 'materialize:run-1:v1', materializationClientId: 'shot-stable-1' }),
    ]))
  })
})
