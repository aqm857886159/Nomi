/**
 * `generation.single-shot` 这个语义面的**路由分类器**。
 *
 * 它不路由 legacy 生成调用，只把墓碑分出来：旧别名的处理器与目录条目删掉之后，
 * 它们必须继续 fail-closed，不能悄悄穿透到新路上双写项目事实。
 *
 * ── 2026-09-21：两个 env flag 与它们背后的三段式 rollout 整条删除 ──
 *
 * 这里曾经有 `NOMI_MCP_GENERATION_SINGLE_SHOT_V1` / `_E1_V1` 两个环境变量，以及由它们派生的
 * `schema_only` / `e0_zero_credit` / `e1_paid` 三个阶段。默认关，于是**外部 AI 一个生成调用都发不出去**，
 * 而五个生成工具仍然挂在 `tools/list` 上广告着——用户让他的助手做一次生成，助手按说明书调用，
 * 拿回一个裸的 `feature_disabled` 和一个指向设置页某个开关的 nextAction，而那个开关在界面上**并不存在**。
 *
 * 用户 2026-09-21 拍板「这版要开，只要可以让用户解决问题就行」。按 P1：一个没有界面能关、
 * 打开之后也没人会去关的 env flag 不是开关，是一道只会把自家广告出去的工具打回去的墙。
 * 所以不是把默认值改成开（那会留一个逃生口：谁设一次 `=0` 就把整个面关掉，而没有任何界面会告诉用户
 * 发生了什么），而是把 flag、阶段、`feature_disabled` / `phase_not_ready` / `not_ready` 三个分支
 * 一起删掉。**能不能做**由租约、闸与人证回答，不由一个环境变量回答。
 */

/** 这个语义面上的全部能力。租约据此发 scope，路由据此判「这是不是一条语义路」。 */
export const MCP_GENERATION_CAPABILITIES = Object.freeze([
  'context',
  'create',
  'plan',
  'preview',
  'read',
  'events',
  'gate_request',
  'gate_decide',
  'start',
  'cancel',
  'reconcile',
  'steer',
] as const)

export type McpGenerationCapability = (typeof MCP_GENERATION_CAPABILITIES)[number]

type LegacyMcpGenerationRoute = 'generate' | 'nomi_generate' | 'production.start' | 'production.control' | 'production.decide-gate' | 'nomi_start_playbook'

type McpGenerationRoute =
  | Readonly<{ kind: 'legacy'; route: LegacyMcpGenerationRoute }>
  | Readonly<{ kind: 'semantic' }>

// 这六条 legacy 生成路显式标 legacy（runtime plan §7 + P4 S7 收敛映射表，
// docs/plan/2026-08-25-p4-s7-legacy-converge.md §2）：guardLegacyGenerationRoute 见语义 binding 即拒
// （legacy_path_forbidden），不与新路径双写项目事实。集合缩水 = 语义 binding 可能从旧路穿透双写，
// 由 check:batch-machines 规则 legacy-routes-shrunk 钉死。挪动任何一条必须同步收敛映射表。
const LEGACY_GENERATION_ROUTES: ReadonlySet<LegacyMcpGenerationRoute> = new Set([
  'generate',
  'nomi_generate',
  'production.start',
  'production.control',
  'production.decide-gate',
  'nomi_start_playbook',
])

export function classifyMcpGenerationRoute(route: string): McpGenerationRoute {
  if (LEGACY_GENERATION_ROUTES.has(route as LegacyMcpGenerationRoute)) {
    return { kind: 'legacy', route: route as LegacyMcpGenerationRoute }
  }
  return { kind: 'semantic' }
}
