import { describe, expect, it } from 'vitest'
import type { RowActionContext } from '../../creation/storyboard/exec/storyboardRowActions'
import type { StoryboardPlan } from '../agent/storyboardPlan'

/**
 * 付费来源（initiator）在整条链上**必填、没有缺省**（R17：让编译器拦）。
 *
 * 缺省成 'user' 是 fail-open：下一个忘了报来源的新入口，会被当成「用户自己点的便宜单张」直接花钱不问。
 * 这里每一处 `@ts-expect-error` 都是一道护栏——谁把 initiator 改回可选，标注就成了多余的，
 * `check:test-types` 报 TS2578 变红。只取类型、闭包从不执行，不在运行时加载这些模块。
 */
declare const confirmGenerationSpend: typeof import('./spendConfirm').confirmGenerationSpend
declare const confirmAndMintGrant: typeof import('./spendConfirm').confirmAndMintGrant
declare const confirmAndRunNode: typeof import('../runner/generationRunController').confirmAndRunNode
declare const confirmAndRunNodeVariants: typeof import('../runner/generationRunController').confirmAndRunNodeVariants
declare const regenerateNodeInPlace: typeof import('../runner/generationRunController').regenerateNodeInPlace
declare const confirmAndRunPlan: typeof import('../components/batchPlanPreview').confirmAndRunPlan
declare const plan: StoryboardPlan

describe('initiator 在付费链上必填', () => {
  it('每一环省掉它都编译不过；分镜行动作要么带手势、要么显式写来源', () => {
    const neverCalled = () => {
      // @ts-expect-error initiator 必填
      void confirmGenerationSpend([], { title: '', message: '' })
      // @ts-expect-error initiator 必填
      void confirmAndMintGrant({ nodeIds: [], nodes: [], title: '', message: '' })
      // @ts-expect-error 第二个参数（含 initiator）必填
      void confirmAndRunNode('node')
      // @ts-expect-error initiator 必填
      void confirmAndRunNode('node', { rerun: true })
      // @ts-expect-error 第三个参数（含 initiator）必填
      void confirmAndRunNodeVariants('node', 2)
      // @ts-expect-error 第二个参数（含 initiator）必填
      void regenerateNodeInPlace('node')
      // @ts-expect-error 第二个参数（含 initiator）必填
      void confirmAndRunPlan({ waves: [], edgesUsed: [], blocked: [] })

      // @ts-expect-error 既没手势也没 initiator
      const noSource: RowActionContext = { documentId: 'doc', designId: 'design', plan }
      // @ts-expect-error 手势与 initiator 只能二选一（不许两个来源打架）
      const bothSources: RowActionContext = { documentId: 'doc', designId: 'design', plan, initiator: 'user', gesture: { source: 'agent', txnId: 't' } }
      const fromGesture: RowActionContext = { documentId: 'doc', designId: 'design', plan, gesture: { source: 'agent', txnId: 't' } }
      const explicit: RowActionContext = { documentId: 'doc', designId: 'design', plan, initiator: 'user' }
      return [noSource, bothSources, fromGesture, explicit]
    }
    expect(typeof neverCalled).toBe('function')
  })
})
