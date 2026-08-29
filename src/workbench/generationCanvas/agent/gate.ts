// 统一求值流(harness §6.1)——AI 想动你的作品前必经的那道门。
// 渲染层只评估会抵达 UI 的操作；main-owned 只读能力不会进入这里。
// 三步:① policy(本地无副作用→allow)② invariant(校验→deny)③ ask(其余→等用户点头)。
// SDK 的 hook registry / permission mode / 规则 DSL 一律不抄(单用户桌面无配置面)。
import i18n from '../../../i18n'

/** 三种 intent = 同一管道的三种入口(每工具 / 批量计划 / 预算)。 */
export type GateIntent =
  | { kind: 'tool-call'; toolName: string; args: unknown }
  | { kind: 'batch-run'; nodeIds: string[] } // S2b/S6b 受理
  | { kind: 'spend'; estimatedCost: number } // S7 预算门

/** ask 的 proposal 由调用方持有(渲染层的 pending 卡),决策本身只需三态。 */
export type GateDecision =
  | { outcome: 'allow' }
  | { outcome: 'deny'; reason: string } // reason = 人话(回喂 LLM 可自我修正,N14 素材)
  | { outcome: 'ask' }

/** 求值上下文(S6-4 锁)。 */
export type GateContext = {
  /** 被用户锁住的节点 id→标题(deny reason 用人话点名);改其 prompt/删除/入边 = deny。 */
  lockedNodes?: ReadonlyMap<string, string>
  /** LLM 口中的 clientId → 真实节点 id(applyCanvasToolCall 注册表;缺省原样返回)。 */
  resolveNodeId?: (id: string) => string
}

/** 工具写/破坏性/花钱分级(T2 meta 的声明式落地;唯一真相源,取代硬编码字符串门)。 */
type ToolMeta = { writes: boolean; destructive?: boolean; costy?: boolean }

const TOOL_META: Record<string, ToolMeta> = {
  // 产出分镜方案对象,只落创作 store 给用户审/改(不写画布投影、不花钱)——免费可改,直通放行(allow)。
  // 真正花钱/写画布的是用户确认后由方案转出的 canonical Canvas write + generation batch。
  propose_storyboard_plan: { writes: false },
  // 写时间轴(非画布投影,不花钱):非破坏、可撤销,但有可见副作用——按写操作走确认门(ask)。
  // 锁不变量只管画布节点,evaluateLock 对此工具名返回 null,自然放行到 ask。
  arrange_storyboard_to_timeline: { writes: true },
  // 站位参考:建 scene3d 节点 + 离屏出灰模参考图(零扣费),但写画布有可见副作用→按写操作走确认门(ask)。
  create_staging_reference: { writes: true },
  // 运镜参考:建 scene3d 节点 + 离屏渲运镜小片(零扣费),但写画布有可见副作用→按写操作走确认门(ask)。
  create_camera_move: { writes: true },
}

/**
 * 单一求值入口。纯函数:同 (intent, ctx) 必得同 decision,便于单测/重放。
 * 决策落日志的裁剪在调用方(deny 必入、ask 结果入、只读 allow 不入——纯噪声)。
 */
export function evaluateGate(intent: GateIntent, ctx: GateContext = {}): GateDecision {
  void ctx
  if (intent.kind === 'tool-call') {
    const meta = TOOL_META[intent.toolName]
    // ② invariant(校验):不认识的工具 = 注定失败的计划,不让用户批准(§6.5)。
    if (!meta) {
      return {
        outcome: 'deny',
        reason: i18n.t('generationCommon.agentRuntime.unsupportedOperation', { operation: intent.toolName }),
      }
    }
    // ① policy:只读直通,零摩擦(M1)。
    if (!meta.writes && !meta.costy) return { outcome: 'allow' }
    // ③ ask:写操作排队等用户点头。
    return { outcome: 'ask' }
  }
  // batch-run / spend:S6b / S7 落地受理与预算语义,本片先一律 ask。
  return { outcome: 'ask' }
}
