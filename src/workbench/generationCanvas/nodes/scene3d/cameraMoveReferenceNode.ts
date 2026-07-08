// 运镜参考节点的「建节点 + 打 cameraMoveAutoCapture 标志」单一真相源（P1/P4）。
//
// 从 applyCanvasToolCall.ts 的 create_camera_move 精确分支抽出——AI 工具执行器和手动运镜控件
// （NodeCameraMoveControl）都调它，杜绝并行拷贝各自算 fps/frameCount/meta（那会像 handleRecordTake
// 一样漏掉 move 而与不变量漂移）。
//
// 输入 = 语义 spec（词汇 → cameraMoveBuilder），输出 = 一个 kind:'scene3d' 节点，meta 带：
//   - scene3dState：含相机轨迹的 3D 场景（buildCameraMoveScene）
//   - cameraMoveAutoCapture：{ targetNodeId?, fps, frameCount, move } —— 常驻 CameraMoveCaptureHost
//     扫到它就离屏采帧拼 mp4 + 喂目标镜头 video_ref（下游共享 sink，两条产路同一契约）。
// 见 docs/plan/2026-06-22-ai-camera-move-tool.md。
import { generationCanvasTools } from '../../agent/generationCanvasTools'
import { layoutPlannedNodes } from '../../agent/trajectoryLayout'
import { getDefaultCategoryForNodeKind } from '../../model/generationNodeKinds'
import { buildCameraMoveScene, type CameraMoveSpec } from './cameraMoveBuilder'
import { CAMERA_SPEED_DURATION } from './cameraMoveVocab'

// Seedance 参考视频要求帧率 23.8–60 FPS（实测 12fps 被 InvalidParameter.FpsTooLow 拒）。
export const CAMERA_MOVE_CAPTURE_FPS = 24

/** spec 的速度 → 采帧数（round(时长秒 × fps)）。AI 路与手动路共用，锁死不变量。 */
export function cameraMoveFrameCount(spec: CameraMoveSpec, fps: number = CAMERA_MOVE_CAPTURE_FPS): number {
  return Math.round(CAMERA_SPEED_DURATION[spec.speed ?? 'medium'] * fps)
}

export type CreateCameraMoveReferenceNodeArgs = {
  /** 语义运镜 spec（move/speed/shot/subjectPose）。 */
  spec: CameraMoveSpec
  /** 目标镜头的视频节点 id；省略 → 只出 mp4 留痕，不挂参考。 */
  targetNodeId?: string
  /** 手势上下文包裹（AI 提议事务用）；手动控件传恒等 f=>f()。 */
  inCtx?: <T>(fn: () => T) => T
}

export type CreateCameraMoveReferenceNodeResult = {
  cameraMoveNodeId: string | null
  fps: number
  frameCount: number
}

/**
 * 建运镜参考 scene3d 节点 + 打 cameraMoveAutoCapture 标志。**不渲染**——常驻 Host 异步出片。
 * AI 执行器（create_camera_move 精确分支）与手动运镜控件都走这里，是那段的唯一实现（P1/P4）。
 */
export function createCameraMoveReferenceNode(
  args: CreateCameraMoveReferenceNodeArgs,
): CreateCameraMoveReferenceNodeResult {
  const { spec, targetNodeId } = args
  const inCtx = args.inCtx ?? (<T,>(fn: () => T): T => fn())
  const state = buildCameraMoveScene(spec)
  const fps = CAMERA_MOVE_CAPTURE_FPS
  const frameCount = cameraMoveFrameCount(spec, fps)
  const existing = generationCanvasTools.read_canvas().nodes
  const position = layoutPlannedNodes(['image'], existing)[0]
  const created = inCtx(() =>
    generationCanvasTools.create_nodes([
      {
        kind: 'scene3d',
        categoryId: getDefaultCategoryForNodeKind('scene3d'),
        title: '运镜参考',
        prompt: '',
        position,
        meta: {
          scene3dState: state,
          // 标志带上 move（供 Host 拼运镜 prompt directive 的人话/降级 floor；不必从 3D 场景反推）。
          cameraMoveAutoCapture: { ...(targetNodeId ? { targetNodeId } : {}), fps, frameCount, move: spec.move },
        },
      },
    ]),
  )
  return { cameraMoveNodeId: created[0]?.id ?? null, fps, frameCount }
}
