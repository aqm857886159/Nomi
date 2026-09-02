// 能力核 · MCP 工具契约目录（单一职责：把 Nomi 能力核暴露成哪些 MCP 工具、各自的 name/title/description/
// inputSchema(JSON Schema)/method(能力核方法或内部路由键)/build(args→params)）。
//
// 面收敛（2026-09-02，surface-16-collapse）：42 个「一动词一工具」的 API 镜像塌成 15 个「按对象归并」的贴任务
// 工具。收敛只发生在 catalog 层——每个新工具的 build 按 target/action/phase 枚举分派到**原 method 字面量 +
// 原 params 形状**；能力核 handler、付费 seam（MAC/fail-closed/收据落账）一行不碰（见 mcpGenerationTools.ts /
// dispatcher.ts / generationDispatcher.ts）。多态工具带 resolveMethod(args)→内部路由键；消费方（mcpProtocol）
// 用 tool.resolveMethod?.(args) ?? tool.method 派发。读侧全收进一个整体 readOnlyHint 的 nomi_read（形状约束1：
// 读写分名）；付费两相靠 phase(T7)/action(T14) 保相位（形状约束2/3）。
//
// title 字段：MCP tools spec 2025-06-18 支持，宿主 UI 优先显示。readOnlyHint 收进本目录 annotations（真相单一，
// 不再靠 mcpProtocol.ts 的 name 集合旁挂）。
//
import { listProductionPlaybookNames } from '../productionRun/productionPlaybooks'
import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
import { MCP_CAPABILITY_RESOLVER, immutableSchemaSnapshot } from './mcpCapabilityProjection'
import { MCP_GENERATION_TOOL_CATALOG } from './mcpGenerationTools'
import { MCP_INTEGRATION_TOOL, INTEGRATION_METHOD_BY_ACTION } from './mcpIntegrationTools'
import { MCP_PROJECT_SESSION_TOOL } from './mcpProjectSessionTool'

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

// 画布只读投影（canvas.read capability adapter；别名由能力契约声明，M2 语义面把它改叫 nomi_canvas_read）——
// 收进 nomi_read target=canvas 时借它的 method/canonical 投影（读侧统一，形状约束1：不另留第二个画布读名）。
const CANVAS_READ_ALIAS = CANVAS_READ_CAPABILITY.aliases.mcp
const CANVAS_READ_ADAPTER_TOOL = MCP_CAPABILITY_RESOLVER.list().find((tool) => tool.name === CANVAS_READ_ALIAS)
if (!CANVAS_READ_ADAPTER_TOOL) throw new Error('canvas.read MCP adapter is not registered')
/** target=canvas 的内部路由键（= CANVAS_READ_CAPABILITY.id）；nomi_read 借它走 canvas.read 传输适配器。 */
export const CANVAS_READ_METHOD = CANVAS_READ_ADAPTER_TOOL.method

// ── T3 · nomi_canvas_edit：画布写=语义租约面（M2 canvas/document 根因契约） ─────────────────────
// 并线裁定（2026-09-02）：42→15 收敛期的 action→canvas.addNodes/... 薄路由与 M2 语义面同名相撞。语义面
//（leaseHandle 必填、operation 枚举、canvas.write 能力路由、fail-closed 图校验）是根因修复
//（docs/fixes/2026-09-02-m2-canvas-document-semantic-surface.root-cause.json），薄路由正是它要杀的
//「目录直投遗留画布操作、裸 projectId 可写」——同 commit 删净（P1），画布写只此一面；删除/撤销走
// nomi_canvas_maintenance（destructiveHint + confirmation + undoToken）。
const CANVAS_EDIT_TOOL = MCP_CAPABILITY_RESOLVER.resolve('nomi_canvas_edit')
if (!CANVAS_EDIT_TOOL) throw new Error('canvas.write MCP adapter is not registered')

