/**
 * 分镜方案 ↔ 主进程 generation resolve 的 renderer 薄客户端（切片 2 窄 IPC 的调用面）。
 *
 * 职责只有两件，其余语义全在纯函数层（storyboardStrategy / planResolver）：
 *   - `fetchStoryboardResolve`：把方案投影成引擎输入 → 走 `DesktopBridge.generationStrategy.resolvePlan`
 *     （可选 client 注入便于单测；真机从 `getDesktopBridge()` 拿）；
 *   - `resolveGeneratableGate`：执行闸——生成前确认「原样生成不会截断/无法出片」，返回第一条人话阻断理由。
 *
 * fail-open 边界：没有 bridge / 没有当前项目 / resolve 通道不可用（core 未起等）→ 一律放行（生成合法性另有
 * main 侧契约钳值兜底；本闸是「落画布前建议级」拦截，不是安全边界，R28 的防线在更早的契约层）。
 */
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import {
  firstResolveBlockerMessage,
  hasResolveBlockers,
  storyboardPlanToPlanShotInputs,
} from '../../generationCanvas/agent/storyboardStrategy'
import type {
  GenerationResolvePlanEnvelope,
  GenerationResolvePlanRequest,
} from '../../../../electron/shared/videoCapabilities/planResolutionContracts'

/** 渲染层能拿到的 resolve 调用面（真机 = DesktopBridge.generationStrategy；测试可注入假面）。 */
export type StoryboardResolveClient = {
  resolvePlan: (request: GenerationResolvePlanRequest) => Promise<GenerationResolvePlanEnvelope>
}

export function videoShotCount(plan: StoryboardPlan): number {
  return plan.shots.filter((shot) => shot.shotKind !== 'image').length
}

/** 方案 → resolve 请求（纯）；无视频镜头 = null（不查）。 */
export function storyboardResolveRequest(plan: StoryboardPlan, projectId: string): GenerationResolvePlanRequest | null {
  const shots = storyboardPlanToPlanShotInputs(plan)
  if (shots.length === 0) return null
  return { projectId, shots }
}

/** 拉取一次 resolve 载荷。返回 null = 不该查（无视频镜）或通道不可用（放行语义）。 */
export async function fetchStoryboardResolve(
  plan: StoryboardPlan,
  projectId: string | null | undefined,
  client: StoryboardResolveClient | null | undefined,
): Promise<GenerationResolvePlanEnvelope | null> {
  if (!projectId || !client) return null
  const request = storyboardResolveRequest(plan, projectId)
  if (!request) return null
  try {
    return await client.resolvePlan(request)
  } catch {
    return null
  }
}

/**
 * 执行闸：可生成则返回 null；否则返回第一条阻断理由（人话，给 toast/面板顶部）。
 * fail-open：通道不可用 / resolve 报错一律放行（见头注释）。
 */
export async function resolveGeneratableGate(
  plan: StoryboardPlan,
  projectId: string | null | undefined,
  client: StoryboardResolveClient | null | undefined,
): Promise<string | null> {
  const envelope = await fetchStoryboardResolve(plan, projectId, client)
  if (!envelope) return null
  if (!envelope.ok) return null
  if (!hasResolveBlockers(envelope.value)) return null
  return firstResolveBlockerMessage(envelope.value)
}
