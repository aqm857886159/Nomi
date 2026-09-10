/**
 * [INPUT]: 依赖 ../../../agent/generationCanvasTools（generationCanvasTools / readGenerationCanvasSnapshot）、../../../agent/trajectoryLayout 的 layoutPlannedNodes、
 *          ../../../model/generationNodeKinds 的 getDefaultCategoryForNodeKind、../../../../../i18n、./stagingBuilder 的 buildStagingSceneAudited、
 *          ../migration/migrateScene3d 的 migrateScene3DState、../model/directorNodeMeta 的 meta 键
 * [OUTPUT]: 对外提供 StagingAutoCapture、readStagingAutoCapture、createStagingReferenceNode
 * [POS]: director/agent 的「站位参考建节点」单一真相：create_staging_reference 工具执行器调它——词表 spec → V1 形状场景（含运行时自检）→ 迁成导演台工程
 *        → 建 director 节点并打 stagingAutoCapture 标志；**不渲染**，常驻 StagingCaptureHost 扫到标志才离屏出图。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import i18n from '../../../../../i18n'
import { generationCanvasTools, readGenerationCanvasSnapshot } from '../../../agent/generationCanvasTools'
import { layoutPlannedNodes } from '../../../agent/trajectoryLayout'
import { getDefaultCategoryForNodeKind } from '../../../model/generationNodeKinds'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { migrateScene3DState } from '../migration/migrateScene3d'
import { DIRECTOR_NODE_KIND, DIRECTOR_PROJECT_META_KEY, STAGING_AUTO_CAPTURE_META_KEY } from '../model/directorNodeMeta'
import { buildStagingSceneAudited, type StagingSpec } from './stagingBuilder'

export type StagingAutoCapture = { targetNodeId?: string }

export function readStagingAutoCapture(node: Pick<GenerationCanvasNode, 'meta'>): StagingAutoCapture | null {
  const raw = node.meta?.[STAGING_AUTO_CAPTURE_META_KEY]
  return raw && typeof raw === 'object' ? (raw as StagingAutoCapture) : null
}

export type CreateStagingReferenceNodeArgs = {
  spec: StagingSpec
  /** 目标镜头的关键帧图片节点 id；省略 → 只出图留痕，不连 composition_ref */
  targetNodeId?: string
  /** 手势上下文包裹（AI 提议事务用） */
  inCtx?: <T>(fn: () => T) => T
}

export function createStagingReferenceNode(args: CreateStagingReferenceNodeArgs): { stagingNodeId: string | null; issues: string[] } {
  const inCtx = args.inCtx ?? (<T>(fn: () => T): T => fn())
  const { state, issues } = buildStagingSceneAudited(args.spec)
  const title = i18n.t('director.agent.stagingReference')
  const { project } = migrateScene3DState(state, { sceneName: title })
  const existing = readGenerationCanvasSnapshot().nodes
  const position = layoutPlannedNodes(['image'], existing)[0]
  const created = inCtx(() =>
    generationCanvasTools.create_nodes([
      {
        kind: DIRECTOR_NODE_KIND,
        categoryId: getDefaultCategoryForNodeKind(DIRECTOR_NODE_KIND),
        title,
        prompt: '',
        position,
        meta: {
          [DIRECTOR_PROJECT_META_KEY]: project,
          [STAGING_AUTO_CAPTURE_META_KEY]: args.targetNodeId ? { targetNodeId: args.targetNodeId } : {},
        },
      },
    ]),
  )
  return { stagingNodeId: created[0]?.id ?? null, issues }
}