// M2 语义编辑工具（timeline_read/edit · export_job · media_query + M2 canvas/document 语义面）——
// 独立能力投影，非本次 42→15 收敛的一员，此处**原样保留**其已发布形态（读工具带 annotations.readOnlyHint），
// 不替它们发明 nomi_read target/collapse 归并——那是未经设计稿裁定的新面设计，留给编排者续裁。
// canvas.read 已进 nomi_read（target=canvas）、canvas 写已是 T3 本体，这两个从透传里排除以免撞名/并行版。
const SEMANTIC_EDITING_TOOLS = MCP_CAPABILITY_RESOLVER.list().filter((tool) => tool.name !== CANVAS_READ_ALIAS && tool.name !== CANVAS_EDIT_TOOL.name)
if (SEMANTIC_EDITING_TOOLS.length === 0) throw new Error('M2 semantic editing MCP adapters are not registered')

// ── T2 · nomi_read：读侧统一入口（多态只读，整体 readOnlyHint） ───────────────────────────────
// 每个旧读工具 = 一个 target 值；get/read 双读（get_artifact vs read_artifact）= artifact vs artifact_content
// 两个 target（投影深浅不同）；subscribe 长轮询 = run_events + waitMs/afterCursor。必填由 handler 按 target 断言
// （schema 层不上 oneOf/if-then，与 validateToolArguments 单边界家法一致；坏组合诊断码由 C3 测试钉住）。
const READ_METHOD_BY_TARGET: Record<string, string> = {
  canvas: CANVAS_READ_METHOD,
  projects: 'project.list',
  models: 'models.list',
  generation_context: 'nomi_get_generation_context',
  operation: 'nomi_operation_read',
  run: 'production.get',
  run_events: 'production.events',
  artifact: 'production.artifact',
  artifact_content: 'production.artifact.read',
  integration: 'integration.get',
}
/** nomi_read 的 target 集合（供 mcpProtocol 判 widget/canonical 投影时复用，真相单一）。 */
export const READ_TARGETS = Object.freeze(Object.keys(READ_METHOD_BY_TARGET))
/** target∈{run,run_events,artifact} → 挂 nomiRunData/widget 投影（形状约束：投影不许丢）。 */
export const READ_RUN_DATA_TARGETS = Object.freeze(['run', 'run_events', 'artifact'])

const READ_TOOL = {
  name: 'nomi_read',
  title: '读 Nomi 的任意只读投影（画布/项目/模型/生成上下文/Run/产物/接入会话）。',
  description: '按 target 读一份安全只读投影；不改状态、不花钱。',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', enum: READ_TARGETS, description: '读什么：canvas 画布 / projects 项目 / models 模型 / generation_context 生成上下文 / operation 生成草稿 / run 制作 Run / run_events 长轮询事件 / artifact 产物元数据 / artifact_content 产物全文 / integration 接入会话。' },
      projectId: { type: 'string' },
      leaseHandle: { type: 'string', description: 'target∈{canvas,generation_context,operation} 需要。' },
      runId: { type: 'string', description: 'target∈{run,run_events,artifact,artifact_content} 需要。' },
      operationId: { type: 'string', description: 'target=operation 需要。' },
      artifactId: { type: 'string', description: 'target∈{artifact,artifact_content} 需要。' },
      sessionId: { type: 'string', description: 'target=integration 需要。' },
      afterCursor: { type: 'integer', minimum: 0, default: 0, description: 'target=run_events 长轮询起点游标。' },
      waitMs: { type: 'integer', minimum: 0, maximum: 25_000, default: 0, description: 'target=run_events 最多等待毫秒（≤25s）。' },
      page: { type: 'integer', minimum: 0, description: 'target∈{projects,models} 分页页码。' },
    },
    required: ['target'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true as const },
  method: 'production.get',
  resolveMethod: (a: Record<string, unknown>): string => READ_METHOD_BY_TARGET[str(a.target)] ?? 'production.get',
  build: (a: Record<string, unknown>): Record<string, unknown> => {
    const target = str(a.target)
    switch (target) {
      case 'canvas':
        // 与旧 nomi_read_canvas 的 canvasReadTransportInputSchema 同形：leaseHandle（必填）+ 可选 projectId。
        return { ...(typeof a.leaseHandle === 'string' ? { leaseHandle: a.leaseHandle } : {}), ...(typeof a.projectId === 'string' ? { projectId: a.projectId } : {}) }
      case 'generation_context':
        return { projectId: a.projectId, leaseHandle: a.leaseHandle }
      case 'operation':
        return { projectId: a.projectId, leaseHandle: a.leaseHandle, operationId: a.operationId }
      case 'projects':
      case 'models':
        return {}
      case 'run':
        return { projectId: a.projectId, runId: a.runId }
      case 'run_events':
        return { projectId: a.projectId, runId: a.runId, afterCursor: a.afterCursor ?? 0, waitMs: a.waitMs ?? 0 }
      case 'artifact':
      case 'artifact_content':
        return { projectId: a.projectId, runId: a.runId, artifactId: a.artifactId }
      case 'integration':
        return { sessionId: a.sessionId }
      default:
        return {}
    }
  },
} as const

