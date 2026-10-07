/**
 * 群众基准（施工计划 docs/plan/2026-10-07-director-ual-mannequin.md §6）：N 个默认 UAL 人偶，每帧跑编辑器真用的姿态管线
 * （characterPosePipeline.poseCharacterFrame：复位 → 静止预设 + 动作层 → basePose → 偏移 → 更新矩阵）+ 蒙皮骨矩阵（skeleton.update，渲染器每帧要做的 CPU 部分）。
 * 纯 CPU，不含 GPU 绘制与阴影。每次迭代 = 一帧，时间前进 1/30 秒（不让缓存跨帧占便宜）。只记录数字，不进 CI。
 *
 * 跑：npx vitest bench --run src/workbench/generationCanvas/nodes/director/scene/character/characterCrowd.bench.ts
 * 读：mean 列就是「每帧毫秒」。目标：100 人同一动作 ≤ 12 ms（编辑器视口 ≥ 30 fps 的逐帧 JS 预算）。
 */
import * as THREE from 'three'
import { bench, describe, vi } from 'vitest'
import { createDirectorStore } from '../../model/directorStore'
import type { DirectorObject } from '../../model/directorTypes'
import { prepareCharacterModel } from './characterAsset'
import { createCharacterPoseContext, poseCharacterFrame, type CharacterPoseContext } from './characterPosePipeline'
import { loadPoseClipsFrom } from './poseClipLibrary'
import { loadUalMannequinForTest } from './ualMannequin.testkit'

vi.mock('../../../../../../desktop/rendererLog', () => ({ logRendererError: () => {}, logRendererWarn: () => {} }))

const gltf = await loadUalMannequinForTest()
loadPoseClipsFrom(gltf)

const MIXED = ['Walk_Loop', 'Idle_Loop', 'Idle_Talking_Loop', 'Jog_Fwd_Loop', 'Sitting_Idle_Loop', 'Crouch_Idle_Loop', 'Dance_Loop', 'Push_Loop', 'Sprint_Loop', 'Walk_Formal_Loop']

type Crowd = { people: Array<{ context: CharacterPoseContext; skinned: THREE.SkinnedMesh | null; object: DirectorObject }>; time: number }

function crowd(count: number, actionFor: (index: number) => string): Crowd {
  const people = Array.from({ length: count }, (_, index) => {
    const prepared = prepareCharacterModel(gltf.scene, { builtin: true, rig: 'ual' })
    // 与 storeEntityActions.batchCreateCrowd 一样：每个人一份完整的对象（静止预设 + 一段很长的动作片段）
    const object: DirectorObject = {
      id: `crowd-${index}`, name: `群众${index}`, type: 'character', rig: 'ual', modelPath: 'builtin:ual',
      position: { x: index % 10, y: 0, z: Math.floor(index / 10) }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false,
      posePreset: 'Idle_Loop',
      actionClips: [{ id: `crowd-${index}-clip`, name: 'clip', clipType: 'action', actionPose: actionFor(index), startTime: 0, endTime: 100000, startFrame: 0, endFrame: 3000000 }],
    }
    return { context: createCharacterPoseContext(prepared.object), skinned: prepared.skinned, object }
  })
  return { people, time: 1 }
}

function frame(group: Crowd): void {
  group.time += 1 / 30
  for (const person of group.people) {
    poseCharacterFrame(person.context, person.object, group.time, { keepBasePose: false })
    person.skinned?.skeleton.update()
  }
}

const options = { time: 1500, warmupTime: 300 }

describe('群众：同一动作同一时刻（batchCreateCrowd 的典型样子）', () => {
  for (const count of [1, 10, 100]) {
    const group = crowd(count, () => 'Walk_Loop')
    bench(`N=${count}`, () => frame(group), options)
  }
})

describe('群众：10 种动作混着', () => {
  for (const count of [10, 100]) {
    const group = crowd(count, (index) => MIXED[index % MIXED.length])
    bench(`N=${count}`, () => frame(group), options)
  }
})

// 施工计划 §11 风险 9：batchCreateCrowd 每人深拷贝整份对象（动作片段 / 轨迹），量工程体积与生成耗时（撤销栈存整树快照，最多 50 步）
describe('群众：一键生成 10×10 的工程体积与耗时', () => {
  const seed = (): { store: ReturnType<typeof createDirectorStore>; id: string } => {
    const store = createDirectorStore({ defaultSceneName: 'Scene' })
    const { id: _id, ...template } = crowd(1, () => 'Walk_Loop').people[0].object
    void _id
    return { store, id: store.getState().addObject(template) }
  }
  const once = seed()
  const before = JSON.stringify(once.store.getState().exportProject()).length
  once.store.getState().batchCreateCrowd(once.id, 10, 10, 1.2, 'crowd')
  const after = JSON.stringify(once.store.getState().exportProject()).length
  console.log(`[crowd] 工程 JSON：1 人 ${before} 字节 → 10×10 群众 ${after} 字节（${(after / 1024).toFixed(0)} KB）；撤销栈 50 步上限时最坏约 ${((after * 50) / 1024 / 1024).toFixed(1)} MB`)
  bench('batchCreateCrowd 10×10', () => {
    const fresh = seed()
    fresh.store.getState().batchCreateCrowd(fresh.id, 10, 10, 1.2, 'crowd')
  }, { time: 1000, warmupTime: 200 })
})
