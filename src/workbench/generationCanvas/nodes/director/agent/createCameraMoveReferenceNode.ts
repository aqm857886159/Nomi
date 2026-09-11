/**
 * [INPUT]: 依赖 ../../../agent/generationCanvasTools（generationCanvasTools / readGenerationCanvasSnapshot）、../../../agent/trajectoryLayout 的 layoutPlannedNodes、
 *          ../../../model/generationNodeKinds 的 getDefaultCategoryForNodeKind、../../../../../i18n、./cameraMoveBuilder 的 buildCameraMoveScene、
 *          ./cameraMoveVocab 的 CAMERA_SPEED_DURATION、../migration/migrateScene3d 的 migrateScene3DState、../model/directorNodeMeta 的 meta 键
 * [OUTPUT]: 对外提供 CAMERA_MOVE_CAPTURE_FPS、cameraMoveFrameCount、CameraMoveAutoCapture、readCameraMoveAutoCapture、createCameraMoveReferenceNode
 * [POS]: director/agent 的「运镜参考建节点」单一真相：AI 工具 create_camera_move 与手动运镜控件（NodeCameraMoveControl）都调它——
 *        词表 spec → V1 形状运镜场景 → 迁成导演台工程 → 建 director 节点并打 cameraMoveAutoCapture（targetNodeId / fps / frameCount / move）；
 *        **不渲染**，常驻 CameraMoveCaptureHost 扫到标志才离屏采帧拼 mp4。两条产路共用 fps / frameCount 不变量，不各自内联。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import i18n from '../../../../../i18n'
import { generationCanvasTools, readGenerationCanvasSnapshot } from '../../../agent/generationCanvasTools'
import { layoutPlannedNodes } from '../../../agent/trajectoryLayout'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { getDefaultCategoryForNodeKind } from '../../../model/generationNodeKinds'
import { migrateScene3DState } from '../migration/migrateScene3d'
import { CAMERA_MOVE_AUTO_CAPTURE_META_KEY, DIRECTOR_NODE_KIND, DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import { buildCameraMoveScene, type CameraMoveSpec } from './cameraMoveBuilder'
import { CAMERA_SPEED_DURATION, type CameraMove } from './cameraMoveVocab'

// Seedance 参考视频要求帧率 23.8–60 FPS（实测 12fps 被 InvalidParameter.FpsTooLow 拒）
export const CAMERA_MOVE_CAPTURE_FPS = 24

export type CameraMoveAutoCapture = {
  targetNodeId?: string
  frameCount?: number
  fps?: number
  move?: CameraMove
}

export function readCameraMoveAutoCapture(node: Pick<GenerationCanvasNode, 'meta'>): CameraMoveAutoCapture | null {
  const raw = node.meta?.[CAMERA_MOVE_AUTO_CAPTURE_META_KEY]
  return raw && typeof raw === 'object' ? (raw as CameraMoveAutoCapture) : null
}

/** spec 的速度 → 采帧数（round(时长秒 × fps)）。AI 路与手动路共用，锁死不变量。 */
export function cameraMoveFrameCount(spec: CameraMoveSpec, fps: number = CAMERA_MOVE_CAPTURE_FPS): number {
  return Math.round(CAMERA_SPEED_DURATION[spec.speed ?? 'medium'] * fps)
}

export type CreateCameraMoveReferenceNodeArgs = {
  spec: CameraMoveSpec
  /** 目标镜头的视频节点 id；省略 → 只出 mp4 留痕，不挂参考 */
  targetNodeId?: string
  /** 手势上下文包裹（AI 提议事务用）；手动控件省略 */
  inCtx?: <T>(fn: () => T) => T
}

export type CreateCameraMoveReferenceNodeResult = { cameraMoveNodeId: string | null; fps: number; frameCount: number }

export function createCameraMoveReferenceNode(args: CreateCameraMoveReferenceNodeArgs): CreateCameraMoveReferenceNodeResult {
  const { spec, targetNodeId } = args
  const inCtx = args.inCtx ?? (<T>(fn: () => T): T => fn())
  const title = i18n.t('director.agent.cameraMoveReference')
  const { project } = migrateScene3DState(buildCameraMoveScene(spec), { sceneName: title })
  const fps = CAMERA_MOVE_CAPTURE_FPS
  const frameCount = cameraMoveFrameCount(spec, fps)
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
          // 标志带上 move：Host 拼运镜提示词 / 降级地板要人话，不必从工程反推
          [CAMERA_MOVE_AUTO_CAPTURE_META_KEY]: { ...(targetNodeId ? { targetNodeId } : {}), fps, frameCount, move: spec.move },
        },
      },
    ]),
  )
  return { cameraMoveNodeId: created[0]?.id ?? null, fps, frameCount }
}