// ── T4 · nomi_asset_import：本机文件→项目素材 ────────────────────────────────────────────
const ASSET_IMPORT_TOOL = {
  name: 'nomi_asset_import',
  title: '把本机图片/视频文件导入项目当素材，返回可引用的 nomi-local:// 地址。',
  description: '导入本机文件为项目素材。只收 png/jpg/webp/gif/bmp/tiff/heic/mp4/mov/webm/m4v，单个 ≤64MB，须传绝对路径；系统/凭据目录（~/.ssh、~/.nomi）会被拒绝。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      path: { type: 'string', description: '本机文件的绝对路径，如 /Users/你/Desktop/参考.png' },
      title: { type: 'string', description: '可选：素材名（不带扩展名也行，会自动补）' },
    },
    required: ['projectId', 'path'],
    additionalProperties: false,
  },
  method: 'asset.import',
  build: (a: Record<string, unknown>): Record<string, unknown> => ({ projectId: a.projectId, path: a.path, ...(a.title ? { title: a.title } : {}) }),
} as const

// ── T12 · nomi_artifact_review：版本化剧本/分镜的审阅+定点修订（簇 B 镜像消除：script/storyboard 双工具→kind） ──
const ARTIFACT_REVIEW_TOOL = {
  name: 'nomi_artifact_review',
  title: '审阅/修订版本化剧本或分镜：approve 采用 / request_changes 请求改 / reject 否决 / revise 起定点修订候选。',
  description: '按 action 对当前版本的剧本或分镜表态或修订；只能操作你刚读到的版本（乐观锁）。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      runId: { type: 'string' },
      artifactId: { type: 'string' },
      expectedVersion: { type: 'integer', minimum: 1, description: '你刚读到的当前版本；版本变化后请求会被拒绝。' },
      action: { type: 'string', enum: ['approve', 'request_changes', 'reject', 'revise'] },
      kind: { type: 'string', enum: ['script', 'storyboard'], description: 'action=revise 必填：改剧本还是分镜。' },
      instruction: { type: 'string', minLength: 1, maxLength: 4_000, description: 'action=revise 必填：只描述这次定点修改。' },
    },
    required: ['projectId', 'runId', 'artifactId', 'expectedVersion', 'action'],
    additionalProperties: false,
  },
  method: 'production.artifact.review',
  resolveMethod: (a: Record<string, unknown>): string =>
    str(a.action) === 'revise' ? 'production.artifact.revise' : 'production.artifact.review',
  build: (a: Record<string, unknown>): Record<string, unknown> => {
    const base = { projectId: a.projectId, runId: a.runId, artifactId: a.artifactId, expectedVersion: a.expectedVersion }
    if (str(a.action) === 'revise') return { ...base, instruction: a.instruction, kind: a.kind }
    // approve/request_changes/reject → production.artifact.review 的 decision 枚举。
    const decision = str(a.action) === 'approve' ? 'approved' : str(a.action) === 'request_changes' ? 'changes_requested' : 'rejected'
    return { ...base, decision }
  },
} as const

// ── T13 · nomi_run_gate：Run 侧付费/创意门（含物化落地） ──────────────────────────────────
const RUN_GATE_TOOL = {
  name: 'nomi_run_gate',
  title: 'Run 的确认门：decide 对可逆创意门（方向/定妆照）approve/reject / materialize 把已批分镜落画布并登记 jobs+预算。',
  description: '按 action 处理 Run 的授权边界：decide 表态可逆创意门（不新增授权）；materialize 把已批分镜落地（登记 jobs/预算合同，不批准剧本/预算、不直接调付费模型）。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      runId: { type: 'string' },
      action: { type: 'string', enum: ['decide', 'materialize'] },
      // action=decide（可逆创意门）
      gateId: { type: 'string', description: 'action=decide：门 id，例如 gate-direction-v1。' },
      decision: { type: 'string', enum: ['approved', 'rejected'], description: 'action=decide：批准或否决。' },
      choiceKey: { type: 'string', description: 'action=decide 方向门专用：选中候选 key（来自 gate.waiting 的 directionCandidates）。' },
      // action=materialize（$ 落地）
      artifactId: { type: 'string', description: 'action=materialize：已批准的 storyboard artifact id。' },
      expectedVersion: { type: 'integer', minimum: 1, description: 'action=materialize：你刚读到的分镜版本；版本变化后拒绝，避免覆盖新稿。' },
    },
    required: ['projectId', 'runId', 'action'],
    additionalProperties: false,
  },
  method: 'production.decide-gate',
  resolveMethod: (a: Record<string, unknown>): string =>
    str(a.action) === 'materialize' ? 'production.storyboard.materialize' : 'production.decide-gate',
  build: (a: Record<string, unknown>): Record<string, unknown> => {
    if (str(a.action) === 'materialize') return { projectId: a.projectId, runId: a.runId, artifactId: a.artifactId, expectedVersion: a.expectedVersion }
    return { projectId: a.projectId, runId: a.runId, gateId: a.gateId, decision: a.decision, choiceKey: a.choiceKey }
  },
} as const

// ── T10 · nomi_run_start：耐久制作草稿入口（只记 brief+playbook，不批预算、不调付费模型） ────────
const RUN_START_TOOL = {
  name: 'nomi_run_start',
  title: '在项目里建一个可审阅的持久制作草稿（只记 brief + playbook，不批预算、不调付费模型）。',
  description: '创建一个可审阅的制作草稿。只记录 brief 与 playbook，不批准预算、不调用付费模型。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '目标 Nomi 项目 id' },
      playbook: {
        type: 'string',
        enum: listProductionPlaybookNames(),
        description: `制作 playbook。当前只实现了：${listProductionPlaybookNames().join('、')}；传其它值会被拒绝。`,
      },
      playbookVersion: { type: 'string', description: '可选版本；默认 1.0.0' },
      brief: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '要完成什么' },
          audience: { type: 'string' },
          channel: { type: 'string' },
          tone: { type: 'string' },
          durationSeconds: { type: 'number', minimum: 1, maximum: 3600 },
          sellingPoints: { type: 'array', maxItems: 20, items: { type: 'string' } },
          referenceArtifactIds: { type: 'array', maxItems: 20, items: { type: 'string' } },
        },
        required: ['goal'],
        additionalProperties: false,
      },
      trustLevel: {
        type: 'string',
        enum: ['key_confirm', 'budget_only', 'confirm_all'],
        description: '可选信任档位：key_confirm 默认（方向/样片门都停）/ budget_only 只管钱（跳过创意与样片门）/ confirm_all 每镜确认。用户一上来就说「别问了直接出」时设 budget_only。',
      },
    },
    required: ['projectId', 'playbook', 'brief'],
    additionalProperties: false,
  },
  method: 'production.start',
  build: (a: Record<string, unknown>): Record<string, unknown> => ({
    projectId: a.projectId,
    playbook: a.playbook,
    playbookVersion: a.playbookVersion,
    brief: a.brief,
    ...(a.trustLevel ? { trustLevel: a.trustLevel } : {}),
  }),
} as const

// ── T11 · nomi_run_control：持久制作 Run 控制（pause/resume/cancel/set_trust） ─────────────────
const RUN_CONTROL_TOOL = {
  name: 'nomi_run_control',
  title: '控制持久制作 Run：pause 暂停 / resume 从断点继续 / cancel 取消 / set_trust 改信任档位。',
  description: 'pause 保住已花预算与已完成镜头 / resume 不重做不重付 / cancel 未提交不计费 / set_trust 改档（配 trustLevel）。用户说「停一下/继续/别做了」用前三个；「别问了直接出」= set_trust 到 budget_only。',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      runId: { type: 'string' },
      action: { type: 'string', enum: ['pause', 'resume', 'cancel', 'set_trust'] },
      trustLevel: { type: 'string', enum: ['key_confirm', 'budget_only', 'confirm_all'], description: 'action=set_trust 时必填：key_confirm 五门全开 / budget_only 只管钱 / confirm_all 每镜确认' },
    },
    required: ['projectId', 'runId', 'action'],
    additionalProperties: false,
  },
  method: 'production.control',
  build: (a: Record<string, unknown>): Record<string, unknown> => ({ projectId: a.projectId, runId: a.runId, action: a.action, ...(a.trustLevel ? { trustLevel: a.trustLevel } : {}) }),
} as const

// ── T15 · nomi_project_create：建新项目（产出 projectId 的独立小对象写） ────────────────────────
const PROJECT_CREATE_TOOL = {
  name: 'nomi_project_create',
  title: '新建一个空白 Nomi 项目，返回项目 id。',
  description: '新建一个空白 Nomi 项目，返回项目 id。',
  inputSchema: { type: 'object', properties: { name: { type: 'string', description: '项目名（可选）' } }, additionalProperties: false },
  method: 'project.create',
  build: (a: Record<string, unknown>): Record<string, unknown> => (a.name ? { name: a.name } : {}),
} as const

// 工具定义：name → { title?, description, inputSchema(JSON Schema), method(能力核方法/内部路由键),
//   resolveMethod?(args→路由键), build(args→params), annotations? }。
export const MCP_TOOL_CATALOG = [
  MCP_PROJECT_SESSION_TOOL, // T1
  READ_TOOL, // T2（吸收 10 读）
  CANVAS_EDIT_TOOL, // T3（画布写=M2 语义租约面，吸收 4 画布写；删除/撤销在 nomi_canvas_maintenance）
  ASSET_IMPORT_TOOL, // T4
  ...MCP_GENERATION_TOOL_CATALOG, // T5/T6/T7/T8/T9（operation 族）
  RUN_START_TOOL, // T10
  RUN_CONTROL_TOOL, // T11
  ARTIFACT_REVIEW_TOOL, // T12（吸收 review + script/storyboard revision）
  RUN_GATE_TOOL, // T13（吸收 decide_gate + materialize）
  MCP_INTEGRATION_TOOL, // T14（接入状态机 9→5 action）
  PROJECT_CREATE_TOOL, // T15
  ...SEMANTIC_EDITING_TOOLS, // M2 语义编辑（canvas_plan/maintenance · document_read/edit · timeline_read/edit · export_job · media_query）——原样保留待续裁
] as const

export type McpToolDefinition = (typeof MCP_TOOL_CATALOG)[number] & {
  title?: string
  resolveMethod?: (args: Record<string, unknown>) => string
  annotations?: { readonly readOnlyHint: true }
  presentResult?: (result: unknown) => unknown
}

// 再导出整族路由映射，供测试逐条 assert 「旧 name 的 method+params ≡ 新 name 某枚举分支的 build 输出」。
export { READ_METHOD_BY_TARGET, INTEGRATION_METHOD_BY_ACTION }

const MCP_TOOL_SNAPSHOT = Object.freeze(MCP_TOOL_CATALOG.map((tool) => {
  const annotations = 'annotations' in tool && tool.annotations
    ? Object.freeze({ ...tool.annotations })
    : undefined
  return Object.freeze({
    ...tool,
    inputSchema: immutableSchemaSnapshot(tool.inputSchema),
    ...(annotations ? { annotations } : {}),
  })
})) as readonly McpToolDefinition[]

const MCP_TOOL_BY_NAME = new Map<string, McpToolDefinition>(
  MCP_TOOL_SNAPSHOT.map((tool) => [tool.name, tool]),
)

if (MCP_TOOL_BY_NAME.size !== MCP_TOOL_SNAPSHOT.length) {
  throw new Error('Duplicate MCP tool name in the explicit catalog')
}

/** tools/list and tools/call must share this exact post-filter resolver. */
export const MCP_TOOL_RESOLVER = Object.freeze({
  list: (): readonly McpToolDefinition[] => MCP_TOOL_SNAPSHOT,
  resolve: (name: string): McpToolDefinition | undefined => MCP_TOOL_BY_NAME.get(name),
})
